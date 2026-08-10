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

interface PerformanceState {
  /** Object URL (or dev URL) of the loaded performance video. */
  videoUrl: string | null
  videoName: string | null
  videoDuration: number
  tracking: TrackingData | null
  isTracking: boolean
  playing: boolean

  loadVideo: (url: string, name: string) => Promise<void>
  setTracking: (data: TrackingData | null) => void
  setIsTracking: (v: boolean) => void
  setPlaying: (v: boolean) => void
}

export const usePerformanceStore = create<PerformanceState>((set, get) => ({
  videoUrl: null,
  videoName: null,
  videoDuration: 0,
  tracking: null,
  isTracking: false,
  playing: false,

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
    set({
      videoUrl: url,
      videoName: name,
      videoDuration: video.duration,
      tracking: null,
      playing: false,
    })
  },

  setTracking: (data) => set({ tracking: data }),
  setIsTracking: (v) => set({ isTracking: v }),
  setPlaying: (v) => set({ playing: v }),
}))
