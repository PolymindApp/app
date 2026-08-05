import { describe, expect, it } from 'vitest'
import { TASK_CARD_ACTION_ITEMS, taskCanLogAmounts, taskIntervalCanStart } from './taskCardActions'
import type { ProgramStep, Task, TaskProgress, TaskType } from '@/types/domain'

function progress(type: TaskType, completionType?: ProgramStep['completionType']) {
  return {
    task: { type } as Task,
    ...(completionType ? { programStep: { completionType } as ProgramStep } : {}),
  } as TaskProgress
}

describe('task card actions', () => {
  it('only includes log history in the task menu', () => {
    expect(TASK_CARD_ACTION_ITEMS.map(item => item.id)).toEqual(['view-log-history'])
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
})
