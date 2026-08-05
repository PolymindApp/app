import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { Entry, Occurrence, ProgramStep, Task } from '@/types/domain'

const apiMocks = vi.hoisted(() => ({
  createOccurrence: vi.fn(),
  createEntry: vi.fn(),
  getEntries: vi.fn(),
  updateOccurrence: vi.fn(),
  updateTask: vi.fn(),
}))
const healthMocks = vi.hoisted(() => ({
  readHealthConnectSteps: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  api: {
    authStore: { record: { id: 'user-1' } },
    collection: (name: string) => {
      if (name === 'entries') return {
        create: apiMocks.createEntry,
        getFullList: apiMocks.getEntries,
      }
      if (name === 'occurrences') return {
        create: apiMocks.createOccurrence,
        update: apiMocks.updateOccurrence,
      }
      if (name === 'tasks') return { update: apiMocks.updateTask }
      throw new Error(`Unexpected collection: ${name}`)
    },
  },
}))

vi.mock('@/services/healthConnect', () => ({
  readHealthConnectSteps: healthMocks.readHealthConnectSteps,
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
  entryNotesEnabled: true,
  entryNoteSuggestionsEnabled: true,
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
    createdAt: '2026-07-29T12:00:00.000Z',
    value,
    kind: value < 0 ? 'adjustment' : 'duration',
    unit: 'hours',
  }
}

describe('quantitative task completion', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    apiMocks.createOccurrence.mockReset()
    apiMocks.createEntry.mockReset()
    apiMocks.getEntries.mockReset()
    apiMocks.updateOccurrence.mockReset()
    healthMocks.readHealthConnectSteps.mockReset()
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

  it('includes partial duration progress in the daily completion rate', () => {
    const store = useTaskStore()
    store.selectedDate = selectedDate
    store.tasks = [task]
    store.entries = [entry('entry-1', 2)]

    expect(store.makeProgress(task, selectedDate)).toMatchObject({
      value: 2,
      percent: 50,
      complete: false,
    })
    expect(store.completionRate).toBe(50)
  })

  it('does not invert an explicit completion request from a stale task card', async () => {
    const store = useTaskStore()
    store.selectedDate = selectedDate
    store.occurrences = [{ ...completedOccurrence }]
    const staleProgress = {
      ...store.makeProgress(task, selectedDate),
      complete: false,
      percent: 0,
      status: 'pending' as const,
    }

    await store.toggleComplete(staleProgress, true)

    expect(apiMocks.updateOccurrence).not.toHaveBeenCalled()
    expect(store.occurrences[0]?.status).toBe('completed')
  })

  it('reactively updates review progress when setting a newly created occurrence to missed', async () => {
    const store = useTaskStore()
    const reviewTask = {
      ...task,
      id: 'review-task',
      type: 'check' as const,
      reviewWhenMissed: true,
    }
    const pendingRecord = {
      id: 'review-occurrence',
      task: reviewTask.id,
      program_step: '',
      scheduled_date: '2026-07-29',
      status: 'pending',
      sealed: false,
      completed_at: '',
      snapshot_name: reviewTask.name,
      snapshot_target: 1,
      snapshot_unit: '',
    }
    let resolveUpdate!: (record: typeof pendingRecord) => void
    store.selectedDate = selectedDate
    store.tasks = [reviewTask]
    apiMocks.createOccurrence.mockResolvedValue(pendingRecord)
    apiMocks.updateOccurrence.mockReturnValue(new Promise((resolve) => {
      resolveUpdate = resolve
    }))

    const statusUpdate = store.setStatus(store.selectedProgress[0]!, 'missed')
    await vi.waitFor(() => expect(apiMocks.updateOccurrence).toHaveBeenCalled())
    expect(store.selectedProgress[0]?.status).toBe('pending')

    resolveUpdate({ ...pendingRecord, status: 'missed' })
    await statusUpdate

    expect(store.selectedProgress[0]?.status).toBe('missed')
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
      created_at: '2026-07-29T13:00:00.000Z',
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

  it('persists an optional note with an amount entry', async () => {
    const store = useTaskStore()
    store.selectedDate = selectedDate
    store.occurrences = [{
      ...completedOccurrence,
      status: 'pending',
      completedAt: undefined,
    }]
    apiMocks.createEntry.mockResolvedValue({
      id: 'entry-note',
      task: task.id,
      occurrence: completedOccurrence.id,
      program_step: '',
      entry_date: '2026-07-29',
      value: 1,
      kind: 'duration',
      unit: 'hours',
      note: 'Steady pace',
      created_at: '2026-07-29T13:00:00.000Z',
    })

    await store.addEntry(store.makeProgress(task, selectedDate), 1, undefined, 'Steady pace')

    expect(apiMocks.createEntry).toHaveBeenCalledWith(expect.objectContaining({ note: 'Steady pace' }))
    expect(store.entries[0]?.note).toBe('Steady pace')
  })

  it('stores notes as a single line limited to 255 characters', async () => {
    const store = useTaskStore()
    store.selectedDate = selectedDate
    store.occurrences = [{ ...completedOccurrence, status: 'pending' }]
    apiMocks.createEntry.mockImplementation(async (payload) => ({
      id: 'entry-sanitized-note',
      ...payload,
      created_at: '2026-07-29T13:00:00.000Z',
    }))

    await store.addEntry(
      store.makeProgress(task, selectedDate),
      1,
      undefined,
      `First line\n${'x'.repeat(300)}`,
    )

    expect(apiMocks.createEntry).toHaveBeenCalledWith(expect.objectContaining({
      note: `First line ${'x'.repeat(244)}`,
    }))
  })

  it('loads the complete log history for one task and program step on one day', async () => {
    const store = useTaskStore()
    apiMocks.getEntries.mockResolvedValue([{
      id: 'entry-history',
      task: task.id,
      occurrence: completedOccurrence.id,
      program_step: 'step-1',
      entry_date: '2026-07-29',
      value: 1.5,
      kind: 'duration',
      unit: 'hours',
      note: 'Focused block',
      created_at: '2026-07-29T14:30:00.000Z',
    }])

    const history = await store.loadEntriesForDay(task.id, '2026-07-29', 'step-1')

    expect(apiMocks.getEntries).toHaveBeenCalledWith({
      filter: `task = "${task.id}" && entry_date = "2026-07-29" && program_step = "step-1"`,
      sort: '-created_at',
    })
    expect(history).toEqual([expect.objectContaining({
      id: 'entry-history',
      programStep: 'step-1',
      note: 'Focused block',
    })])
  })

  it('keeps parent task log history separate from program-step entries', async () => {
    const store = useTaskStore()
    apiMocks.getEntries.mockResolvedValue([])

    await store.loadEntriesForDay(task.id, '2026-07-29')

    expect(apiMocks.getEntries).toHaveBeenCalledWith({
      filter: `task = "${task.id}" && entry_date = "2026-07-29" && program_step = ""`,
      sort: '-created_at',
    })
  })
})

describe('step-counter task progress', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    healthMocks.readHealthConnectSteps.mockReset()
  })

  it('uses the Health Connect daily aggregate as its value', async () => {
    const store = useTaskStore()
    const stepTask: Task = {
      ...task,
      id: 'step-task',
      name: 'Daily steps',
      type: 'step_counter',
      targetValue: 8000,
      targetOperator: 'gte',
      unit: 'steps',
    }
    store.tasks = [stepTask]
    store.selectedDate = selectedDate
    healthMocks.readHealthConnectSteps.mockResolvedValue(9234)

    await store.refreshStepCount(selectedDate)

    expect(healthMocks.readHealthConnectSteps).toHaveBeenCalledWith(selectedDate)
    expect(store.makeProgress(stepTask, selectedDate)).toMatchObject({
      value: 9234,
      percent: 100,
      complete: true,
    })
  })
})

