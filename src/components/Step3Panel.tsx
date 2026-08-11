import { usePerformanceStore } from '../state/performanceStore'
import { exportTextureVideo, exportBustVideo } from '../lib/exporters/exportVideos'
import { exportGLBBundle, exportBakedGLB } from '../lib/exporters/exportGLB'

export function Step3Panel() {
  const tracking = usePerformanceStore((s) => s.tracking)
  const trimStart = usePerformanceStore((s) => s.trimStart)
  const trimEnd = usePerformanceStore((s) => s.trimEnd)

  if (!tracking) {
    return (
      <div className="placeholder-note">
        Nothing to edit or export yet — track a performance in Step 2 first.
      </div>
    )
  }

  const run = (fn: () => Promise<void>) => () => void fn().catch(() => {})

  return (
    <>
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
