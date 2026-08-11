import { useEffect, useRef } from 'react'

/** Wheel/stepper fine-tune increment on the number box. */
const FINE_STEP = 0.02

interface Props {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  /** Double-click (slider) reset value. */
  resetValue?: number
  /** Decimals shown in the number box (default 2). */
  decimals?: number
}

/**
 * Standard panel slider: range input + editable number box. The number box
 * fine-tunes by ±0.02 via its stepper arrows or the scroll wheel; the range
 * resets on double-click.
 */
export function SliderRow({ label, value, min, max, step, onChange, resetValue, decimals = 2 }: Props) {
  const numberRef = useRef<HTMLInputElement>(null)

  const clamp = (v: number) => Math.min(max, Math.max(min, v))

  // React wheel listeners are passive; a manual non-passive listener lets us
  // stop the page from scrolling while adjusting the value.
  useEffect(() => {
    const el = numberRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const dir = e.deltaY < 0 ? 1 : -1
      onChange(clamp(Number((value + dir * FINE_STEP).toFixed(4))))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  })

  return (
    <div className="slider-row">
      <span className="slider-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={resetValue !== undefined ? () => onChange(resetValue) : undefined}
        title={resetValue !== undefined ? 'Double-click to reset' : undefined}
      />
      <input
        ref={numberRef}
        className="slider-number"
        type="number"
        min={min}
        max={max}
        step={FINE_STEP}
        value={Number(value.toFixed(decimals))}
        onChange={(e) => {
          const v = Number(e.target.value)
          if (!Number.isNaN(v)) onChange(clamp(v))
        }}
      />
    </div>
  )
}
