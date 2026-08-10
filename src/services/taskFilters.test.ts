import { describe, expect, it } from 'vitest'
import { TASK_FILTER_ITEMS, tasksWithoutProgress } from './taskFilters'
import type { Task, TaskProgress } from '@/types/domain'

const task = (id: string, active = true) => ({ id, active }) as Task
const progress = (value: Task) => ({ task: value }) as TaskProgress

describe('task filters', () => {
  it('offers a clear filter for tasks outside the selected day', () => {
    expect(TASK_FILTER_ITEMS).toContainEqual({
      id: 'not_scheduled',
      title: 'Not scheduled',
      ariaLabel: 'Show tasks not scheduled for the selected day',
    })
  })

  it('includes both active and paused tasks without progress for the selected day', () => {
    const scheduled = task('scheduled')
    const notScheduled = task('not-scheduled')
    const paused = task('paused', false)

    expect(tasksWithoutProgress(
      [scheduled, notScheduled, paused],
      [progress(scheduled)],
    )).toEqual([notScheduled, paused])
  })
})
