export type TaskTimerStatus = 'running' | 'paused'

export interface TaskTimerState {
  version: 1
  taskId: string
  dateKey: string
  status: TaskTimerStatus
  accumulatedMs: number
  startedAt?: string
  updatedAt: string
}

const STORAGE_PREFIX = 'mom-task-timer'

export function createTaskTimer(
  taskId: string,
  dateKey: string,
  now = new Date(),
): TaskTimerState {
  return {
    version: 1,
    taskId,
    dateKey,
    status: 'paused',
    accumulatedMs: 0,
    updatedAt: now.toISOString(),
  }
}

export function taskTimerElapsedMs(state: TaskTimerState, now = new Date()) {
  if (state.status !== 'running' || !state.startedAt) return state.accumulatedMs
  const startedAt = Date.parse(state.startedAt)
  if (!Number.isFinite(startedAt)) return state.accumulatedMs
  return state.accumulatedMs + Math.max(0, now.getTime() - startedAt)
}

export function resumeTaskTimer(state: TaskTimerState, now = new Date()): TaskTimerState {
  if (state.status === 'running') return state
  return {
    ...state,
    status: 'running',
    startedAt: now.toISOString(),
    updatedAt: now.toISOString(),
  }
}

export function pauseTaskTimer(state: TaskTimerState, now = new Date()): TaskTimerState {
  return {
    ...state,
    status: 'paused',
    accumulatedMs: taskTimerElapsedMs(state, now),
    startedAt: undefined,
    updatedAt: now.toISOString(),
  }
}

export function resetTaskTimer(state: TaskTimerState, now = new Date()): TaskTimerState {
  return {
    ...state,
    accumulatedMs: 0,
    startedAt: state.status === 'running' ? now.toISOString() : undefined,
    updatedAt: now.toISOString(),
  }
}

export function formatTaskTimer(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor(totalSeconds % 3600 / 60)
  const seconds = totalSeconds % 60
  const clock = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  return hours ? `${String(hours).padStart(2, '0')}:${clock}` : clock
}

export function loadTaskTimer(taskId: string, dateKey: string) {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey(taskId, dateKey)) || '')
    if (
      saved?.version !== 1
      || saved.taskId !== taskId
      || saved.dateKey !== dateKey
      || !['running', 'paused'].includes(saved.status)
      || !Number.isFinite(saved.accumulatedMs)
      || saved.accumulatedMs < 0
      || typeof saved.updatedAt !== 'string'
      || (saved.startedAt !== undefined && typeof saved.startedAt !== 'string')
    ) return undefined
    return saved as TaskTimerState
  } catch {
    return undefined
  }
}

export function saveTaskTimer(state: TaskTimerState) {
  try {
    localStorage.setItem(storageKey(state.taskId, state.dateKey), JSON.stringify(state))
  } catch {
    // The active view still keeps time if local storage is unavailable.
  }
}

export function clearTaskTimer(taskId: string, dateKey: string) {
  try {
    localStorage.removeItem(storageKey(taskId, dateKey))
  } catch {
    // Nothing else is required when storage is unavailable.
  }
}

function storageKey(taskId: string, dateKey: string) {
  return `${STORAGE_PREFIX}:${taskId}:${dateKey}`
}
