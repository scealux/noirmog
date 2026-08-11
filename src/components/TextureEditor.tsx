import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { prepareHead } from '../lib/headMesh'
import { ProjectionBaker } from '../lib/projectionBaker'
import { useFittingStore } from '../state/fittingStore'
import { usePerformanceStore } from '../state/performanceStore'

const PREVIEW_SIZE = 272

/**
 * 2D live view of the baked head texture with direct manipulation of the
 * active photo: drag to move, wheel to zoom, Shift+drag to rotate.
 * (First slice of the planned projection-editor suite.)
 */
export function TextureEditor() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const bakerRef = useRef<ProjectionBaker | null>(null)
  const drag = useRef<{ x: number; y: number; rotating: boolean } | null>(null)

  const bakeVersion = useFittingStore((s) => s.bakeVersion)
  const headModel = useFittingStore((s) => s.headModel)
  const hasPhotos = useFittingStore((s) => Object.keys(s.slotPhotos).length > 0)
  const skinColorOverride = usePerformanceStore((s) => s.skinColorOverride)

  // Renderer + baker lifecycle (baker re-keys with the head model).
  useEffect(() => {
    if (!hasPhotos) return
    let cancelled = false
    const canvas = canvasRef.current
    if (!canvas) return
    rendererRef.current ??= new THREE.WebGLRenderer({ canvas, antialias: false })
    rendererRef.current.setSize(PREVIEW_SIZE, PREVIEW_SIZE, false)
    void prepareHead(headModel).then((head) => {
      if (cancelled) return
      bakerRef.current?.dispose()
      bakerRef.current = new ProjectionBaker(head.geometry)
      const s = useFittingStore.getState()
      const skin =
        usePerformanceStore.getState().skinColorOverride ??
        usePerformanceStore.getState().tracking?.skinColor ??
        ([154, 133, 120] as [number, number, number])
      void bakerRef.current.bakeToCanvas(rendererRef.current!, s.slotPhotos, skin, s.mirrorFill)
    })
    return () => {
      cancelled = true
    }
  }, [headModel, hasPhotos])

  // Re-render the preview on any bake-affecting change (debounced).
  useEffect(() => {
    if (!hasPhotos) return
    const timer = setTimeout(() => {
      const renderer = rendererRef.current
      const baker = bakerRef.current
      if (!renderer || !baker) return
      const s = useFittingStore.getState()
      const skin =
        skinColorOverride ??
        usePerformanceStore.getState().tracking?.skinColor ??
        ([154, 133, 120] as [number, number, number])
      void baker.bakeToCanvas(renderer, s.slotPhotos, skin, s.mirrorFill)
    }, 120)
    return () => clearTimeout(timer)
  }, [bakeVersion, skinColorOverride, hasPhotos])

  useEffect(
    () => () => {
      bakerRef.current?.dispose()
      bakerRef.current = null
      rendererRef.current?.dispose()
      rendererRef.current = null
    },
    [],
  )

  if (!hasPhotos) return null

  const adjust = (key: 'scale' | 'offsetX' | 'offsetY' | 'rotation', delta: number) => {
    const s = useFittingStore.getState()
    const photo = s.slotPhotos[s.activeSlot]
    if (!photo) return
    const limits: Record<string, [number, number]> = {
      scale: [0.5, 2],
      offsetX: [-0.4, 0.4],
      offsetY: [-0.4, 0.4],
      rotation: [-30, 30],
    }
    const [lo, hi] = limits[key]
    s.adjustSlotPhoto(s.activeSlot, key, Math.min(hi, Math.max(lo, photo[key] + delta)))
  }

  return (
    <div className="texture-editor">
      <canvas
        ref={canvasRef}
        width={PREVIEW_SIZE}
        height={PREVIEW_SIZE}
        className="fitting-canvas"
        style={{ aspectRatio: '1 / 1' }}
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY, rotating: e.shiftKey }
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          if (!drag.current) return
          const dx = e.clientX - drag.current.x
          const dy = e.clientY - drag.current.y
          drag.current = { ...drag.current, x: e.clientX, y: e.clientY }
          if (drag.current.rotating) {
            adjust('rotation', dx * 0.2)
          } else {
            // Dragging the texture moves the projected photo with the cursor.
            adjust('offsetX', -dx / PREVIEW_SIZE)
            adjust('offsetY', dy / PREVIEW_SIZE)
          }
        }}
        onPointerUp={(e) => {
          drag.current = null
          e.currentTarget.releasePointerCapture(e.pointerId)
        }}
        onWheel={(e) => adjust('scale', e.deltaY < 0 ? 0.04 : -0.04)}
      />
      <p>
        Baked texture (active tab edits): drag to move · wheel to zoom · Shift+drag to rotate.
      </p>
    </div>
  )
}
