import { useTaskStore, type StageDef, type LogLevel } from '../state/taskStore'

/**
 * An error with a user-facing hint ("what to try"). Pipeline code should throw
 * these; runTask attaches the failing stage automatically.
 */
export class PipelineError extends Error {
  hint?: string
  constructor(message: string, hint?: string) {
    super(message)
    this.name = 'PipelineError'
    this.hint = hint
  }
}

export interface StageHandle {
  /** Report progress within this stage, with an optional sub-task label. */
  set(progress: number, detail?: string): void
  done(): void
}

export interface TaskContext {
  /** Begin a declared stage. Any previously begun stage is completed first. */
  stage(id: string): StageHandle
  log(level: LogLevel, message: string): void
}

/**
 * Run an async pipeline operation under the task system: registers stages,
 * routes progress/log lines to the store, and surfaces failures with the
 * failing stage and a hint. Rethrows so callers can react; the UI already
 * shows the error by then.
 */
export async function runTask<T>(
  title: string,
  stages: StageDef[],
  fn: (ctx: TaskContext) => Promise<T>,
): Promise<T> {
  const store = useTaskStore.getState()
  const taskId = store.startTask(title, stages)
  const labelOf = (id: string) => stages.find((s) => s.id === id)?.label ?? id

  let currentStageId: string | null = null
  const ctx: TaskContext = {
    stage(id) {
      if (currentStageId) store.completeStage(taskId, currentStageId)
      currentStageId = id
      store.startStage(taskId, id)
      store.log('info', title, `Stage started: ${labelOf(id)}`)
      return {
        set(progress, detail) {
          store.setStageProgress(taskId, id, progress, detail)
        },
        done() {
          store.completeStage(taskId, id)
          store.log('info', title, `Stage done: ${labelOf(id)}`)
          if (currentStageId === id) currentStageId = null
        },
      }
    },
    log(level, message) {
      store.log(level, title, message)
    },
  }

  store.log('info', title, 'Task started')
  try {
    const result = await fn(ctx)
    store.finishTask(taskId)
    store.log('success', title, 'Task finished')
    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const hint = err instanceof PipelineError ? err.hint : undefined
    const stageLabel = currentStageId ? labelOf(currentStageId) : undefined
    store.failTask(taskId, { message, stageLabel, hint })
    store.log(
      'error',
      title,
      `Failed${stageLabel ? ` during "${stageLabel}"` : ''}: ${message}${hint ? ` — ${hint}` : ''}`,
    )
    throw err
  }
}
