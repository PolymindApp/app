import { meetsTarget } from '@/services/schedule'
import type { TaskProgress } from '@/types/domain'

export const TASK_CARD_ACTION_ITEMS = [
  {
    id: 'complete-task',
    title: 'Mark completed',
    icon: 'mdi-check-circle-outline',
    dividerAfter: true,
  },
  {
    id: 'edit-task',
    title: 'Edit',
    icon: 'mdi-pencil-outline',
  },
  {
    id: 'skip-task',
    title: 'Skip',
    icon: 'mdi-skip-next-outline',
  },
  {
    id: 'log-additional-value',
    title: 'Log additional value',
    icon: 'mdi-plus-minus-variant',
    dividerAfter: true,
  },
  {
    id: 'toggle-task-status',
    title: 'Pause task',
    icon: 'mdi-pause',
  },
  {
    id: 'view-log-history',
    title: 'Log history',
    icon: 'mdi-history',
  },
] as const

export type TaskCardActionId = typeof TASK_CARD_ACTION_ITEMS[number]['id']

export function taskIsResolved(progress: TaskProgress) {
  return progress.complete || progress.status === 'skipped'
}

export function taskCanBeMarkedCompleted(progress?: TaskProgress) {
  if (!progress || progress.complete || progress.locked || progress.status === 'skipped') return false
  const completionType = progress.programStep?.completionType || progress.task.type
  return completionType === 'interval' || completionType === 'flashcards'
}

export function taskCanLogAmounts(progress?: TaskProgress) {
  if (!progress) return false
  if (progress.programStep) return progress.programStep.completionType === 'quantity'
  return progress.task.type === 'duration' || progress.task.type === 'daily_total'
}

export function taskCanLogAdditionalValue(progress?: TaskProgress) {
  return Boolean(progress && !progress.programStep && progress.task.type === 'step_counter')
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

export function taskNeedsReview(progress: TaskProgress, currentDate: string) {
  if (
    !progress.task.reviewWhenMissed
    || progress.status !== 'pending'
    || progress.scheduledDate >= currentDate
  ) {
    return false
  }

  const isQuantitative = progress.programStep
    ? progress.programStep.completionType === 'quantity'
    : ['duration', 'daily_total', 'step_counter'].includes(progress.task.type)
      || (['interval', 'flashcards'].includes(progress.task.type)
        && progress.task.sessionGoalType === 'duration')
  const targetMet = isQuantitative && meetsTarget(
    progress.value,
    progress.programStep?.targetValue
      ?? (progress.task.sessionGoalType === 'duration'
        ? progress.task.sessionTargetSeconds
        : progress.task.targetValue)
      ?? 0,
    progress.programStep?.targetOperator ?? progress.task.targetOperator ?? 'gte',
  )

  return !progress.complete && !targetMet
}
