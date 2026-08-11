import { useEffect, useRef, useState, type ChangeEvent, type PointerEvent } from 'react'
import { getImageFaceLandmarker } from '../lib/faceTracker'
import { prepareHead, DEFAULT_HEAD_MORPH, type HeadMorphSettings } from '../lib/headMesh'
import { useTaskStore } from '../state/taskStore'
import {
  KEY_POINTS,
  morphFromKeyPoints,
  useFittingStore,
  type KeyPointMap,
} from '../state/fittingStore'
import { GuidedCapture } from './GuidedCapture'
import type { PhotoSlot } from '../lib/projectionBaker'

const SIDE_SLOTS: { slot: PhotoSlot; label: string }[] = [
  { slot: 'left', label: 'Left' },
  { slot: 'right', label: 'Right' },
  { slot: 'back', label: 'Back' },
  { slot: 'top', label: 'Top' },
]

// Dev-only sample side photos.
const DEV_SIDE_PHOTOS = import.meta.env.DEV
  ? [
      { slot: 'left' as PhotoSlot, name: 'leftside.jpg' },
      { slot: 'right' as PhotoSlot, name: 'rightside.jpg' },
      { slot: 'back' as PhotoSlot, name: 'back.jpg' },
    ].map((p) => ({
      ...p,
      url: '/@fs' + encodeURI(`/Users/afiel/Developer/Noirmog/sample side textures/${p.name}`),
    }))
  : []

// Dev-only test photos from the local reference folder.
const DEV_PHOTOS = import.meta.env.DEV
  ? ['testface.png', 'test-face-example.png'].map((name) => ({
      name,
      url: '/@fs' + encodeURI(`/Users/afiel/Developer/Noirmog/Noirmog Head UV Ref/${name}`),
    }))
  : []

const POINT_RADIUS = 7

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not load image'))
    img.src = url
  })
}

