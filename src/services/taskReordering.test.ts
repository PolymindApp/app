import { describe, expect, it } from 'vitest'
import { taskIdsFromProgressDrag, taskProgressDragKey } from './taskReordering'
import type { ProgramStep, Task, TaskProgress } from '@/types/domain'

const task = (id: string): Task => ({
  id,
  name: id,
  description: '',
  type: 'check',
  mandatory: true,
  reviewWhenMissed: false,
  active: true,
  startDate: '2026-08-09',
  recurrenceType: 'daily',
  weekdays: [],
  intervalWeeks: 1,
  logWithImagesEnabled: false,
  reminderEnabled: false,
  reminderTimes: [],
  sortOrder: 0,
})

const progress = (taskId: string, stepId = ''): TaskProgress => ({
  task: task(taskId),
  scheduledDate: '2026-08-09',
  value: 0,
  percent: 0,
  complete: false,
  status: 'pending',
  programStep: stepId ? ({ id: stepId } as ProgramStep) : undefined,
})

describe('task drag order', () => {
  it('uses a stable key for tasks and program steps', () => {
    expect(taskProgressDragKey(progress('alpha'))).toBe('alpha:')
    expect(taskProgressDragKey(progress('program', 'step-2'))).toBe('program:step-2')
  })

  it('converts visible card order into task order', () => {
    const items = [progress('alpha'), progress('beta'), progress('gamma')]

    expect(taskIdsFromProgressDrag({
      id: 'gamma:',
      orderedIds: ['gamma:', 'alpha:', 'beta:'],
    }, items)).toEqual(['gamma', 'alpha', 'beta'])
  })

  it('uses the dragged program-step card to place its parent task once', () => {
    const items = [
      progress('program', 'step-1'),
      progress('program', 'step-2'),
      progress('other'),
    ]

    expect(taskIdsFromProgressDrag({
      id: 'program:step-2',
      orderedIds: ['program:step-1', 'other:', 'program:step-2'],
    }, items)).toEqual(['other', 'program'])
  })
})
