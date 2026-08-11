import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { getFaceLandmarker, nextVideoTimestampMs } from '../lib/faceTracker'
import { openWebcam, type WebcamSession } from '../lib/webcamRecorder'
import { useTaskStore } from '../state/taskStore'
import { useFittingStore } from '../state/fittingStore'
import type { PhotoSlot } from '../lib/projectionBaker'

/**
 * Guided reference-photo capture: watches head yaw live, chimes when you are
 * turned to the requested angle, then counts down and captures. The back shot
 * cannot be pose-verified (no face visible), so it is captured on a timer.
 */

interface CaptureStep {
  slot: PhotoSlot | 'front'
  label: string
  instruction: string
  /** Target yaw in degrees (positive = subject turns to their left); null = timed shot. */
  targetYaw: number | null
}

const CAPTURE_STEPS: CaptureStep[] = [
  { slot: 'front', label: 'Front', instruction: 'Look straight at the camera', targetYaw: 0 },
  { slot: 'left', label: 'Left side', instruction: 'Turn your head to YOUR right (show your left cheek)', targetYaw: -55 },
  { slot: 'right', label: 'Right side', instruction: 'Turn your head to YOUR left (show your right cheek)', targetYaw: 55 },
  { slot: 'back', label: 'Back', instruction: 'Turn all the way around — capturing on a timer', targetYaw: null },
]

const YAW_TOLERANCE = 14
const HOLD_FRAMES = 6
const COUNTDOWN_SECONDS = 3
const BACK_TIMER_SECONDS = 5

let audioCtx: AudioContext | null = null
function beep(freq: number, durationMs: number): void {
  try {
    audioCtx ??= new AudioContext()
    const osc = audioCtx.createOscillator()
    const gain = audioCtx.createGain()
    osc.frequency.value = freq
    gain.gain.value = 0.12
    osc.connect(gain).connect(audioCtx.destination)
    osc.start()
    osc.stop(audioCtx.currentTime + durationMs / 1000)
  } catch {
    // No audio available — the visual countdown still works.
  }
}

interface Props {
  onDone: () => void
  /** Receives the front capture (for the landmark fitting flow). */
  onFrontPhoto: (url: string) => void
}

export function GuidedCapture({ onDone, onFrontPhoto }: Props) {
  const log = useTaskStore((s) => s.log)
  const setSlotPhoto = useFittingStore((s) => s.setSlotPhoto)
  const videoRef = useRef<HTMLVideoElement>(null)
  const sessionRef = useRef<WebcamSession | null>(null)
  const [stepIndex, setStepIndex] = useState(0)
  const [status, setStatus] = useState('Opening webcam…')
  const [countdown, setCountdown] = useState<number | null>(null)
  const stateRef = useRef({ hold: 0, counting: false, cancelled: false })

  useEffect(() => {
    const st = stateRef.current
    let timer = 0

    const capture = (step: CaptureStep) => {
      const video = videoRef.current
      if (!video) return
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      canvas.getContext('2d')?.drawImage(video, 0, 0)
      canvas.toBlob(
        (blob) => {
          if (!blob) return
          const url = URL.createObjectURL(blob)
          if (step.slot === 'front') onFrontPhoto(url)
          else setSlotPhoto(step.slot, url)
          log('success', 'Guided capture', `${step.label} captured`)
        },
        'image/jpeg',
        0.92,
      )
    }

    const runCountdown = (step: CaptureStep, seconds: number, onFinish: () => void) => {
      st.counting = true
      let remaining = seconds
      setCountdown(remaining)
      beep(880, 120)
      timer = window.setInterval(() => {
        remaining--
        if (remaining > 0) {
          setCountdown(remaining)
          beep(880, 120)
        } else {
          clearInterval(timer)
          setCountdown(null)
          beep(1320, 250)
          capture(step)
          st.counting = false
          st.hold = 0
          onFinish()
        }
      }, 1000)
    }

    const start = async () => {
      try {
        const session = await openWebcam()
        sessionRef.current = session
        const video = videoRef.current
        if (!video) return
        video.srcObject = session.stream
        await video.play()
        const landmarker = await getFaceLandmarker()

        const m4 = new THREE.Matrix4()
        const q = new THREE.Quaternion()
        const euler = new THREE.Euler()
        const pos = new THREE.Vector3()
        const scl = new THREE.Vector3()

        let currentIndex = 0
        const advance = () => {
          currentIndex++
          if (currentIndex >= CAPTURE_STEPS.length) {
            setStatus('All reference photos captured')
            onDone()
            return
          }
          setStepIndex(currentIndex)
        }

        const tick = () => {
          if (st.cancelled) return
          const step = CAPTURE_STEPS[currentIndex]
          if (!step) return
          if (!st.counting) {
            if (step.targetYaw === null) {
              // Back of head: no face to verify — timed capture.
              setStatus(step.instruction)
              runCountdown(step, BACK_TIMER_SECONDS, advance)
            } else if (video.readyState >= 2) {
              const result = landmarker.detectForVideo(video, nextVideoTimestampMs(66))
              const matrix = result.facialTransformationMatrixes?.[0]
              if (matrix) {
                m4.fromArray(matrix.data)
                m4.decompose(pos, q, scl)
                euler.setFromQuaternion(q, 'YXZ')
                const yaw = THREE.MathUtils.radToDeg(euler.y)
                const delta = yaw - step.targetYaw
                if (Math.abs(delta) < YAW_TOLERANCE) {
                  st.hold++
                  setStatus(`Hold it… (${step.label})`)
                  if (st.hold >= HOLD_FRAMES) runCountdown(step, COUNTDOWN_SECONDS, advance)
                } else {
                  st.hold = 0
                  const dir = delta > 0 ? 'a bit more to your right' : 'a bit more to your left'
                  setStatus(
                    step.targetYaw === 0
                      ? step.instruction
                      : `${step.instruction} — ${Math.abs(delta) < 25 ? dir : step.instruction.toLowerCase()}`,
                  )
                }
              } else {
                st.hold = 0
                setStatus(step.targetYaw === 0 ? 'No face detected — face the camera' : step.instruction)
              }
            }
          }
          if (!st.cancelled) requestAnimationFrame(tick)
        }
        setStatus(CAPTURE_STEPS[0].instruction)
        requestAnimationFrame(tick)
      } catch (err) {
        log('error', 'Guided capture', err instanceof Error ? err.message : String(err))
        onDone()
      }
    }

    void start()
    return () => {
      st.cancelled = true
      clearInterval(timer)
      sessionRef.current?.dispose()
      sessionRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const step = CAPTURE_STEPS[stepIndex]

  return (
    <div className="recorder">
      <div className="guided-steps">
        {CAPTURE_STEPS.map((s, i) => (
          <span key={s.slot} className={i === stepIndex ? 'active' : i < stepIndex ? 'done' : ''}>
            {s.label}
          </span>
        ))}
      </div>
      <div className="guided-video-wrap">
        <video ref={videoRef} className="recorder-preview" muted playsInline />
        {countdown !== null && <div className="guided-countdown">{countdown}</div>}
      </div>
      <p>{status}</p>
      <div className="button-row">
        <button onClick={onDone}>Cancel</button>
        {step?.targetYaw !== null && step && (
          <span className="rec-time">step {stepIndex + 1}/{CAPTURE_STEPS.length}</span>
        )}
      </div>
    </div>
  )
}
