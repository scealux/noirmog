import * as THREE from 'three'
import { runTask, PipelineError } from '../runTask'
import { recordRealtime } from './recordRealtime'
import { downloadBlob } from '../download'
import { FaceTextureWarper } from '../faceWarper'
import { prepareHead } from '../headMesh'
import { landmarksForFrame, frameForTime } from '../trackingData'
import { usePerformanceStore, getPerformanceVideo } from '../../state/performanceStore'
import { viewportHandle } from '../viewportHandle'

function exportBasename(): string {
  const name = usePerformanceStore.getState().videoName ?? 'performance'
  return 'noirmog-' + name.replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '_')
}

function extFor(mimeType: string): string {
  return mimeType.includes('mp4') ? 'mp4' : 'webm'
}

/**
 * Export 3: the stabilized UV face-texture video with audio — the raw
 * pipeline asset, rendered at texture resolution in real time.
 */
export async function exportTextureVideo(): Promise<void> {
  const { tracking, trimStart, trimEnd, faceFit, skinColorOverride } =
    usePerformanceStore.getState()
  if (!tracking) throw new PipelineError('Track a performance first')

  await runTask(
    'Export UV texture video',
    [
      { id: 'setup', label: 'Setting up renderer', weight: 1 },
      { id: 'record', label: 'Recording texture video', weight: 8 },
    ],
    async (ctx) => {
      const setup = ctx.stage('setup')
      const head = await prepareHead()
      const canvas = document.createElement('canvas')
      canvas.width = 1024
      canvas.height = 1024
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: false })
      renderer.setSize(1024, 1024, false)
      const warper = new FaceTextureWarper(
        head.mapToUV({ scale: faceFit.scale, offsetY: faceFit.offsetY }),
        getPerformanceVideo(),
        skinColorOverride ?? tracking.skinColor,
        faceFit.feather,
      )
      setup.done()

      try {
        const record = ctx.stage('record')
        const { blob, mimeType } = await recordRealtime({
          canvas,
          trimStart,
          trimEnd,
          withAudio: true,
          stage: record,
          onFrame: (t) => {
            warper.update(landmarksForFrame(tracking, frameForTime(tracking, t)))
            warper.renderToCanvas(renderer)
          },
        })
        record.done()
        downloadBlob(blob, `${exportBasename()}-uv-texture.${extFor(mimeType)}`)
        ctx.log('success', `Texture video: ${(blob.size / 1e6).toFixed(1)} MB (${mimeType})`)
      } finally {
        warper.dispose()
        renderer.dispose()
      }
    },
  )
}

/**
 * Export 4: rendered video of the animated 3D bust — records the live
 * viewport canvas while the trimmed performance plays.
 */
export async function exportBustVideo(): Promise<void> {
  const { tracking, trimStart, trimEnd } = usePerformanceStore.getState()
  if (!tracking) throw new PipelineError('Track a performance first')
  const canvas = viewportHandle.canvas
  if (!canvas)
    throw new PipelineError('Viewport is not ready', 'Wait for the 3D view to load, then retry.')

  await runTask(
    'Export rendered bust video',
    [{ id: 'record', label: 'Recording viewport', weight: 1 }],
    async (ctx) => {
      const record = ctx.stage('record')
      const { blob, mimeType } = await recordRealtime({
        canvas,
        trimStart,
        trimEnd,
        withAudio: true,
        stage: record,
        // The viewport's own render loop draws the bust each frame.
      })
      record.done()
      downloadBlob(blob, `${exportBasename()}-bust.${extFor(mimeType)}`)
      ctx.log('success', `Bust video: ${(blob.size / 1e6).toFixed(1)} MB (${mimeType})`)
      ctx.log('info', 'Keep the tab visible during this export — the viewport pauses in hidden tabs.')
    },
  )
}
