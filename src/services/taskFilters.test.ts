import { beforeEach, describe, expect, it } from 'vitest'
import {
  TASK_FILTER_ITEMS,
  readTaskFilterSelection,
  tasksWithoutProgress,
  writeTaskFilterSelection,
} from './taskFilters'
import type { Task, TaskProgress } from '@/types/domain'

const task = (id: string, active = true) => ({ id, active }) as Task
const progress = (value: Task) => ({ task: value }) as TaskProgress

describe('task filters', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

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

  it('keeps the selected filters for the browser session', () => {
    writeTaskFilterSelection(['completed', 'not_scheduled'])

    expect(readTaskFilterSelection()).toEqual(['completed', 'not_scheduled'])
  })

  it('ignores unknown filters left in session storage', () => {
    sessionStorage.setItem(
      'mom-task-filter-selection',
      JSON.stringify(['completed', 'retired']),
    )

    expect(readTaskFilterSelection()).toEqual(['completed'])
  })
})
