import type { TaskProgress } from '@/types/domain'

export const TASK_CARD_ACTION_ITEMS = [
  {
    id: 'view-log-history',
    title: 'View log history',
    icon: 'mdi-history',
  },
] as const

export type TaskCardActionId = typeof TASK_CARD_ACTION_ITEMS[number]['id']

export function taskCanLogAmounts(progress?: TaskProgress) {
  if (!progress) return false
  if (progress.programStep) return progress.programStep.completionType === 'quantity'
  return progress.task.type === 'duration' || progress.task.type === 'daily_total'
}
