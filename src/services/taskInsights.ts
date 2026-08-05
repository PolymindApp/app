import { parseISO } from 'date-fns'
import { isTaskScheduled } from '@/services/schedule'
import { dateRangeKeys } from '@/services/tracking'
import type {
  Entry,
  Occurrence,
  Task,
  TrackingDailyValue,
  TrackingFactorMode,
} from '@/types/domain'

export interface TaskInsightProfile {
  factorMode: TrackingFactorMode
  unit: string
  scaleMin?: number
  scaleMax?: number
}

const QUANTITATIVE_TASK_TYPES = new Set<Task['type']>([
  'daily_total',
  'duration',
  'step_counter',
])

export function isQuantitativeTask(task: Task) {
  return QUANTITATIVE_TASK_TYPES.has(task.type)
}

export function taskInsightProfile(task: Task): TaskInsightProfile {
  if (!isQuantitativeTask(task)) {
    return {
      factorMode: 'presence',
      unit: 'completed',
      scaleMin: 0,
      scaleMax: 1,
    }
  }

  const fallbackUnit = task.type === 'duration'
    ? 'hours'
    : task.type === 'step_counter'
      ? 'steps'
      : 'amount'
  return {
    factorMode: 'quantity',
    unit: task.customUnit || (task.unit === 'custom' ? '' : task.unit) || fallbackUnit,
    scaleMin: 0,
  }
}

export function taskInsightDateKeys(task: Task, start: string, end: string) {
  return dateRangeKeys(start, end).filter((date) =>
    isTaskScheduled(task, parseISO(date)),
  )
}

export function taskInsightDailyValues(
  task: Task,
  entries: Entry[],
  occurrences: Occurrence[],
  start: string,
  end: string,
  stepCounts: Record<string, number> = {},
): TrackingDailyValue[] {
  const scheduledDates = new Set(taskInsightDateKeys(task, start, end))

  if (task.type === 'step_counter') {
    return [...scheduledDates]
      .map((date) => ({ date, value: Math.max(0, Number(stepCounts[date]) || 0) }))
  }

  if (isQuantitativeTask(task)) {
    const totals = new Map<string, number>()
    entries
      .filter((entry) =>
        entry.task === task.id
        && !entry.programStep
        && entry.entryDate >= start
        && entry.entryDate <= end,
      )
      .forEach((entry) => {
        scheduledDates.add(entry.entryDate)
        totals.set(entry.entryDate, (totals.get(entry.entryDate) || 0) + entry.value)
      })

    return [...scheduledDates]
      .sort()
      .map((date) => ({ date, value: totals.get(date) || 0 }))
  }

  const completedDates = new Set<string>()
  occurrences
    .filter((occurrence) =>
      occurrence.task === task.id
      && occurrence.scheduledDate >= start
      && occurrence.scheduledDate <= end,
    )
    .forEach((occurrence) => {
      scheduledDates.add(occurrence.scheduledDate)
      if (occurrence.status === 'completed') completedDates.add(occurrence.scheduledDate)
    })

  return [...scheduledDates]
    .sort()
    .map((date) => ({ date, value: completedDates.has(date) ? 1 : 0 }))
}
