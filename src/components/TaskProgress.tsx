import { taskOverallProgress, useTaskStore, type Stage, type Task } from '../state/taskStore'

function StageRow({ stage }: { stage: Stage }) {
  return (
    <div className={`stage-row ${stage.status}`}>
      <div className="stage-label-row">
        <span className="name">{stage.label}</span>
        <span className="detail">{stage.detail}</span>
      </div>
      <div className="progress-track">
        <div
          className={`progress-fill${stage.status === 'error' ? ' err' : ''}`}
          style={{ width: `${Math.round(stage.progress * 100)}%` }}
        />
      </div>
    </div>
  )
}

function TaskCard({ task }: { task: Task }) {
  const dismissTask = useTaskStore((s) => s.dismissTask)
  const overall = taskOverallProgress(task)
  const fillClass =
    task.status === 'error' ? ' err' : task.status === 'done' ? ' ok' : ''

  return (
    <div className="task-card">
      <div className="task-card-head">
        <span className="title">{task.title}</span>
        <span className="pct">{Math.round(overall * 100)}%</span>
        {task.status !== 'running' && (
          <button
            className="dismiss"
            onClick={() => dismissTask(task.id)}
            title="Dismiss"
            aria-label={`Dismiss ${task.title}`}
          >
            ×
          </button>
        )}
      </div>
      <div className="progress-track">
        <div className={`progress-fill${fillClass}`} style={{ width: `${Math.round(overall * 100)}%` }} />
      </div>

      <div className="task-stages">
        {task.stages.map((stage) => (
          <StageRow key={stage.id} stage={stage} />
        ))}
      </div>

      {task.error && (
        <div className="task-error" role="alert">
          <div className="where">
            Failed{task.error.stageLabel ? ` during “${task.error.stageLabel}”` : ''}
          </div>
          <div>{task.error.message}</div>
          {task.error.hint && <div className="hint">Try: {task.error.hint}</div>}
        </div>
      )}
    </div>
  )
}

/** Floating task cards over the center stage: running tasks + undismissed results. */
export function TaskProgress() {
  const tasks = useTaskStore((s) => s.tasks)
  if (tasks.length === 0) return null

  return (
    <div className="task-overlay">
      {tasks.map((task) => (
        <TaskCard key={task.id} task={task} />
      ))}
    </div>
  )
}
