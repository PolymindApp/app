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

export function taskIntervalCanStart(progress: TaskProgress, currentDate: string) {
  const isInterval = progress.programStep
    ? progress.programStep.completionType === 'interval'
    : progress.task.type === 'interval'
  return isInterval
    && progress.scheduledDate === currentDate
    && !progress.complete
    && (progress.status === 'pending' || progress.status === 'missed')
}
