import { computed, nextTick, ref } from 'vue'
import { defineStore } from 'pinia'
import { addDays, parseISO, startOfWeek, subDays } from 'date-fns'
import { api } from '@/lib/api'
import { createLocalRecordId, hasLocalBootstrap, listLocalRecords, repairLegacyHealthConnectEntrySync } from '@/lib/localDatabase'
import { readHealthConnectSteps } from '@/services/healthConnect'
import { healthConnectEntrySession, isHealthConnectEntry } from '@/services/healthConnectEntries'
import { completedIntervalFlashcardReviewSeconds } from '@/services/intervals'
import { dailyTotalCompletionPercent, isTaskScheduled, meetsTarget, programCycleDay, progressPercent, stepsForDate, toDateKey } from '@/services/schedule'
import { taskNeedsReview } from '@/services/taskCardActions'
import { sanitizeTaskEntryNote } from '@/services/taskEntryNotes'
import { reconcileTaskReminders } from '@/services/taskReminders'
import { useSnackbarStore } from '@/stores/snackbar'
import { useJournalStore } from '@/stores/journal'
import { useTrackingStore } from '@/stores/tracking'
import type {
  Entry,
  IntervalDefinition,
  IntervalRuntimeState,
  Occurrence,
  ProgramStep,
  Task,
  TaskDraft,
  TaskProgress,
} from '@/types/domain'

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
    scheduleMode: record.schedule_mode === 'time_based' ? 'time_based' : 'all_day',
    scheduledTime: record.schedule_mode === 'time_based' ? record.scheduled_time || undefined : undefined,
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
    sessionCountMode: record.session_count_mode === 'linked' ? 'linked' : 'task',
    sessionGoalType: record.session_goal_type === 'duration' ? 'duration' : 'complete',
    sessionTargetSeconds: Number(record.session_target_seconds || 0),
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
    sourceType: record.source_type || undefined,
    sourceSession: record.source_session || undefined,
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
  const stepCountLoading = ref(false)
  const stepCountError = ref('')
  const optimisticOccurrencePatches = ref<Partial<Record<string, {
    revision: number
    status?: Occurrence['status']
    sealed?: boolean
  }>>>({})
  let stepCountRequest = 0
  let progressRangeRequest = 0
  let initialProgressSince = ''
  let reconciledSessionProgressKey = ''
  let reminderSyncPromise: Promise<void> | undefined
  let reminderSyncRequested = false
  let optimisticOccurrenceRevision = 0
  const loadedProgressRanges = new Set<string>()
  const pendingOccurrenceCreates = new Map<string, Promise<Occurrence>>()

  const activeTasks = computed(() => tasks.value.filter((task) => task.active))

  function occurrenceStatusKey(taskId: string, scheduledDate: string, programStepId = '') {
    return `${scheduledDate}:${taskId}:${programStepId}`
  }

  const taskById = computed(() => new Map(tasks.value.map(task => [task.id, task])))
  const stepById = computed(() => new Map(steps.value.map(step => [step.id, step])))
  const occurrenceIndex = computed(() => {
    const byStatusKey = new Map<string, Occurrence>()
    const byDate = new Map<string, Occurrence[]>()
    for (const occurrence of occurrences.value) {
      const statusKey = occurrenceStatusKey(
        occurrence.task,
        occurrence.scheduledDate,
        occurrence.programStep,
      )
      if (!byStatusKey.has(statusKey)) byStatusKey.set(statusKey, occurrence)
      const dateOccurrences = byDate.get(occurrence.scheduledDate)
      if (dateOccurrences) dateOccurrences.push(occurrence)
      else byDate.set(occurrence.scheduledDate, [occurrence])
    }
    return { byStatusKey, byDate }
  })
  const taskEntryIndex = computed(() => {
    const byStatusKey = new Map<string, Entry[]>()
    for (const entry of entries.value) {
      const statusKey = occurrenceStatusKey(entry.task, entry.entryDate, entry.programStep)
      const matchingEntries = byStatusKey.get(statusKey)
      if (matchingEntries) matchingEntries.push(entry)
      else byStatusKey.set(statusKey, [entry])
    }
    return byStatusKey
  })
  const trackingEntryTrackerIdsByDate = computed(() => {
    const trackerIdsByDate = new Map<string, Set<string>>()
    for (const entry of trackingStore.entries) {
      const trackerIds = trackerIdsByDate.get(entry.localDate)
      if (trackerIds) trackerIds.add(entry.tracker)
      else trackerIdsByDate.set(entry.localDate, new Set([entry.tracker]))
    }
    return trackerIdsByDate
  })
  const journalEntryCountByTaskDate = computed(() => {
    const counts = new Map<string, number>()
    for (const entry of journalStore.entries) {
      if (!entry.task) continue
      const statusKey = occurrenceStatusKey(entry.task, entry.localDate)
      counts.set(statusKey, (counts.get(statusKey) || 0) + 1)
    }
    return counts
  })

  function entriesFor(task: Task, date: Date, step?: ProgramStep) {
    const weekly = task.goalPeriod === 'week' && !step
    const start = weekly ? startOfWeek(date, { weekStartsOn: 1 }) : date
    const matchingEntries: Entry[] = []
    for (let offset = 0; offset < (weekly ? 7 : 1); offset += 1) {
      const entryDate = toDateKey(addDays(start, offset))
      matchingEntries.push(...(taskEntryIndex.value.get(
        occurrenceStatusKey(task.id, entryDate, step?.id),
      ) || []))
    }
    return matchingEntries
  }

  function occurrenceFor(task: Task, date: Date, step?: ProgramStep) {
    return occurrenceIndex.value.byStatusKey.get(
      occurrenceStatusKey(task.id, toDateKey(date), step?.id),
    )
  }

  function makeProgress(task: Task, date: Date, step?: ProgramStep): TaskProgress {
    const occurrence = occurrenceFor(task, date, step)
    const dateKey = toDateKey(date)
    const optimisticPatch = optimisticOccurrencePatches.value[
      occurrenceStatusKey(task.id, dateKey, step?.id)
    ]
    const trackingTrackerIds = !step && task.type === 'tracking'
      ? [...new Set(task.trackingTrackers ?? [])]
      : []
    const loggedTrackingTrackerIds = trackingEntryTrackerIdsByDate.value.get(dateKey)
    const loggedTrackingTrackerCount = trackingTrackerIds.reduce(
      (count, trackerId) => count + Number(loggedTrackingTrackerIds?.has(trackerId)),
      0,
    )
    const journalEntryCount = !step && task.type === 'journal'
      ? journalEntryCountByTaskDate.value.get(occurrenceStatusKey(task.id, dateKey)) || 0
      : 0
    const value = trackingTrackerIds.length
      ? loggedTrackingTrackerCount
      : !step && task.type === 'journal'
        ? journalEntryCount
      : entriesFor(task, date, step).reduce((sum, entry) => sum + entry.value, 0)
    const isSessionDuration = !step
      && ['interval', 'flashcards'].includes(task.type)
      && task.sessionGoalType === 'duration'
    const target = trackingTrackerIds.length || (!step && task.type === 'journal'
      ? 1
      : isSessionDuration
        ? task.sessionTargetSeconds || 1
        : step?.targetValue || task.targetValue || 1)
    const operator = step?.targetOperator || task.targetOperator || 'gte'
    const targetReached = task.type === 'tracking' && !step
      ? trackingTrackerIds.length > 0 && value === target
      : task.type === 'journal' && !step
        ? value > 0
      : meetsTarget(value, target, operator)
    const storedStatus = optimisticPatch?.status ?? occurrence?.status ?? 'pending'
    const occurrenceComplete = storedStatus === 'completed'
    const occurrenceSkipped = storedStatus === 'skipped'
    const isOccurrenceDriven = (step && ['check', 'interval', 'flashcards'].includes(step.completionType))
      || (!step && ['check', 'interval', 'flashcards'].includes(task.type) && !isSessionDuration)
    const occurrenceSealed = optimisticPatch?.sealed ?? Boolean(occurrence?.sealed)
    const manuallyCompleted = isSessionDuration && occurrenceComplete && occurrenceSealed
    const isDailyTotal = !step && task.type === 'daily_total'
    const sealed = (isDailyTotal || isSessionDuration) && occurrenceSealed
    const complete = occurrenceSkipped
      ? false
      : isOccurrenceDriven
        ? occurrenceComplete
        : manuallyCompleted
          ? true
          : isDailyTotal
            ? sealed
            : operator !== 'lte' && targetReached
    return {
      task,
      scheduledDate: toDateKey(date),
      occurrence,
      value,
      percent: isOccurrenceDriven || manuallyCompleted
        ? (occurrenceComplete ? 100 : 0)
        : progressPercent(value, target, operator),
      complete,
      sealed,
      status: occurrenceSkipped
        ? 'skipped'
        : complete
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
      .filter((candidate) =>
        candidate.active
        && candidate.completionType !== 'day_off'
        && candidate.task === task.id)
      .flatMap((candidate) => candidate.cycleDays.map((day) => ({ candidate, day })))
      .filter(({ candidate, day }) => day < currentDay || (day === currentDay && candidate.sortOrder < step.sortOrder))
    return earlierSlots.some(({ candidate, day }) => {
      const occurrence = occurrenceFor(task, addDays(cycleStart, day - 1), candidate)
      return !occurrence || occurrence.status === 'pending'
    })
  }

  function progressForDate(date: Date) {
    const result: TaskProgress[] = []
    const includedStatusKeys = new Set<string>()
    const dateKey = toDateKey(date)
    for (const task of activeTasks.value) {
      if (!isTaskScheduled(task, date)) continue
      if (task.type !== 'program') {
        result.push(makeProgress(task, date))
        includedStatusKeys.add(occurrenceStatusKey(task.id, dateKey))
        continue
      }
      for (const step of stepsForDate(task, steps.value, date)) {
        result.push(makeProgress(task, date, step))
        includedStatusKeys.add(occurrenceStatusKey(task.id, dateKey, step.id))
      }
    }
    for (const occurrence of occurrenceIndex.value.byDate.get(dateKey) || []) {
      const statusKey = occurrenceStatusKey(occurrence.task, dateKey, occurrence.programStep)
      if (includedStatusKeys.has(statusKey)) continue
      includedStatusKeys.add(statusKey)
      const task = taskById.value.get(occurrence.task)
      const step = occurrence.programStep ? stepById.value.get(occurrence.programStep) : undefined
      if (task) result.push(makeProgress(task, date, step))
    }
    return result.sort((a, b) => Number(b.task.mandatory) - Number(a.task.mandatory) || a.task.sortOrder - b.task.sortOrder)
  }

  const selectedProgress = computed(() => progressForDate(selectedDate.value))

  function completionRateForDate(date: Date) {
    const progress = progressForDate(date).filter(item => item.status !== 'skipped')
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

  function isTaskIncompleteForReminder(task: Task, date: Date) {
    const dateKey = toDateKey(date)
    const progress: TaskProgress[] = []
    const includedStatusKeys = new Set<string>()
    if (task.active && isTaskScheduled(task, date)) {
      const scheduledSteps = task.type === 'program'
        ? stepsForDate(task, steps.value, date)
        : [undefined]
      for (const step of scheduledSteps) {
        progress.push(makeProgress(task, date, step))
        includedStatusKeys.add(occurrenceStatusKey(task.id, dateKey, step?.id))
      }
    }
    for (const occurrence of occurrenceIndex.value.byDate.get(dateKey) || []) {
      if (occurrence.task !== task.id) continue
      const statusKey = occurrenceStatusKey(task.id, dateKey, occurrence.programStep)
      if (includedStatusKeys.has(statusKey)) continue
      includedStatusKeys.add(statusKey)
      const step = occurrence.programStep ? stepById.value.get(occurrence.programStep) : undefined
      progress.push(makeProgress(task, date, step))
    }
    return progress.length > 0 && progress.some(item => !item.complete)
  }

  function syncTaskReminders() {
    reminderSyncRequested = true
    if (!reminderSyncPromise) {
      reminderSyncPromise = runTaskReminderSync().finally(() => {
        reminderSyncPromise = undefined
      })
    }
    return reminderSyncPromise
  }

  async function runTaskReminderSync() {
    while (reminderSyncRequested) {
      reminderSyncRequested = false
      try {
        await reconcileTaskReminders(tasks.value, {
          isTaskIncomplete: isTaskIncompleteForReminder,
        })
      } catch {
        // Reminder maintenance must not prevent task data from saving.
      }
    }
  }

  async function load() {
    if (!api.authStore.record) return
    loading.value = true
    error.value = ''
    try {
      await repairLegacyHealthConnectEntrySync(api.authStore.record.id)
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
      const reconciliationKey = `${api.authStore.record.id}:${since}`
      if (reconciledSessionProgressKey !== reconciliationKey) {
        const reconciled = await api.reconcileSessionTaskProgress?.(since)
        reconciled?.occurrences.forEach(upsertOccurrenceRecord)
        reconciled?.entries.forEach(upsertEntryRecord)
        reconciledSessionProgressKey = reconciliationKey
      }
      initialProgressSince = since
      loadedProgressRanges.clear()
      await reconcileLocalSessionProgress(since)
      await syncTaskReminders()
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
      await syncTaskReminders()
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
    await nextTick()
    try {
      const value = await readHealthConnectSteps(date)
      if (request !== stepCountRequest) return
      const entryDate = toDateKey(date)
      const stepTasks = activeTasks.value.filter(
        task => task.type === 'step_counter' && isTaskScheduled(task, date),
      )
      for (const task of stepTasks) {
        const occurrence = await ensureOccurrence(task, date)
        const existing = entries.value.find(entry => (
          entry.task === task.id
          && !entry.programStep
          && entry.entryDate === entryDate
          && isHealthConnectEntry(entry)
          && (entry.sourceSession === entryDate
            || entry.sourceSession === healthConnectEntrySession(entryDate))
        ))
        const payload = {
          occurrence: occurrence.id,
          entry_date: entryDate,
          value,
          kind: 'quantity',
          unit: 'steps',
          note: '',
          source_type: '',
          source_session: healthConnectEntrySession(entryDate),
        }
        const unchanged = existing
          && existing.occurrence === payload.occurrence
          && existing.value === payload.value
          && existing.kind === payload.kind
          && existing.unit === payload.unit
          && (existing.note || '') === payload.note
          && !existing.sourceType
          && existing.sourceSession === payload.source_session
        if (unchanged) {
          await syncEntryProgress(makeProgress(task, date))
          continue
        }
        const record = existing
          ? await api.collection('entries').update(existing.id, payload)
          : await api.collection('entries').create({
              owner: api.authStore.record!.id,
              task: task.id,
              program_step: '',
              ...payload,
            })
        upsertEntryRecord(record)
        await syncEntryProgress(makeProgress(task, date))
      }
    } catch (cause) {
      if (request !== stepCountRequest) return
      await syncTaskReminders()
      stepCountError.value = cause instanceof Error
        ? cause.message
        : 'Your Health Connect steps could not be loaded.'
    } finally {
      if (request === stepCountRequest) stepCountLoading.value = false
    }
  }

  async function ensureOccurrence(task: Task, date: Date, step?: ProgramStep) {
    const existing = occurrenceFor(task, date, step)
    const key = occurrenceStatusKey(task.id, toDateKey(date), step?.id)
    if (existing) return pendingOccurrenceCreates.get(key) || existing

    const occurrence: Occurrence = {
      id: createLocalRecordId(),
      task: task.id,
      programStep: step?.id,
      scheduledDate: toDateKey(date),
      status: 'pending',
      sealed: false,
      snapshotName: step?.name || task.name,
      snapshotTarget: step?.targetValue || task.targetValue || 0,
      snapshotUnit: step?.customUnit || step?.unit || task.customUnit || task.unit || '',
    }
    occurrences.value.push(occurrence)

    const persistence = (async () => {
      try {
        const record = await api.collection('occurrences').create({
          owner: api.authStore.record!.id,
          task: task.id,
          program_step: step?.id || '',
          scheduled_date: occurrence.scheduledDate,
          status: 'pending',
          sealed: false,
          snapshot_name: occurrence.snapshotName,
          snapshot_target: occurrence.snapshotTarget,
          snapshot_unit: occurrence.snapshotUnit || '',
        })
        Object.assign(occurrence, mapOccurrence(record))
        return occurrence
      } catch (cause) {
        occurrences.value = occurrences.value.filter(item => item !== occurrence)
        throw cause
      } finally {
        pendingOccurrenceCreates.delete(key)
      }
    })()
    pendingOccurrenceCreates.set(key, persistence)
    return persistence
  }

  async function updateOccurrenceOptimistically(
    progress: TaskProgress,
    patch: {
      status?: Occurrence['status']
      sealed?: boolean
      completedAt?: string
    },
    waitFor?: Promise<unknown>,
  ) {
    const progressDate = parseISO(progress.scheduledDate)
    const key = occurrenceStatusKey(
      progress.task.id,
      progress.scheduledDate,
      progress.programStep?.id,
    )
    const revision = ++optimisticOccurrenceRevision
    optimisticOccurrencePatches.value = {
      ...optimisticOccurrencePatches.value,
      [key]: {
        revision,
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.sealed !== undefined ? { sealed: patch.sealed } : {}),
      },
    }
    try {
      if (waitFor) await waitFor
      const occurrence = await ensureOccurrence(progress.task, progressDate, progress.programStep)
      const payload: Record<string, unknown> = {}
      if (patch.status !== undefined) payload.status = patch.status
      if (patch.sealed !== undefined) payload.sealed = patch.sealed
      if (patch.completedAt !== undefined) payload.completed_at = patch.completedAt
      const record = await api.collection('occurrences').update(occurrence.id, payload)
      Object.assign(occurrence, mapOccurrence(record))
      return occurrence
    } finally {
      if (optimisticOccurrencePatches.value[key]?.revision === revision) {
        const nextPatches = { ...optimisticOccurrencePatches.value }
        delete nextPatches[key]
        optimisticOccurrencePatches.value = nextPatches
      }
    }
  }

  async function toggleComplete(progress: TaskProgress, complete: boolean) {
    const progressDate = parseISO(progress.scheduledDate)
    const existing = occurrenceFor(progress.task, progressDate, progress.programStep)
    if (existing && (existing.status === 'completed') === complete) return
    await updateOccurrenceOptimistically(progress, {
      status: complete ? 'completed' : 'pending',
      completedAt: complete ? new Date().toISOString() : '',
    })
    void syncTaskReminders()
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

  async function applyLocalSessionProgress(input: {
    id: string
    sourceType: 'interval' | 'flashcards'
    sourceId?: string
    taskId?: string
    programStepId?: string
    taskDate?: string
    startedAt: string
    status: 'completed' | 'ended'
    elapsedSeconds: number
    completedAt: string
  }, syncReminders = true) {
    if (!tasks.value.length) await load()
    const taskDate = input.taskDate || toDateKey(new Date(input.startedAt))
    if (input.programStepId && input.taskId && input.status === 'completed') {
      await completeAttributedTask(input.taskId, taskDate, input.programStepId)
    }
    if (!input.sourceId) return

    const date = parseISO(taskDate)
    const candidates = tasks.value.filter(task => (
      task.active
      && task.type === input.sourceType
      && (input.sourceType === 'interval'
        ? task.intervalTemplate === input.sourceId
        : task.flashcardReviewSet === input.sourceId)
      && (task.id === input.taskId || task.sessionCountMode === 'linked')
      && isTaskScheduled(task, date)
    ))
    for (const task of candidates) {
      if (task.sessionGoalType !== 'duration') {
        if (input.status === 'completed') {
          await completeAttributedTask(task.id, taskDate)
        }
        continue
      }
      if (input.elapsedSeconds <= 0) continue
      const existingEntry = entries.value.find(entry => (
        entry.task === task.id
        && entry.sourceType === input.sourceType
        && entry.sourceSession === input.id
      ))
      if (existingEntry) continue

      const occurrence = await ensureOccurrence(task, date)
      const record = await api.collection('entries').create({
        owner: api.authStore.record!.id,
        task: task.id,
        occurrence: occurrence.id,
        program_step: '',
        entry_date: taskDate,
        value: Math.max(0, Math.round(input.elapsedSeconds)),
        kind: 'duration',
        unit: 'seconds',
        note: '',
        source_type: input.sourceType,
        source_session: input.id,
      })
      upsertEntryRecord(record)
      const updated = makeProgress(task, date)
      if (updated.complete && occurrence.status !== 'completed') {
        await updateOccurrenceOptimistically(updated, {
          status: 'completed',
          completedAt: input.completedAt,
        })
      }
    }
    if (syncReminders) await syncTaskReminders()
  }

  async function reconcileLocalSessionProgress(since: string) {
    const accountId = api.authStore.record?.id || ''
    if (!tasks.value.length || !accountId || !await hasLocalBootstrap(accountId)) return
    const [intervalSessions, flashcardSessions] = await Promise.all([
      listLocalRecords(accountId, 'interval_sessions'),
      listLocalRecords(accountId, 'flashcard_review_sessions'),
    ])
    const sessions = [
      ...intervalSessions.map(session => ({
        record: session,
        sourceType: 'interval' as const,
        sourceId: String(session.template || ''),
      })),
      ...flashcardSessions.map(session => ({
        record: session,
        sourceType: 'flashcards' as const,
        sourceId: String(session.review_set || ''),
      })),
    ]
    for (const { record, sourceType, sourceId } of sessions) {
      const status = String(record.status || '')
      if (status !== 'completed' && status !== 'ended') continue
      const startedAt = String(record.started_at || '')
      const taskDate = String(record.task_date || '')
      if (!startedAt || (startedAt.slice(0, 10) < since && (!taskDate || taskDate < since))) continue
      await applyLocalSessionProgress({
        id: String(record.id || ''),
        sourceType,
        sourceId,
        taskId: String(record.task || ''),
        programStepId: String(record.program_step || ''),
        taskDate,
        startedAt,
        status,
        elapsedSeconds: Number(record.elapsed_seconds || 0),
        completedAt: String(record.ended_at || record.updated_at || new Date().toISOString()),
      }, false)
      if (sourceType !== 'interval') continue
      const snapshot = record.flashcard_snapshot
      const definition = record.definition_snapshot
      const runtime = record.runtime_state
      const reviewSetId = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
        ? String((snapshot as Record<string, unknown>).reviewSet || '')
        : ''
      if (
        !reviewSetId
        || !definition
        || typeof definition !== 'object'
        || Array.isArray(definition)
        || !runtime
        || typeof runtime !== 'object'
        || Array.isArray(runtime)
      ) continue
      const reviewElapsedSeconds = completedIntervalFlashcardReviewSeconds(
        definition as unknown as IntervalDefinition,
        runtime as unknown as IntervalRuntimeState,
        Number(record.elapsed_seconds || 0),
      )
      if (reviewElapsedSeconds <= 0) continue
      await applyLocalSessionProgress({
        id: String(record.id || ''),
        sourceType: 'flashcards',
        sourceId: reviewSetId,
        taskDate: String(record.task_date || ''),
        startedAt,
        status,
        elapsedSeconds: reviewElapsedSeconds,
        completedAt: String(record.ended_at || record.updated_at || new Date().toISOString()),
      }, false)
    }
  }

  async function setDailyTotalSealed(progress: TaskProgress) {
    if (progress.task.type !== 'daily_total' || progress.programStep) return
    const sealed = !progress.sealed
    await updateOccurrenceOptimistically(progress, {
      sealed,
      status: sealed ? 'completed' : 'pending',
      completedAt: sealed ? new Date().toISOString() : '',
    })
    void syncTaskReminders()
  }

  async function addEntry(progress: TaskProgress, amount: number, kind?: Entry['kind'], note = '') {
    if (progress.sealed) return
    if (amount === 0) throw new Error('Task log entries cannot have a value of zero.')
    const progressDate = parseISO(progress.scheduledDate)
    const occurrencePromise = ensureOccurrence(progress.task, progressDate, progress.programStep)
    const occurrence = occurrenceFor(progress.task, progressDate, progress.programStep)!
    const unit = progress.programStep?.customUnit || progress.programStep?.unit || progress.task.customUnit || progress.task.unit || (progress.task.type === 'duration' ? 'hours' : '')
    const entry: Entry = {
      id: createLocalRecordId(),
      task: progress.task.id,
      occurrence: occurrence.id,
      programStep: progress.programStep?.id,
      entryDate: progress.scheduledDate,
      createdAt: new Date().toISOString(),
      value: amount,
      kind: kind || (progress.task.type === 'duration' ? 'duration' : 'quantity'),
      unit,
      note: sanitizeTaskEntryNote(note).trim(),
    }
    entries.value.unshift(entry)
    const persistence = (async () => {
      const persistedOccurrence = await occurrencePromise
      entry.occurrence = persistedOccurrence.id
      const record = await api.collection('entries').create({
        owner: api.authStore.record!.id,
        task: entry.task,
        occurrence: entry.occurrence,
        program_step: entry.programStep || '',
        entry_date: entry.entryDate,
        value: entry.value,
        kind: entry.kind,
        unit: entry.unit,
        note: entry.note || '',
      })
      Object.assign(entry, mapEntry(record))
      return entry
    })()
    const progressSync = syncEntryProgress(progress, persistence)
    try {
      await Promise.all([persistence, progressSync])
    } catch (cause) {
      entries.value = entries.value.filter(item => item !== entry)
      throw cause
    }
  }

  async function updateEntry(progress: TaskProgress, entryId: string, amount: number, note = '') {
    if (progress.sealed) return undefined
    if (amount === 0) throw new Error('Task log entries cannot have a value of zero.')
    const nextNote = sanitizeTaskEntryNote(note).trim()
    const index = entries.value.findIndex(item => item.id === entryId)
    const previous = index >= 0 ? { ...entries.value[index]! } : undefined
    const entry = index >= 0
      ? entries.value[index]!
      : {
          id: entryId,
          task: progress.task.id,
          occurrence: progress.occurrence?.id,
          programStep: progress.programStep?.id,
          entryDate: progress.scheduledDate,
          createdAt: new Date().toISOString(),
          value: amount,
          kind: progress.task.type === 'duration' ? 'duration' : 'quantity',
          unit: progress.programStep?.customUnit
            || progress.programStep?.unit
            || progress.task.customUnit
            || progress.task.unit
            || '',
          note: nextNote || undefined,
        } satisfies Entry
    entry.value = amount
    entry.note = nextNote || undefined
    if (index < 0) entries.value.unshift(entry)
    const persistence = api.collection('entries').update(entryId, {
      value: amount,
      note: nextNote,
    }).then((record) => {
      Object.assign(entry, mapEntry(record))
      return entry
    })
    const progressSync = syncEntryProgress(progress, persistence)
    try {
      await Promise.all([persistence, progressSync])
      return entry
    } catch (cause) {
      if (previous) Object.assign(entry, previous)
      else entries.value = entries.value.filter(item => item !== entry)
      throw cause
    }
  }

  async function deleteEntry(progress: TaskProgress, entryId: string) {
    if (progress.sealed) return false
    const index = entries.value.findIndex(entry => entry.id === entryId)
    const entry = index >= 0 ? entries.value[index] : undefined
    if (index >= 0) entries.value.splice(index, 1)
    const persistence = api.collection('entries').delete(entryId)
    const progressSync = syncEntryProgress(progress, persistence)
    try {
      await Promise.all([persistence, progressSync])
    } catch (cause) {
      if (entry && !entries.value.includes(entry)) entries.value.splice(index, 0, entry)
      throw cause
    }
    useSnackbarStore().showDeletion('Log')
    return true
  }

  async function syncEntryProgress(progress: TaskProgress, waitFor?: Promise<unknown>) {
    const progressDate = parseISO(progress.scheduledDate)
    const updated = makeProgress(progress.task, progressDate, progress.programStep)
    const isCheck = progress.programStep
      ? progress.programStep.completionType === 'check'
      : progress.task.type === 'check'
    const occurrence = occurrenceFor(
      progress.task,
      progressDate,
      progress.programStep,
    )
    if (!isCheck && occurrence) {
      const shouldComplete = updated.complete
      const nextStatus = shouldComplete ? 'completed' : 'pending'
      if (occurrence.status !== nextStatus) {
        await updateOccurrenceOptimistically(updated, {
          status: nextStatus,
          completedAt: shouldComplete ? new Date().toISOString() : '',
        }, waitFor)
      }
    }
    void syncTaskReminders()
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
    const statusUpdate = updateOccurrenceOptimistically(progress, {
      status,
      sealed: status === 'completed',
      completedAt: status === 'completed' ? new Date().toISOString() : '',
    })
    const carriedOccurrence = status === 'carried'
      ? ensureOccurrence(progress.task, addDays(progressDate, 1), progress.programStep)
      : undefined
    await Promise.all([statusUpdate, carriedOccurrence])
    void syncTaskReminders()
  }

  async function saveTask(draft: TaskDraft) {
    error.value = ''
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
      schedule_mode: draft.scheduleMode === 'time_based' ? 'time_based' : 'all_day',
      scheduled_time: draft.scheduleMode === 'time_based' ? draft.scheduledTime || '' : '',
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
      cycle_length: draft.type === 'program' ? draft.steps.length : draft.cycleLength || 0,
      program_repeat: draft.programRepeat ?? true,
      program_strict: draft.programStrict ?? false,
      entry_notes_enabled: draft.entryNotesEnabled,
      entry_note_suggestions_enabled: false,
      sort_order: sortOrder,
      interval_template: draft.type === 'interval' ? draft.intervalTemplate || '' : '',
      flashcard_review_set: draft.type === 'flashcards' ? draft.flashcardReviewSet || '' : '',
      session_count_mode: ['interval', 'flashcards'].includes(draft.type)
        ? draft.sessionCountMode || 'task'
        : 'task',
      session_goal_type: ['interval', 'flashcards'].includes(draft.type)
        ? draft.sessionGoalType || 'complete'
        : 'complete',
      session_target_seconds: ['interval', 'flashcards'].includes(draft.type)
        && draft.sessionGoalType === 'duration'
          ? draft.sessionTargetSeconds || 0
          : 0,
      tracking_trackers: draft.type === 'tracking' ? [...new Set(draft.trackingTrackers ?? [])] : [],
      reminder_enabled: draft.reminderEnabled,
      reminder_times: [...new Set(draft.reminderTimes)],
    }
    const previousTasks = tasks.value
    const previousSteps = steps.value
    const optimisticTask = mapTask({ id: draft.id || createLocalRecordId(), ...payload })
    const taskIndex = draft.id ? tasks.value.findIndex(task => task.id === draft.id) : -1
    if (taskIndex >= 0) tasks.value = tasks.value.toSpliced(taskIndex, 1, optimisticTask)
    else tasks.value = [...tasks.value, optimisticTask]
    let optimisticSteps: ProgramStep[] = []
    if (draft.type === 'program') {
      optimisticSteps = draft.steps.map((step, index) => mapStep({
        id: step.id || createLocalRecordId(),
        task: optimisticTask.id,
        name: step.name,
        description: step.description,
        sort_order: index,
        cycle_days: [index + 1],
        completion_type: step.completionType,
        target_value: step.targetValue || 0,
        target_operator: step.targetOperator || 'gte',
        unit: step.unit || '',
        custom_unit: step.customUnit || '',
        active: true,
        interval_template: step.completionType === 'interval' ? step.intervalTemplate || '' : '',
        flashcard_review_set: step.completionType === 'flashcards' ? step.flashcardReviewSet || '' : '',
      }))
      steps.value = [
        ...steps.value.filter(step => step.task !== optimisticTask.id),
        ...optimisticSteps,
      ]
    }
    try {
      const record = draft.id
        ? await api.collection('tasks').update(draft.id, payload)
        : await api.collection('tasks').create(payload)
      const taskId = record.id
      Object.assign(optimisticTask, mapTask(record))
      optimisticSteps.forEach((step) => {
        step.task = taskId
      })

      if (draft.type === 'program') {
        const existing = previousSteps.filter((step) => step.task === taskId)
        const retainedIds = new Set(draft.steps.map((step) => step.id).filter(Boolean))
        await Promise.all(existing.filter((step) => !retainedIds.has(step.id)).map((step) =>
          api.collection('program_steps').update(step.id, {
            active: false,
            interval_template: '',
            flashcard_review_set: '',
          }),
        ))
        const stepRecords = await Promise.all(
          draft.steps.map((step, index) => {
            const stepPayload = {
              owner: api.authStore.record!.id,
              task: taskId,
              name: step.name,
              description: step.description,
              sort_order: index,
              cycle_days: [index + 1],
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
        stepRecords.forEach((stepRecord, index) => {
          const optimisticStep = optimisticSteps[index]
          if (optimisticStep) Object.assign(optimisticStep, mapStep(stepRecord))
        })
      }
      void syncTaskReminders()
      return taskId
    } catch (cause) {
      tasks.value = previousTasks
      steps.value = previousSteps
      error.value = cause instanceof Error ? cause.message : 'Could not save the task.'
      void syncTaskReminders()
      throw cause
    }
  }

  async function toggleTaskActive(task: Task) {
    const previous = { ...task }
    task.active = !task.active
    try {
      const record = await api.collection('tasks').update(task.id, { active: task.active })
      Object.assign(task, mapTask(record))
    } catch (cause) {
      Object.assign(task, previous)
      throw cause
    } finally {
      void syncTaskReminders()
    }
  }

  function progressIsScheduled(progress: TaskProgress) {
    const date = parseISO(progress.scheduledDate)
    if (progress.programStep) {
      return stepsForDate(progress.task, steps.value, date)
        .some(step => step.id === progress.programStep?.id)
    }
    return progress.task.type !== 'program' && isTaskScheduled(progress.task, date)
  }

  async function toggleSkipped(progress: TaskProgress, skipped: boolean) {
    if (skipped) {
      await setStatus(progress, 'skipped')
      return
    }
    const occurrence = occurrenceFor(
      progress.task,
      parseISO(progress.scheduledDate),
      progress.programStep,
    )
    if (!occurrence || occurrence.status !== 'skipped') return
    if (progressIsScheduled(progress)) {
      await setStatus(progress, 'pending')
      return
    }
    const index = occurrences.value.indexOf(occurrence)
    occurrences.value.splice(index, 1)
    try {
      await api.collection('occurrences').delete(occurrence.id)
    } catch (cause) {
      occurrences.value.splice(index, 0, occurrence)
      throw cause
    } finally {
      void syncTaskReminders()
    }
  }

  function upsertOccurrenceRecord(record: Record<string, any>) {
    const occurrence = mapOccurrence(record)
    const index = occurrences.value.findIndex((item) => item.id === occurrence.id)
    if (index >= 0) occurrences.value.splice(index, 1, occurrence)
    else occurrences.value.push(occurrence)
    void syncTaskReminders()
    return occurrence
  }

  function upsertEntryRecord(record: Record<string, any>) {
    const entry = mapEntry(record)
    const index = entries.value.findIndex(item => item.id === entry.id)
    if (index >= 0) entries.value.splice(index, 1, entry)
    else entries.value.unshift(entry)
    void syncTaskReminders()
    return entry
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
      await syncTaskReminders()
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
    const previousTasks = tasks.value
    const previousSteps = steps.value
    const previousOccurrences = occurrences.value
    const previousEntries = entries.value
    tasks.value = tasks.value.filter((task) => task.id !== taskId)
    steps.value = steps.value.filter((step) => step.task !== taskId)
    occurrences.value = occurrences.value.filter((occurrence) => occurrence.task !== taskId)
    entries.value = entries.value.filter((entry) => entry.task !== taskId)
    try {
      await api.collection('tasks').delete(taskId)
    } catch (cause) {
      tasks.value = previousTasks
      steps.value = previousSteps
      occurrences.value = previousOccurrences
      entries.value = previousEntries
      throw cause
    } finally {
      void syncTaskReminders()
    }
    useSnackbarStore().showDeletion('Routine')
  }

  async function shiftProgram(progress: TaskProgress) {
    const previousStart = progress.task.startDate
    const shiftedStart = toDateKey(addDays(parseISO(progress.task.startDate), 1))
    progress.task.startDate = shiftedStart
    try {
      await setStatus(progress, 'rescheduled')
      await api.collection('tasks').update(progress.task.id, { start_date: shiftedStart })
    } catch (cause) {
      progress.task.startDate = previousStart
      throw cause
    } finally {
      void syncTaskReminders()
    }
  }

  return {
    tasks,
    steps,
    occurrences,
    entries,
    selectedDate,
    loading,
    error,
    stepCountLoading,
    stepCountError,
    activeTasks,
    selectedProgress,
    completionRate,
    progressForDate,
    completionRateForDate,
    reviewProgressForDate,
    syncTaskReminders,
    load,
    loadProgressRange,
    refreshStepCount,
    makeProgress,
    entriesFor,
    toggleComplete,
    completeAttributedTask,
    applyLocalSessionProgress,
    setDailyTotalSealed,
    addEntry,
    updateEntry,
    deleteEntry,
    loadEntryNoteHistory,
    loadEntriesForDay,
    setStatus,
    progressIsScheduled,
    toggleSkipped,
    shiftProgram,
    saveTask,
    toggleTaskActive,
    upsertOccurrenceRecord,
    upsertEntryRecord,
    reorderTasks,
    deleteTask,
  }
})
