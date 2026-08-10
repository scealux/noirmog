import { getFaceLandmarker, nextVideoTimestampMs, resetFaceLandmarker } from './faceTracker'
import { PipelineError, runTask } from './runTask'
import {
  BLENDSHAPE_COUNT,
  LANDMARK_COUNT,
  type TrackingData,
} from './trackingData'

const SAMPLE_FPS = 30

/** Cheek landmarks used to sample a default skin tone. */
const CHEEK_LANDMARKS = [50, 280, 205, 425, 101, 330]

function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onSeeked = () => {
      cleanup()
      resolve()
    }
    const onError = () => {
      cleanup()
      reject(new PipelineError(`Video seek failed at ${time.toFixed(2)}s`))
    }
    const cleanup = () => {
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('error', onError)
    }
    video.addEventListener('seeked', onSeeked)
    video.addEventListener('error', onError)
    video.currentTime = time
  })
}

function sampleSkinColor(
  video: HTMLVideoElement,
  landmarks: Float32Array,
): [number, number, number] {
  const w = 160
  const h = Math.max(1, Math.round((video.videoHeight / video.videoWidth) * w))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return [150, 110, 90]
  ctx.drawImage(video, 0, 0, w, h)
  let r = 0,
    g = 0,
    b = 0,
    n = 0
  for (const idx of CHEEK_LANDMARKS) {
    const x = Math.min(w - 1, Math.max(0, Math.round(landmarks[idx * 2] * w)))
    const y = Math.min(h - 1, Math.max(0, Math.round(landmarks[idx * 2 + 1] * h)))
    const px = ctx.getImageData(x, y, 1, 1).data
    r += px[0]
    g += px[1]
    b += px[2]
    n++
  }
  return n ? [r / n, g / n, b / n] : [150, 110, 90]
}

/**
 * Track a performance video: step through it at a fixed 30fps sampling rate,
 * run the Face Landmarker per frame, and collect landmarks, transformation
 * matrices and blendshapes. Tracking-loss frames reuse the previous frame's
 * data and are flagged + logged.
 */
export async function trackPerformance(video: HTMLVideoElement): Promise<TrackingData> {
  return runTask(
    'Track performance',
    [
      { id: 'init', label: 'Initializing tracker', weight: 1 },
      { id: 'track', label: 'Tracking frames', weight: 8 },
    ],
    async (ctx) => {
      const init = ctx.stage('init')
      init.set(0.1, 'Loading MediaPipe Face Landmarker')
      const landmarker = await getFaceLandmarker()
      if (!video.videoWidth) throw new PipelineError('Video has no dimensions', 'Try a different file.')
      const duration = video.duration
      if (!isFinite(duration) || duration <= 0)
        throw new PipelineError('Video has no duration', 'Try re-encoding the clip as MP4 (H.264).')
      init.done()

      const frameCount = Math.max(1, Math.floor(duration * SAMPLE_FPS))
      const data: TrackingData = {
        fps: SAMPLE_FPS,
        frameCount,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        landmarks: new Float32Array(frameCount * LANDMARK_COUNT * 2),
        matrices: new Float32Array(frameCount * 16),
        blendshapes: new Float32Array(frameCount * BLENDSHAPE_COUNT),
        blendshapeNames: [],
        tracked: new Uint8Array(frameCount),
        lostFrames: [],
        skinColor: [150, 110, 90],
      }

      const track = ctx.stage('track')
      video.pause()
      video.muted = true
      let skinSampled = false
      let anyTracked = false

      for (let f = 0; f < frameCount; f++) {
        const t = Math.min(f / SAMPLE_FPS, Math.max(0, duration - 0.001))
        await seekTo(video, t)
        let result
        try {
          result = landmarker.detectForVideo(video, nextVideoTimestampMs(1000 / SAMPLE_FPS))
        } catch (err) {
          // A graph error leaves the landmarker broken; dispose it so the
          // next tracking attempt starts from a fresh instance.
          resetFaceLandmarker()
          throw err
        }

        const lm = result.faceLandmarks[0]
        const matrix = result.facialTransformationMatrixes?.[0]
        const shapes = result.faceBlendshapes?.[0]
        const base = f * LANDMARK_COUNT * 2

        if (lm && matrix && shapes) {
          for (let i = 0; i < LANDMARK_COUNT; i++) {
            data.landmarks[base + i * 2] = lm[i].x
            data.landmarks[base + i * 2 + 1] = lm[i].y
          }
          data.matrices.set(matrix.data, f * 16)
          for (let i = 0; i < Math.min(BLENDSHAPE_COUNT, shapes.categories.length); i++) {
            data.blendshapes[f * BLENDSHAPE_COUNT + i] = shapes.categories[i].score
          }
          if (data.blendshapeNames.length === 0) {
            data.blendshapeNames = shapes.categories.map((c) => c.categoryName)
          }
          data.tracked[f] = 1
          anyTracked = true
          if (!skinSampled) {
            data.skinColor = sampleSkinColor(video, data.landmarks.subarray(base))
            skinSampled = true
            ctx.log(
              'info',
              `Sampled skin color rgb(${data.skinColor.map((c) => Math.round(c)).join(', ')})`,
            )
          }
        } else {
          // Hold the previous frame's data so playback stays dense.
          data.lostFrames.push(f)
          if (f > 0) {
            data.landmarks.copyWithin(base, base - LANDMARK_COUNT * 2, base)
            data.matrices.copyWithin(f * 16, (f - 1) * 16, f * 16)
            data.blendshapes.copyWithin(
              f * BLENDSHAPE_COUNT,
              (f - 1) * BLENDSHAPE_COUNT,
              f * BLENDSHAPE_COUNT,
            )
          }
          ctx.log('warn', `No face detected on frame ${f} (${t.toFixed(2)}s) — holding last tracked frame`)
        }

        if (f % 5 === 0 || f === frameCount - 1) {
          track.set((f + 1) / frameCount, `Tracking frames: ${f + 1}/${frameCount}`)
        }
      }

      if (!anyTracked)
        throw new PipelineError(
          'No face was detected in the entire video',
          'Make sure the face is large, front-on and evenly lit, then try again.',
        )
      if (data.lostFrames.length > 0)
        ctx.log('warn', `Tracking lost on ${data.lostFrames.length}/${frameCount} frames`)
      track.done()

      ctx.log('success', `Tracked ${frameCount} frames at ${SAMPLE_FPS}fps`)
      return data
    },
  )
}
