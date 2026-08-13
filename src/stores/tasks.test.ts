import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { Entry, JournalEntry, Occurrence, ProgramStep, Task, TrackingEntry } from '@/types/domain'

const apiMocks = vi.hoisted(() => ({
  createOccurrence: vi.fn(),
  createEntry: vi.fn(),
  updateEntry: vi.fn(),
  deleteEntry: vi.fn(),
  getEntries: vi.fn(),
  updateOccurrence: vi.fn(),
  updateTask: vi.fn(),
}))
const healthMocks = vi.hoisted(() => ({
  readHealthConnectSteps: vi.fn(),
}))
const reminderMocks = vi.hoisted(() => ({
  reconcileTaskReminders: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  api: {
    authStore: { record: { id: 'user-1' } },
    collection: (name: string) => {
      if (name === 'entries') return {
        create: apiMocks.createEntry,
        update: apiMocks.updateEntry,
        delete: apiMocks.deleteEntry,
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

vi.mock('@/services/taskReminders', () => ({
  reconcileTaskReminders: reminderMocks.reconcileTaskReminders,
}))

import { useTaskStore } from './tasks'
import { useJournalStore } from './journal'
import { useTrackingStore } from './tracking'

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
  reminderEnabled: false,
  reminderTimes: [],
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
    apiMocks.updateEntry.mockReset()
    apiMocks.deleteEntry.mockReset()
    apiMocks.getEntries.mockReset()
    apiMocks.updateOccurrence.mockReset()
    healthMocks.readHealthConnectSteps.mockReset()
    reminderMocks.reconcileTaskReminders.mockReset()
    reminderMocks.reconcileTaskReminders.mockResolvedValue(undefined)
  })

  it('reports completed occurrences as ineligible for their programmed reminder', async () => {
    const store = useTaskStore()
    store.tasks = [{ ...task, reminderEnabled: true, reminderTimes: ['20:00'] }]
    store.entries = [entry('completed-entry', 4)]

    await store.syncTaskReminders()

    const options = reminderMocks.reconcileTaskReminders.mock.calls[0]?.[1]
    expect(options.isTaskIncomplete(store.tasks[0], selectedDate)).toBe(false)

    store.entries = [entry('partial-entry', 2)]
    expect(options.isTaskIncomplete(store.tasks[0], selectedDate)).toBe(true)
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

  it('treats a rounded duration target as complete despite an older missed status', () => {
    const store = useTaskStore()
    store.selectedDate = selectedDate
    store.tasks = [{ ...task, reviewWhenMissed: true }]
    store.occurrences = [{
      ...completedOccurrence,
      status: 'missed',
      completedAt: undefined,
    }]
    store.entries = [
      entry('duration-entry-1', 2),
      entry('duration-entry-2', 0.278055555555556),
      entry('duration-entry-3', -1.27805555555556),
      entry('duration-entry-4', 3),
    ]

    const progress = store.makeProgress(store.tasks[0]!, selectedDate)

    expect(progress.value).toBeLessThan(4)
    expect(progress.value.toFixed(2)).toBe('4.00')
    expect(progress).toMatchObject({
      percent: 100,
      complete: true,
      status: 'completed',
    })
    expect(store.completionRate).toBe(100)
  })

  it('reviews unfinished work from the previous day instead of the current day', () => {
    const store = useTaskStore()
    const cardio: Task = {
      ...task,
      id: 'cardio-task',
      name: 'Cardio',
      type: 'interval',
      reviewWhenMissed: true,
      intervalTemplate: 'cardio-interval',
    }
    const currentDate = new Date(2026, 7, 6)
    store.tasks = [cardio]

    expect(store.reviewProgressForDate(currentDate)).toEqual([
      expect.objectContaining({
        task: cardio,
        scheduledDate: '2026-08-05',
        status: 'pending',
        complete: false,
      }),
    ])
    expect(store.reviewProgressForDate(currentDate)[0]?.scheduledDate).not.toBe('2026-08-06')
  })

  it('does not reopen previous-day work that was already resolved as missed', () => {
    const store = useTaskStore()
    const cardio: Task = {
      ...task,
      id: 'cardio-task',
      name: 'Cardio',
      type: 'interval',
      reviewWhenMissed: true,
      intervalTemplate: 'cardio-interval',
    }
    store.tasks = [cardio]
    store.occurrences = [{
      ...completedOccurrence,
      id: 'cardio-occurrence',
      task: cardio.id,
      scheduledDate: '2026-08-05',
      status: 'missed',
      completedAt: undefined,
      snapshotName: cardio.name,
    }]

    expect(store.reviewProgressForDate(new Date(2026, 7, 6))).toEqual([])
  })

  it('reserves an unlocked daily total in the daily percentage denominator at zero progress', () => {
    const store = useTaskStore()
    const dailyTotal: Task = {
      ...task,
      id: 'daily-total-task',
      name: 'Daily total',
      type: 'daily_total',
      targetValue: 4,
      targetOperator: 'lte',
    }
    store.selectedDate = selectedDate
    store.tasks = [task, dailyTotal]
    store.entries = [
      entry('duration-entry', 2),
      { ...entry('daily-total-entry', 5), task: dailyTotal.id },
    ]

    expect(store.completionRate).toBe(25)
  })

  it('awards a locked daily total its full equal share among eight scheduled tasks', () => {
    const store = useTaskStore()
    const calories: Task = {
      ...task,
      id: 'calories-task',
      name: 'Calories',
      type: 'daily_total',
      targetValue: 2200,
      targetOperator: 'lte',
      unit: 'calories',
      sortOrder: 7,
    }
    const completedTasks = Array.from({ length: 7 }, (_, index): Task => ({
      ...task,
      id: `check-task-${index}`,
      name: `Check task ${index + 1}`,
      type: 'check',
      sortOrder: index,
    }))
    store.selectedDate = selectedDate
    store.tasks = [...completedTasks, calories]
    store.occurrences = completedTasks.map((completedTask, index) => ({
      ...completedOccurrence,
      id: `check-occurrence-${index}`,
      task: completedTask.id,
      snapshotName: completedTask.name,
    }))
    store.entries = [{
      ...entry('calories-entry', 2100),
      task: calories.id,
      occurrence: 'calories-occurrence',
      kind: 'quantity',
      unit: 'calories',
    }]

    expect(store.completionRate).toBe(88)

    store.occurrences.push({
      ...completedOccurrence,
      id: 'calories-occurrence',
      task: calories.id,
      sealed: true,
      snapshotName: calories.name,
      snapshotTarget: 2200,
      snapshotUnit: 'calories',
    })

    expect(store.completionRate).toBe(100)
  })

  it('reopens a missed daily total without scoring it before it is locked', async () => {
    const store = useTaskStore()
    const dailyTotal: Task = {
      ...task,
      id: 'daily-total-task',
      name: 'Daily total',
      type: 'daily_total',
      targetValue: 4,
      unit: 'hours',
    }
    const missedOccurrence: Occurrence = {
      ...completedOccurrence,
      id: 'daily-total-occurrence',
      task: dailyTotal.id,
      status: 'missed',
      completedAt: undefined,
      snapshotName: dailyTotal.name,
      snapshotTarget: 4,
      snapshotUnit: 'hours',
    }
    const existingValues = [3, -1.28, 2]
    const timerValue = 1007 / 3600
    store.tasks = [dailyTotal]
    store.occurrences = [missedOccurrence]
    store.entries = existingValues.map((value, index) => ({
      ...entry(`daily-total-entry-${index}`, value),
      task: dailyTotal.id,
      occurrence: missedOccurrence.id,
    }))
    apiMocks.createEntry.mockResolvedValue({
      id: 'timer-entry',
      task: dailyTotal.id,
      occurrence: missedOccurrence.id,
      program_step: '',
      entry_date: '2026-07-29',
      value: timerValue,
      kind: 'duration',
      unit: 'hours',
      note: 'Logged with timer',
      created_at: '2026-07-29T13:00:00.000Z',
    })
    apiMocks.updateOccurrence.mockResolvedValue({
      id: missedOccurrence.id,
      task: dailyTotal.id,
      program_step: '',
      scheduled_date: '2026-07-29',
      status: 'pending',
      sealed: false,
      completed_at: '',
      snapshot_name: dailyTotal.name,
      snapshot_target: 4,
      snapshot_unit: 'hours',
    })

    await store.addEntry(
      store.makeProgress(dailyTotal, selectedDate),
      timerValue,
      'duration',
      'Logged with timer',
    )

    expect(apiMocks.updateOccurrence).toHaveBeenCalledWith(missedOccurrence.id, {
      status: 'pending',
      completed_at: '',
    })
    expect(store.makeProgress(dailyTotal, selectedDate)).toMatchObject({
      percent: 100,
      complete: false,
      status: 'pending',
      sealed: false,
    })
    expect(store.completionRateForDate(selectedDate)).toBe(0)
  })

  it('scores a locked at-most daily total by subtracting its proportional excess', () => {
    const store = useTaskStore()
    const dailyTotal: Task = {
      ...task,
      id: 'daily-total-task',
      name: 'Daily total',
      type: 'daily_total',
      targetValue: 4,
      targetOperator: 'lte',
      unit: 'hours',
    }
    store.tasks = [dailyTotal]
    store.occurrences = [{
      ...completedOccurrence,
      id: 'daily-total-occurrence',
      task: dailyTotal.id,
      sealed: true,
      snapshotName: dailyTotal.name,
      snapshotTarget: 4,
      snapshotUnit: 'hours',
    }]
    store.entries = [{
      ...entry('daily-total-entry', 5),
      task: dailyTotal.id,
      occurrence: 'daily-total-occurrence',
    }]

    expect(store.makeProgress(dailyTotal, selectedDate)).toMatchObject({
      complete: true,
      sealed: true,
    })
    expect(store.completionRateForDate(selectedDate)).toBe(75)
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

  it('rejects task log entries with a value of zero', async () => {
    const store = useTaskStore()
    const progress = store.makeProgress(task, selectedDate)

    await expect(store.addEntry(progress, 0)).rejects.toThrow(
      'Task log entries cannot have a value of zero.',
    )

    expect(apiMocks.createOccurrence).not.toHaveBeenCalled()
    expect(apiMocks.createEntry).not.toHaveBeenCalled()
  })

  it('rejects changing a task log entry value to zero', async () => {
    const store = useTaskStore()
    const progress = store.makeProgress(task, selectedDate)

    await expect(store.updateEntry(progress, 'entry-1', 0)).rejects.toThrow(
      'Task log entries cannot have a value of zero.',
    )

    expect(apiMocks.updateEntry).not.toHaveBeenCalled()
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

  it('updates a log entry and reopens progress when its value falls below the target', async () => {
    const store = useTaskStore()
    store.selectedDate = selectedDate
    store.occurrences = [{ ...completedOccurrence }]
    store.entries = [entry('entry-to-edit', 4)]
    apiMocks.updateEntry.mockResolvedValue({
      id: 'entry-to-edit',
      task: task.id,
      occurrence: completedOccurrence.id,
      program_step: '',
      entry_date: '2026-07-29',
      created_at: '2026-07-29T12:00:00.000Z',
      value: 1,
      kind: 'duration',
      unit: 'hours',
      note: 'Shortened',
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

    const updated = await store.updateEntry(
      store.makeProgress(task, selectedDate),
      'entry-to-edit',
      1,
      'Shortened',
    )

    expect(apiMocks.updateEntry).toHaveBeenCalledWith('entry-to-edit', {
      value: 1,
      note: 'Shortened',
    })
    expect(updated).toMatchObject({ value: 1, note: 'Shortened' })
    expect(apiMocks.updateOccurrence).toHaveBeenCalledWith(completedOccurrence.id, {
      status: 'pending',
      completed_at: '',
    })
    expect(store.makeProgress(task, selectedDate)).toMatchObject({
      value: 1,
      complete: false,
    })
  })

  it('deletes a log entry and removes its contribution from progress', async () => {
    const store = useTaskStore()
    store.selectedDate = selectedDate
    store.occurrences = [{ ...completedOccurrence }]
    store.entries = [entry('entry-to-delete', 4)]
    apiMocks.deleteEntry.mockResolvedValue(true)
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

    const deleted = await store.deleteEntry(
      store.makeProgress(task, selectedDate),
      'entry-to-delete',
    )

    expect(deleted).toBe(true)
    expect(apiMocks.deleteEntry).toHaveBeenCalledWith('entry-to-delete')
    expect(store.entries).toEqual([])
    expect(store.makeProgress(task, selectedDate)).toMatchObject({
      value: 0,
      complete: false,
    })
  })
})

describe('tracking task completion', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('counts each selected tracker once and completes after all are logged for the date', () => {
    const store = useTaskStore()
    const trackingStore = useTrackingStore()
    const trackingTask: Task = {
      ...task,
      id: 'tracking-task',
      name: 'Daily check-in',
      type: 'tracking',
      trackingTrackers: ['mood', 'energy'],
    }
    const trackingEntry = (id: string, tracker: string, localDate = '2026-07-29'): TrackingEntry => ({
      id,
      tracker,
      occurredAt: `${localDate}T12:00:00.000Z`,
      localDate,
      timezoneOffset: 240,
      value: 1,
      note: '',
    })
    store.tasks = [trackingTask]
    trackingStore.entries = [
      trackingEntry('mood-1', 'mood'),
      trackingEntry('mood-2', 'mood'),
      trackingEntry('energy-other-day', 'energy', '2026-07-28'),
    ]

    expect(store.makeProgress(trackingTask, selectedDate)).toMatchObject({
      value: 1,
      percent: 50,
      complete: false,
      status: 'pending',
    })

    trackingStore.entries.push(trackingEntry('energy-1', 'energy'))

    expect(store.makeProgress(trackingTask, selectedDate)).toMatchObject({
      value: 2,
      percent: 100,
      complete: true,
      status: 'completed',
    })
    expect(store.completionRateForDate(selectedDate)).toBe(100)
  })
})

describe('journaling task completion', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('completes when a reflection is linked to the task for the scheduled date', () => {
    const store = useTaskStore()
    const journalStore = useJournalStore()
    const journalTask: Task = {
      ...task,
      id: 'journal-task',
      name: 'Evening reflection',
      type: 'journal',
      targetValue: 1,
    }
    const journalEntry = (id: string, taskId: string, localDate: string): JournalEntry => ({
      id,
      title: '',
      body: 'What went well today?',
      color: '#C7F464',
      image: '',
      occurredAt: `${localDate}T20:00:00.000Z`,
      localDate,
      timezoneOffset: 240,
      task: taskId,
      trackers: [],
      taskSnapshot: journalTask.name,
      trackerSnapshots: {},
      createdAt: `${localDate}T20:00:00.000Z`,
      updatedAt: `${localDate}T20:00:00.000Z`,
    })

    store.tasks = [journalTask]
    journalStore.entries = [
      journalEntry('other-task', 'another-task', '2026-07-29'),
      journalEntry('other-day', journalTask.id, '2026-07-28'),
    ]

    expect(store.makeProgress(journalTask, selectedDate)).toMatchObject({
      value: 0,
      percent: 0,
      complete: false,
      status: 'pending',
    })

    journalStore.entries.push(journalEntry('matching', journalTask.id, '2026-07-29'))

    expect(store.makeProgress(journalTask, selectedDate)).toMatchObject({
      value: 1,
      percent: 100,
      complete: true,
      status: 'completed',
    })
    expect(store.completionRateForDate(selectedDate)).toBe(100)
  })
})

describe('step-counter task progress', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    healthMocks.readHealthConnectSteps.mockReset()
    apiMocks.createOccurrence.mockReset()
    apiMocks.createEntry.mockReset()
    apiMocks.updateEntry.mockReset()
    apiMocks.updateOccurrence.mockReset()
    apiMocks.createOccurrence.mockImplementation(async payload => ({
      id: 'step-occurrence',
      ...payload,
    }))
    apiMocks.createEntry.mockImplementation(async payload => ({
      id: 'health-connect-entry',
      created_at: '2026-07-29T12:00:00.000Z',
      ...payload,
    }))
    apiMocks.updateOccurrence.mockImplementation(async (id, payload) => ({
      id,
      task: 'step-task',
      program_step: '',
      scheduled_date: '2026-07-29',
      sealed: false,
      snapshot_name: 'Daily steps',
      snapshot_target: 8000,
      snapshot_unit: 'steps',
      ...payload,
    }))
  })

  it('persists the Health Connect daily aggregate and uses it as its value', async () => {
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
    expect(apiMocks.createEntry).toHaveBeenCalledWith(expect.objectContaining({
      task: stepTask.id,
      entry_date: '2026-07-29',
      value: 9234,
      kind: 'quantity',
      unit: 'steps',
      source_type: '',
      source_session: 'health-connect:2026-07-29',
    }))
    expect(store.makeProgress(stepTask, selectedDate)).toMatchObject({
      value: 9234,
      percent: 100,
      complete: true,
    })
  })

  it('replaces a synced total and keeps additional steps on top', async () => {
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
    store.occurrences = [{ ...completedOccurrence, id: 'step-occurrence', task: stepTask.id }]
    store.entries = [
      { ...entry('health-connect-entry', 9000), task: stepTask.id, kind: 'quantity', unit: 'steps', sourceType: 'health_connect', sourceSession: '2026-07-29' },
      { ...entry('additional-entry', 250), task: stepTask.id, kind: 'quantity', unit: 'steps' },
    ]
    healthMocks.readHealthConnectSteps.mockResolvedValue(9234)
    apiMocks.updateEntry.mockImplementation(async (id, payload) => ({
      id,
      task: stepTask.id,
      program_step: '',
      created_at: '2026-07-29T12:00:00.000Z',
      ...payload,
    }))

    await store.refreshStepCount(selectedDate)

    expect(apiMocks.updateEntry).toHaveBeenCalledWith('health-connect-entry', expect.objectContaining({
      value: 9234,
      source_type: '',
      source_session: 'health-connect:2026-07-29',
    }))
    expect(apiMocks.createEntry).not.toHaveBeenCalled()
    expect(store.makeProgress(stepTask, selectedDate).value).toBe(9484)
  })

  it('keeps the last persisted total when Health Connect cannot refresh', async () => {
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
    store.entries = [{
      ...entry('health-connect-entry', 9000),
      task: stepTask.id,
      kind: 'quantity',
      unit: 'steps',
      sourceType: 'health_connect',
      sourceSession: '2026-07-29',
    }]
    healthMocks.readHealthConnectSteps.mockRejectedValue(new Error('Health Connect unavailable'))

    await store.refreshStepCount(selectedDate)

    expect(store.makeProgress(stepTask, selectedDate).value).toBe(9000)
    expect(store.stepCountError).toBe('Health Connect unavailable')
  })

  it('exposes loading through a Vue update before a fast Health Connect read completes', async () => {
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
    healthMocks.readHealthConnectSteps.mockResolvedValue(9234)

    const refresh = store.refreshStepCount(selectedDate)

    expect(store.stepCountLoading).toBe(true)
    expect(healthMocks.readHealthConnectSteps).not.toHaveBeenCalled()

    await refresh

    expect(healthMocks.readHealthConnectSteps).toHaveBeenCalledWith(selectedDate)
    expect(store.stepCountLoading).toBe(false)
  })
})

describe('interval task completion', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    apiMocks.createOccurrence.mockReset()
    apiMocks.updateOccurrence.mockReset()
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

  it('keeps today open when a previous-day interval is marked missed', async () => {
    const store = useTaskStore()
    const intervalTask: Task = {
      ...task,
      id: 'daily-interval-task',
      name: 'Daily intervals',
      type: 'interval',
      intervalTemplate: 'template-1',
      targetValue: 1,
    }
    const previousDate = new Date(2026, 6, 28)
    const previousProgress = store.makeProgress(intervalTask, previousDate)
    store.selectedDate = selectedDate
    apiMocks.createOccurrence.mockResolvedValue({
      id: 'previous-interval-occurrence',
      task: intervalTask.id,
      program_step: '',
      scheduled_date: '2026-07-28',
      status: 'pending',
      sealed: false,
      completed_at: '',
      snapshot_name: intervalTask.name,
      snapshot_target: 1,
      snapshot_unit: '',
    })
    apiMocks.updateOccurrence.mockResolvedValue({
      id: 'previous-interval-occurrence',
      task: intervalTask.id,
      program_step: '',
      scheduled_date: '2026-07-28',
      status: 'missed',
      sealed: false,
      completed_at: '',
      snapshot_name: intervalTask.name,
      snapshot_target: 1,
      snapshot_unit: '',
    })

    await store.setStatus(previousProgress, 'missed')

    expect(apiMocks.createOccurrence).toHaveBeenCalledWith(expect.objectContaining({
      scheduled_date: '2026-07-28',
    }))
    expect(store.makeProgress(intervalTask, previousDate).status).toBe('missed')
    expect(store.makeProgress(intervalTask, selectedDate)).toMatchObject({
      scheduledDate: '2026-07-29',
      status: 'pending',
      complete: false,
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

  it('accumulates elapsed seconds for a linked-session duration objective', () => {
    const store = useTaskStore()
    const intervalTask: Task = {
      ...task,
      id: 'timed-interval-task',
      name: 'Conditioning time',
      type: 'interval',
      intervalTemplate: 'template-1',
      sessionCountMode: 'linked',
      sessionGoalType: 'duration',
      sessionTargetSeconds: 20 * 60,
    }
    store.entries = [
      {
        ...entry('interval-session-entry', 12 * 60),
        task: intervalTask.id,
        kind: 'duration',
        unit: 'seconds',
        sourceType: 'interval',
        sourceSession: 'session-1',
      },
    ]

    expect(store.makeProgress(intervalTask, selectedDate)).toMatchObject({
      value: 12 * 60,
      percent: 60,
      complete: false,
      status: 'pending',
    })

    store.entries.push({
      ...entry('interval-session-entry-2', 8 * 60),
      task: intervalTask.id,
      kind: 'duration',
      unit: 'seconds',
      sourceType: 'interval',
      sourceSession: 'session-2',
    })

    expect(store.makeProgress(intervalTask, selectedDate)).toMatchObject({
      value: 20 * 60,
      percent: 100,
      complete: true,
      status: 'completed',
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
