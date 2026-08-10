import { STEPS, useAppStore } from '../state/appStore'
import { taskOverallProgress, useTaskStore } from '../state/taskStore'

export function StatusBar() {
  const currentStep = useAppStore((s) => s.currentStep)
  const showLogConsole = useAppStore((s) => s.showLogConsole)
  const setShowLogConsole = useAppStore((s) => s.setShowLogConsole)
  const tasks = useTaskStore((s) => s.tasks)

  const step = STEPS.find((s) => s.id === currentStep)
  const running = tasks.find((t) => t.status === 'running')
  const lastError = !running && tasks.length > 0 ? tasks[tasks.length - 1].error : undefined

  let summary = 'Idle'
  let summaryClass = ''
  if (running) {
    const active = running.stages.find((s) => s.status === 'active')
    const pct = Math.round(taskOverallProgress(running) * 100)
    summary = `${running.title}: ${active?.detail || active?.label || 'working'} (${pct}%)`
  } else if (lastError) {
    summary = `Error: ${lastError.message}`
    summaryClass = 'err'
  }

  return (
    <footer className="statusbar">
      <span>
        Step {currentStep} — {step?.title}
      </span>
      <div className="spacer" />
      <span className={`task-summary ${summaryClass}`}>{summary}</span>
      <button
        className={showLogConsole ? 'on' : ''}
        onClick={() => setShowLogConsole(!showLogConsole)}
        aria-pressed={showLogConsole}
      >
        Log
      </button>
    </footer>
  )
}
