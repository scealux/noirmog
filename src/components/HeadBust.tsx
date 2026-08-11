import { use, useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { prepareHead } from '../lib/headMesh'
import { FaceTextureWarper } from '../lib/faceWarper'
import { ChannelSampler, applyChannels, type ChannelValues } from '../lib/channels'
import { frameForTime, landmarksForFrame } from '../lib/trackingData'
import { getPerformanceVideo, usePerformanceStore } from '../state/performanceStore'
import { useFittingStore } from '../state/fittingStore'
import { ProjectionBaker } from '../lib/projectionBaker'

const NEUTRAL_SKIN = new THREE.Color('#9a8578')

/**
 * The animated bust: rigged head mesh, video-texture warp target as its map,
 * and channel-driven bones (neck/head rotation + jaw) synced to the video.
 */
export function HeadBust() {
  const headModel = useFittingStore((s) => s.headModel)
  const head = use(prepareHead(headModel))
  const tracking = usePerformanceStore((s) => s.tracking)
  const faceFit = usePerformanceStore((s) => s.faceFit)
  const gl = useThree((s) => s.gl)

  const channelsRef = useRef<ChannelValues>({})

  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: NEUTRAL_SKIN.clone(),
        roughness: 0.9,
        metalness: 0,
      }),
    [],
  )

  // The skinned mesh renders with our material (video texture once tracked).
  useEffect(() => {
    head.skinnedMesh.material = material
  }, [head, material])

  // morphVersion re-fits the face texture after Step 1 morphs the head.
  const morphVersion = useFittingStore((s) => s.morphVersion)
  const landmarkUV = useMemo(
    () => head.mapToUV({ scale: faceFit.scale, offsetY: faceFit.offsetY }),
    // morphVersion is an external mutation signal for the head geometry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [head, faceFit.scale, faceFit.offsetY, morphVersion],
  )

  const warper = useMemo(() => {
    if (!tracking) return null
    const state = usePerformanceStore.getState()
    return new FaceTextureWarper(
      head.mapToUV({ scale: state.faceFit.scale, offsetY: state.faceFit.offsetY }),
      getPerformanceVideo(),
      tracking.skinColor,
      state.faceFit.feather,
    )
  }, [tracking, head])

  // Live-apply face-fit edits without rebuilding the warper.
  useEffect(() => {
    warper?.setLandmarkUV(landmarkUV)
  }, [warper, landmarkUV])
  useEffect(() => {
    warper?.setFeather(faceFit.feather)
  }, [warper, faceFit.feather])

  const skinColorOverride = usePerformanceStore((s) => s.skinColorOverride)
  const bakeVersion = useFittingStore((s) => s.bakeVersion)

  const baker = useMemo(() => new ProjectionBaker(head.geometry), [head])
  useEffect(() => () => baker.dispose(), [baker])

  // Baked side-fill photos: behind the live face when tracked, directly on
  // the head material when not — photos are visible as soon as they load.
  // Debounced + serialized so slider drags don't flood the GPU (that froze
  // the app before).
  useEffect(() => {
    const { slotPhotos, mirrorFill } = useFittingStore.getState()
    const skin = skinColorOverride ?? tracking?.skinColor ?? [154, 133, 120]
    if (Object.keys(slotPhotos).length === 0) {
      warper?.setBackgroundColor(skin as [number, number, number])
      if (!warper) {
        material.map = null
        material.color.copy(NEUTRAL_SKIN)
        material.needsUpdate = true
      }
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      void baker.bake(gl, slotPhotos, skin as [number, number, number], mirrorFill).then(() => {
        if (cancelled) return
        if (warper) {
          warper.setBackgroundTexture(baker.texture)
        } else {
          material.map = baker.texture
          material.color.set('#ffffff')
          material.needsUpdate = true
        }
      })
    }, 150)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warper, tracking, skinColorOverride, bakeVersion, baker, gl, material])

  const sampler = useMemo(() => (tracking ? new ChannelSampler(tracking) : null), [tracking])

  useEffect(() => {
    if (warper) {
      material.map = warper.texture
      material.color.set('#ffffff')
      material.needsUpdate = true
    }
    // No-warper appearance (neutral or baked photos) is handled by the bake
    // effect above so the two never fight over material.map.
    return () => warper?.dispose()
  }, [warper, material])

  useFrame(() => {
    if (!tracking || !warper || !sampler) return
    const video = getPerformanceVideo()
    const frame = frameForTime(tracking, video.currentTime)
    warper.update(landmarksForFrame(tracking, frame))
    warper.render(gl)
    const settings = usePerformanceStore.getState().channelSettings
    const values = sampler.sample(frame, settings, channelsRef.current)
    applyChannels(values, head.rig)
  })

  return <primitive object={head.scene} />
}