describe('interval task completion', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('uses the daily occurrence as all-or-nothing progress', () => {
    const store = useTaskStore()
    const intervalTask: Task = {
      ...task,
      id: 'interval-task',
      name: 'Morning intervals',
      type: 'interval',
      intervalTemplate: 'template-1',
      targetValue: 1,
    }

    expect(store.makeProgress(intervalTask, selectedDate)).toMatchObject({
      percent: 0,
      complete: false,
      status: 'pending',
    })

    store.occurrences = [{
      ...completedOccurrence,
      id: 'interval-occurrence',
      task: intervalTask.id,
      snapshotName: intervalTask.name,
      snapshotTarget: 1,
      snapshotUnit: '',
    }]

    expect(store.makeProgress(intervalTask, selectedDate)).toMatchObject({
      percent: 100,
      complete: true,
      status: 'completed',
    })
  })

  it('uses the same occurrence completion model for flashcard reviews', () => {
    const store = useTaskStore()
    const flashcardTask: Task = {
      ...task,
      id: 'flashcard-task',
      name: 'Review algebra',
      type: 'flashcards',
      flashcardReviewSet: 'set-1',
      targetValue: 1,
    }

    expect(store.makeProgress(flashcardTask, selectedDate)).toMatchObject({
      percent: 0,
      complete: false,
    })

    store.occurrences = [{
      ...completedOccurrence,
      id: 'flashcard-occurrence',
      task: flashcardTask.id,
      snapshotName: flashcardTask.name,
    }]

    expect(store.makeProgress(flashcardTask, selectedDate)).toMatchObject({
      percent: 100,
      complete: true,
    })
  })

  it('uses the program-step occurrence for an attached interval', () => {
    const store = useTaskStore()
    const programTask: Task = {
      ...task,
      id: 'program-task',
      name: 'Training program',
      type: 'program',
      cycleLength: 7,
      programRepeat: true,
    }
    const intervalStep: ProgramStep = {
      id: 'interval-step',
      task: programTask.id,
      name: 'Conditioning',
      description: '',
      sortOrder: 0,
      cycleDays: [3],
      completionType: 'interval',
      active: true,
      intervalTemplate: 'template-1',
    }

    expect(store.makeProgress(programTask, selectedDate, intervalStep)).toMatchObject({
      percent: 0,
      complete: false,
      status: 'pending',
    })

    store.occurrences = [{
      ...completedOccurrence,
      id: 'program-interval-occurrence',
      task: programTask.id,
      programStep: intervalStep.id,
      snapshotName: intervalStep.name,
      snapshotTarget: 1,
      snapshotUnit: '',
    }]

    expect(store.makeProgress(programTask, selectedDate, intervalStep)).toMatchObject({
      percent: 100,
      complete: true,
      status: 'completed',
    })
  })
})

