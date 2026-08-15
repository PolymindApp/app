import type { Task, TaskProgress } from '@/types/domain'

const TASK_FILTER_SELECTION_STORAGE_KEY = 'backontrack-task-filter-selection'

export const TASK_FILTER_ITEMS = [
  {
    id: 'completed',
    title: 'Completed',
    ariaLabel: 'Show completed tasks',
  },
  {
    id: 'not_scheduled',
    title: 'Not scheduled',
    ariaLabel: 'Show tasks not scheduled for the selected day',
  },
] as const

export type TaskFilterId = typeof TASK_FILTER_ITEMS[number]['id']

function isTaskFilterId(value: unknown): value is TaskFilterId {
  return typeof value === 'string' && TASK_FILTER_ITEMS.some(filter => filter.id === value)
}

export function readTaskFilterSelection(): TaskFilterId[] {
  if (typeof sessionStorage === 'undefined') return []
  try {
    const stored = JSON.parse(sessionStorage.getItem(TASK_FILTER_SELECTION_STORAGE_KEY) || '[]')
    return Array.isArray(stored) ? stored.filter(isTaskFilterId) : []
  } catch {
    return []
  }
}

export function writeTaskFilterSelection(filters: TaskFilterId[]) {
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.setItem(TASK_FILTER_SELECTION_STORAGE_KEY, JSON.stringify(filters))
  } catch {
    // Filters remain usable in memory when session storage is unavailable.
  }
}

export function tasksWithoutProgress(tasks: Task[], progressItems: TaskProgress[]) {
  const taskIdsWithProgress = new Set(progressItems.map(progress => progress.task.id))
  return tasks.filter(task => !taskIdsWithProgress.has(task.id))
}
