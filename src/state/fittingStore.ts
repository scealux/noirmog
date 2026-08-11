import { create } from 'zustand'
import {
  DEFAULT_HEAD_MORPH,
  type HeadMorphSettings,
} from '../lib/headMesh'
import { canonicalVertex } from '../lib/canonicalFace'
import type { PhotoSlot, SlotPhotos } from '../lib/projectionBaker'

export const DEFAULT_SLOT_PHOTO = { scale: 1, offsetX: 0, offsetY: 0, exposure: 1 }

/**
 * Landmarks used to measure facial proportions. These are the draggable points
 * in the Step 1 photo view; positions are normalized photo coords (0..1).
 */
export const KEY_POINTS = [
  { index: 10, label: 'Forehead top' },
  { index: 152, label: 'Chin' },
  { index: 234, label: 'Face edge L' },
  { index: 454, label: 'Face edge R' },
  { index: 172, label: 'Jaw corner L' },
  { index: 397, label: 'Jaw corner R' },
] as const

export type KeyPointMap = Record<number, [number, number]>

interface PhotoInfo {
  url: string
  width: number
  height: number
}

interface FittingState {
  frontPhoto: PhotoInfo | null
  sidePhoto: PhotoInfo | null
  /** Draggable measurement points on the front photo (normalized coords). */
  keyPoints: KeyPointMap
  morph: HeadMorphSettings
  /** Bumped whenever the head geometry changes so dependents re-fit. */
  morphVersion: number

  /** Side/back reference photos for the baked base texture. */
  slotPhotos: SlotPhotos
  mirrorFill: boolean
  /** Bumped whenever the baked base texture must be regenerated. */
  bakeVersion: number

  setFrontPhoto: (photo: PhotoInfo | null) => void
  setSidePhoto: (photo: PhotoInfo | null) => void
  setKeyPoints: (points: KeyPointMap) => void
  moveKeyPoint: (index: number, x: number, y: number) => void
  setMorphValue: (key: keyof HeadMorphSettings, value: number) => void
  setMorph: (morph: HeadMorphSettings) => void
  bumpMorphVersion: () => void
  resetMorph: () => void

  setSlotPhoto: (slot: PhotoSlot, url: string | null) => void
  adjustSlotPhoto: (slot: PhotoSlot, key: 'scale' | 'offsetX' | 'offsetY' | 'exposure', value: number) => void
  setMirrorFill: (v: boolean) => void
}

export const useFittingStore = create<FittingState>((set) => ({
  frontPhoto: null,
  sidePhoto: null,
  keyPoints: {},
  morph: { ...DEFAULT_HEAD_MORPH },
  morphVersion: 0,
  slotPhotos: {},
  mirrorFill: true,
  bakeVersion: 0,

  setFrontPhoto: (photo) => set({ frontPhoto: photo, keyPoints: {} }),
  setSidePhoto: (photo) => set({ sidePhoto: photo }),
  setKeyPoints: (points) => set({ keyPoints: points }),
  moveKeyPoint: (index, x, y) =>
    set((s) => ({ keyPoints: { ...s.keyPoints, [index]: [x, y] } })),
  setMorphValue: (key, value) => set((s) => ({ morph: { ...s.morph, [key]: value } })),
  setMorph: (morph) => set({ morph }),
  bumpMorphVersion: () => set((s) => ({ morphVersion: s.morphVersion + 1 })),
  resetMorph: () => set({ morph: { ...DEFAULT_HEAD_MORPH } }),

  setSlotPhoto: (slot, url) =>
    set((s) => {
      const slotPhotos = { ...s.slotPhotos }
      if (url) slotPhotos[slot] = { ...DEFAULT_SLOT_PHOTO, url }
      else delete slotPhotos[slot]
      return { slotPhotos, bakeVersion: s.bakeVersion + 1 }
    }),
  adjustSlotPhoto: (slot, key, value) =>
    set((s) => {
      const photo = s.slotPhotos[slot]
      if (!photo) return s
      return {
        slotPhotos: { ...s.slotPhotos, [slot]: { ...photo, [key]: value } },
        bakeVersion: s.bakeVersion + 1,
      }
    }),
  setMirrorFill: (v) => set((s) => ({ mirrorFill: v, bakeVersion: s.bakeVersion + 1 })),
}))

if (import.meta.env.DEV) {
  ;(window as Window & { __noirmogFitting?: typeof useFittingStore }).__noirmogFitting =
    useFittingStore
}

const dist = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1])

function canonicalXY(i: number): [number, number] {
  const [x, y] = canonicalVertex(i)
  return [x, y]
}

/**
 * Derive coarse morph values by comparing facial proportions measured on the
 * photo against the same proportions on the canonical face. Ratios of ratios,
 * so photo scale/position don't matter (aspect ratio must be corrected by the
 * caller via aspect = photoWidth / photoHeight).
 */
export function morphFromKeyPoints(points: KeyPointMap, aspect: number): Partial<HeadMorphSettings> {
  const get = (i: number): [number, number] | null =>
    points[i] ? [points[i][0] * aspect, points[i][1]] : null

  const forehead = get(10)
  const chin = get(152)
  const faceL = get(234)
  const faceR = get(454)
  const jawL = get(172)
  const jawR = get(397)
  if (!forehead || !chin || !faceL || !faceR) return {}

  const faceLen = dist(forehead, chin)
  const faceWidth = dist(faceL, faceR)
  if (faceLen < 1e-6) return {}

  const cForehead = canonicalXY(10)
  const cChin = canonicalXY(152)
  const cFaceL = canonicalXY(234)
  const cFaceR = canonicalXY(454)
  const cFaceLen = dist(cForehead, cChin)
  const cFaceWidth = dist(cFaceL, cFaceR)

  const clamp = (v: number) => Math.min(1.25, Math.max(0.8, v))
  const result: Partial<HeadMorphSettings> = {
    faceWidth: clamp(faceWidth / faceLen / (cFaceWidth / cFaceLen)),
  }

  if (jawL && jawR) {
    const jawWidth = dist(jawL, jawR)
    const cJawWidth = dist(canonicalXY(172), canonicalXY(397))
    result.jawWidth = clamp(jawWidth / faceWidth / (cJawWidth / cFaceWidth))
  }
  return result
}
