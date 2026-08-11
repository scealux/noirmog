import { use, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { TransformControls } from '@react-three/drei'
import { prepareHead } from '../lib/headMesh'
import { SLOT_FRAMES } from '../lib/projectionBaker'
import { useFittingStore } from '../state/fittingStore'
import { usePerformanceStore } from '../state/performanceStore'
import { useAppStore } from '../state/appStore'

/**
 * Substance-style projection gizmos:
 * - Step 1: a textured plane represents the active photo's projection; move /
 *   rotate / scale it with the gizmo and the bake parameters follow.
 * - Step 2: a frame over the face manipulates the front video mapping
 *   (face-fit offset/scale) the same way.
 */

const PROJ_COVER = 0.7 // the photo frame covers head-height / this fraction

export function ProjectionGizmos() {
  const currentStep = useAppStore((s) => s.currentStep)
  const gizmoMode = useFittingStore((s) => s.gizmoMode)
  if (!gizmoMode) return null
  if (currentStep === 1) return <PhotoGizmo mode={gizmoMode} />
  if (currentStep === 2) return <FrontGizmo mode={gizmoMode === 'rotate' ? 'translate' : gizmoMode} />
  return null
}

function usePhotoTexture(url: string | undefined): THREE.Texture | null {
  const [tex, setTex] = useState<THREE.Texture | null>(null)
  useEffect(() => {
    if (!url) {
      setTex(null)
      return
    }
    let cancelled = false
    void new THREE.TextureLoader().loadAsync(url).then((t) => {
      t.colorSpace = THREE.SRGBColorSpace
      if (!cancelled) setTex(t)
      else t.dispose()
    })
    return () => {
      cancelled = true
    }
  }, [url])
  return tex
}

function PhotoGizmo({ mode }: { mode: 'translate' | 'rotate' | 'scale' }) {
  const headModel = useFittingStore((s) => s.headModel)
  const head = use(prepareHead(headModel))
  const activeSlot = useFittingStore((s) => s.activeSlot)
  const photo = useFittingStore((s) => s.slotPhotos[s.activeSlot])
  const adjustSlotPhoto = useFittingStore((s) => s.adjustSlotPhoto)
  const texture = usePhotoTexture(photo?.url)
  const planeRef = useRef<THREE.Mesh>(null)
  const [planeReady, setPlaneReady] = useState(false)
  const dragStart = useRef<{ offsetX: number; offsetY: number; rotation: number; scale: number } | null>(null)

  const world = useMemo(() => {
    const box = new THREE.Box3().setFromObject(head.scene)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    return { size, center }
  }, [head])

  const frame = SLOT_FRAMES[activeSlot]
  const aspect = texture ? (texture.image as HTMLImageElement).naturalWidth / (texture.image as HTMLImageElement).naturalHeight : 1
  const H = world.size.y
  const baseH = H / PROJ_COVER
  const baseW = baseH * aspect

  // Canonical plane pose derived from the store (kept in sync outside drags).
  const syncFromStore = () => {
    const plane = planeRef.current
    if (!plane || !photo) return
    const posU = (-photo.offsetX * H * aspect * photo.scale) / PROJ_COVER
    const posV = (-photo.offsetY * H * photo.scale) / PROJ_COVER
    const dist = Math.max(world.size.x, world.size.z) * 0.9
    plane.position
      .copy(world.center)
      .addScaledVector(frame.view, dist)
      .addScaledVector(frame.uAxis, posU)
      .addScaledVector(frame.vAxis, posV)
    const m = new THREE.Matrix4().lookAt(
      frame.view.clone(),
      new THREE.Vector3(0, 0, 0),
      frame.vAxis.clone(),
    )
    plane.quaternion.setFromRotationMatrix(m)
    plane.rotateZ(THREE.MathUtils.degToRad(-photo.rotation))
    plane.scale.setScalar(photo.scale)
  }

  useEffect(syncFromStore, [photo, world, frame, aspect]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!photo || !texture) return null

  const onChange = () => {
    const plane = planeRef.current
    const start = dragStart.current
    if (!plane || !start) return
    if (mode === 'translate') {
      const rel = plane.position.clone().sub(world.center)
      const a = rel.dot(frame.uAxis)
      const b = rel.dot(frame.vAxis)
      adjustSlotPhoto(activeSlot, 'offsetX', (-a * PROJ_COVER) / (H * aspect * start.scale))
      adjustSlotPhoto(activeSlot, 'offsetY', (-b * PROJ_COVER) / (H * start.scale))
    } else if (mode === 'rotate') {
      // Rotation about the projection axis = plane's local Z spin.
      const m = new THREE.Matrix4().lookAt(frame.view.clone(), new THREE.Vector3(0, 0, 0), frame.vAxis.clone())
      const baseQ = new THREE.Quaternion().setFromRotationMatrix(m)
      const rel = baseQ.invert().multiply(plane.quaternion)
      const e = new THREE.Euler().setFromQuaternion(rel, 'ZYX')
      adjustSlotPhoto(activeSlot, 'rotation', -THREE.MathUtils.radToDeg(e.z))
    } else {
      adjustSlotPhoto(activeSlot, 'scale', Math.min(2, Math.max(0.5, plane.scale.x)))
    }
  }

  return (
    <>
      <mesh
        ref={(m) => {
          planeRef.current = m
          if (m && !planeReady) setPlaneReady(true)
        }}
      >
        <planeGeometry args={[baseW, baseH]} />
        <meshBasicMaterial map={texture} transparent opacity={0.55} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      {planeReady && planeRef.current && (
        <TransformControls
          object={planeRef.current}
          mode={mode}
          size={0.7}
          onMouseDown={() => {
            dragStart.current = { offsetX: photo.offsetX, offsetY: photo.offsetY, rotation: photo.rotation, scale: photo.scale }
          }}
          onMouseUp={() => {
            dragStart.current = null
            syncFromStore()
          }}
          onObjectChange={onChange}
        />
      )}
    </>
  )
}

function FrontGizmo({ mode }: { mode: 'translate' | 'scale' }) {
  const headModel = useFittingStore((s) => s.headModel)
  const head = use(prepareHead(headModel))
  const tracking = usePerformanceStore((s) => s.tracking)
  const faceFit = usePerformanceStore((s) => s.faceFit)
  const setFaceFit = usePerformanceStore((s) => s.setFaceFit)
  const planeRef = useRef<THREE.Mesh>(null)
  const [planeReady, setPlaneReady] = useState(false)
  const dragStart = useRef<{ scale: number } | null>(null)

  const world = useMemo(() => {
    const box = new THREE.Box3().setFromObject(head.scene)
    return { size: box.getSize(new THREE.Vector3()), center: box.getCenter(new THREE.Vector3()) }
  }, [head])
  const headScale = head.scene.scale.x || 1

  const syncFromStore = () => {
    const plane = planeRef.current
    if (!plane) return
    plane.position.set(
      world.center.x + faceFit.offsetX * headScale,
      world.center.y + world.size.y * 0.12 + faceFit.offsetY * headScale,
      world.center.z + world.size.z * 0.75,
    )
    plane.scale.setScalar(faceFit.scale)
    plane.quaternion.identity()
  }
  useEffect(syncFromStore, [faceFit, world, headScale]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!tracking) return null
  const baseH = world.size.y * 0.42

  const onChange = () => {
    const plane = planeRef.current
    if (!plane) return
    if (mode === 'translate') {
      setFaceFit('offsetX', (plane.position.x - world.center.x) / headScale)
      setFaceFit('offsetY', (plane.position.y - (world.center.y + world.size.y * 0.12)) / headScale)
    } else {
      setFaceFit('scale', Math.min(1.35, Math.max(0.85, plane.scale.x)))
    }
  }

  return (
    <>
      <mesh
        ref={(m) => {
          planeRef.current = m
          if (m && !planeReady) setPlaneReady(true)
        }}
      >
        <planeGeometry args={[baseH * 0.8, baseH]} />
        <meshBasicMaterial color="#d9a441" transparent opacity={0.14} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      {planeReady && planeRef.current && (
        <TransformControls
          object={planeRef.current}
          mode={mode}
          size={0.6}
          showZ={false}
          onMouseDown={() => {
            dragStart.current = { scale: faceFit.scale }
          }}
          onMouseUp={() => {
            dragStart.current = null
            syncFromStore()
          }}
          onObjectChange={onChange}
        />
      )}
    </>
  )
}
