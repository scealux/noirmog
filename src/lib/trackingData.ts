/**
 * Per-frame tracking results for a performance, stored as flat typed arrays.
 * All later phases (playback, texture warp, export) read from this.
 */
export interface TrackingData {
  fps: number
  frameCount: number
  videoWidth: number
  videoHeight: number
  /** 468 * 2 per frame, normalized video coords (x right, y down, 0..1). */
  landmarks: Float32Array
  /** 16 per frame, column-major facial transformation matrix. */
  matrices: Float32Array
  /** 52 per frame, blendshape scores. */
  blendshapes: Float32Array
  /** Blendshape category names, index-aligned with scores. */
  blendshapeNames: string[]
  /** 1 = face tracked this frame, 0 = tracking lost (previous frame's data was reused). */
  tracked: Uint8Array
  /** Frames where tracking was lost. */
  lostFrames: number[]
  /** Average skin color sampled from the cheeks of the first tracked frame (sRGB 0..255). */
  skinColor: [number, number, number]
}

export const LANDMARK_COUNT = 468
export const BLENDSHAPE_COUNT = 52

export function landmarksForFrame(data: TrackingData, frame: number): Float32Array {
  const stride = LANDMARK_COUNT * 2
  return data.landmarks.subarray(frame * stride, (frame + 1) * stride)
}

export function matrixForFrame(data: TrackingData, frame: number): Float32Array {
  return data.matrices.subarray(frame * 16, (frame + 1) * 16)
}

export function blendshapeForFrame(data: TrackingData, frame: number, index: number): number {
  return data.blendshapes[frame * BLENDSHAPE_COUNT + index]
}

export function frameForTime(data: TrackingData, timeSec: number): number {
  const f = Math.round(timeSec * data.fps)
  return Math.min(data.frameCount - 1, Math.max(0, f))
}
