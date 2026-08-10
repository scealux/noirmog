import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { getPerformanceVideo, usePerformanceStore } from '../state/performanceStore'
import { trackPerformance } from '../lib/trackPerformance'
import { useTaskStore } from '../state/taskStore'

// Dev-only shortcut to the test clips in the repo (served by Vite's /@fs/).
const DEV_CLIPS = import.meta.env.DEV
  ? ['quickbrownfox.mov', 'facestretch.mov'].map((name) => ({
      name,
      url: '/@fs' + encodeURI(`/Users/afiel/Developer/Noirmog/Noirmog Head UV Ref/${name}`),
    }))
  : []

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec - m * 60
  return `${m}:${s.toFixed(1).padStart(4, '0')}`
}

export function Step2Panel() {
  const {
    videoUrl,
    videoName,
    videoDuration,
    tracking,
    isTracking,
    playing,
    loadVideo,
    setTracking,
    setIsTracking,
    setPlaying,
  } = usePerformanceStore()
  const log = useTaskStore((s) => s.log)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [scrub, setScrub] = useState(0)

  // Follow the video element's real state: scrub position and play/pause.
  useEffect(() => {
    const video = getPerformanceVideo()
    const onTime = () => setScrub(video.currentTime)
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    video.addEventListener('timeupdate', onTime)
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('ended', onPause)
    return () => {
      video.removeEventListener('timeupdate', onTime)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('ended', onPause)
    }
  }, [setPlaying])

  const handleLoad = async (url: string, name: string) => {
    try {
      await loadVideo(url, name)
      log('info', 'Capture', `Loaded video "${name}" (${formatDuration(getPerformanceVideo().duration)})`)
    } catch (err) {
      log('error', 'Capture', err instanceof Error ? err.message : String(err))
    }
  }

  const onFileChosen = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    void handleLoad(URL.createObjectURL(file), file.name)
    e.target.value = ''
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
    if (video.currentTime >= video.duration - 0.05) video.currentTime = 0
    try {
      await video.play()
    } catch (err) {
      log(
        'error',
        'Playback',
        `Could not start playback: ${err instanceof Error ? err.message : err}`,
      )
    }
  }

  const onScrub = (e: ChangeEvent<HTMLInputElement>) => {
    const t = Number(e.target.value)
    getPerformanceVideo().currentTime = t
    setScrub(t)
  }

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
        <button onClick={() => fileInputRef.current?.click()} disabled={isTracking}>
          Upload video…
        </button>
        {DEV_CLIPS.map((clip) => (
          <button
            key={clip.name}
            onClick={() => void handleLoad(clip.url, clip.name)}
            disabled={isTracking}
            style={{ marginLeft: 6 }}
          >
            {clip.name}
          </button>
        ))}
        {videoName && (
          <p style={{ marginTop: 8 }}>
            {videoName} — {formatDuration(videoDuration)}
          </p>
        )}
        {!videoName && <p style={{ marginTop: 8 }}>Webcam recording arrives in Phase 2.</p>}
      </div>

      <div className="panel-section">
        <h3>Tracking</h3>
        <button onClick={() => void onTrack()} disabled={!videoUrl || isTracking}>
          {isTracking ? 'Tracking…' : tracking ? 'Re-track performance' : 'Track performance'}
        </button>
        {tracking && (
          <p style={{ marginTop: 8 }}>
            {tracking.frameCount} frames @ {tracking.fps}fps
            {tracking.lostFrames.length > 0 && ` — ${tracking.lostFrames.length} lost`}
          </p>
        )}
      </div>

      {tracking && (
        <div className="panel-section">
          <h3>Playback</h3>
          <button onClick={() => void onPlayPause()}>{playing ? 'Pause' : 'Play'}</button>
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
      )}
    </>
  )
}
