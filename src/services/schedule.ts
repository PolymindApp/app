import {
  addDays,
  differenceInCalendarDays,
  differenceInCalendarWeeks,
  format,
  isAfter,
  isBefore,
  parseISO,
  startOfWeek,
} from 'date-fns'
import type { ProgramStep, TargetOperator, Task } from '@/types/domain'

export const toDateKey = (date: Date) => format(date, 'yyyy-MM-dd')
export type GoalState = 'neutral' | 'met' | 'exceeded' | 'not_enough'

function comparableTaskValue(value: number) {
  return Number(value.toFixed(2))
}

export function isTaskScheduled(task: Task, date: Date): boolean {
  const start = parseISO(task.startDate)
  if (isBefore(date, start)) return false
  if (task.endDate && isAfter(date, parseISO(task.endDate))) return false

  if (task.type === 'program') return programCycleDay(task, date) !== null
  if (task.recurrenceType === 'daily') return true
  if (task.recurrenceType === 'weekdays') return task.weekdays.includes(date.getDay())

  const weeks = differenceInCalendarWeeks(
    startOfWeek(date, { weekStartsOn: 1 }),
    startOfWeek(start, { weekStartsOn: 1 }),
    { weekStartsOn: 1 },
  )
  return weeks >= 0 && weeks % Math.max(task.intervalWeeks, 1) === 0 && task.weekdays.includes(date.getDay())
}

export function programCycleDay(task: Task, date: Date): number | null {
  if (task.type !== 'program' || !task.cycleLength) return null
  const elapsed = differenceInCalendarDays(date, parseISO(task.startDate))
  if (elapsed < 0) return null
  if (!task.programRepeat && elapsed >= task.cycleLength) return null
  return (elapsed % task.cycleLength) + 1
}

export function stepsForDate(task: Task, steps: ProgramStep[], date: Date): ProgramStep[] {
  const cycleDay = programCycleDay(task, date)
  if (!cycleDay) return []
  return steps.filter((step) => step.active && step.task === task.id && step.cycleDays.includes(cycleDay))
}

export function meetsTarget(value: number, target: number, operator: TargetOperator = 'gte'): boolean {
  const comparableValue = comparableTaskValue(value)
  const comparableTarget = comparableTaskValue(target)
  if (operator === 'lte') return comparableValue <= comparableTarget
  if (operator === 'eq') return comparableValue === comparableTarget
  return comparableValue >= comparableTarget
}

export function progressPercent(value: number, target = 1, operator: TargetOperator = 'gte'): number {
  if (target <= 0) return 0
  if (operator !== 'lte' && meetsTarget(value, target, operator)) return 100
  if (operator === 'lte') return value <= target ? Math.max(0, Math.min((value / target) * 100, 100)) : 100
  return Math.max(0, Math.min((value / target) * 100, 100))
}

export function dailyTotalCompletionPercent(
  value: number,
  target: number,
  operator: TargetOperator = 'gte',
) {
  const comparableValue = comparableTaskValue(value)
  const comparableTarget = comparableTaskValue(target)
  if (comparableTarget <= 0) {
    if (operator === 'gte') return 100
    return comparableValue <= 0 ? 100 : 0
  }
  if (operator === 'lte') {
    const exceeding = Math.max(0, comparableValue - comparableTarget)
    return Math.max(0, 100 - (exceeding * 100 / comparableTarget))
  }
  if (operator === 'eq') {
    const difference = Math.abs(comparableValue - comparableTarget)
    return Math.max(0, 100 - (difference * 100 / comparableTarget))
  }
  return Math.max(0, Math.min(comparableValue * 100 / comparableTarget, 100))
}

export function goalState(value: number, target: number, operator: TargetOperator = 'gte'): GoalState {
  const targetMet = meetsTarget(value, target, operator)
  if (operator === 'lte') return targetMet ? 'neutral' : 'exceeded'
  if (operator === 'gte') return targetMet ? 'met' : 'not_enough'
  return targetMet ? 'met' : 'neutral'
}

export function taskCompletionMarkerColor(percent: number) {
  if (percent >= 100) return 'success'
  if (percent < 25) return 'error'
  return 'warning'
}

export function nextScheduledDates(task: Task, count = 3, from = new Date()): Date[] {
  const result: Date[] = []
  for (let offset = 0; offset < 370 && result.length < count; offset += 1) {
    const date = addDays(from, offset)
    if (isTaskScheduled(task, date)) result.push(date)
  }
  return result
}
