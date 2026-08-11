import { useFittingStore } from '../state/fittingStore'
import { usePerformanceStore } from '../state/performanceStore'
import { useTaskStore } from '../state/taskStore'
import type { PhotoSlot, SlotPhotos } from './projectionBaker'

/**
 * Session persistence so a refresh doesn't wipe the setup:
 * - small settings (morphs, fits, adjustments, key points) -> localStorage
 * - reference photos (multi-MB blobs, too big for localStorage) -> IndexedDB
 * The performance video itself is NOT persisted — re-load and re-track.
 */

const SETTINGS_KEY = 'noirmog.settings.v1'
const DB_NAME = 'noirmog'
const PHOTO_STORE = 'photos'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(PHOTO_STORE)) {
        req.result.createObjectStore(PHOTO_STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbPut(key: string, blob: Blob): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(PHOTO_STORE, 'readwrite')
    tx.objectStore(PHOTO_STORE).put(blob, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function idbDelete(key: string): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(PHOTO_STORE, 'readwrite')
    tx.objectStore(PHOTO_STORE).delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function idbGet(key: string): Promise<Blob | null> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTO_STORE, 'readonly')
    const req = tx.objectStore(PHOTO_STORE).get(key)
    req.onsuccess = () => resolve((req.result as Blob) ?? null)
    req.onerror = () => reject(req.error)
  })
}

/** Persist a photo blob (fetched from its object URL) under a slot key. */
export function persistPhoto(key: string, url: string): void {
  void fetch(url)
    .then((r) => r.blob())
    .then((blob) => idbPut(key, blob))
    .catch(() => {
      // Persistence is best-effort; the session still works without it.
    })
}

export function removePersistedPhoto(key: string): void {
  void idbDelete(key).catch(() => {})
}

interface PersistedSettings {
  morph: unknown
  keyPoints: unknown
  mirrorFill: boolean
  headModel: string
  slotAdjust: Record<string, { scale: number; offsetX: number; offsetY: number; exposure: number; rotation: number }>
  faceFit: unknown
  channelSettings: unknown
}

let saveTimer = 0

function saveSettings(): void {
  clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    try {
      const fit = useFittingStore.getState()
      const perf = usePerformanceStore.getState()
      const slotAdjust: PersistedSettings['slotAdjust'] = {}
      for (const [slot, photo] of Object.entries(fit.slotPhotos)) {
        slotAdjust[slot] = {
          scale: photo.scale,
          offsetX: photo.offsetX,
          offsetY: photo.offsetY,
          exposure: photo.exposure,
          rotation: photo.rotation,
        }
      }
      const settings: PersistedSettings = {
        morph: fit.morph,
        keyPoints: fit.keyPoints,
        mirrorFill: fit.mirrorFill,
        headModel: fit.headModel,
        slotAdjust,
        faceFit: perf.faceFit,
        channelSettings: perf.channelSettings,
      }
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
    } catch {
      // Best-effort.
    }
  }, 500)
}

async function restore(): Promise<void> {
  const log = useTaskStore.getState().log
  let settings: Partial<PersistedSettings> = {}
  try {
    settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}')
  } catch {
    settings = {}
  }

  const fit = useFittingStore.getState()
  const perf = usePerformanceStore.getState()
  if (settings.morph) fit.setMorph(settings.morph as never)
  if (settings.keyPoints) fit.setKeyPoints(settings.keyPoints as never)
  if (typeof settings.mirrorFill === 'boolean') fit.setMirrorFill(settings.mirrorFill)
  if (settings.headModel === 'classic' || settings.headModel === 'detailed') {
    fit.setHeadModel(settings.headModel)
  }
  if (settings.faceFit) {
    for (const [k, v] of Object.entries(settings.faceFit as Record<string, number>)) {
      perf.setFaceFit(k as never, v as never)
    }
  }
  if (settings.channelSettings) {
    for (const [k, v] of Object.entries(settings.channelSettings as Record<string, number>)) {
      perf.setChannelSetting(k as never, v as never)
    }
  }

  // Restore photos from IndexedDB.
  const slots: PhotoSlot[] = ['left', 'right', 'back', 'top']
  const restored: SlotPhotos = {}
  for (const slot of slots) {
    const blob = await idbGet(`slot:${slot}`).catch(() => null)
    if (!blob) continue
    const adjust = settings.slotAdjust?.[slot]
    restored[slot] = {
      url: URL.createObjectURL(blob),
      scale: adjust?.scale ?? 1,
      offsetX: adjust?.offsetX ?? 0,
      offsetY: adjust?.offsetY ?? 0,
      exposure: adjust?.exposure ?? 1,
      rotation: adjust?.rotation ?? 0,
    }
  }
  if (Object.keys(restored).length > 0) {
    useFittingStore.setState((s) => ({ slotPhotos: restored, bakeVersion: s.bakeVersion + 1 }))
    log('info', 'Session', `Restored ${Object.keys(restored).length} reference photo(s) from the previous session`)
  }

  const frontBlob = await idbGet('front').catch(() => null)
  if (frontBlob) {
    const url = URL.createObjectURL(frontBlob)
    const img = new Image()
    img.onload = () => {
      useFittingStore.getState().setFrontPhoto({ url, width: img.naturalWidth, height: img.naturalHeight })
      // setFrontPhoto clears key points; put the persisted ones back.
      if (settings.keyPoints) useFittingStore.getState().setKeyPoints(settings.keyPoints as never)
    }
    img.src = url
  }
}

/** Call once at startup. */
export function initPersistence(): void {
  void restore().catch(() => {})
  useFittingStore.subscribe(saveSettings)
  usePerformanceStore.subscribe(saveSettings)
}
