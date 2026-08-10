import { Fragment } from 'react'
import { STEPS, useAppStore } from '../state/appStore'

export function Stepper() {
  const currentStep = useAppStore((s) => s.currentStep)
  const setStep = useAppStore((s) => s.setStep)

  return (
    <nav className="stepper" aria-label="Workflow steps">
      {STEPS.map((step, i) => (
        <Fragment key={step.id}>
          {i > 0 && <div className="stepper-sep" />}
          <button
            className={`stepper-item${step.id === currentStep ? ' active' : ''}`}
            onClick={() => setStep(step.id)}
            aria-current={step.id === currentStep ? 'step' : undefined}
          >
            <span className="stepper-num">{step.id}</span>
            <span>{step.title}</span>
          </button>
        </Fragment>
      ))}
    </nav>
  )
}
