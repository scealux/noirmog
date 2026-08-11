import * as THREE from 'three'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import { runTask, PipelineError } from '../runTask'
import { downloadBlob, downloadText } from '../download'
import { prepareHead } from '../headMesh'
import { ChannelSampler } from '../channels'
import { usePerformanceStore } from '../../state/performanceStore'
import { frameForTime } from '../trackingData'
import { VIEWER_HTML } from './viewerTemplate'

function exportBasename(): string {
  const name = usePerformanceStore.getState().videoName ?? 'performance'
  return 'noirmog-' + name.replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '_')
}

async function exportHeadGLB(): Promise<Blob> {
  const head = await prepareHead()
  // Export a clone-free scene: temporarily strip the live video material so
  // the GLB carries a plain material (the viewer wires the video texture).
  const mesh = head.skinnedMesh
  const liveMaterial = mesh.material
  mesh.material = new THREE.MeshStandardMaterial({ roughness: 0.9 })
  try {
    const result = await new GLTFExporter().parseAsync(head.scene, { binary: true })
    return new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' })
  } finally {
    mesh.material = liveMaterial
  }
}

function channelsJSON(): string {
  const { tracking, trimStart, trimEnd, channelSettings } = usePerformanceStore.getState()
  if (!tracking) throw new PipelineError('Track a performance first')
  const sampler = new ChannelSampler(tracking)
  const startFrame = frameForTime(tracking, trimStart)
  const endFrame = frameForTime(tracking, trimEnd)
  const frames: number[][] = []
  const values: Record<string, number> = {}
  for (let f = startFrame; f <= endFrame; f++) {
    sampler.sample(f, channelSettings, values)
    frames.push([
      +values.headYaw.toFixed(5),
      +values.headPitch.toFixed(5),
      +values.headRoll.toFixed(5),
      +values.jawOpen.toFixed(4),
    ])
  }
  return JSON.stringify({
    fps: tracking.fps,
    channelOrder: ['headYaw', 'headPitch', 'headRoll', 'jawOpen'],
    neckShare: 0.3,
    frames,
  })
}

/**
 * Export 1: GLB + (separate) texture video + channels JSON + a small
 * self-contained Three.js viewer that wires them together. The texture video
 * comes from the "UV texture video" export; this bundle carries everything
 * else so game engines / the viewer can reassemble the bust.
 */
export async function exportGLBBundle(): Promise<void> {
  await runTask(
    'Export GLB bundle',
    [
      { id: 'glb', label: 'Exporting head GLB', weight: 2 },
      { id: 'channels', label: 'Baking channel curves', weight: 1 },
      { id: 'viewer', label: 'Writing viewer', weight: 1 },
    ],
    async (ctx) => {
      const base = exportBasename()
      const glbStage = ctx.stage('glb')
      const glb = await exportHeadGLB()
      downloadBlob(glb, `${base}.glb`)
      glbStage.done()

      const ch = ctx.stage('channels')
      downloadText(channelsJSON(), `${base}-channels.json`, 'application/json')
      ch.done()

      const viewer = ctx.stage('viewer')
      downloadText(
        VIEWER_HTML.replaceAll('__BASENAME__', base),
        `${base}-viewer.html`,
        'text/html',
      )
      viewer.done()

      ctx.log('success', `GLB bundle exported (${(glb.size / 1e6).toFixed(2)} MB GLB)`)
      ctx.log(
        'info',
        'Also run "UV texture video" export, keep all files in one folder, and open the viewer HTML via a local server.',
      )
    },
  )
}

/**
 * Export 2: GLB with the animated texture baked in as a JPEG frame sequence
 * (in scene extras). Expected to be huge — this exists so real sizes can be
 * measured and compared against the GLB + video-file approach.
 */
export async function exportBakedGLB(): Promise<void> {
  const { tracking, trimStart, trimEnd } = usePerformanceStore.getState()
  if (!tracking) throw new PipelineError('Track a performance first')

  await runTask(
    'Export baked-texture GLB',
    [
      { id: 'bake', label: 'Baking texture frames', weight: 6 },
      { id: 'glb', label: 'Exporting GLB', weight: 2 },
    ],
    async (ctx) => {
      const bake = ctx.stage('bake')
      const head = await prepareHead()

      // Bake at reduced rate/size to keep this measurable rather than absurd.
      const BAKE_FPS = 15
      const BAKE_SIZE = 512
      const { FaceTextureWarper } = await import('../faceWarper')
      const { getPerformanceVideo } = await import('../../state/performanceStore')
      const { landmarksForFrame } = await import('../trackingData')
      const state = usePerformanceStore.getState()

      const canvas = document.createElement('canvas')
      canvas.width = BAKE_SIZE
      canvas.height = BAKE_SIZE
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: false })
      renderer.setSize(BAKE_SIZE, BAKE_SIZE, false)
      const warper = new FaceTextureWarper(
        head.mapToUV({ scale: state.faceFit.scale, offsetY: state.faceFit.offsetY }),
        getPerformanceVideo(),
        state.skinColorOverride ?? tracking.skinColor,
        state.faceFit.feather,
      )

      const video = getPerformanceVideo()
      video.pause()
      const frameCount = Math.max(1, Math.floor((trimEnd - trimStart) * BAKE_FPS))
      const framesData: string[] = []
      try {
        for (let i = 0; i < frameCount; i++) {
          const t = trimStart + i / BAKE_FPS
          video.currentTime = Math.min(t, trimEnd - 0.001)
          await new Promise<void>((resolve) => {
            const onSeeked = () => {
              video.removeEventListener('seeked', onSeeked)
              resolve()
            }
            video.addEventListener('seeked', onSeeked)
          })
          warper.update(landmarksForFrame(tracking, frameForTime(tracking, video.currentTime)))
          warper.renderToCanvas(renderer)
          framesData.push(canvas.toDataURL('image/jpeg', 0.7))
          bake.set((i + 1) / frameCount, `Baking frames: ${i + 1}/${frameCount}`)
        }
      } finally {
        warper.dispose()
        renderer.dispose()
      }
      bake.done()

      const glbStage = ctx.stage('glb')
      const prevUserData = head.scene.userData
      head.scene.userData = {
        ...prevUserData,
        noirmogBakedTexture: { fps: BAKE_FPS, size: BAKE_SIZE, frames: framesData },
      }
      const mesh = head.skinnedMesh
      const liveMaterial = mesh.material
      mesh.material = new THREE.MeshStandardMaterial({ roughness: 0.9 })
      try {
        const result = await new GLTFExporter().parseAsync(head.scene, { binary: true })
        const blob = new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' })
        downloadBlob(blob, `${exportBasename()}-baked.glb`)
        ctx.log(
          'success',
          `Baked GLB: ${(blob.size / 1e6).toFixed(1)} MB (${framesData.length} frames @ ${BAKE_FPS}fps, ${BAKE_SIZE}px)`,
        )
      } finally {
        mesh.material = liveMaterial
        head.scene.userData = prevUserData
      }
      glbStage.done()
    },
  )
}
