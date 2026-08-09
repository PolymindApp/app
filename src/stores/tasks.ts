import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { addDays, endOfWeek, format, parseISO, startOfWeek, subDays } from 'date-fns'
import { api } from '@/lib/api'
import { readHealthConnectSteps } from '@/services/healthConnect'
import { dailyTotalCompletionPercent, isTaskScheduled, meetsTarget, programCycleDay, progressPercent, stepsForDate, toDateKey } from '@/services/schedule'
import { taskNeedsReview } from '@/services/taskCardActions'
import { sanitizeTaskEntryNote } from '@/services/taskEntryNotes'
import { reconcileTaskReminders } from '@/services/taskReminders'
import { useSnackbarStore } from '@/stores/snackbar'
import { useJournalStore } from '@/stores/journal'
import { useTrackingStore } from '@/stores/tracking'
import type { Entry, Occurrence, ProgramStep, Task, TaskDraft, TaskProgress } from '@/types/domain'

const asNumberArray = (value: unknown, fallback: number[] = []) =>
  Array.isArray(value) ? value.map(Number) : fallback

const asStringArray = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []

function mapTask(record: Record<string, any>): Task {
  return {
    id: record.id,
    name: record.name,
    description: record.description || '',
    type: record.type,
    color: record.color || undefined,
    mandatory: record.mandatory,
    reviewWhenMissed: record.review_when_missed,
    active: record.active,
    startDate: record.start_date,
    endDate: record.end_date || undefined,
    recurrenceType: record.recurrence_type,
    weekdays: asNumberArray(record.weekdays),
    intervalWeeks: Number(record.interval_weeks || 1),
    targetValue: record.target_value || undefined,
    targetOperator: record.target_operator || undefined,
    unit: record.unit || undefined,
    customUnit: record.custom_unit || undefined,
    goalPeriod: record.goal_period || undefined,
    cycleLength: record.cycle_length || undefined,
    programRepeat: record.program_repeat,
    programStrict: record.program_strict,
    entryNotesEnabled: record.entry_notes_enabled === true,
    entryNoteSuggestionsEnabled: record.entry_note_suggestions_enabled === true,
    sortOrder: record.sort_order || 0,
    intervalTemplate: record.interval_template || undefined,
    flashcardReviewSet: record.flashcard_review_set || undefined,
    trackingTrackers: asStringArray(record.tracking_trackers),
    reminderEnabled: record.reminder_enabled === true,
    reminderTimes: asStringArray(record.reminder_times),
  }
}

function mapStep(record: Record<string, any>): ProgramStep {
  return {
    id: record.id,
    task: record.task,
    name: record.name,
    description: record.description || '',
    sortOrder: record.sort_order || 0,
    cycleDays: asNumberArray(record.cycle_days),
    completionType: record.completion_type,
    targetValue: record.target_value || undefined,
    targetOperator: record.target_operator || undefined,
    unit: record.unit || undefined,
    customUnit: record.custom_unit || undefined,
    active: record.active !== false,
    intervalTemplate: record.interval_template || undefined,
    flashcardReviewSet: record.flashcard_review_set || undefined,
  }
}

function mapOccurrence(record: Record<string, any>): Occurrence {
  return {
    id: record.id,
    task: record.task,
    programStep: record.program_step || undefined,
    scheduledDate: record.scheduled_date,
    status: record.status,
    sealed: record.sealed === true,
    completedAt: record.completed_at || undefined,
    snapshotName: record.snapshot_name,
    snapshotTarget: record.snapshot_target || undefined,
    snapshotUnit: record.snapshot_unit || undefined,
  }
}

function mapEntry(record: Record<string, any>): Entry {
  return {
    id: record.id,
    task: record.task,
    occurrence: record.occurrence || undefined,
    programStep: record.program_step || undefined,
    entryDate: record.entry_date,
    createdAt: record.created_at || `${record.entry_date}T00:00:00Z`,
    value: Number(record.value),
    kind: record.kind,
    unit: record.unit || '',
    note: record.note || undefined,
  }
}

