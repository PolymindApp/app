import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { Entry, Occurrence, Task } from '@/types/domain'

const apiMocks = vi.hoisted(() => ({
  createEntry: vi.fn(),
  updateOccurrence: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  api: {
    authStore: { record: { id: 'user-1' } },
    collection: (name: string) => {
      if (name === 'entries') return { create: apiMocks.createEntry }
      if (name === 'occurrences') return { update: apiMocks.updateOccurrence }
      throw new Error(`Unexpected collection: ${name}`)
    },
  },
}))

import { useTaskStore } from './tasks'

const selectedDate = new Date(2026, 6, 29)
const task: Task = {
  id: 'duration-task',
  name: 'Focused work',
  description: '',
  type: 'duration',
  mandatory: true,
  reviewWhenMissed: false,
  active: true,
  startDate: '2026-07-01',
  recurrenceType: 'daily',
  weekdays: [],
  intervalWeeks: 1,
  targetValue: 4,
  targetOperator: 'gte',
  goalPeriod: 'occurrence',
  quickAmounts: [0.5, 1],
  sortOrder: 0,
}
const completedOccurrence: Occurrence = {
  id: 'occurrence-1',
  task: task.id,
  scheduledDate: '2026-07-29',
  status: 'completed',
  sealed: false,
  completedAt: '2026-07-29T12:00:00.000Z',
  snapshotName: task.name,
  snapshotTarget: 4,
  snapshotUnit: 'hours',
}

function entry(id: string, value: number): Entry {
  return {
    id,
    task: task.id,
    occurrence: completedOccurrence.id,
    entryDate: '2026-07-29',
    value,
    kind: value < 0 ? 'adjustment' : 'duration',
    unit: 'hours',
  }
}

describe('quantitative task completion', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    apiMocks.createEntry.mockReset()
    apiMocks.updateOccurrence.mockReset()
  })

  it('does not remain complete when adjustments reduce a four-hour task to zero', () => {
    const store = useTaskStore()
    store.selectedDate = selectedDate
    store.tasks = [task]
    store.occurrences = [{ ...completedOccurrence }]
    store.entries = [entry('entry-1', 2), entry('entry-2', 2), entry('entry-3', -4)]

    const progress = store.makeProgress(task, selectedDate)

    expect(progress.value).toBe(0)
    expect(progress.percent).toBe(0)
    expect(progress.complete).toBe(false)
    expect(store.completionRate).toBe(0)
  })

  it('returns a completed occurrence to pending when an entry drops below its target', async () => {
    const store = useTaskStore()
    store.selectedDate = selectedDate
    store.occurrences = [{ ...completedOccurrence }]
    store.entries = [entry('entry-1', 2), entry('entry-2', 2)]
    apiMocks.createEntry.mockResolvedValue({
      id: 'entry-3',
      task: task.id,
      occurrence: completedOccurrence.id,
      program_step: '',
      entry_date: '2026-07-29',
      value: -4,
      kind: 'adjustment',
      unit: 'hours',
      note: '',
    })
    apiMocks.updateOccurrence.mockResolvedValue({
      id: completedOccurrence.id,
      task: task.id,
      program_step: '',
      scheduled_date: '2026-07-29',
      status: 'pending',
      sealed: false,
      completed_at: '',
      snapshot_name: task.name,
      snapshot_target: 4,
      snapshot_unit: 'hours',
    })

    await store.addEntry(store.makeProgress(task, selectedDate), -4, 'adjustment')

    expect(apiMocks.updateOccurrence).toHaveBeenCalledWith(completedOccurrence.id, {
      status: 'pending',
      completed_at: '',
    })
    expect(store.makeProgress(task, selectedDate)).toMatchObject({
      value: 0,
      percent: 0,
      complete: false,
      status: 'pending',
    })
  })
})
