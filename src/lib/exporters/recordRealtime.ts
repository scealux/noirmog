import { PipelineError, type StageHandle } from '../runTask'
import { getPerformanceVideo } from '../../state/performanceStore'

interface RecordOptions {
  canvas: HTMLCanvasElement
  trimStart: number
  trimEnd: number
  /** Called every animation frame while recording so the caller can render. */
  onFrame?: (videoTime: number) => void
  withAudio: boolean
  stage: StageHandle
}

function pickVideoMime(): string {
  const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? ''
}

/**
 * Record a canvas (plus the performance's audio) by playing the trimmed range
 * in real time. Realtime keeps picture and sound locked; export duration
 * equals the trim length.
 */
export async function recordRealtime(opts: RecordOptions): Promise<{ blob: Blob; mimeType: string }> {
  const video = getPerformanceVideo()
  video.pause()
  video.muted = false
  video.currentTime = opts.trimStart
  await new Promise<void>((resolve) => {
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked)
      resolve()
    }
    video.addEventListener('seeked', onSeeked)
  })

  const stream = opts.canvas.captureStream(30)
  if (opts.withAudio) {
    const mediaStream = (
      video as HTMLVideoElement & { captureStream?: () => MediaStream }
    ).captureStream?.()
    const audio = mediaStream?.getAudioTracks() ?? []
    for (const track of audio) stream.addTrack(track)
    if (audio.length === 0) {
      throw new PipelineError(
        'This browser cannot capture the video audio track',
        'Use Chrome or Edge for exports with audio.',
      )
    }
  }

  const mimeType = pickVideoMime()
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }

  const duration = Math.max(0.01, opts.trimEnd - opts.trimStart)
  return new Promise((resolve, reject) => {
    let raf = 0
    const finish = () => {
      cancelAnimationFrame(raf)
      video.pause()
      if (recorder.state === 'recording') recorder.stop()
    }
    recorder.onstop = () => {
      const type = recorder.mimeType || mimeType || 'video/webm'
      resolve({ blob: new Blob(chunks, { type }), mimeType: type })
    }
    recorder.onerror = () => {
      finish()
      reject(new PipelineError('Video encoding failed', 'Try a shorter trim range.'))
    }

    const tick = () => {
      const t = video.currentTime
      opts.onFrame?.(t)
      opts.stage.set(
        Math.min(1, (t - opts.trimStart) / duration),
        `Recording: ${(t - opts.trimStart).toFixed(1)}s / ${duration.toFixed(1)}s`,
      )
      if (t >= opts.trimEnd - 0.03 || video.ended) {
        finish()
        return
      }
      raf = requestAnimationFrame(tick)
    }

    recorder.start(500)
    video
      .play()
      .then(() => {
        raf = requestAnimationFrame(tick)
      })
      .catch((err) => {
        finish()
        reject(
          new PipelineError(
            `Could not start playback for export: ${err instanceof Error ? err.message : err}`,
            'Interact with the page once (click anywhere), then retry the export.',
          ),
        )
      })
  })
}
