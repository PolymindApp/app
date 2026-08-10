import type { Task, TaskProgress } from '@/types/domain'

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

export function tasksWithoutProgress(tasks: Task[], progressItems: TaskProgress[]) {
  const taskIdsWithProgress = new Set(progressItems.map(progress => progress.task.id))
  return tasks.filter(task => !taskIdsWithProgress.has(task.id))
}
