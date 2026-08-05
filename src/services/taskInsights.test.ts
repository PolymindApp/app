import { describe, expect, it } from 'vitest'
import {
  taskInsightDailyValues,
  taskInsightProfile,
} from './taskInsights'
import type { Entry, Occurrence, Task } from '@/types/domain'

const task = (type: Task['type'], overrides: Partial<Task> = {}): Task => ({
  id: 'task-1',
  name: 'Test task',
  description: '',
  type,
  mandatory: false,
  reviewWhenMissed: false,
  active: true,
  startDate: '2026-07-01',
  recurrenceType: 'daily',
  weekdays: [],
  intervalWeeks: 1,
  entryNotesEnabled: false,
  entryNoteSuggestionsEnabled: false,
  sortOrder: 0,
  ...overrides,
})

const entry = (date: string, value: number, overrides: Partial<Entry> = {}): Entry => ({
  id: `${date}-${value}`,
  task: 'task-1',
  entryDate: date,
  createdAt: `${date}T12:00:00.000Z`,
  value,
  kind: 'quantity',
  unit: 'g',
  ...overrides,
})

const occurrence = (
  date: string,
  status: Occurrence['status'],
  overrides: Partial<Occurrence> = {},
): Occurrence => ({
  id: `${date}-${status}`,
  task: 'task-1',
  scheduledDate: date,
  status,
  sealed: status === 'completed',
  snapshotName: 'Test task',
  ...overrides,
})

describe('task insight factors', () => {
  it('uses daily-total amounts and the configured unit', () => {
    const dailyTotal = task('daily_total', { unit: 'g', targetValue: 150 })

    expect(taskInsightProfile(dailyTotal)).toEqual({
      factorMode: 'quantity',
      unit: 'g',
      scaleMin: 0,
    })
    expect(taskInsightDailyValues(
      dailyTotal,
      [
        entry('2026-07-01', 40),
        entry('2026-07-01', 15, { id: 'second-entry' }),
        entry('2026-07-02', 10),
        entry('2026-07-02', -5, { id: 'adjustment', kind: 'adjustment' }),
      ],
      [],
      '2026-07-01',
      '2026-07-03',
    )).toEqual([
      { date: '2026-07-01', value: 55 },
      { date: '2026-07-02', value: 5 },
      { date: '2026-07-03', value: 0 },
    ])
  })

  it('uses actual daily duration totals in hours', () => {
    const duration = task('duration', { unit: 'hours', targetValue: 2 })

    expect(taskInsightProfile(duration).factorMode).toBe('quantity')
    expect(taskInsightProfile(duration).unit).toBe('hours')
    expect(taskInsightDailyValues(
      duration,
      [
        entry('2026-07-01', .5, { kind: 'duration', unit: 'hours' }),
        entry('2026-07-01', 1.25, { id: 'second-duration', kind: 'duration', unit: 'hours' }),
      ],
      [occurrence('2026-07-01', 'completed')],
      '2026-07-01',
      '2026-07-02',
    )).toEqual([
      { date: '2026-07-01', value: 1.75 },
      { date: '2026-07-02', value: 0 },
    ])
  })

  it('keeps check tasks completion-based', () => {
    const check = task('check')

    expect(taskInsightProfile(check)).toEqual({
      factorMode: 'presence',
      unit: 'completed',
      scaleMin: 0,
      scaleMax: 1,
    })
    expect(taskInsightDailyValues(
      check,
      [],
      [
        occurrence('2026-07-01', 'completed'),
        occurrence('2026-07-02', 'pending'),
      ],
      '2026-07-01',
      '2026-07-02',
    )).toEqual([
      { date: '2026-07-01', value: 1 },
      { date: '2026-07-02', value: 0 },
    ])
  })

  it('uses Health Connect step amounts for step-counter tasks', () => {
    const stepCounter = task('step_counter', { unit: 'steps', targetValue: 10_000 })

    expect(taskInsightProfile(stepCounter)).toMatchObject({
      factorMode: 'quantity',
      unit: 'steps',
    })
    expect(taskInsightDailyValues(
      stepCounter,
      [],
      [],
      '2026-07-01',
      '2026-07-02',
      { '2026-07-01': 8123, '2026-07-02': 10_456 },
    )).toEqual([
      { date: '2026-07-01', value: 8123 },
      { date: '2026-07-02', value: 10_456 },
    ])
  })

  it('uses a custom daily-total unit instead of the custom placeholder', () => {
    expect(taskInsightProfile(task('daily_total', {
      unit: 'custom',
      customUnit: 'glasses',
    })).unit).toBe('glasses')
  })
})
