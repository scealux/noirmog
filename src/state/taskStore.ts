import { create } from 'zustand'

export type LogLevel = 'info' | 'success' | 'warn' | 'error'

export interface LogEntry {
  id: number
  time: number
  level: LogLevel
  source: string
  message: string
}

export type StageStatus = 'pending' | 'active' | 'done' | 'error'

export interface Stage {
  id: string
  label: string
  /** Relative share of the overall task bar (default 1). */
  weight: number
  status: StageStatus
  /** 0..1 within this stage. */
  progress: number
  /** Sub-task label, e.g. "Tracking frames: 342/900". */
  detail: string
}

export type TaskStatus = 'running' | 'done' | 'error'

export interface TaskError {
  message: string
  /** Stage that failed, for display. */
  stageLabel?: string
  /** What the user can try. */
  hint?: string
}

export interface Task {
  id: number
  title: string
  status: TaskStatus
  stages: Stage[]
  startedAt: number
  finishedAt?: number
  error?: TaskError
}

export interface StageDef {
  id: string
  label: string
  weight?: number
}

const MAX_LOG_ENTRIES = 2000

let nextTaskId = 1
let nextLogId = 1

interface TaskStoreState {
  tasks: Task[]
  logs: LogEntry[]

  log: (level: LogLevel, source: string, message: string) => void
  clearLogs: () => void

  startTask: (title: string, stages: StageDef[]) => number
  startStage: (taskId: number, stageId: string) => void
  setStageProgress: (taskId: number, stageId: string, progress: number, detail?: string) => void
  completeStage: (taskId: number, stageId: string) => void
  finishTask: (taskId: number) => void
  failTask: (taskId: number, error: TaskError) => void
  dismissTask: (taskId: number) => void
}

function updateTask(tasks: Task[], taskId: number, fn: (task: Task) => Task): Task[] {
  return tasks.map((t) => (t.id === taskId ? fn(t) : t))
}

function updateStage(task: Task, stageId: string, fn: (stage: Stage) => Stage): Task {
  return { ...task, stages: task.stages.map((s) => (s.id === stageId ? fn(s) : s)) }
}

export const useTaskStore = create<TaskStoreState>((set) => ({
  tasks: [],
  logs: [],

  log: (level, source, message) =>
    set((state) => {
      const entry: LogEntry = { id: nextLogId++, time: Date.now(), level, source, message }
      const logs = [...state.logs, entry]
      return { logs: logs.length > MAX_LOG_ENTRIES ? logs.slice(-MAX_LOG_ENTRIES) : logs }
    }),

  clearLogs: () => set({ logs: [] }),

  startTask: (title, stages) => {
    const id = nextTaskId++
    const task: Task = {
      id,
      title,
      status: 'running',
      startedAt: Date.now(),
      stages: stages.map((s) => ({
        id: s.id,
        label: s.label,
        weight: s.weight ?? 1,
        status: 'pending',
        progress: 0,
        detail: '',
      })),
    }
    // Keep the running task plus a short history of finished ones.
    set((state) => ({ tasks: [...state.tasks.slice(-4), task] }))
    return id
  },

  startStage: (taskId, stageId) =>
    set((state) => ({
      tasks: updateTask(state.tasks, taskId, (task) =>
        updateStage(task, stageId, (s) => ({ ...s, status: 'active' })),
      ),
    })),

  setStageProgress: (taskId, stageId, progress, detail) =>
    set((state) => ({
      tasks: updateTask(state.tasks, taskId, (task) =>
        updateStage(task, stageId, (s) => ({
          ...s,
          progress: Math.min(1, Math.max(0, progress)),
          detail: detail ?? s.detail,
        })),
      ),
    })),

  completeStage: (taskId, stageId) =>
    set((state) => ({
      tasks: updateTask(state.tasks, taskId, (task) =>
        updateStage(task, stageId, (s) => ({ ...s, status: 'done', progress: 1 })),
      ),
    })),

  finishTask: (taskId) =>
    set((state) => ({
      tasks: updateTask(state.tasks, taskId, (task) => ({
        ...task,
        status: 'done',
        finishedAt: Date.now(),
        stages: task.stages.map((s) =>
          s.status === 'done' ? s : { ...s, status: 'done', progress: 1 },
        ),
      })),
    })),

  failTask: (taskId, error) =>
    set((state) => ({
      tasks: updateTask(state.tasks, taskId, (task) => ({
        ...task,
        status: 'error',
        finishedAt: Date.now(),
        error,
        stages: task.stages.map((s) => (s.status === 'active' ? { ...s, status: 'error' } : s)),
      })),
    })),

  dismissTask: (taskId) =>
    set((state) => ({ tasks: state.tasks.filter((t) => t.id !== taskId) })),
}))

/** Overall 0..1 progress across weighted stages. */
export function taskOverallProgress(task: Task): number {
  const totalWeight = task.stages.reduce((sum, s) => sum + s.weight, 0)
  if (totalWeight === 0) return task.status === 'done' ? 1 : 0
  const done = task.stages.reduce(
    (sum, s) => sum + s.weight * (s.status === 'done' ? 1 : s.progress),
    0,
  )
  return done / totalWeight
}
