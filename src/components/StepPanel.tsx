import { STEPS, useAppStore } from '../state/appStore'
import { Step1Panel } from './Step1Panel'
import { Step2Panel } from './Step2Panel'
import { Step3Panel } from './Step3Panel'

export function StepPanel() {
  const currentStep = useAppStore((s) => s.currentStep)
  const step = STEPS.find((s) => s.id === currentStep)
  if (!step) return null

  return (
    <aside className="side-panel">
      <div className="panel-header">
        <h2>
          {step.id}. {step.title}
        </h2>
        <p className="blurb">{step.blurb}</p>
      </div>
      {step.id === 1 ? <Step1Panel /> : step.id === 2 ? <Step2Panel /> : <Step3Panel />}
    </aside>
  )
}
