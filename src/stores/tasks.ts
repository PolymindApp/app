import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { addDays, endOfWeek, format, parseISO, startOfWeek, subDays } from 'date-fns'
import { api } from '@/lib/api'
import { isTaskScheduled, meetsTarget, programCycleDay, progressPercent, stepsForDate, toDateKey } from '@/services/schedule'
import type { Entry, Occurrence, ProgramStep, Task, TaskDraft, TaskProgress } from '@/types/domain'

const asNumberArray = (value: unknown, fallback: number[] = []) =>
  Array.isArray(value) ? value.map(Number) : fallback

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
    quickAmounts: asNumberArray(record.quick_amounts, [1]),
    cycleLength: record.cycle_length || undefined,
    programRepeat: record.program_repeat,
    programStrict: record.program_strict,
    sortOrder: record.sort_order || 0,
    intervalTemplate: record.interval_template || undefined,
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
    quickAmounts: asNumberArray(record.quick_amounts, [1]),
    active: record.active !== false,
    intervalTemplate: record.interval_template || undefined,
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
    value: Number(record.value),
    kind: record.kind,
    unit: record.unit || '',
    note: record.note || undefined,
  }
}

export const useTaskStore = defineStore('tasks', () => {
  const tasks = ref<Task[]>([])
  const steps = ref<ProgramStep[]>([])
  const occurrences = ref<Occurrence[]>([])
  const entries = ref<Entry[]>([])
  const selectedDate = ref(new Date())
  const loading = ref(false)
  const error = ref('')

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
    const value = entriesFor(task, date, step).reduce((sum, entry) => sum + entry.value, 0)
    const target = step?.targetValue || task.targetValue || 1
    const operator = step?.targetOperator || task.targetOperator || 'gte'
    const targetReached = meetsTarget(value, target, operator)
    const occurrenceComplete = occurrence?.status === 'completed'
    const isOccurrenceDriven = (step && (step.completionType === 'check' || step.completionType === 'interval'))
      || (!step && (task.type === 'check' || task.type === 'interval'))
    const isDailyTotal = !step && task.type === 'daily_total'
    const sealed = isDailyTotal && Boolean(occurrence?.sealed)
    return {
      task,
      occurrence,
      value,
      percent: isOccurrenceDriven ? (occurrenceComplete ? 100 : 0) : progressPercent(value, target, operator),
      complete: isOccurrenceDriven
        ? occurrenceComplete
        : isDailyTotal
          ? sealed
          : operator !== 'lte' && targetReached,
      sealed,
      status: occurrence?.status || 'pending',
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

  const selectedProgress = computed(() => {
    const result: TaskProgress[] = []
    for (const task of activeTasks.value) {
      if (!isTaskScheduled(task, selectedDate.value)) continue
      if (task.type !== 'program') {
        result.push(makeProgress(task, selectedDate.value))
        continue
      }
      for (const step of stepsForDate(task, steps.value, selectedDate.value)) {
        result.push(makeProgress(task, selectedDate.value, step))
      }
    }
    const key = toDateKey(selectedDate.value)
    for (const occurrence of occurrences.value.filter((item) => item.scheduledDate === key)) {
      if (result.some((item) => item.task.id === occurrence.task && (item.programStep?.id || '') === (occurrence.programStep || ''))) continue
      const task = tasks.value.find((item) => item.id === occurrence.task)
      const step = steps.value.find((item) => item.id === occurrence.programStep)
      if (task) result.push(makeProgress(task, selectedDate.value, step))
    }
    return result.sort((a, b) => Number(b.task.mandatory) - Number(a.task.mandatory) || a.task.sortOrder - b.task.sortOrder)
  })

  const completionRate = computed(() => {
    if (!selectedProgress.value.length) return 0
    const earnedProgress = selectedProgress.value.reduce(
      (total, item) => total + Math.max(0, Math.min(item.percent, 100)),
      0,
    )
    return Math.round(earnedProgress / selectedProgress.value.length)
  })

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
        api.collection('entries').getFullList({ filter: `entry_date >= "${since}"`, sort: '-entry_date' }),
      ])
      tasks.value = taskRecords.map(mapTask)
      steps.value = stepRecords.map(mapStep)
      occurrences.value = occurrenceRecords.map(mapOccurrence)
      entries.value = entryRecords.map(mapEntry)
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Could not load your plan.'
      throw cause
    } finally {
      loading.value = false
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
    return occurrence
  }

  async function toggleComplete(progress: TaskProgress) {
    const occurrence = await ensureOccurrence(progress.task, selectedDate.value, progress.programStep)
    const completing = occurrence.status !== 'completed'
    const record = await api.collection('occurrences').update(occurrence.id, {
      status: completing ? 'completed' : 'pending',
      completed_at: completing ? new Date().toISOString() : '',
    })
    Object.assign(occurrence, mapOccurrence(record))
  }

  async function setDailyTotalSealed(progress: TaskProgress) {
    if (progress.task.type !== 'daily_total' || progress.programStep) return
    const occurrence = await ensureOccurrence(progress.task, selectedDate.value, progress.programStep)
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
    const occurrence = await ensureOccurrence(progress.task, selectedDate.value, progress.programStep)
    const unit = progress.programStep?.customUnit || progress.programStep?.unit || progress.task.customUnit || progress.task.unit || (progress.task.type === 'duration' ? 'hours' : '')
    const record = await api.collection('entries').create({
      owner: api.authStore.record!.id,
      task: progress.task.id,
      occurrence: occurrence.id,
      program_step: progress.programStep?.id || '',
      entry_date: toDateKey(selectedDate.value),
      value: amount,
      kind: kind || (progress.task.type === 'duration' ? 'duration' : 'quantity'),
      unit,
      note,
    })
    entries.value.unshift(mapEntry(record))
    const updated = makeProgress(progress.task, selectedDate.value, progress.programStep)
    const isCheck = progress.programStep
      ? progress.programStep.completionType === 'check'
      : progress.task.type === 'check'
    if (progress.task.type !== 'daily_total' && !isCheck) {
      const shouldComplete = updated.complete
      if (shouldComplete !== (occurrence.status === 'completed')) {
        const updatedOccurrence = await api.collection('occurrences').update(occurrence.id, {
          status: shouldComplete ? 'completed' : 'pending',
          completed_at: shouldComplete ? new Date().toISOString() : '',
        })
        Object.assign(occurrence, mapOccurrence(updatedOccurrence))
      }
    }
  }

  async function setStatus(progress: TaskProgress, status: Occurrence['status']) {
    const occurrence = await ensureOccurrence(progress.task, selectedDate.value, progress.programStep)
    const record = await api.collection('occurrences').update(occurrence.id, {
      status,
      sealed: status === 'completed',
      completed_at: status === 'completed' ? new Date().toISOString() : '',
    })
    Object.assign(occurrence, mapOccurrence(record))
    if (status === 'carried') {
      await ensureOccurrence(progress.task, addDays(selectedDate.value, 1), progress.programStep)
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
      unit: draft.unit || '',
      custom_unit: draft.customUnit || '',
      goal_period: draft.goalPeriod || 'occurrence',
      quick_amounts: draft.quickAmounts,
      cycle_length: draft.cycleLength || 0,
      program_repeat: draft.programRepeat ?? true,
      program_strict: draft.programStrict ?? false,
      sort_order: sortOrder,
      interval_template: draft.type === 'interval' ? draft.intervalTemplate || '' : '',
    }
    const record = draft.id
      ? await api.collection('tasks').update(draft.id, payload)
      : await api.collection('tasks').create(payload)
    const taskId = record.id

    if (draft.type === 'program') {
      const existing = steps.value.filter((step) => step.task === taskId)
      const retainedIds = new Set(draft.steps.map((step) => step.id).filter(Boolean))
      await Promise.all(existing.filter((step) => !retainedIds.has(step.id)).map((step) =>
        api.collection('program_steps').update(step.id, { active: false, interval_template: '' }),
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
            quick_amounts: step.quickAmounts,
            active: true,
            interval_template: step.completionType === 'interval' ? step.intervalTemplate || '' : '',
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
    activeTasks,
    selectedProgress,
    completionRate,
    load,
    makeProgress,
    entriesFor,
    toggleComplete,
    setDailyTotalSealed,
    addEntry,
    setStatus,
    shiftProgram,
    saveTask,
    toggleTaskActive,
    upsertOccurrenceRecord,
    reorderTasks,
    deleteTask,
  }
})
