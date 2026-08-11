import { STEPS, useAppStore } from '../state/appStore'
import { Step1Panel } from './Step1Panel'
import { Step2Panel } from './Step2Panel'

const PLACEHOLDERS: Record<number, { sections: { title: string; body: string }[] }> = {
  1: {
    sections: [
      {
        title: 'Reference photos',
        body: 'Optional front and side photos. Auto-detected landmarks become draggable points. (Phase 3)',
      },
      {
        title: 'Morph sliders',
        body: 'Coarse controls like jaw width and face length to fit the generic head. (Phase 3)',
      },
    ],
  },
  2: { sections: [] },
  3: {
    sections: [
      {
        title: 'Blend',
        body: 'Skin color picker override for the auto-sampled tone. Trim and edge feathering live in Step 2. (Phase 4)',
      },
      {
        title: 'Export',
        body: 'GLB + texture MP4, baked-texture GLB, raw UV texture video, or rendered MP4. (Phase 4)',
      },
    ],
  },
}

export function StepPanel() {
  const currentStep = useAppStore((s) => s.currentStep)
  const step = STEPS.find((s) => s.id === currentStep)
  if (!step) return null
  const placeholder = PLACEHOLDERS[step.id]

  return (
    <aside className="side-panel">
      <div className="panel-header">
        <h2>
          {step.id}. {step.title}
        </h2>
        <p className="blurb">{step.blurb}</p>
      </div>
      {step.id === 1 ? (
        <Step1Panel />
      ) : step.id === 2 ? (
        <Step2Panel />
      ) : (
        <>
          {placeholder.sections.map((section) => (
            <div className="panel-section" key={section.title}>
              <h3>{section.title}</h3>
              <p>{section.body}</p>
            </div>
          ))}
          <div className="placeholder-note">
            These controls arrive in a later phase. Step 2 (Capture Performance) is live.
          </div>
        </>
      )}
    </aside>
  )
}
