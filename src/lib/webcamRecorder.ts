import { PipelineError } from './runTask'

/** Spec: clips up to ~2 minutes. */
export const MAX_RECORD_SECONDS = 120

export interface WebcamSession {
  stream: MediaStream
  /** Number of audio tracks captured — 0 means the clip will be silent. */
  audioTrackCount: number
  /** Start recording; resolves with the finished clip when stop() is called. */
  start: () => void
  stop: () => Promise<{ blob: Blob; mimeType: string }>
  /** Release the camera. Safe to call at any point. */
  dispose: () => void
  isRecording: () => boolean
}

function pickMimeType(): string {
  // WebM+Opus first: Chrome reports mp4 support but its mp4 muxer has dropped
  // audio tracks in the wild. Safari has no webm and falls through to mp4.
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4',
  ]
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? ''
}

/** Audio inputs available (call after camera permission has been granted). */
export async function listMicrophones(): Promise<{ deviceId: string; label: string }[]> {
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices
    .filter((d) => d.kind === 'audioinput')
    .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${i + 1}` }))
}

/** Ask for the webcam+mic and return a session handle. Throws PipelineError with a hint. */
export async function openWebcam(audioDeviceId?: string): Promise<WebcamSession> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new PipelineError(
      'Webcam capture is not available in this browser',
      'Use a current Chrome/Edge/Safari/Firefox over HTTPS (or localhost).',
    )
  }
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
      audio: audioDeviceId ? { deviceId: { exact: audioDeviceId } } : true,
    })
  } catch (err) {
    const name = err instanceof DOMException ? err.name : ''
    const hints: Record<string, string> = {
      NotAllowedError: 'Allow camera and microphone access in the browser permission prompt.',
      NotFoundError: 'No camera/microphone was found — plug one in and try again.',
      NotReadableError: 'Another app may be using the camera — close it and try again.',
    }
    throw new PipelineError(
      `Could not open the webcam${name ? ` (${name})` : ''}`,
      hints[name] ?? 'Check camera permissions and hardware, then try again.',
    )
  }

  let recorder: MediaRecorder | null = null
  let chunks: Blob[] = []
  let stopResolve: ((r: { blob: Blob; mimeType: string }) => void) | null = null

  const dispose = () => {
    if (recorder?.state === 'recording') recorder.stop()
    stream.getTracks().forEach((t) => t.stop())
  }

  return {
    stream,
    audioTrackCount: stream.getAudioTracks().length,
    isRecording: () => recorder?.state === 'recording',
    start: () => {
      const mimeType = pickMimeType()
      chunks = []
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data)
      }
      recorder.onstop = () => {
        const type = recorder?.mimeType || mimeType || 'video/webm'
        stopResolve?.({ blob: new Blob(chunks, { type }), mimeType: type })
        stopResolve = null
      }
      recorder.start(1000) // gather data in 1s chunks
    },
    stop: () =>
      new Promise((resolve, reject) => {
        if (!recorder || recorder.state !== 'recording') {
          reject(new PipelineError('Not recording'))
          return
        }
        stopResolve = resolve
        recorder.stop()
      }),
    dispose,
  }
}
