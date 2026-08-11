import { create } from 'zustand'
import type { TrackingData } from '../lib/trackingData'

/**
 * The performance video element lives outside React/zustand (it is a stateful
 * media object used by tracking, the warper, and playback+audio alike).
 */
let videoEl: HTMLVideoElement | null = null

export function getPerformanceVideo(): HTMLVideoElement {
  if (!videoEl) {
    videoEl = document.createElement('video')
    videoEl.playsInline = true
    videoEl.preload = 'auto'
    videoEl.crossOrigin = 'anonymous'
    if (import.meta.env.DEV) {
      ;(window as Window & { __noirmogVideo?: HTMLVideoElement }).__noirmogVideo = videoEl
    }
  }
  return videoEl
}

/** Editable capture settings applied at playback time (non-destructive). */
export interface ChannelEditSettings {
  /** Multiplier on head rotation channels (0 = statue, 1 = as performed). */
  headMotionScale: number
  /** Multiplier on the jawOpen channel. */
  jawScale: number
  /** Temporal smoothing radius in frames (0 = off). */
  smoothing: number
}

export const DEFAULT_CHANNEL_SETTINGS: ChannelEditSettings = {
  headMotionScale: 1,
  jawScale: 1,
  smoothing: 1,
}

/** Placement + blending of the face texture on the head. */
export interface FaceFitEditSettings {
  /** Scale of the face layout on the head (1 = auto fit). */
  scale: number
  /** Vertical offset in head space (meters, + is up). */
  offsetY: number
  /** Feather distance of the edge blend, in UV units (0 = hard edge). */
  feather: number
}

// Defaults nudged from testing: the auto fit reads slightly small and low.
export const DEFAULT_FACE_FIT: FaceFitEditSettings = {
  scale: 1.1,
  offsetY: 0.012,
  feather: 0.07,
}

interface PerformanceState {
  /** Object URL (or dev URL) of the loaded performance video. */
  videoUrl: string | null
  videoName: string | null
  videoDuration: number
  tracking: TrackingData | null
  isTracking: boolean
  playing: boolean

  /** Playback/export range in seconds. */
  trimStart: number
  trimEnd: number
  loop: boolean

  channelSettings: ChannelEditSettings
  faceFit: FaceFitEditSettings
  /** Overrides the auto-sampled skin tone (sRGB 0..255); null = auto. */
  skinColorOverride: [number, number, number] | null

  loadVideo: (url: string, name: string) => Promise<void>
  setTracking: (data: TrackingData | null) => void
  setIsTracking: (v: boolean) => void
  setPlaying: (v: boolean) => void
  setTrim: (start: number, end: number) => void
  setLoop: (v: boolean) => void
  setChannelSetting: <K extends keyof ChannelEditSettings>(
    key: K,
    value: ChannelEditSettings[K],
  ) => void
  setFaceFit: <K extends keyof FaceFitEditSettings>(
    key: K,
    value: FaceFitEditSettings[K],
  ) => void
  setSkinColorOverride: (rgb: [number, number, number] | null) => void
}

/**
 * MediaRecorder blobs report duration = Infinity until the browser is forced
 * to scan the file; seek far past the end and wait for the real duration.
 */
async function ensureFiniteDuration(video: HTMLVideoElement): Promise<void> {
  if (isFinite(video.duration)) return
  await new Promise<void>((resolve) => {
    const onDurationChange = () => {
      if (isFinite(video.duration)) {
        video.removeEventListener('durationchange', onDurationChange)
        resolve()
      }
    }
    video.addEventListener('durationchange', onDurationChange)
    video.currentTime = 1e7
  })
  video.currentTime = 0
}

export const usePerformanceStore = create<PerformanceState>((set, get) => ({
  videoUrl: null,
  videoName: null,
  videoDuration: 0,
  tracking: null,
  isTracking: false,
  playing: false,

  trimStart: 0,
  trimEnd: 0,
  loop: true,

  channelSettings: { ...DEFAULT_CHANNEL_SETTINGS },
  faceFit: { ...DEFAULT_FACE_FIT },
  skinColorOverride: null,

  loadVideo: async (url, name) => {
    const video = getPerformanceVideo()
    video.pause()
    const prev = get().videoUrl
    if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev)
    video.src = url
    await new Promise<void>((resolve, reject) => {
      const onLoaded = () => {
        cleanup()
        resolve()
      }
      const onError = () => {
        cleanup()
        reject(new Error(`Could not load video "${name}" — unsupported codec or corrupt file?`))
      }
      const cleanup = () => {
        video.removeEventListener('loadedmetadata', onLoaded)
        video.removeEventListener('error', onError)
      }
      video.addEventListener('loadedmetadata', onLoaded)
      video.addEventListener('error', onError)
    })
    await ensureFiniteDuration(video)
    set({
      videoUrl: url,
      videoName: name,
      videoDuration: video.duration,
      tracking: null,
      playing: false,
      trimStart: 0,
      trimEnd: video.duration,
    })
  },

  setTracking: (data) => set({ tracking: data }),
  setIsTracking: (v) => set({ isTracking: v }),
  setPlaying: (v) => set({ playing: v }),

  setTrim: (start, end) => {
    const duration = get().videoDuration
    const s = Math.max(0, Math.min(start, duration))
    const e = Math.max(s + 0.1, Math.min(end, duration))
    set({ trimStart: s, trimEnd: e })
  },
  setLoop: (v) => set({ loop: v }),

  setChannelSetting: (key, value) =>
    set((state) => ({ channelSettings: { ...state.channelSettings, [key]: value } })),

  setFaceFit: (key, value) => set((state) => ({ faceFit: { ...state.faceFit, [key]: value } })),

  setSkinColorOverride: (rgb) => set({ skinColorOverride: rgb }),
}))
