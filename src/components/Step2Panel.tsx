import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import {
  DEFAULT_CHANNEL_SETTINGS,
  DEFAULT_FACE_FIT,
  getPerformanceVideo,
  usePerformanceStore,
} from '../state/performanceStore'
import { trackPerformance } from '../lib/trackPerformance'
import { PipelineError } from '../lib/runTask'
import { useTaskStore } from '../state/taskStore'
import { MAX_RECORD_SECONDS, openWebcam, type WebcamSession } from '../lib/webcamRecorder'

// Dev-only shortcut to the test clips in the repo (served by Vite's /@fs/).
const DEV_CLIPS = import.meta.env.DEV
  ? ['quickbrownfox.mov', 'facestretch.mov'].map((name) => ({
      name,
      url: '/@fs' + encodeURI(`/Users/afiel/Developer/Noirmog/Noirmog Head UV Ref/${name}`),
    }))
  : []

function errorText(err: unknown): string {
  if (err instanceof PipelineError) return err.hint ? `${err.message} — ${err.hint}` : err.message
  return err instanceof Error ? err.message : String(err)
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec - m * 60
  return `${m}:${s.toFixed(1).padStart(4, '0')}`
}

type RecordingState = 'idle' | 'preview' | 'recording'

export function Step2Panel() {
  const {
    videoUrl,
    videoName,
    videoDuration,
    tracking,
    isTracking,
    playing,
    trimStart,
    trimEnd,
    loop,
    channelSettings,
    faceFit,
    loadVideo,
    setTracking,
    setIsTracking,
    setPlaying,
    setTrim,
    setLoop,
    setChannelSetting,
    setFaceFit,
  } = usePerformanceStore()
  const log = useTaskStore((s) => s.log)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [scrub, setScrub] = useState(0)

  const [recState, setRecState] = useState<RecordingState>('idle')
  const [recSeconds, setRecSeconds] = useState(0)
  const sessionRef = useRef<WebcamSession | null>(null)
  const previewRef = useRef<HTMLVideoElement>(null)

  // Follow the video element's real state, keep playback inside the trim range.
  useEffect(() => {
    const video = getPerformanceVideo()
    const onTime = () => {
      setScrub(video.currentTime)
      const { trimEnd: end, trimStart: start, loop: doLoop } = usePerformanceStore.getState()
      if (!video.paused && end > 0 && video.currentTime >= end - 0.02) {
        if (doLoop) video.currentTime = start
        else video.pause()
      }
    }
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    // 'ended' can fire before timeupdate crosses the trim threshold, so loop here too.
    const onEnded = () => {
      const { loop: doLoop, trimStart: start } = usePerformanceStore.getState()
      if (doLoop) {
        video.currentTime = start
        void video.play().catch(() => setPlaying(false))
      } else {
        setPlaying(false)
      }
    }
    video.addEventListener('timeupdate', onTime)
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('ended', onEnded)
    return () => {
      video.removeEventListener('timeupdate', onTime)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('ended', onEnded)
    }
  }, [setPlaying])

  // Recording timer + auto-stop at the clip length limit.
  useEffect(() => {
    if (recState !== 'recording') return
    const startedAt = Date.now()
    const timer = setInterval(() => {
      const elapsed = (Date.now() - startedAt) / 1000
      setRecSeconds(elapsed)
      if (elapsed >= MAX_RECORD_SECONDS) void finishRecording()
    }, 250)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recState])

  // Attach the camera stream to the preview element after it has committed —
  // attaching in the same tick as the state change raced the mount and could
  // leave a black preview on first authorization.
  useEffect(() => {
    if (recState === 'idle') return
    const el = previewRef.current
    const session = sessionRef.current
    if (el && session && el.srcObject !== session.stream) {
      el.srcObject = session.stream
      void el.play().catch(() => {})
    }
  }, [recState])

  // Release the camera if the panel unmounts mid-session.
  useEffect(
    () => () => {
      sessionRef.current?.dispose()
      sessionRef.current = null
    },
    [],
  )

  const handleLoad = async (url: string, name: string) => {
    try {
      await loadVideo(url, name)
      log('info', 'Capture', `Loaded video "${name}" (${formatDuration(getPerformanceVideo().duration)})`)
    } catch (err) {
      log('error', 'Capture', errorText(err))
    }
  }

  const onFileChosen = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    void handleLoad(URL.createObjectURL(file), file.name)
    e.target.value = ''
  }

  const openCamera = async () => {
    try {
      const session = await openWebcam()
      sessionRef.current = session
      setRecState('preview')
      log('info', 'Capture', `Webcam opened (${session.audioTrackCount} audio track(s))`)
      if (session.audioTrackCount === 0) {
        log('warn', 'Capture', 'No microphone track — the recording will be silent. Check mic permissions.')
      }
    } catch (err) {
      log('error', 'Capture', errorText(err))
    }
  }

  const startRecording = () => {
    sessionRef.current?.start()
    setRecSeconds(0)
    setRecState('recording')
    log('info', 'Capture', 'Recording started')
  }

  const finishRecording = async () => {
    const session = sessionRef.current
    if (!session?.isRecording()) return
    try {
      const { blob, mimeType } = await session.stop()
      session.dispose()
      sessionRef.current = null
      setRecState('idle')
      const ext = mimeType.includes('mp4') ? 'mp4' : 'webm'
      const name = `webcam-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${ext}`
      log('info', 'Capture', `Recording stopped (${(blob.size / 1e6).toFixed(1)} MB, ${mimeType})`)
      await handleLoad(URL.createObjectURL(blob), name)
    } catch (err) {
      log('error', 'Capture', errorText(err))
      setRecState('idle')
    }
  }

  const cancelCamera = () => {
    sessionRef.current?.dispose()
    sessionRef.current = null
    setRecState('idle')
    log('info', 'Capture', 'Webcam closed')
  }

  const onTrack = async () => {
    setIsTracking(true)
    setPlaying(false)
    try {
      const data = await trackPerformance(getPerformanceVideo())
      setTracking(data)
    } catch {
      // The task system has already surfaced the error.
    } finally {
      setIsTracking(false)
    }
  }

  const onPlayPause = async () => {
    const video = getPerformanceVideo()
    if (playing) {
      video.pause()
      return
    }
    video.muted = false
    if (video.currentTime < trimStart || video.currentTime >= trimEnd - 0.05) {
      video.currentTime = trimStart
    }
    try {
      await video.play()
    } catch (err) {
      log('error', 'Playback', `Could not start playback: ${err instanceof Error ? err.message : err}`)
    }
  }

  const onScrub = (e: ChangeEvent<HTMLInputElement>) => {
    const t = Number(e.target.value)
    getPerformanceVideo().currentTime = t
    setScrub(t)
  }

  const sliderRow = (
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    display: string,
    onChange: (v: number) => void,
  ) => (
    <div className="slider-row">
      <span className="slider-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="slider-value">{display}</span>
    </div>
  )

  return (
    <>
      <div className="panel-section">
        <h3>Source</h3>
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
          style={{ display: 'none' }}
          onChange={onFileChosen}
        />
        {recState === 'idle' && (
          <div className="button-row">
            <button onClick={() => fileInputRef.current?.click()} disabled={isTracking}>
              Upload video…
            </button>
            <button onClick={() => void openCamera()} disabled={isTracking}>
              Record webcam…
            </button>
            {DEV_CLIPS.map((clip) => (
              <button
                key={clip.name}
                onClick={() => void handleLoad(clip.url, clip.name)}
                disabled={isTracking}
              >
                {clip.name}
              </button>
            ))}
          </div>
        )}

        {recState !== 'idle' && (
          <div className="recorder">
            <video ref={previewRef} className="recorder-preview" muted playsInline />
            <div className="button-row">
              {recState === 'preview' && (
                <>
                  <button className="rec-start" onClick={startRecording}>
                    ● Start recording
                  </button>
                  <button onClick={cancelCamera}>Cancel</button>
                </>
              )}
              {recState === 'recording' && (
                <>
                  <button className="rec-stop" onClick={() => void finishRecording()}>
                    ■ Stop
                  </button>
                  <span className="rec-time">
                    {formatDuration(recSeconds)} / {formatDuration(MAX_RECORD_SECONDS)}
                  </span>
                </>
              )}
            </div>
            {recState === 'preview' && (
              <p>Keep your head as still as possible, face evenly lit.</p>
            )}
          </div>
        )}

        {recState === 'idle' && videoName && (
          <p style={{ marginTop: 8 }}>
            {videoName} — {formatDuration(videoDuration)}
          </p>
        )}
      </div>

      <div className="panel-section">
        <h3>Tracking</h3>
        <button onClick={() => void onTrack()} disabled={!videoUrl || isTracking}>
          {isTracking ? 'Tracking…' : tracking ? 'Re-track performance' : 'Track performance'}
        </button>
        {tracking && (
          <p style={{ marginTop: 8 }}>
            {tracking.frameCount} frames @ {tracking.fps}fps
            {tracking.lostFrames.length > 0 &&
              ` — tracking lost on ${tracking.lostFrames.length} (held last good frame)`}
          </p>
        )}
      </div>

      {tracking && (
        <>
          <div className="panel-section">
            <h3>Playback</h3>
            <div className="button-row">
              <button onClick={() => void onPlayPause()}>{playing ? 'Pause' : 'Play'}</button>
              <label className="check-label">
                <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} />
                Loop
              </label>
            </div>
            <input
              type="range"
              min={0}
              max={videoDuration}
              step={0.01}
              value={scrub}
              onChange={onScrub}
              style={{ width: '100%', marginTop: 8 }}
            />
            <p>
              {formatDuration(scrub)} / {formatDuration(videoDuration)}
            </p>
          </div>

          <div className="panel-section">
            <h3>Trim</h3>
            {sliderRow('In', trimStart, 0, videoDuration, 0.01, formatDuration(trimStart), (v) =>
              setTrim(v, trimEnd),
            )}
            {sliderRow('Out', trimEnd, 0, videoDuration, 0.01, formatDuration(trimEnd), (v) =>
              setTrim(trimStart, v),
            )}
            <div className="button-row">
              <button onClick={() => setTrim(scrub, trimEnd)}>Set In here</button>
              <button onClick={() => setTrim(trimStart, scrub)}>Set Out here</button>
              <button onClick={() => setTrim(0, videoDuration)}>Reset</button>
            </div>
            <p>Range: {formatDuration(Math.max(0, trimEnd - trimStart))}</p>
          </div>

          <div className="panel-section">
            <h3>Face Fit & Blend</h3>
            {sliderRow(
              'Face size',
              faceFit.scale,
              0.85,
              1.35,
              0.01,
              `${Math.round(faceFit.scale * 100)}%`,
              (v) => setFaceFit('scale', v),
            )}
            {sliderRow(
              'Height',
              faceFit.offsetY,
              -0.04,
              0.04,
              0.001,
              `${(faceFit.offsetY * 100).toFixed(1)}cm`,
              (v) => setFaceFit('offsetY', v),
            )}
            {sliderRow(
              'Feather',
              faceFit.feather,
              0,
              0.18,
              0.005,
              faceFit.feather === 0 ? 'hard' : faceFit.feather.toFixed(3),
              (v) => setFaceFit('feather', v),
            )}
            <div className="button-row">
              <button
                onClick={() => {
                  for (const [k, v] of Object.entries(DEFAULT_FACE_FIT)) {
                    setFaceFit(k as keyof typeof DEFAULT_FACE_FIT, v)
                  }
                }}
              >
                Reset
              </button>
            </div>
          </div>

          <div className="panel-section">
            <h3>Capture Edit</h3>
            {sliderRow(
              'Head motion',
              channelSettings.headMotionScale,
              0,
              2,
              0.05,
              `${Math.round(channelSettings.headMotionScale * 100)}%`,
              (v) => setChannelSetting('headMotionScale', v),
            )}
            {sliderRow(
              'Jaw',
              channelSettings.jawScale,
              0,
              2,
              0.05,
              `${Math.round(channelSettings.jawScale * 100)}%`,
              (v) => setChannelSetting('jawScale', v),
            )}
            {sliderRow(
              'Smoothing',
              channelSettings.smoothing,
              0,
              6,
              1,
              channelSettings.smoothing === 0 ? 'off' : `±${channelSettings.smoothing}f`,
              (v) => setChannelSetting('smoothing', v),
            )}
            <div className="button-row">
              <button
                onClick={() => {
                  for (const [k, v] of Object.entries(DEFAULT_CHANNEL_SETTINGS)) {
                    setChannelSetting(k as keyof typeof DEFAULT_CHANNEL_SETTINGS, v)
                  }
                }}
              >
                Reset
              </button>
            </div>
          </div>
        </>
      )}
    </>
  )
}