export const useTaskStore = defineStore('tasks', () => {
  const journalStore = useJournalStore()
  const trackingStore = useTrackingStore()
  const tasks = ref<Task[]>([])
  const steps = ref<ProgramStep[]>([])
  const occurrences = ref<Occurrence[]>([])
  const entries = ref<Entry[]>([])
  const selectedDate = ref(new Date())
  const loading = ref(false)
  const error = ref('')
  const stepCounts = ref<Record<string, number>>({})
  const stepCountLoading = ref(false)
  const stepCountError = ref('')
  let stepCountRequest = 0
  let progressRangeRequest = 0
  let initialProgressSince = ''
  const loadedProgressRanges = new Set<string>()

  const activeTasks = computed(() => tasks.value.filter((task) => task.active))

  function entriesFor(task: Task, date: Date, step?: ProgramStep) {
    let start = toDateKey(date)
    let end = start
    if (task.goalPeriod === 'week' && !step) {
      start = format(startOfWeek(date, { weekStartsOn: 1 }), 'yyyy-MM-dd')
      end = format(endOfWeek(date, { weekStartsOn: 1 }), 'yyyy-MM-dd')
    }
    return entries.value.filter(
      (entry) =>
        entry.task === task.id &&
        (!step || entry.programStep === step.id) &&
        entry.entryDate >= start &&
        entry.entryDate <= end,
    )
  }

  function occurrenceFor(task: Task, date: Date, step?: ProgramStep) {
    const key = toDateKey(date)
    return occurrences.value.find(
      (item) => item.task === task.id && item.scheduledDate === key && (item.programStep || '') === (step?.id || ''),
    )
  }

  function makeProgress(task: Task, date: Date, step?: ProgramStep): TaskProgress {
    const occurrence = occurrenceFor(task, date, step)
    const dateKey = toDateKey(date)
    const trackingTrackerIds = !step && task.type === 'tracking'
      ? [...new Set(task.trackingTrackers ?? [])]
      : []
    const loggedTrackingTrackerIds = trackingTrackerIds.length
      ? new Set(trackingStore.entries
        .filter(entry => entry.localDate === dateKey && trackingTrackerIds.includes(entry.tracker))
        .map(entry => entry.tracker))
      : new Set<string>()
    const journalEntryCount = !step && task.type === 'journal'
      ? journalStore.entries.filter(entry => entry.task === task.id && entry.localDate === dateKey).length
      : 0
    const value = trackingTrackerIds.length
      ? loggedTrackingTrackerIds.size
      : !step && task.type === 'journal'
        ? journalEntryCount
      : !step && task.type === 'step_counter'
        ? stepCounts.value[dateKey] || 0
        : entriesFor(task, date, step).reduce((sum, entry) => sum + entry.value, 0)
    const target = trackingTrackerIds.length || (!step && task.type === 'journal' ? 1 : step?.targetValue || task.targetValue || 1)
    const operator = step?.targetOperator || task.targetOperator || 'gte'
    const targetReached = task.type === 'tracking' && !step
      ? trackingTrackerIds.length > 0 && value === target
      : task.type === 'journal' && !step
        ? value > 0
      : meetsTarget(value, target, operator)
    const occurrenceComplete = occurrence?.status === 'completed'
    const isOccurrenceDriven = (step && ['check', 'interval', 'flashcards'].includes(step.completionType))
      || (!step && ['check', 'interval', 'flashcards'].includes(task.type))
    const isDailyTotal = !step && task.type === 'daily_total'
    const sealed = isDailyTotal && Boolean(occurrence?.sealed)
    const complete = isOccurrenceDriven
      ? occurrenceComplete
      : isDailyTotal
        ? sealed
        : operator !== 'lte' && targetReached
    const storedStatus = occurrence?.status || 'pending'
    return {
      task,
      scheduledDate: toDateKey(date),
      occurrence,
      value,
      percent: isOccurrenceDriven ? (occurrenceComplete ? 100 : 0) : progressPercent(value, target, operator),
      complete,
      sealed,
      status: complete
        ? 'completed'
        : !isOccurrenceDriven && storedStatus === 'completed'
          ? 'pending'
          : storedStatus,
      programStep: step,
      locked: step ? isStepLocked(task, step, date) : false,
    }
  }

  function isStepLocked(task: Task, step: ProgramStep, date: Date) {
    if (!task.programStrict) return false
    const currentDay = programCycleDay(task, date)
    if (!currentDay) return false
    const cycleStart = addDays(date, -(currentDay - 1))
    const earlierSlots = steps.value
      .filter((candidate) => candidate.active && candidate.task === task.id)
      .flatMap((candidate) => candidate.cycleDays.map((day) => ({ candidate, day })))
      .filter(({ candidate, day }) => day < currentDay || (day === currentDay && candidate.sortOrder < step.sortOrder))
    return earlierSlots.some(({ candidate, day }) => {
      const occurrence = occurrenceFor(task, addDays(cycleStart, day - 1), candidate)
      return !occurrence || occurrence.status === 'pending'
    })
  }

  function progressForDate(date: Date) {
    const result: TaskProgress[] = []
    for (const task of activeTasks.value) {
      if (!isTaskScheduled(task, date)) continue
      if (task.type !== 'program') {
        result.push(makeProgress(task, date))
        continue
      }
      for (const step of stepsForDate(task, steps.value, date)) {
        result.push(makeProgress(task, date, step))
      }
    }
    const key = toDateKey(date)
    for (const occurrence of occurrences.value.filter((item) => item.scheduledDate === key)) {
      if (result.some((item) => item.task.id === occurrence.task && (item.programStep?.id || '') === (occurrence.programStep || ''))) continue
      const task = tasks.value.find((item) => item.id === occurrence.task)
      const step = steps.value.find((item) => item.id === occurrence.programStep)
      if (task) result.push(makeProgress(task, date, step))
    }
    return result.sort((a, b) => Number(b.task.mandatory) - Number(a.task.mandatory) || a.task.sortOrder - b.task.sortOrder)
  }

  const selectedProgress = computed(() => progressForDate(selectedDate.value))

  function completionRateForDate(date: Date) {
    const progress = progressForDate(date)
    if (!progress.length) return undefined
    const earnedProgress = progress.reduce(
      (total, item) => {
        if (!item.programStep && item.task.type === 'daily_total') {
          if (!item.sealed) return total
          return total + dailyTotalCompletionPercent(
            item.value,
            item.task.targetValue || 0,
            item.task.targetOperator || 'gte',
          )
        }
        return total + Math.max(0, Math.min(item.percent, 100))
      },
      0,
    )
    return Math.round(earnedProgress / progress.length)
  }

  function reviewProgressForDate(date: Date) {
    const currentDate = toDateKey(date)
    return progressForDate(subDays(date, 1)).filter(item => taskNeedsReview(item, currentDate))
  }

  const completionRate = computed(() => completionRateForDate(selectedDate.value) || 0)

  async function load() {
    if (!api.authStore.record) return
    loading.value = true
    error.value = ''
    try {
      const since = toDateKey(subDays(new Date(), 120))
      const [taskRecords, stepRecords, occurrenceRecords, entryRecords] = await Promise.all([
        api.collection('tasks').getFullList({ sort: 'sort_order' }),
        api.collection('program_steps').getFullList({ sort: 'sort_order' }),
        api.collection('occurrences').getFullList({ filter: `scheduled_date >= "${since}"`, sort: '-scheduled_date' }),
        api.collection('entries').getFullList({ filter: `entry_date >= "${since}"`, sort: '-created_at' }),
      ])
      tasks.value = taskRecords.map(mapTask)
      steps.value = stepRecords.map(mapStep)
      occurrences.value = occurrenceRecords.map(mapOccurrence)
      entries.value = entryRecords.map(mapEntry)
      initialProgressSince = since
      loadedProgressRanges.clear()
      await reconcileTaskReminders(tasks.value).catch(() => undefined)
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Could not load your plan.'
      throw cause
    } finally {
      loading.value = false
    }
  }

  async function loadProgressRange(start: string, end: string) {
    if (initialProgressSince && start >= initialProgressSince) return true
    const rangeKey = `${start}:${end}`
    if (loadedProgressRanges.has(rangeKey)) return true
    const request = ++progressRangeRequest
    try {
      const [occurrenceRecords, entryRecords] = await Promise.all([
        api.collection('occurrences').getFullList({
          filter: `scheduled_date >= "${start}" && scheduled_date <= "${end}"`,
          sort: '-scheduled_date',
        }),
        api.collection('entries').getFullList({
          filter: `entry_date >= "${start}" && entry_date <= "${end}"`,
          sort: '-created_at',
        }),
      ])
      if (request !== progressRangeRequest) return false
      const mergedOccurrences = new Map(occurrences.value.map((item) => [item.id, item]))
      occurrenceRecords.map(mapOccurrence).forEach((item) => mergedOccurrences.set(item.id, item))
      occurrences.value = [...mergedOccurrences.values()]
      const mergedEntries = new Map(entries.value.map((item) => [item.id, item]))
      entryRecords.map(mapEntry).forEach((item) => mergedEntries.set(item.id, item))
      entries.value = [...mergedEntries.values()]
      loadedProgressRanges.add(rangeKey)
      return true
    } catch (cause) {
      if (request === progressRangeRequest) {
        error.value = cause instanceof Error ? cause.message : 'Could not load task progress for this week.'
      }
      throw cause
    }
  }

  async function refreshStepCount(date = selectedDate.value) {
    const request = ++stepCountRequest
    const hasScheduledStepCounter = activeTasks.value.some(
      task => task.type === 'step_counter' && isTaskScheduled(task, date),
    )
    if (!hasScheduledStepCounter) {
      stepCountLoading.value = false
      stepCountError.value = ''
      return
    }

    stepCountLoading.value = true
    stepCountError.value = ''
    try {
      const steps = await readHealthConnectSteps(date)
      if (request !== stepCountRequest) return
      stepCounts.value = {
        ...stepCounts.value,
        [toDateKey(date)]: steps,
      }
    } catch (cause) {
      if (request !== stepCountRequest) return
      const key = toDateKey(date)
      const nextStepCounts = { ...stepCounts.value }
      delete nextStepCounts[key]
      stepCounts.value = nextStepCounts
      stepCountError.value = cause instanceof Error
        ? cause.message
        : 'Your Health Connect steps could not be loaded.'
    } finally {
      if (request === stepCountRequest) stepCountLoading.value = false
    }
  }

  async function ensureOccurrence(task: Task, date: Date, step?: ProgramStep) {
    const existing = occurrenceFor(task, date, step)
    if (existing) return existing
    const record = await api.collection('occurrences').create({
      owner: api.authStore.record!.id,
      task: task.id,
      program_step: step?.id || '',
      scheduled_date: toDateKey(date),
      status: 'pending',
      sealed: false,
      snapshot_name: step?.name || task.name,
      snapshot_target: step?.targetValue || task.targetValue || 0,
      snapshot_unit: step?.customUnit || step?.unit || task.customUnit || task.unit || '',
    })
    const occurrence = mapOccurrence(record)
    occurrences.value.push(occurrence)
    return occurrences.value[occurrences.value.length - 1]!
  }

  async function toggleComplete(progress: TaskProgress, complete: boolean) {
    const progressDate = parseISO(progress.scheduledDate)
    const occurrence = await ensureOccurrence(progress.task, progressDate, progress.programStep)
    if ((occurrence.status === 'completed') === complete) return
    const record = await api.collection('occurrences').update(occurrence.id, {
      status: complete ? 'completed' : 'pending',
      completed_at: complete ? new Date().toISOString() : '',
    })
    Object.assign(occurrence, mapOccurrence(record))
  }

  async function completeAttributedTask(taskId: string, dateKey: string, programStepId = '') {
    if (!taskId || !dateKey) return undefined
    const progress = progressForDate(parseISO(dateKey)).find(item => (
      item.task.id === taskId
      && (item.programStep?.id || '') === programStepId
    ))
    if (!progress) return undefined
    if (!progress.complete) await toggleComplete(progress, true)
    return occurrenceFor(progress.task, parseISO(dateKey), progress.programStep)
  }

  async function setDailyTotalSealed(progress: TaskProgress) {
    if (progress.task.type !== 'daily_total' || progress.programStep) return
    const progressDate = parseISO(progress.scheduledDate)
    const occurrence = await ensureOccurrence(progress.task, progressDate, progress.programStep)
    const sealed = !occurrence.sealed
    const record = await api.collection('occurrences').update(occurrence.id, {
      sealed,
      status: sealed ? 'completed' : 'pending',
      completed_at: sealed ? new Date().toISOString() : '',
    })
    Object.assign(occurrence, mapOccurrence(record))
  }

  async function addEntry(progress: TaskProgress, amount: number, kind?: Entry['kind'], note = '') {
    if (progress.sealed) return
    const progressDate = parseISO(progress.scheduledDate)
    const occurrence = await ensureOccurrence(progress.task, progressDate, progress.programStep)
    const unit = progress.programStep?.customUnit || progress.programStep?.unit || progress.task.customUnit || progress.task.unit || (progress.task.type === 'duration' ? 'hours' : '')
    const record = await api.collection('entries').create({
      owner: api.authStore.record!.id,
      task: progress.task.id,
      occurrence: occurrence.id,
      program_step: progress.programStep?.id || '',
      entry_date: progress.scheduledDate,
      value: amount,
      kind: kind || (progress.task.type === 'duration' ? 'duration' : 'quantity'),
      unit,
      note: sanitizeTaskEntryNote(note).trim(),
    })
    entries.value.unshift(mapEntry(record))
    const updated = makeProgress(progress.task, progressDate, progress.programStep)
    const isCheck = progress.programStep
      ? progress.programStep.completionType === 'check'
      : progress.task.type === 'check'
    if (!isCheck) {
      const shouldComplete = updated.complete
      const nextStatus = shouldComplete ? 'completed' : 'pending'
      if (occurrence.status !== nextStatus) {
        const updatedOccurrence = await api.collection('occurrences').update(occurrence.id, {
          status: nextStatus,
          completed_at: shouldComplete ? new Date().toISOString() : '',
        })
        Object.assign(occurrence, mapOccurrence(updatedOccurrence))
      }
    }
  }

  async function loadEntryNoteHistory(taskId: string) {
    const records = await api.collection('entries').getFullList({
      filter: `task = "${taskId}"`,
      sort: '-created_at',
    })
    return records.map(mapEntry)
  }

  async function loadEntriesForDay(taskId: string, entryDate: string, programStepId?: string) {
    const stepFilter = programStepId
      ? `program_step = "${programStepId}"`
      : 'program_step = ""'
    const records = await api.collection('entries').getFullList({
      filter: `task = "${taskId}" && entry_date = "${entryDate}" && ${stepFilter}`,
      sort: '-created_at',
    })
    return records.map(mapEntry)
  }

  async function setStatus(progress: TaskProgress, status: Occurrence['status']) {
    const progressDate = parseISO(progress.scheduledDate)
    const occurrence = await ensureOccurrence(progress.task, progressDate, progress.programStep)
    const record = await api.collection('occurrences').update(occurrence.id, {
      status,
      sealed: status === 'completed',
      completed_at: status === 'completed' ? new Date().toISOString() : '',
    })
    Object.assign(occurrence, mapOccurrence(record))
    if (status === 'carried') {
      await ensureOccurrence(progress.task, addDays(progressDate, 1), progress.programStep)
    }
  }

  async function saveTask(draft: TaskDraft) {
    const sortOrder = draft.id
      ? draft.sortOrder
      : tasks.value.reduce((highest, task) => Math.max(highest, task.sortOrder), -1) + 1
    const payload = {
      owner: api.authStore.record!.id,
      name: draft.name,
      description: draft.description,
      type: draft.type,
      color: draft.color || '#C7F464',
      mandatory: draft.mandatory,
      review_when_missed: draft.reviewWhenMissed,
      active: draft.active,
      start_date: draft.startDate,
      end_date: draft.endDate || '',
      recurrence_type: draft.recurrenceType,
      weekdays: draft.weekdays,
      interval_weeks: draft.intervalWeeks,
      target_value: draft.targetValue || 0,
      target_operator: draft.targetOperator || 'gte',
      unit: draft.type === 'step_counter' ? 'steps' : draft.unit || '',
      custom_unit: draft.type === 'step_counter' ? '' : draft.customUnit || '',
      goal_period: draft.goalPeriod || 'occurrence',
      cycle_length: draft.cycleLength || 0,
      program_repeat: draft.programRepeat ?? true,
      program_strict: draft.programStrict ?? false,
      entry_notes_enabled: draft.entryNotesEnabled,
      entry_note_suggestions_enabled: draft.entryNoteSuggestionsEnabled,
      sort_order: sortOrder,
      interval_template: draft.type === 'interval' ? draft.intervalTemplate || '' : '',
      flashcard_review_set: draft.type === 'flashcards' ? draft.flashcardReviewSet || '' : '',
      tracking_trackers: draft.type === 'tracking' ? [...new Set(draft.trackingTrackers ?? [])] : [],
      reminder_enabled: draft.reminderEnabled,
      reminder_times: [...new Set(draft.reminderTimes)],
    }
    const record = draft.id
      ? await api.collection('tasks').update(draft.id, payload)
      : await api.collection('tasks').create(payload)
    const taskId = record.id

    if (draft.type === 'program') {
      const existing = steps.value.filter((step) => step.task === taskId)
      const retainedIds = new Set(draft.steps.map((step) => step.id).filter(Boolean))
      await Promise.all(existing.filter((step) => !retainedIds.has(step.id)).map((step) =>
        api.collection('program_steps').update(step.id, {
          active: false,
          interval_template: '',
          flashcard_review_set: '',
        }),
      ))
      await Promise.all(
        draft.steps.map((step, index) => {
          const stepPayload = {
            owner: api.authStore.record!.id,
            task: taskId,
            name: step.name,
            description: step.description,
            sort_order: index,
            cycle_days: step.cycleDays,
            completion_type: step.completionType,
            target_value: step.targetValue || 0,
            target_operator: step.targetOperator || 'gte',
            unit: step.unit || '',
            custom_unit: step.customUnit || '',
            active: true,
            interval_template: step.completionType === 'interval' ? step.intervalTemplate || '' : '',
            flashcard_review_set: step.completionType === 'flashcards' ? step.flashcardReviewSet || '' : '',
          }
          return step.id
            ? api.collection('program_steps').update(step.id, stepPayload)
            : api.collection('program_steps').create(stepPayload)
        }),
      )
    }
    await load()
    return taskId
  }

  async function toggleTaskActive(task: Task) {
    const record = await api.collection('tasks').update(task.id, { active: !task.active })
    Object.assign(task, mapTask(record))
    await reconcileTaskReminders(tasks.value).catch(() => undefined)
  }

  function upsertOccurrenceRecord(record: Record<string, any>) {
    const occurrence = mapOccurrence(record)
    const index = occurrences.value.findIndex((item) => item.id === occurrence.id)
    if (index >= 0) occurrences.value.splice(index, 1, occurrence)
    else occurrences.value.push(occurrence)
    return occurrence
  }

  function reorderTasksInMemory(orderedIds: string[]) {
    const uniqueIds = [...new Set(orderedIds)]
    const orderedIdSet = new Set(uniqueIds)
    const orderedTasks = uniqueIds
      .map((id) => tasks.value.find((task) => task.id === id))
      .filter((task): task is Task => Boolean(task))

    if (orderedTasks.length < 2) return

    let orderedIndex = 0
    tasks.value = tasks.value.map((task) =>
      orderedIdSet.has(task.id)
        ? orderedTasks[orderedIndex++] ?? task
        : task,
    )
    tasks.value.forEach((task, index) => {
      task.sortOrder = index
    })
  }

  async function reorderTasks(orderedIds: string[]) {
    const previousTasks = tasks.value.map((task) => ({ ...task }))
    const previousSortOrders = new Map(
      previousTasks.map((task) => [task.id, task.sortOrder]),
    )
    reorderTasksInMemory(orderedIds)
    const changedTasks = tasks.value.filter(
      (task) => previousSortOrders.get(task.id) !== task.sortOrder,
    )
    if (!changedTasks.length) return

    error.value = ''
    try {
      await Promise.all(
        changedTasks.map((task) =>
          api.collection('tasks').update(task.id, { sort_order: task.sortOrder }),
        ),
      )
    } catch (cause) {
      tasks.value = previousTasks
      await Promise.allSettled(
        changedTasks.map((task) =>
          api.collection('tasks').update(task.id, {
            sort_order: previousSortOrders.get(task.id),
          }),
        ),
      )
      error.value = cause instanceof Error
        ? cause.message
        : 'Could not save the task order.'
      throw cause
    }
  }

  async function deleteTask(taskId: string) {
    await api.collection('tasks').delete(taskId)
    tasks.value = tasks.value.filter((task) => task.id !== taskId)
    steps.value = steps.value.filter((step) => step.task !== taskId)
    occurrences.value = occurrences.value.filter((occurrence) => occurrence.task !== taskId)
    entries.value = entries.value.filter((entry) => entry.task !== taskId)
    await reconcileTaskReminders(tasks.value).catch(() => undefined)
    useSnackbarStore().showDeletion('Routine')
  }

  async function shiftProgram(progress: TaskProgress) {
    await setStatus(progress, 'rescheduled')
    const shiftedStart = toDateKey(addDays(parseISO(progress.task.startDate), 1))
    await api.collection('tasks').update(progress.task.id, { start_date: shiftedStart })
    progress.task.startDate = shiftedStart
  }

  return {
    tasks,
    steps,
    occurrences,
    entries,
    selectedDate,
    loading,
    error,
    stepCounts,
    stepCountLoading,
    stepCountError,
    activeTasks,
    selectedProgress,
    completionRate,
    progressForDate,
    completionRateForDate,
    reviewProgressForDate,
    load,
    loadProgressRange,
    refreshStepCount,
    makeProgress,
    entriesFor,
    toggleComplete,
    completeAttributedTask,
    setDailyTotalSealed,
    addEntry,
    loadEntryNoteHistory,
    loadEntriesForDay,
    setStatus,
    shiftProgram,
    saveTask,
    toggleTaskActive,
    upsertOccurrenceRecord,
    reorderTasks,
    deleteTask,
  }
})
