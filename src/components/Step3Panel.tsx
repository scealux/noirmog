import { usePerformanceStore } from '../state/performanceStore'
import { exportTextureVideo, exportBustVideo } from '../lib/exporters/exportVideos'
import { exportGLBBundle, exportBakedGLB } from '../lib/exporters/exportGLB'

function rgbToHex([r, g, b]: [number, number, number]): string {
  const h = (n: number) => Math.round(n).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ]
}

export function Step3Panel() {
  const tracking = usePerformanceStore((s) => s.tracking)
  const skinColorOverride = usePerformanceStore((s) => s.skinColorOverride)
  const setSkinColorOverride = usePerformanceStore((s) => s.setSkinColorOverride)
  const trimStart = usePerformanceStore((s) => s.trimStart)
  const trimEnd = usePerformanceStore((s) => s.trimEnd)

  if (!tracking) {
    return (
      <div className="placeholder-note">
        Nothing to edit or export yet — track a performance in Step 2 first.
      </div>
    )
  }

  const currentColor = skinColorOverride ?? tracking.skinColor
  const run = (fn: () => Promise<void>) => () => void fn().catch(() => {})

  return (
    <>
      <div className="panel-section">
        <h3>Blend</h3>
        <div className="button-row">
          <input
            type="color"
            value={rgbToHex(currentColor)}
            onChange={(e) => setSkinColorOverride(hexToRgb(e.target.value))}
            title="Skin tone for the untextured head area"
          />
          <button onClick={() => setSkinColorOverride(null)} disabled={!skinColorOverride}>
            Use auto-sampled
          </button>
        </div>
        <p style={{ marginTop: 6 }}>
          {skinColorOverride ? 'Custom skin tone.' : 'Auto-sampled from the tracked face.'} Edge
          feathering lives in Step 2 → Face Fit &amp; Blend.
        </p>
      </div>

      <div className="panel-section">
        <h3>Export</h3>
        <p>
          Range: {trimStart.toFixed(1)}s – {trimEnd.toFixed(1)}s (set in Step 2 → Trim). Video
          exports record in real time — keep this tab visible.
        </p>
        <div className="export-list">
          <button onClick={run(exportGLBBundle)}>GLB + channels + viewer</button>
          <p>Rigged head GLB, channel curves JSON, and a Three.js viewer HTML. Pair with the UV texture video below.</p>
          <button onClick={run(exportTextureVideo)}>UV texture video</button>
          <p>The stabilized face texture as video with audio — the raw pipeline asset.</p>
          <button onClick={run(exportBustVideo)}>Rendered bust video</button>
          <p>Records the 3D viewport exactly as you see it, with audio.</p>
          <button onClick={run(exportBakedGLB)}>GLB with baked frames</button>
          <p>Texture frames baked into the GLB (15fps, 512px). Expect a large file.</p>
        </div>
      </div>
    </>
  )
}
