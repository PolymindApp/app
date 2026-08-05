import { describe, expect, it } from 'vitest'
import { dailyTotalCompletionPercent, goalState, isTaskScheduled, meetsTarget, programCycleDay, progressPercent, stepsForDate, taskCompletionMarkerColor } from './schedule'
import type { ProgramStep, Task } from '@/types/domain'

const task = (overrides: Partial<Task> = {}): Task => ({
  id: 'task-1',
  name: 'Train',
  description: '',
  type: 'check',
  mandatory: true,
  reviewWhenMissed: false,
  active: true,
  startDate: '2026-07-06',
  recurrenceType: 'daily',
  weekdays: [1, 3, 5],
  intervalWeeks: 1,
  entryNotesEnabled: true,
  entryNoteSuggestionsEnabled: true,
  sortOrder: 0,
  ...overrides,
})

describe('task schedules', () => {
  it('schedules daily work from its start date', () => {
    expect(isTaskScheduled(task(), new Date(2026, 6, 5))).toBe(false)
    expect(isTaskScheduled(task(), new Date(2026, 6, 6))).toBe(true)
    expect(isTaskScheduled(task(), new Date(2026, 6, 12))).toBe(true)
  })

  it('schedules only selected weekdays', () => {
    const weekdays = task({ recurrenceType: 'weekdays' })
    expect(isTaskScheduled(weekdays, new Date(2026, 6, 8))).toBe(true)
    expect(isTaskScheduled(weekdays, new Date(2026, 6, 9))).toBe(false)
  })

  it('anchors every-N-week work to its start week', () => {
    const biweekly = task({ recurrenceType: 'interval_weeks', intervalWeeks: 2, weekdays: [1] })
    expect(isTaskScheduled(biweekly, new Date(2026, 6, 6))).toBe(true)
    expect(isTaskScheduled(biweekly, new Date(2026, 6, 13))).toBe(false)
    expect(isTaskScheduled(biweekly, new Date(2026, 6, 20))).toBe(true)
  })
})

describe('program cycles', () => {
  const program = task({ type: 'program', cycleLength: 10, programRepeat: true })
  const steps: ProgramStep[] = [
    { id: 'a', task: 'task-1', name: 'Upper', description: '', sortOrder: 0, cycleDays: [1, 8], completionType: 'check', active: true },
    { id: 'b', task: 'task-1', name: 'Lower', description: '', sortOrder: 1, cycleDays: [3], completionType: 'check', active: true },
  ]

  it('supports cycles longer than a week and repeats them', () => {
    expect(programCycleDay(program, new Date(2026, 6, 6))).toBe(1)
    expect(programCycleDay(program, new Date(2026, 6, 15))).toBe(10)
    expect(programCycleDay(program, new Date(2026, 6, 16))).toBe(1)
  })

  it('stops a one-off program after its final day', () => {
    expect(programCycleDay({ ...program, programRepeat: false }, new Date(2026, 6, 16))).toBeNull()
  })

  it('selects steps assigned to the current numbered day', () => {
    expect(stepsForDate(program, steps, new Date(2026, 6, 13)).map((step) => step.name)).toEqual(['Upper'])
  })
})

describe('quantitative targets', () => {
  it('evaluates at-least, at-most, and exact targets', () => {
    expect(meetsTarget(151, 150, 'gte')).toBe(true)
    expect(meetsTarget(2100, 2200, 'lte')).toBe(true)
    expect(meetsTarget(2.5, 2.5, 'eq')).toBe(true)
    expect(meetsTarget(2.4, 2.5, 'eq')).toBe(false)
  })

  it('compares targets at the same two-decimal precision shown to the user', () => {
    const displayedFourHours = 3 - 1.28 + (1007 / 3600) + 2

    expect(Number(displayedFourHours.toFixed(2))).toBe(4)
    expect(meetsTarget(displayedFourHours, 4, 'gte')).toBe(true)
    expect(progressPercent(displayedFourHours, 4, 'gte')).toBe(100)
    expect(goalState(displayedFourHours, 4, 'gte')).toBe('met')
  })

  it('caps progress at one hundred percent', () => {
    expect(progressPercent(175, 150, 'gte')).toBe(100)
    expect(progressPercent(75, 150, 'gte')).toBe(50)
    expect(progressPercent(-25, 150, 'gte')).toBe(0)
  })

  it('penalizes a locked at-most daily total only by its proportional excess', () => {
    expect(dailyTotalCompletionPercent(3, 4, 'lte')).toBe(100)
    expect(dailyTotalCompletionPercent(4, 4, 'lte')).toBe(100)
    expect(dailyTotalCompletionPercent(5, 4, 'lte')).toBe(75)
    expect(dailyTotalCompletionPercent(8, 4, 'lte')).toBe(0)
  })

  it('identifies exceeded maximums and insufficient minimums', () => {
    expect(goalState(2300, 2200, 'lte')).toBe('exceeded')
    expect(goalState(2100, 2200, 'lte')).toBe('neutral')
    expect(goalState(120, 150, 'gte')).toBe('not_enough')
    expect(goalState(150, 150, 'gte')).toBe('met')
  })
})

describe('daily task completion markers', () => {
  it('uses error below 25%, warning for other incomplete days, and success at 100%', () => {
    expect(taskCompletionMarkerColor(0)).toBe('error')
    expect(taskCompletionMarkerColor(24)).toBe('error')
    expect(taskCompletionMarkerColor(25)).toBe('warning')
    expect(taskCompletionMarkerColor(99)).toBe('warning')
    expect(taskCompletionMarkerColor(100)).toBe('success')
  })
})