export function Step1Panel() {
  const {
    frontPhoto,
    keyPoints,
    morph,
    setFrontPhoto,
    setKeyPoints,
    moveKeyPoint,
    setMorphValue,
    setMorph,
    bumpMorphVersion,
    resetMorph,
  } = useFittingStore()
  const log = useTaskStore((s) => s.log)
  const slotPhotos = useFittingStore((s) => s.slotPhotos)
  const mirrorFill = useFittingStore((s) => s.mirrorFill)
  const setMirrorFill = useFittingStore((s) => s.setMirrorFill)
  const setSlotPhoto = useFittingStore((s) => s.setSlotPhoto)
  const adjustSlotPhoto = useFittingStore((s) => s.adjustSlotPhoto)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const slotInputRef = useRef<HTMLInputElement>(null)
  const pendingSlot = useRef<PhotoSlot>('left')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const dragIndex = useRef<number | null>(null)
  const [detecting, setDetecting] = useState(false)
  const [guided, setGuided] = useState(false)
  const [activeSlot, setActiveSlot] = useState<PhotoSlot>('left')

  // Apply the current morph to the head whenever it changes.
  useEffect(() => {
    let cancelled = false
    prepareHead()
      .then((head) => {
        if (cancelled) return
        head.applyMorph(morph)
        bumpMorphVersion()
      })
      .catch(() => {
        // Viewport already surfaces head load errors.
      })
    return () => {
      cancelled = true
    }
  }, [morph, bumpMorphVersion])

  // Redraw the photo + landmarks whenever anything changes.
  useEffect(() => {
    const canvas = canvasRef.current
    const img = imageRef.current
    if (!canvas || !frontPhoto) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const w = canvas.width
    const h = canvas.height
    ctx.clearRect(0, 0, w, h)
    if (img) ctx.drawImage(img, 0, 0, w, h)

    for (const kp of KEY_POINTS) {
      const p = keyPoints[kp.index]
      if (!p) continue
      const x = p[0] * w
      const y = p[1] * h
      ctx.beginPath()
      ctx.arc(x, y, POINT_RADIUS, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(217, 164, 65, 0.35)'
      ctx.fill()
      ctx.lineWidth = 1.5
      ctx.strokeStyle = '#d9a441'
      ctx.stroke()
    }
  }, [frontPhoto, keyPoints])

  const detectOnPhoto = async (url: string, name: string) => {
    setDetecting(true)
    try {
      const img = await loadImage(url)
      imageRef.current = img
      setFrontPhoto({ url, width: img.naturalWidth, height: img.naturalHeight })
      log('info', 'Base mesh', `Loaded front photo "${name}" (${img.naturalWidth}×${img.naturalHeight})`)

      const landmarker = await getImageFaceLandmarker()
      const result = landmarker.detect(img)
      const lm = result.faceLandmarks[0]
      if (!lm) {
        log('warn', 'Base mesh', 'No face detected in the photo — drag the points into place manually.')
        // Seed points in a sensible default arrangement.
        const seeded: KeyPointMap = {}
        for (const kp of KEY_POINTS) seeded[kp.index] = [0.5, 0.5]
        setKeyPoints(seeded)
        return
      }
      const points: KeyPointMap = {}
      for (const kp of KEY_POINTS) points[kp.index] = [lm[kp.index].x, lm[kp.index].y]
      setKeyPoints(points)

      const auto = morphFromKeyPoints(points, img.naturalWidth / img.naturalHeight)
      setMorph({ ...DEFAULT_HEAD_MORPH, ...auto })
      log(
        'success',
        'Base mesh',
        `Auto-fit from photo: ${Object.entries(auto)
          .map(([k, v]) => `${k} ${Math.round((v as number) * 100)}%`)
          .join(', ') || 'no measurable proportions'}`,
      )
    } catch (err) {
      log('error', 'Base mesh', err instanceof Error ? err.message : String(err))
    } finally {
      setDetecting(false)
    }
  }

  const onFileChosen = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    void detectOnPhoto(URL.createObjectURL(file), file.name)
    e.target.value = ''
  }

  const canvasPos = (e: PointerEvent): [number, number] => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return [
      Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    ]
  }

  const onPointerDown = (e: PointerEvent) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const [nx, ny] = canvasPos(e)
    const rect = canvas.getBoundingClientRect()
    for (const kp of KEY_POINTS) {
      const p = keyPoints[kp.index]
      if (!p) continue
      const dx = (p[0] - nx) * rect.width
      const dy = (p[1] - ny) * rect.height
      if (Math.hypot(dx, dy) < POINT_RADIUS * 1.8) {
        dragIndex.current = kp.index
        try {
          canvas.setPointerCapture(e.pointerId)
        } catch {
          // Synthetic or already-released pointers can't be captured; dragging
          // still works, it just won't track outside the canvas.
        }
        return
      }
    }
  }

  const onPointerMove = (e: PointerEvent) => {
    if (dragIndex.current === null) return
    const [nx, ny] = canvasPos(e)
    moveKeyPoint(dragIndex.current, nx, ny)
  }

  const onPointerUp = () => {
    if (dragIndex.current === null) return
    dragIndex.current = null
    // Re-derive the morph from the adjusted points.
    const photo = useFittingStore.getState().frontPhoto
    const points = useFittingStore.getState().keyPoints
    if (photo) {
      const auto = morphFromKeyPoints(points, photo.width / photo.height)
      if (Object.keys(auto).length > 0) {
        setMorph({ ...useFittingStore.getState().morph, ...auto })
        log('info', 'Base mesh', 'Morph updated from adjusted points')
      }
    }
  }

  const sliderRow = (label: string, key: keyof HeadMorphSettings) => (
    <div className="slider-row">
      <span className="slider-label">{label}</span>
      <input
        type="range"
        min={0.8}
        max={1.25}
        step={0.01}
        value={morph[key]}
        onChange={(e) => setMorphValue(key, Number(e.target.value))}
        onDoubleClick={() => setMorphValue(key, DEFAULT_HEAD_MORPH[key])}
        title="Double-click to reset"
      />
      <span className="slider-value">{Math.round(morph[key] * 100)}%</span>
    </div>
  )

  const canvasAspect = frontPhoto ? frontPhoto.height / frontPhoto.width : 0.75

  return (
    <>
      <div className="panel-section">
        <h3>Reference photo</h3>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={onFileChosen}
        />
        <div className="button-row">
          <button onClick={() => fileInputRef.current?.click()} disabled={detecting || guided}>
            {detecting ? 'Detecting…' : 'Front photo…'}
          </button>
          <button onClick={() => setGuided(true)} disabled={guided}>
            Guided webcam capture…
          </button>
          {DEV_PHOTOS.map((p) => (
            <button key={p.name} onClick={() => void detectOnPhoto(p.url, p.name)} disabled={detecting}>
              {p.name}
            </button>
          ))}
        </div>
        {guided && (
          <GuidedCapture
            onDone={() => setGuided(false)}
            onFrontPhoto={(url) => void detectOnPhoto(url, 'webcam-front.jpg')}
          />
        )}
        {frontPhoto ? (
          <canvas
            ref={canvasRef}
            className="fitting-canvas"
            width={272}
            height={Math.round(272 * canvasAspect)}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          />
        ) : (
          <p style={{ marginTop: 8 }}>
            Optional. Landmarks are auto-detected; drag the points to correct them. Without a
            photo, the default head passes straight through.
          </p>
        )}
      </div>

      <div className="panel-section">
        <h3>Side &amp; back photos</h3>
        <input
          ref={slotInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) {
              setSlotPhoto(pendingSlot.current, URL.createObjectURL(file))
              setActiveSlot(pendingSlot.current)
              log('info', 'Base mesh', `${pendingSlot.current} photo loaded ("${file.name}")`)
            }
            e.target.value = ''
          }}
        />
        <div className="button-row">
          {SIDE_SLOTS.map(({ slot, label }) => (
            <button
              key={slot}
              className={slotPhotos[slot] ? 'slot-filled' : ''}
              onClick={() => {
                pendingSlot.current = slot
                slotInputRef.current?.click()
              }}
              onDoubleClick={() => setSlotPhoto(slot, null)}
              title={slotPhotos[slot] ? 'Loaded — double-click to remove' : `Upload ${label} photo`}
            >
              {label}
              {slotPhotos[slot] ? ' ✓' : ''}
            </button>
          ))}
        </div>
        {DEV_SIDE_PHOTOS.length > 0 && (
          <div className="button-row" style={{ marginTop: 6 }}>
            <button
              onClick={() => {
                for (const p of DEV_SIDE_PHOTOS) setSlotPhoto(p.slot, p.url)
                log('info', 'Base mesh', 'Loaded sample side photos')
              }}
            >
              Load sample set
            </button>
          </div>
        )}
        {Object.keys(slotPhotos).length > 0 && (
          <>
            <label className="check-label" style={{ margin: '8px 0' }}>
              <input
                type="checkbox"
                checked={mirrorFill}
                onChange={(e) => setMirrorFill(e.target.checked)}
              />
              Mirror-fill missing side
            </label>
            <div className="slider-row">
              <span className="slider-label">Adjust</span>
              <select
                value={activeSlot}
                onChange={(e) => setActiveSlot(e.target.value as PhotoSlot)}
                style={{ flex: 1 }}
              >
                {SIDE_SLOTS.filter((s) => slotPhotos[s.slot]).map((s) => (
                  <option key={s.slot} value={s.slot}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            {slotPhotos[activeSlot] &&
              (
                [
                  ['Zoom', 'scale', 0.5, 2, 1],
                  ['Shift X', 'offsetX', -0.4, 0.4, 0],
                  ['Shift Y', 'offsetY', -0.4, 0.4, 0],
                  ['Exposure', 'exposure', 0.5, 2, 1],
                ] as const
              ).map(([label, key, min, max, def]) => (
                <div className="slider-row" key={key}>
                  <span className="slider-label">{label}</span>
                  <input
                    type="range"
                    min={min}
                    max={max}
                    step={0.01}
                    value={slotPhotos[activeSlot]![key]}
                    onChange={(e) => adjustSlotPhoto(activeSlot, key, Number(e.target.value))}
                    onDoubleClick={() => adjustSlotPhoto(activeSlot, key, def)}
                    title="Double-click to reset"
                  />
                  <span className="slider-value">{slotPhotos[activeSlot]![key].toFixed(2)}</span>
                </div>
              ))}
            <p>Photos bake into the head texture behind the live face once a performance is tracked.</p>
          </>
        )}
      </div>

      <div className="panel-section">
        <h3>Morph</h3>
        {sliderRow('Face width', 'faceWidth')}
        {sliderRow('Face length', 'faceLength')}
        {sliderRow('Jaw width', 'jawWidth')}
        {sliderRow('Head depth', 'headDepth')}
        <div className="button-row">
          <button onClick={resetMorph}>Reset</button>
        </div>
      </div>
    </>
  )
}
