import { describe, expect, it } from 'vitest'
import { TASK_CARD_ACTION_ITEMS, taskCanBeMarkedCompleted, taskCanLogAdditionalValue, taskCanLogAmounts, taskIntervalCanStart, taskIsResolved, taskNeedsReview } from './taskCardActions'
import type { ProgramStep, Task, TaskProgress, TaskType } from '@/types/domain'

function progress(type: TaskType, completionType?: ProgramStep['completionType']) {
  return {
    task: { type } as Task,
    ...(completionType ? { programStep: { completionType } as ProgramStep } : {}),
  } as TaskProgress
}

describe('task card actions', () => {
  it('defines the shared task menu order', () => {
    expect(TASK_CARD_ACTION_ITEMS.map(item => item.id)).toEqual([
      'complete-task',
      'skip-task',
      'log-additional-value',
      'edit-task',
      'toggle-task-status',
      'view-log-history',
    ])
  })

  it('offers manual completion only for unfinished interval and Review set work', () => {
    expect(taskCanBeMarkedCompleted(progress('interval'))).toBe(true)
    expect(taskCanBeMarkedCompleted(progress('flashcards'))).toBe(true)
    expect(taskCanBeMarkedCompleted(progress('program', 'interval'))).toBe(true)
    expect(taskCanBeMarkedCompleted(progress('program', 'flashcards'))).toBe(true)
    expect(taskCanBeMarkedCompleted(progress('check'))).toBe(false)
    expect(taskCanBeMarkedCompleted({ ...progress('interval'), complete: true })).toBe(false)
    expect(taskCanBeMarkedCompleted({ ...progress('flashcards'), locked: true })).toBe(false)
    expect(taskCanBeMarkedCompleted({ ...progress('interval'), status: 'skipped' })).toBe(false)
  })

  it('treats completed and skipped work as resolved', () => {
    expect(taskIsResolved({ ...progress('check'), complete: true })).toBe(true)
    expect(taskIsResolved({ ...progress('check'), status: 'skipped' })).toBe(true)
    expect(taskIsResolved({ ...progress('check'), complete: false, status: 'pending' })).toBe(false)
  })

  it('limits additional values to top-level step-counter tasks', () => {
    expect(taskCanLogAdditionalValue(progress('step_counter'))).toBe(true)
    expect(taskCanLogAdditionalValue(progress('daily_total'))).toBe(false)
    expect(taskCanLogAdditionalValue(progress('program', 'quantity'))).toBe(false)
  })

  it('limits log history to tasks and steps that can log amounts', () => {
    expect(taskCanLogAmounts(progress('duration'))).toBe(true)
    expect(taskCanLogAmounts(progress('daily_total'))).toBe(true)
    expect(taskCanLogAmounts(progress('program', 'quantity'))).toBe(true)
    expect(taskCanLogAmounts(progress('check'))).toBe(false)
    expect(taskCanLogAmounts(progress('interval'))).toBe(false)
    expect(taskCanLogAmounts(progress('step_counter'))).toBe(false)
    expect(taskCanLogAmounts(progress('program', 'check'))).toBe(false)
    expect(taskCanLogAmounts(progress('program', 'interval'))).toBe(false)
  })

  it('allows a missed interval to be reopened only for the current day', () => {
    const missedInterval = {
      ...progress('interval'),
      scheduledDate: '2026-08-05',
      status: 'missed',
      complete: false,
    } as TaskProgress

    expect(taskIntervalCanStart(missedInterval, '2026-08-05')).toBe(true)
    expect(taskIntervalCanStart(missedInterval, '2026-08-06')).toBe(false)
    expect(taskIntervalCanStart({
      ...missedInterval,
      status: 'completed',
      complete: true,
    }, '2026-08-05')).toBe(false)
  })

  it('does not review an unlocked daily total whose rounded value meets its target', () => {
    const dailyTotal = {
      ...progress('daily_total'),
      task: {
        ...progress('daily_total').task,
        reviewWhenMissed: true,
        targetValue: 4,
        targetOperator: 'gte',
      },
      scheduledDate: '2026-08-05',
      status: 'pending',
      complete: false,
      sealed: false,
      value: 3.999,
    } as TaskProgress

    expect(taskNeedsReview(dailyTotal, '2026-08-06')).toBe(false)
    expect(taskNeedsReview({ ...dailyTotal, value: 3.994 }, '2026-08-06')).toBe(true)
  })

  it('does not review a duration whose floating-point total rounds to its target', () => {
    const displayedFourHours = [
      2,
      0.278055555555556,
      -1.27805555555556,
      3,
    ].reduce((total, value) => total + value, 0)
    const duration = {
      ...progress('duration'),
      task: {
        ...progress('duration').task,
        reviewWhenMissed: true,
        targetValue: 4,
        targetOperator: 'gte',
      },
      scheduledDate: '2026-08-05',
      status: 'pending',
      complete: false,
      value: displayedFourHours,
    } as TaskProgress

    expect(displayedFourHours).toBeLessThan(4)
    expect(displayedFourHours.toFixed(2)).toBe('4.00')
    expect(taskNeedsReview(duration, '2026-08-06')).toBe(false)
  })

  it('only reviews unfinished work after its scheduled day has passed', () => {
    const currentWork = {
      ...progress('duration'),
      task: {
        ...progress('duration').task,
        reviewWhenMissed: true,
        targetValue: 4,
        targetOperator: 'gte',
      },
      scheduledDate: '2026-08-06',
      status: 'pending',
      complete: false,
      value: 0,
    } as TaskProgress

    expect(taskNeedsReview(currentWork, '2026-08-06')).toBe(false)
    expect(taskNeedsReview(currentWork, '2026-08-07')).toBe(true)
  })
})
