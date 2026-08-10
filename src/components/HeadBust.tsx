import { use, useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { prepareHead } from '../lib/headMesh'
import { FaceTextureWarper } from '../lib/faceWarper'
import { ChannelSampler, applyChannels, type ChannelValues } from '../lib/channels'
import { frameForTime, landmarksForFrame } from '../lib/trackingData'
import { getPerformanceVideo, usePerformanceStore } from '../state/performanceStore'

const NEUTRAL_SKIN = new THREE.Color('#9a8578')

/**
 * The animated bust: prepared head mesh, video-texture warp target as its map,
 * and channel-driven motion (head rotation + jawOpen) synced to the video.
 */
export function HeadBust() {
  const head = use(prepareHead())
  const tracking = usePerformanceStore((s) => s.tracking)
  const gl = useThree((s) => s.gl)

  const groupRef = useRef<THREE.Group>(null)
  const meshRef = useRef<THREE.Mesh>(null)
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

  const warper = useMemo(() => {
    if (!tracking) return null
    return new FaceTextureWarper(head.landmarkUV, getPerformanceVideo(), tracking.skinColor)
  }, [tracking, head])

  const sampler = useMemo(() => (tracking ? new ChannelSampler(tracking) : null), [tracking])

  useEffect(() => {
    if (warper) {
      material.map = warper.texture
      material.color.set('#ffffff')
    } else {
      material.map = null
      material.color.copy(NEUTRAL_SKIN)
    }
    material.needsUpdate = true
    return () => warper?.dispose()
  }, [warper, material])

  // Three only initializes morphTargetInfluences from geometry at construction.
  useEffect(() => {
    meshRef.current?.updateMorphTargets()
  }, [head])

  useFrame(() => {
    if (!tracking || !warper || !sampler || !groupRef.current || !meshRef.current) return
    const video = getPerformanceVideo()
    const frame = frameForTime(tracking, video.currentTime)
    warper.update(landmarksForFrame(tracking, frame))
    warper.render(gl)
    const values = sampler.sample(frame, channelsRef.current)
    applyChannels(values, { headGroup: groupRef.current, mesh: meshRef.current })
  })

  return (
    <group ref={groupRef} position={head.pivot}>
      <mesh
        ref={meshRef}
        geometry={head.geometry}
        material={material}
        position={head.pivot.clone().negate()}
      />
    </group>
  )
}