describe('task ordering', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    apiMocks.updateTask.mockReset()
    apiMocks.updateTask.mockResolvedValue({})
  })

  it('reorders the requested task subset and persists every changed position', async () => {
    const store = useTaskStore()
    const secondActive = { ...task, id: 'second-active', name: 'Second', sortOrder: 2 }
    const thirdActive = { ...task, id: 'third-active', name: 'Third', sortOrder: 3 }
    const paused = { ...task, id: 'paused', name: 'Paused', active: false, sortOrder: 1 }
    store.tasks = [{ ...task }, paused, secondActive, thirdActive]

    await store.reorderTasks(['third-active', task.id, 'second-active'])

    expect(store.tasks.map((item) => item.id)).toEqual([
      'third-active',
      'paused',
      task.id,
      'second-active',
    ])
    expect(store.tasks.map((item) => item.sortOrder)).toEqual([0, 1, 2, 3])
    expect(apiMocks.updateTask.mock.calls).toEqual([
      ['third-active', { sort_order: 0 }],
      [task.id, { sort_order: 2 }],
      ['second-active', { sort_order: 3 }],
    ])
  })

  it('restores the previous order when persistence fails', async () => {
    const store = useTaskStore()
    const second = { ...task, id: 'second', name: 'Second', sortOrder: 1 }
    store.tasks = [{ ...task }, second]
    apiMocks.updateTask.mockRejectedValueOnce(new Error('The API is offline.'))

    await expect(store.reorderTasks(['second', task.id]))
      .rejects.toThrow('The API is offline.')

    expect(store.tasks.map((item) => item.id)).toEqual([task.id, 'second'])
    expect(store.tasks.map((item) => item.sortOrder)).toEqual([0, 1])
    expect(store.error).toBe('The API is offline.')
  })
})
