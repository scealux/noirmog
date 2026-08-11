import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'
import { PipelineError } from './runTask'

let cached: Promise<FaceLandmarker> | null = null

// VIDEO mode requires timestamps that increase monotonically for the lifetime
// of a landmarker instance, so the clock lives here, next to the instance.
let lastTimestampMs = 0

export function nextVideoTimestampMs(deltaMs: number): number {
  lastTimestampMs += deltaMs
  return Math.round(lastTimestampMs)
}

/** Create (once) the MediaPipe Face Landmarker, loading wasm + model from our own origin. */
export function getFaceLandmarker(): Promise<FaceLandmarker> {
  cached ??= create().catch((err) => {
    cached = null
    throw err
  })
  return cached
}

/**
 * Dispose the cached landmarker so the next call creates a fresh one — a
 * MediaPipe graph error leaves the instance permanently broken.
 */
export function resetFaceLandmarker(): void {
  cached?.then((l) => l.close()).catch(() => {})
  cached = null
}

let cachedImage: Promise<FaceLandmarker> | null = null

/** Separate IMAGE-mode landmarker for still photos (Step 1 fitting). */
export function getImageFaceLandmarker(): Promise<FaceLandmarker> {
  cachedImage ??= createImage().catch((err) => {
    cachedImage = null
    throw err
  })
  return cachedImage
}

async function createImage(): Promise<FaceLandmarker> {
  const fileset = await FilesetResolver.forVisionTasks(`${import.meta.env.BASE_URL}mediapipe/wasm`)
  return FaceLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: `${import.meta.env.BASE_URL}mediapipe/face_landmarker.task`,
      delegate: 'GPU',
    },
    runningMode: 'IMAGE',
    numFaces: 1,
  })
}

async function create(): Promise<FaceLandmarker> {
  const base = import.meta.env.BASE_URL
  let fileset
  try {
    fileset = await FilesetResolver.forVisionTasks(`${base}mediapipe/wasm`)
  } catch (err) {
    throw new PipelineError(
      `Could not load MediaPipe wasm: ${err instanceof Error ? err.message : err}`,
      'Check that public/mediapipe/wasm is deployed alongside the app.',
    )
  }
  try {
    return await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: `${base}mediapipe/face_landmarker.task`, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
    })
  } catch (err) {
    throw new PipelineError(
      `Could not create Face Landmarker: ${err instanceof Error ? err.message : err}`,
      'Check that public/mediapipe/face_landmarker.task is deployed alongside the app.',
    )
  }
}
