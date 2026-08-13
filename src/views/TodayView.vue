<script setup lang="ts">
import { Capacitor } from '@capacitor/core'
import { App } from '@capacitor/app'
import { computed, onBeforeUnmount, onBeforeUpdate, onMounted, onUpdated, ref, watch } from 'vue'
import { addDays, format, isAfter, parseISO, startOfDay, startOfWeek } from 'date-fns'
import { storeToRefs } from 'pinia'
import { useDisplay } from 'vuetify'
import { useRouter } from 'vue-router'
import ActionBottomSheet from '@/components/ActionBottomSheet.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import TaskCard from '@/components/TaskCard.vue'
import TrackingLogBottomSheet from '@/components/TrackingLogBottomSheet.vue'
import WeekDateNavigator from '@/components/WeekDateNavigator.vue'
import type { LongPressDragResult } from '@/directives/longPressDrag'
import { reviewSetCardCount } from '@/services/flashcards'
import { isNativeHealthConnectSupported } from '@/services/healthConnect'
import { isHealthConnectEntry } from '@/services/healthConnectEntries'
import { formatIntervalDuration, intervalDuration } from '@/services/intervals'
import { taskCompletionMarkerColor, toDateKey } from '@/services/schedule'
import { TASK_CARD_ACTION_ITEMS, taskCanLogAdditionalValue, taskCanLogAmounts, taskIntervalCanStart } from '@/services/taskCardActions'
import type { TaskCardActionId } from '@/services/taskCardActions'
import { formatTrackingValue } from '@/services/tracking'
import {
  TASK_ENTRY_NOTE_MAX_LENGTH,
  sanitizeTaskEntryNote,
  taskEntryNoteOptions,
} from '@/services/taskEntryNotes'
import {
  TASK_FILTER_ITEMS,
  readTaskFilterSelection,
  tasksWithoutProgress,
  writeTaskFilterSelection,
} from '@/services/taskFilters'
import type { TaskFilterId } from '@/services/taskFilters'
import { taskIdsFromProgressDrag, taskProgressDragKey } from '@/services/taskReordering'
import { useIntervalStore } from '@/stores/intervals'
import { useFlashcardStore } from '@/stores/flashcards'
import { useJournalStore } from '@/stores/journal'
import { useTaskStore } from '@/stores/tasks'
import { useTrackingStore } from '@/stores/tracking'
import type { Entry, TaskProgress, TrackingTracker } from '@/types/domain'

const allowAutomaticFocus = Capacitor.getPlatform() !== 'android'
const HEALTH_CONNECT_RESUME_DELAY_MS = 500
const store = useTaskStore()
const intervalStore = useIntervalStore()
const flashcardStore = useFlashcardStore()
const journalStore = useJournalStore()
const trackingStore = useTrackingStore()
const router = useRouter()
const { smAndUp } = useDisplay()
const {
  selectedDate,
  selectedProgress,
  completionRate,
  loading,
  error,
  stepCountLoading,
  stepCountError,
} = storeToRefs(store)
const visibleWeekStart = ref(startOfWeek(selectedDate.value, { weekStartsOn: 1 }))
const busy = ref(false)
const busyProgressKeys = ref(new Set<string>())
const exactDialog = ref(false)
const exactProgress = ref<TaskProgress>()
const exactAmountInput = ref('')
const exactNote = ref('')
const exactNoteHistory = ref<Entry[]>([])
const exactNoteLoading = ref(false)
const exactEditingEntry = ref<Entry>()
const exactLoggingAdditional = ref(false)
const exactError = ref('')
let exactNoteHistoryRequest = 0
const exactAction = ref<'add' | 'subtract' | 'set' | 'save'>()
const reviewSheet = ref(false)
const taskSheet = ref(false)
const taskSheetMode = ref<'actions' | 'history'>('actions')
const taskActionProgress = ref<TaskProgress>()
const taskStatusDialog = ref(false)
const taskStatusUpdating = ref(false)
const taskLogEntries = ref<Entry[]>([])
const taskLogLoading = ref(false)
const taskLogError = ref('')
const taskLogDeleteDialog = ref(false)
const taskLogDeleteEntry = ref<Entry>()
let taskLogRequest = 0
const activeIntervalSheet = ref(false)
const activeReviewSheet = ref(false)
const intervalStartError = ref('')
const flashcardStartError = ref('')
const trackingSheetOpen = ref(false)
const trackingSheetTracker = ref<TrackingTracker>()
const trackingSheetDate = ref(toDateKey(new Date()))
const trackingSheetContext = ref('')
const taskPage = ref<HTMLElement>()
const valuePulseVersions = ref<Record<string, number>>({})
const initialTaskFilters = readTaskFilterSelection()
const showCompleted = ref(initialTaskFilters.includes('completed'))
const showNotScheduled = ref(initialTaskFilters.includes('not_scheduled'))
const taskFiltersOpen = ref(false)
const reorderingTasks = ref(false)
const recentlyCompletedKeys = ref(new Set<string>())
const completedVisibilityTimers = new Map<string, ReturnType<typeof setTimeout>>()
const taskCardPositions = new Map<HTMLElement, {
  top: number
  left: number
  width: number
}>()
let captureTaskCardPositions = false
const exactAmount = computed(() => {
  if (!exactAmountInput.value || exactAmountInput.value === '.') return null
  const value = Number(exactAmountInput.value)
  return Number.isFinite(value) ? value : null
})
const exactDesktopAmount = computed<number | null>({
  get: () => exactAmount.value,
  set: (value) => {
    exactAmountInput.value = value === null ? '' : String(value)
  },
})
const exactCanLogAmount = computed(() => exactAmount.value !== null && exactAmount.value !== 0)
const exactCanAdjustAmount = computed(() => exactAmount.value !== null && exactAmount.value > 0)
const exactCanSetAmount = computed(() => exactAmount.value !== null && exactAmount.value >= 0)
const exactAmountError = computed(() => {
  if (exactEditingEntry.value && exactAmount.value === 0) return 'Amount cannot be zero.'
  if (!exactEditingEntry.value && exactAmount.value !== null && exactAmount.value < 0) {
    return 'Enter a positive amount and use Subtract.'
  }
  return undefined
})
const keypadKeys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'backspace'] as const
const exactNoteOptions = computed(() =>
  exactProgress.value?.task.entryNotesEnabled
    ? taskEntryNoteOptions(exactNoteHistory.value, exactProgress.value.task.id)
    : [],
)
const taskActionTitle = computed(() =>
  taskActionProgress.value?.programStep?.name
    || taskActionProgress.value?.task.name
    || 'Task actions',
)
const taskSheetDescription = computed(() => taskSheetMode.value === 'history'
  ? `${taskActionTitle.value} · ${format(selectedDate.value, 'EEEE, MMMM d')}`
  : undefined)
const taskCardActionItems = computed(() => TASK_CARD_ACTION_ITEMS.filter((action) =>
  action.id === 'log-additional-value'
    ? taskCanLogAdditionalValue(taskActionProgress.value)
    : action.id !== 'view-log-history'
      || taskCanLogAmounts(taskActionProgress.value)
      || (taskCanLogAdditionalValue(taskActionProgress.value) && taskActionProgress.value
        ? store.entriesFor(
            taskActionProgress.value.task,
            parseISO(taskActionProgress.value.scheduledDate),
            taskActionProgress.value.programStep,
          ).length > 0
        : false),
).map(action => action.id === 'toggle-task-status'
  ? {
      ...action,
      title: taskActionProgress.value?.task.active ? 'Pause task' : 'Unpause task',
      icon: taskActionProgress.value?.task.active ? 'mdi-pause' : 'mdi-play',
    }
  : action))
const visibleWeekDates = computed(() => Array.from(
  { length: 7 },
  (_, index) => addDays(visibleWeekStart.value, index),
))
const taskDateMarkers = computed(() => visibleWeekDates.value.flatMap((date) => {
  if (isAfter(date, startOfDay(new Date()))) return []
  const percent = store.completionRateForDate(date)
  if (percent === undefined) return []
  return [{
    date: toDateKey(date),
    color: taskCompletionMarkerColor(percent),
    label: `${percent}% of tasks complete`,
  }]
}))

const notScheduledProgress = computed(() => tasksWithoutProgress(
  store.tasks,
  selectedProgress.value,
).map(task => store.makeProgress(task, selectedDate.value)))
const displayedProgress = computed(() => {
  const progressItems = showNotScheduled.value
    ? [...selectedProgress.value, ...notScheduledProgress.value]
    : selectedProgress.value
  return [...progressItems].sort((left, right) => (
    Number(right.task.mandatory) - Number(left.task.mandatory)
    || left.task.sortOrder - right.task.sortOrder
    || (left.programStep?.sortOrder ?? 0) - (right.programStep?.sortOrder ?? 0)
  ))
})
const required = computed(() => displayedProgress.value.filter((item) => item.task.mandatory))
const optional = computed(() => displayedProgress.value.filter((item) => !item.task.mandatory))
const visibleRequired = computed(() => required.value.filter(taskIsVisible))
const visibleOptional = computed(() => optional.value.filter(taskIsVisible))
const reviewItems = computed(() => store.reviewProgressForDate(selectedDate.value))
const doneCount = computed(() => selectedProgress.value.filter((item) => item.complete).length)
const taskFiltersActive = computed(() => showCompleted.value || showNotScheduled.value)
let appStateListener: Awaited<ReturnType<typeof App.addListener>> | undefined
let stepCountResumeTimer: ReturnType<typeof setTimeout> | undefined

watch([showCompleted, showNotScheduled], ([completed, notScheduled]) => {
  const filters: TaskFilterId[] = []
  if (completed) filters.push('completed')
  if (notScheduled) filters.push('not_scheduled')
  writeTaskFilterSelection(filters)
})

onMounted(async () => {
  try {
    await Promise.all([store.load(), intervalStore.load(), flashcardStore.load(), trackingStore.load()])
  } catch { /* Store error states are displayed in the view. */ }
  await loadVisibleTaskProgress()
  if (Capacitor.isNativePlatform()) {
    appStateListener = await App.addListener('appStateChange', ({ isActive }) => {
      clearTimeout(stepCountResumeTimer)
      stepCountResumeTimer = undefined
      if (!isActive) return

      // Android emits the active event just before Health Connect recognizes
      // the app as foregrounded. Let that transition settle before reading.
      stepCountResumeTimer = setTimeout(() => {
        stepCountResumeTimer = undefined
        void store.refreshStepCount(selectedDate.value)
      }, HEALTH_CONNECT_RESUME_DELAY_MS)
    })
  }
})

onBeforeUnmount(() => {
  void appStateListener?.remove()
  clearTimeout(stepCountResumeTimer)
  completedVisibilityTimers.forEach(timer => clearTimeout(timer))
  completedVisibilityTimers.clear()
})

onBeforeUpdate(() => {
  if (!captureTaskCardPositions) return
  captureTaskCardPositions = false
  taskCardPositions.clear()
  taskPage.value?.querySelectorAll<HTMLElement>('.task-masonry-item').forEach((element) => {
    const parent = element.parentElement
    if (!parent) return
    const bounds = element.getBoundingClientRect()
    const parentBounds = parent.getBoundingClientRect()
    taskCardPositions.set(element, {
      top: bounds.top - parentBounds.top,
      left: bounds.left - parentBounds.left,
      width: bounds.width,
    })
  })
})

onUpdated(() => {
  taskCardPositions.clear()
})

watch(selectedDate, date => {
  if (isNativeHealthConnectSupported()) void store.refreshStepCount(date)
})

watch(visibleWeekStart, () => {
  if (store.tasks.length) void loadVisibleTaskProgress()
})

async function loadVisibleTaskProgress() {
  const dates = visibleWeekDates.value
  const start = toDateKey(dates[0])
  const end = toDateKey(dates[6])
  const journalStart = toDateKey(addDays(dates[0], -1))
  await Promise.all([
    store.loadProgressRange(start, end).catch(() => undefined),
    trackingStore.loaded ? trackingStore.loadRange(start, end).catch(() => undefined) : Promise.resolve(),
    journalStore.loadRange(journalStart, end).catch(() => undefined),
  ])
  if (!isNativeHealthConnectSupported()) return
  for (const date of dates) {
    if (isAfter(date, startOfDay(new Date()))) continue
    await store.refreshStepCount(date)
  }
}
async function run(action: () => Promise<void>) {
  busy.value = true
  try { await action() } finally { busy.value = false }
}

function syncStepCount() {
  void store.refreshStepCount(selectedDate.value)
}

function progressKey(progress: TaskProgress) {
  return taskProgressDragKey(progress)
}

function draggableTaskCount(progressItems: TaskProgress[]) {
  return new Set(progressItems.map(item => item.task.id)).size
}

async function reorderTaskCards(result: LongPressDragResult, progressItems: TaskProgress[]) {
  const orderedTaskIds = taskIdsFromProgressDrag(result, progressItems)
  if (orderedTaskIds.length < 2) return
  reorderingTasks.value = true
  try {
    await store.reorderTasks(orderedTaskIds)
  } catch {
    // The store restores the previous order and exposes the save error.
  } finally {
    reorderingTasks.value = false
  }
}

function visibilityKey(progress: TaskProgress) {
  return `${progress.scheduledDate}:${progressKey(progress)}`
}

function taskIsVisible(progress: TaskProgress) {
  return showCompleted.value
    || !progress.complete
    || recentlyCompletedKeys.value.has(visibilityKey(progress))
}

function taskFilterEnabled(filter: TaskFilterId) {
  if (filter === 'completed') return showCompleted.value
  return showNotScheduled.value
}

function toggleTaskFilter(filter: TaskFilterId) {
  if (filter === 'completed') {
    captureTaskCardPositions = showCompleted.value
    showCompleted.value = !showCompleted.value
    return
  }
  captureTaskCardPositions = showNotScheduled.value
  showNotScheduled.value = !showNotScheduled.value
}

function taskScheduleStatus(progress: TaskProgress) {
  if (!showNotScheduled.value || selectedProgress.value.some(item => item.task.id === progress.task.id)) {
    return undefined
  }
  return progress.task.active ? 'not-scheduled' as const : 'paused' as const
}

function pinLeavingTaskCard(element: Element) {
  if (!(element instanceof HTMLElement)) return
  const position = taskCardPositions.get(element)
  if (!position) return
  element.style.position = 'absolute'
  element.style.top = `${position.top}px`
  element.style.left = `${position.left}px`
  element.style.width = `${position.width}px`
  element.style.zIndex = '1'
  element.style.pointerEvents = 'none'
}

function releaseLeavingTaskCard(element: Element) {
  if (!(element instanceof HTMLElement)) return
  element.style.removeProperty('position')
  element.style.removeProperty('top')
  element.style.removeProperty('left')
  element.style.removeProperty('width')
  element.style.removeProperty('z-index')
  element.style.removeProperty('pointer-events')
}

function clearCompletedTaskVisibility(key: string) {
  const timer = completedVisibilityTimers.get(key)
  if (timer) clearTimeout(timer)
  completedVisibilityTimers.delete(key)
  if (!recentlyCompletedKeys.value.has(key)) return
  const nextKeys = new Set(recentlyCompletedKeys.value)
  nextKeys.delete(key)
  recentlyCompletedKeys.value = nextKeys
}

function keepCompletedTaskVisible(key: string) {
  const existingTimer = completedVisibilityTimers.get(key)
  if (existingTimer) clearTimeout(existingTimer)

  recentlyCompletedKeys.value = new Set(recentlyCompletedKeys.value).add(key)
  completedVisibilityTimers.set(key, setTimeout(() => {
    clearCompletedTaskVisibility(key)
  }, 2000))
}

watch(
  () => selectedProgress.value.map(progress => ({
    key: visibilityKey(progress),
    complete: progress.complete,
  })),
  (current, previous = []) => {
    const previousByKey = new Map(previous.map(item => [item.key, item.complete]))
    const currentByKey = new Map(current.map(item => [item.key, item.complete]))

    current.forEach((item) => {
      if (item.complete && previousByKey.get(item.key) === false) {
        keepCompletedTaskVisible(item.key)
      }
      if (!item.complete) clearCompletedTaskVisibility(item.key)
    })

    previous.forEach((item) => {
      if (currentByKey.has(item.key)) return
      clearCompletedTaskVisibility(item.key)
    })
  },
)

function progressIsToday(progress: TaskProgress) {
  return progress.scheduledDate === toDateKey(new Date())
}

function intervalCanStart(progress: TaskProgress) {
  return taskIntervalCanStart(progress, toDateKey(new Date()))
}

function trackingCanLog(progress: TaskProgress) {
  return progress.task.type === 'tracking'
    && !isAfter(parseISO(progress.scheduledDate), startOfDay(new Date()))
}

function journalCanWrite(progress: TaskProgress) {
  return progress.task.type === 'journal'
    && !isAfter(parseISO(progress.scheduledDate), startOfDay(new Date()))
}

function openJournalTask(progress: TaskProgress) {
  void router.push({
    name: 'journal-new',
    query: {
      task: progress.task.id,
      date: progress.scheduledDate,
      from: 'tasks',
    },
  })
}

function trackingMeta(progress: TaskProgress) {
  const trackerIds = progress.task.trackingTrackers ?? []
  return trackerIds.flatMap((trackerId) => {
    const tracker = trackingStore.trackers.find(item => item.id === trackerId)
    if (!tracker) return []
    const entries = trackingStore.entries.filter(entry =>
      entry.tracker === tracker.id && entry.localDate === progress.scheduledDate)
    return [{
      id: tracker.id,
      name: tracker.name,
      icon: tracker.icon,
      color: tracker.color,
      kind: tracker.kind,
      logged: entries.length > 0,
      loggedValue: tracker.kind === 'duration' && entries.length
        ? formatTrackingValue(tracker, entries.reduce((total, entry) => total + entry.value, 0))
        : undefined,
    }]
  })
}

function openTrackingLogger(progress: TaskProgress, trackerId: string) {
  const tracker = trackingStore.trackers.find(item => item.id === trackerId)
  if (!tracker) return
  trackingSheetTracker.value = tracker
  trackingSheetDate.value = progress.scheduledDate
  trackingSheetContext.value = progress.programStep?.name || progress.task.name
  trackingSheetOpen.value = true
}

function openTrackingTimeLogger(progress: TaskProgress, trackerId: string) {
  const tracker = trackingStore.trackers.find(item => item.id === trackerId)
  if (tracker?.kind !== 'duration' || !progress.task.trackingTrackers?.includes(trackerId)) return
  void router.push({
    name: 'task-timer',
    params: { id: progress.task.id },
    query: { date: progress.scheduledDate, tracker: trackerId },
  })
}

function progressIsBusy(progress: TaskProgress) {
  return busy.value || busyProgressKeys.value.has(progressKey(progress))
}

function valuePulseFor(progress: TaskProgress) {
  return valuePulseVersions.value[progressKey(progress)] || 0
}

function pulseProgressValue(progress: TaskProgress) {
  const key = progressKey(progress)
  valuePulseVersions.value = {
    ...valuePulseVersions.value,
    [key]: (valuePulseVersions.value[key] || 0) + 1,
  }
}

async function runForProgress(progress: TaskProgress, action: () => Promise<void>) {
  const key = progressKey(progress)
  if (busyProgressKeys.value.has(key)) return
  busyProgressKeys.value.add(key)
  try {
    await action()
  } finally {
    busyProgressKeys.value.delete(key)
  }
}

async function resolveReview(item: TaskProgress, status: 'missed' | 'carried') {
  await run(() => store.setStatus(item, status))
  reviewSheet.value = false
}

function openTaskActions(progress: TaskProgress) {
  taskLogRequest += 1
  taskActionProgress.value = progress
  taskSheetMode.value = 'actions'
  taskLogEntries.value = []
  taskLogLoading.value = false
  taskLogError.value = ''
  taskSheet.value = true
}

function taskEntryKindLabel(entry: Entry) {
  if (isHealthConnectEntry(entry)) return 'Health Connect'
  if (entry.kind === 'duration') return 'Duration'
  if (entry.kind === 'adjustment') return 'Adjustment'
  return 'Quantity'
}

function taskEntryIcon(entry: Entry) {
  if (isHealthConnectEntry(entry)) return 'mdi-heart-pulse'
  if (entry.kind === 'duration') return 'mdi-timer-outline'
  if (entry.kind === 'adjustment') return 'mdi-plus-minus-variant'
  return 'mdi-chart-donut'
}

function taskEntryValue(entry: Entry) {
  const value = Number(entry.value.toFixed(2))
  return `${value}${entry.unit ? ` ${entry.unit}` : ''}`
}

function taskEntryTime(entry: Entry) {
  const created = new Date(entry.createdAt)
  return Number.isNaN(created.getTime()) ? 'Logged entry' : format(created, 'h:mm a')
}

function taskEntrySubtitle(entry: Entry) {
  return [
    taskEntryTime(entry),
    ...(entry.note ? [taskEntryKindLabel(entry)] : []),
  ].join(' · ')
}

async function openTaskLogHistory() {
  const progress = taskActionProgress.value
  if (!progress || taskLogLoading.value) return
  const request = ++taskLogRequest
  taskSheetMode.value = 'history'
  taskLogLoading.value = true
  taskLogError.value = ''
  try {
    const entries = await store.loadEntriesForDay(
      progress.task.id,
      progress.scheduledDate,
      progress.programStep?.id,
    )
    if (request === taskLogRequest) taskLogEntries.value = entries
  } catch (cause) {
    if (request === taskLogRequest) {
      taskLogError.value = cause instanceof Error ? cause.message : 'Could not load this log history.'
    }
  } finally {
    if (request === taskLogRequest) taskLogLoading.value = false
  }
}

function runTaskCardAction(action: TaskCardActionId) {
  if (action === 'edit-task') {
    const taskId = taskActionProgress.value?.task.id
    if (!taskId) return
    taskSheet.value = false
    void router.push({ name: 'task-edit', params: { id: taskId } })
    return
  }
  if (action === 'toggle-task-status') {
    if (!taskActionProgress.value) return
    taskSheet.value = false
    taskStatusDialog.value = true
    return
  }
  if (action === 'log-additional-value') {
    const progress = taskActionProgress.value
    if (!progress) return
    taskSheet.value = false
    void openExact(progress, true)
    return
  }
  if (action === 'view-log-history') void openTaskLogHistory()
}

async function confirmTaskStatusChange() {
  const task = taskActionProgress.value?.task
  if (!task || taskStatusUpdating.value) return
  taskStatusUpdating.value = true
  try {
    await store.toggleTaskActive(task)
    taskStatusDialog.value = false
    taskActionProgress.value = undefined
  } finally {
    taskStatusUpdating.value = false
  }
}

async function openExact(progress: TaskProgress, additional = false) {
  exactProgress.value = progress
  exactEditingEntry.value = undefined
  exactLoggingAdditional.value = additional
  exactAmountInput.value = ''
  exactNote.value = ''
  exactNoteHistory.value = store.entries.filter((entry) => entry.task === progress.task.id)
  exactAction.value = undefined
  exactError.value = ''
  exactDialog.value = true

  if (!progress.task.entryNotesEnabled) return

  const request = ++exactNoteHistoryRequest
  exactNoteLoading.value = true
  try {
    const history = await store.loadEntryNoteHistory(progress.task.id)
    if (request === exactNoteHistoryRequest && exactProgress.value?.task.id === progress.task.id) {
      exactNoteHistory.value = history
    }
  } catch {
    // Recent entries already provide useful suggestions if full history cannot load.
  } finally {
    if (request === exactNoteHistoryRequest) exactNoteLoading.value = false
  }
}

function updateExactNote(value: unknown) {
  exactNote.value = sanitizeTaskEntryNote(value)
}

function editTaskLogEntry(entry: Entry) {
  const progress = taskActionProgress.value
  if (!progress || progress.sealed || busy.value || isHealthConnectEntry(entry)) return
  exactProgress.value = progress
  exactEditingEntry.value = entry
  exactLoggingAdditional.value = false
  exactAmountInput.value = String(Number(entry.value.toFixed(2)))
  exactNote.value = entry.note || ''
  exactNoteHistory.value = taskLogEntries.value
  exactNoteLoading.value = false
  exactAction.value = undefined
  exactError.value = ''
  exactDialog.value = true
}

function toggleExactSign() {
  if (!exactAmountInput.value || exactAmountInput.value === '0') return
  exactAmountInput.value = exactAmountInput.value.startsWith('-')
    ? exactAmountInput.value.slice(1)
    : `-${exactAmountInput.value}`
}

function requestTaskLogDeletion(entry: Entry) {
  if (taskActionProgress.value?.sealed || busy.value || isHealthConnectEntry(entry)) return
  taskLogDeleteEntry.value = entry
  taskLogDeleteDialog.value = true
}

async function confirmTaskLogDeletion() {
  const progress = taskActionProgress.value
  const entry = taskLogDeleteEntry.value
  if (!progress || !entry || busy.value) return
  taskLogError.value = ''
  try {
    await run(async () => {
      const deleted = await store.deleteEntry(progress, entry.id)
      if (!deleted) return
      taskLogEntries.value = taskLogEntries.value.filter(item => item.id !== entry.id)
      pulseProgressValue(progress)
    })
    taskLogDeleteDialog.value = false
    taskLogDeleteEntry.value = undefined
  } catch (cause) {
    taskLogError.value = cause instanceof Error ? cause.message : 'Could not delete this log entry.'
    taskLogDeleteDialog.value = false
    taskLogDeleteEntry.value = undefined
  }
}

function openTimeLogger(progress: TaskProgress) {
  void router.push({
    name: 'task-timer',
    params: { id: progress.task.id },
    query: { date: progress.scheduledDate },
  })
}

function intervalMeta(progress: TaskProgress) {
  const templateId = progress.programStep?.intervalTemplate || progress.task.intervalTemplate
  const template = intervalStore.templates.find((item) => item.id === templateId)
  if (!template) return undefined
  return {
    name: template.name,
    duration: formatIntervalDuration(intervalDuration(template.definition)),
  }
}

function reviewSetMeta(progress: TaskProgress) {
  const reviewSetId = progress.programStep?.flashcardReviewSet || progress.task.flashcardReviewSet
  const reviewSet = flashcardStore.reviewSets.find(item => item.id === reviewSetId)
  if (!reviewSet) return undefined
  return {
    name: reviewSet.name,
    mode: reviewSet.mode,
    cardCount: reviewSetCardCount(reviewSet),
  }
}

function reviewSessionMatchesProgress(progress: TaskProgress) {
  const active = flashcardStore.activeSession
  return active?.task === progress.task.id
    && (active.programStep || '') === (progress.programStep?.id || '')
    && active.taskDate === progress.scheduledDate
}

async function startFlashcardTask(progress: TaskProgress) {
  flashcardStartError.value = ''
  const active = flashcardStore.activeSession
  if (active) {
    if (reviewSessionMatchesProgress(progress)) {
      await router.push({
        name: 'flashcard-review-runner',
        params: { sessionId: active.id },
        query: { from: 'tasks', autoplay: '1' },
      })
    } else {
      activeReviewSheet.value = true
    }
    return
  }
  const reviewSetId = progress.programStep?.flashcardReviewSet || progress.task.flashcardReviewSet
  if (!reviewSetId) {
    flashcardStartError.value = 'This task or program step does not have an attached Review set.'
    return
  }
  await router.push({
    name: 'flashcard-review-set-runner',
    params: { reviewSetId },
    query: {
      task: progress.task.id,
      ...(progress.programStep ? { step: progress.programStep.id } : {}),
      date: progress.scheduledDate,
      from: 'tasks',
    },
  })
}

function sessionMatchesProgress(progress: TaskProgress) {
  const active = intervalStore.activeSession
  return active?.task === progress.task.id
    && (active.programStep || '') === (progress.programStep?.id || '')
}

async function startIntervalTask(progress: TaskProgress) {
  intervalStartError.value = ''
  const active = intervalStore.activeSession
  if (active) {
    if (sessionMatchesProgress(progress)) {
      await router.push({
        name: 'interval-runner',
        params: { sessionId: active.id },
        query: { from: 'tasks', autoplay: '1' },
      })
    } else {
      activeIntervalSheet.value = true
    }
    return
  }
  const templateId = progress.programStep?.intervalTemplate || progress.task.intervalTemplate
  if (!templateId) {
    intervalStartError.value = 'This task or program step does not have an attached interval.'
    return
  }
  await router.push({
    name: 'interval-template-runner',
    params: { templateId },
    query: {
      task: progress.task.id,
      ...(progress.programStep ? { step: progress.programStep.id } : {}),
      date: progress.scheduledDate,
      from: 'tasks',
    },
  })
}

async function resumeActiveInterval() {
  const active = intervalStore.activeSession
  if (!active) return
  activeIntervalSheet.value = false
  await router.push({
    name: 'interval-runner',
    params: { sessionId: active.id },
    query: { from: 'tasks', autoplay: '1' },
  })
}

async function resumeActiveReview() {
  const active = flashcardStore.activeSession
  if (!active) return
  activeReviewSheet.value = false
  await router.push({
    name: 'flashcard-review-runner',
    params: { sessionId: active.id },
    query: { from: 'tasks', autoplay: '1' },
  })
}

function pressKeypad(key: typeof keypadKeys[number]) {
  if (key === 'backspace') {
    exactAmountInput.value = exactAmountInput.value.slice(0, -1)
    return
  }
  if (key === '.') {
    if (!exactAmountInput.value.includes('.')) exactAmountInput.value = `${exactAmountInput.value || '0'}.`
    return
  }
  if (exactAmountInput.value.length >= 10) return
  exactAmountInput.value = exactAmountInput.value === '0' ? key : `${exactAmountInput.value}${key}`
}

async function submitExact(mode: 'add' | 'subtract' | 'set') {
  if (!exactProgress.value || exactAmount.value === null || busy.value) return
  if (mode === 'set' ? exactAmount.value < 0 : exactAmount.value <= 0) return
  const progress = exactProgress.value
  exactAction.value = mode
  const amount = mode === 'set'
    ? exactAmount.value - progress.value
    : mode === 'subtract'
      ? -exactAmount.value
      : exactAmount.value
  if (amount === 0) {
    if (mode === 'set') exactDialog.value = false
    return
  }
  try {
    await run(() => store.addEntry(
      progress,
      amount,
      mode === 'add' ? undefined : 'adjustment',
      progress.task.entryNotesEnabled ? exactNote.value.trim() : '',
    ))
    pulseProgressValue(progress)
    exactDialog.value = false
  } catch (cause) {
    exactError.value = cause instanceof Error ? cause.message : 'Could not save this log entry.'
  } finally {
    exactAction.value = undefined
  }
}

async function saveTaskLogEntry() {
  const progress = exactProgress.value
  const entry = exactEditingEntry.value
  if (!progress || !entry || !exactCanLogAmount.value || busy.value) return
  exactAction.value = 'save'
  exactError.value = ''
  try {
    await run(async () => {
      const updated = await store.updateEntry(
        progress,
        entry.id,
        exactAmount.value!,
        progress.task.entryNotesEnabled ? exactNote.value.trim() : entry.note || '',
      )
      if (!updated) return
      const index = taskLogEntries.value.findIndex(item => item.id === updated.id)
      if (index >= 0) taskLogEntries.value.splice(index, 1, updated)
      pulseProgressValue(progress)
    })
    exactDialog.value = false
    exactEditingEntry.value = undefined
  } catch (cause) {
    exactError.value = cause instanceof Error ? cause.message : 'Could not update this log entry.'
  } finally {
    exactAction.value = undefined
  }
}
</script>

<template>
  <main ref="taskPage" class="app-page today-page">
    <WeekDateNavigator
      v-model="selectedDate"
      v-model:week-start="visibleWeekStart"
      :markers="taskDateMarkers"
      class="mb-5"
    />

    <v-card class="score-card pa-5" color="surface">
      <div class="score-pattern" />
      <div class="position-relative d-flex align-center justify-space-between ga-4">
        <div>
          <div class="d-flex align-end ga-2 mt-2">
            <span class="score-number">{{ completionRate }}</span><span class="score-percent">%</span>
          </div>
          <p class="text-caption text-medium-emphasis mt-1">
            {{ doneCount }} of {{ selectedProgress.length }} scheduled tasks complete
          </p>
        </div>
        <v-progress-circular
          :model-value="completionRate"
          color="secondary"
          bg-color="#363A35"
          :size="92"
          :width="10"
        >
          <v-icon :icon="completionRate === 100 ? 'mdi-trophy' : 'mdi-arrow-top-right-thick'" color="secondary" size="30" />
        </v-progress-circular>
      </div>
      <v-btn
        v-if="reviewItems.length"
        size="small"
        variant="tonal"
        color="secondary"
        class="mt-5"
        prepend-icon="mdi-clipboard-check-outline"
        @click="reviewSheet = true"
      >
        Review {{ reviewItems.length }} open
      </v-btn>
    </v-card>

    <v-alert v-if="error" type="error" variant="tonal" class="mt-4">
      {{ error }}
      <template #append><v-btn size="small" variant="text" @click="store.load">Retry</v-btn></template>
    </v-alert>
    <v-alert v-if="intervalStartError" type="error" variant="tonal" class="mt-4">
      {{ intervalStartError }}
    </v-alert>
    <v-alert v-if="flashcardStartError" type="error" variant="tonal" class="mt-4">
      {{ flashcardStartError }}
    </v-alert>
    <template v-if="displayedProgress.length">
      <section v-if="required.length">
        <div class="section-heading task-section-heading">
          <h2>Tasks</h2>
          <div class="task-section-heading__controls">
            <v-btn
              size="small"
              :variant="taskFiltersActive ? 'tonal' : 'text'"
              :color="taskFiltersActive ? 'secondary' : undefined"
              prepend-icon="mdi-filter-variant"
              :aria-pressed="taskFiltersActive"
              @click="taskFiltersOpen = true"
            >
              Filter
            </v-btn>
            <v-btn size="small" variant="text" prepend-icon="mdi-plus" to="/tasks/new">
              New
            </v-btn>
          </div>
        </div>
        <TransitionGroup
          name="task-list"
          tag="div"
          class="task-stack"
          @before-leave="pinLeavingTaskCard"
          @after-leave="releaseLeavingTaskCard"
          @leave-cancelled="releaseLeavingTaskCard"
        >
          <div
            v-for="item in visibleRequired"
            :key="visibilityKey(item)"
            v-long-press-drag="{
              id: progressKey(item),
              group: 'required-task-cards',
              handle: '[data-task-drag-handle]',
              disabled: draggableTaskCount(visibleRequired) < 2 || busy || reorderingTasks,
              onDrop: result => reorderTaskCards(result, visibleRequired),
            }"
            class="task-masonry-item"
            :class="{ 'task-masonry-item--draggable': draggableTaskCount(visibleRequired) > 1 }"
          >
            <TaskCard
              :progress="item"
              :schedule-status="taskScheduleStatus(item)"
              :busy="progressIsBusy(item)"
              :value-pulse="valuePulseFor(item)"
              :syncing="item.task.type === 'step_counter' && stepCountLoading"
              :step-count-error="item.task.type === 'step_counter' ? stepCountError : ''"
              :interval="intervalMeta(item)"
              :can-start-interval="intervalCanStart(item)"
              :interval-active="sessionMatchesProgress(item)"
              :review-set="reviewSetMeta(item)"
              :can-start-review="progressIsToday(item) && item.status === 'pending'"
              :review-active="reviewSessionMatchesProgress(item)"
              :trackers="trackingMeta(item)"
              :can-log-tracking="trackingCanLog(item)"
              :can-write-journal="journalCanWrite(item)"
              @toggle="(progress, complete) => runForProgress(progress, () => store.toggleComplete(progress, complete))"
              @seal="progress => runForProgress(progress, () => store.setDailyTotalSealed(progress))"
              @log-amount="openExact"
              @log-time="openTimeLogger"
              @start-interval="startIntervalTask"
              @start-review="startFlashcardTask"
              @log-tracking="openTrackingLogger"
              @log-tracking-time="openTrackingTimeLogger"
              @write-journal="openJournalTask"
              @sync-steps="syncStepCount"
              @actions="openTaskActions"
            />
          </div>
        </TransitionGroup>
      </section>

      <section v-if="optional.length">
        <div class="section-heading task-section-heading">
          <h2>Extra credit</h2>
          <span v-if="required.length" class="text-caption muted">Optional</span>
          <div v-else class="task-section-heading__controls">
            <v-btn
              size="small"
              :variant="taskFiltersActive ? 'tonal' : 'text'"
              :color="taskFiltersActive ? 'secondary' : undefined"
              prepend-icon="mdi-filter-variant"
              :aria-pressed="taskFiltersActive"
              @click="taskFiltersOpen = true"
            >
              Filter
            </v-btn>
            <v-btn size="small" variant="text" prepend-icon="mdi-plus" to="/tasks/new">
              New
            </v-btn>
          </div>
        </div>
        <TransitionGroup
          name="task-list"
          tag="div"
          class="task-stack"
          @before-leave="pinLeavingTaskCard"
          @after-leave="releaseLeavingTaskCard"
          @leave-cancelled="releaseLeavingTaskCard"
        >
          <div
            v-for="item in visibleOptional"
            :key="visibilityKey(item)"
            v-long-press-drag="{
              id: progressKey(item),
              group: 'optional-task-cards',
              handle: '[data-task-drag-handle]',
              disabled: draggableTaskCount(visibleOptional) < 2 || busy || reorderingTasks,
              onDrop: result => reorderTaskCards(result, visibleOptional),
            }"
            class="task-masonry-item"
            :class="{ 'task-masonry-item--draggable': draggableTaskCount(visibleOptional) > 1 }"
          >
            <TaskCard
              :progress="item"
              :schedule-status="taskScheduleStatus(item)"
              :busy="progressIsBusy(item)"
              :value-pulse="valuePulseFor(item)"
              :syncing="item.task.type === 'step_counter' && stepCountLoading"
              :step-count-error="item.task.type === 'step_counter' ? stepCountError : ''"
              :interval="intervalMeta(item)"
              :can-start-interval="intervalCanStart(item)"
              :interval-active="sessionMatchesProgress(item)"
              :review-set="reviewSetMeta(item)"
              :can-start-review="progressIsToday(item) && item.status === 'pending'"
              :review-active="reviewSessionMatchesProgress(item)"
              :trackers="trackingMeta(item)"
              :can-log-tracking="trackingCanLog(item)"
              :can-write-journal="journalCanWrite(item)"
              @toggle="(progress, complete) => runForProgress(progress, () => store.toggleComplete(progress, complete))"
              @seal="progress => runForProgress(progress, () => store.setDailyTotalSealed(progress))"
              @log-amount="openExact"
              @log-time="openTimeLogger"
              @start-interval="startIntervalTask"
              @start-review="startFlashcardTask"
              @log-tracking="openTrackingLogger"
              @log-tracking-time="openTrackingTimeLogger"
              @write-journal="openJournalTask"
              @sync-steps="syncStepCount"
              @actions="openTaskActions"
            />
          </div>
        </TransitionGroup>
      </section>
    </template>

    <v-card v-else-if="!loading" class="surface-card empty-card pa-8 mt-6 text-center">
      <div class="empty-icon mx-auto mb-4"><v-icon icon="mdi-arm-flex-outline" size="32" /></div>
      <h2 class="text-h6 font-weight-black">No tasks scheduled</h2>
      <p class="text-body-2 muted mt-2 mb-5">
        {{ store.tasks.length
          ? 'Use the filter to see routines that are not scheduled for this day.'
          : 'Build your first routine and it will show up here.' }}
      </p>
      <div class="d-flex flex-wrap justify-center ga-2">
        <v-btn
          v-if="store.tasks.length"
          variant="tonal"
          prepend-icon="mdi-filter-variant"
          @click="taskFiltersOpen = true"
        >
          Filter
        </v-btn>
        <v-btn color="secondary" prepend-icon="mdi-plus" to="/tasks/new">
          {{ store.tasks.length ? 'New' : 'Create a task' }}
        </v-btn>
      </div>
    </v-card>

    <v-dialog
      v-model="exactDialog"
      max-width="440"
      :transition="smAndUp ? 'dialog-transition' : 'digit-pad-scale-transition'"
    >
      <v-card class="pa-5">
        <div class="d-flex align-center justify-space-between mb-5">
          <div class="min-width-0">
            <h2 class="text-h6 font-weight-black">{{ exactEditingEntry ? 'Edit log entry' : exactLoggingAdditional ? 'Log additional value' : 'Log amount' }}</h2>
            <p class="text-body-2 muted text-truncate mt-1">{{ exactProgress?.programStep?.name || exactProgress?.task.name }}</p>
          </div>
          <v-btn icon="mdi-close" variant="text" aria-label="Close amount logger" @click="exactDialog = false" />
        </div>
        <v-alert v-if="exactError" type="error" variant="tonal" density="compact" class="mb-4">
          {{ exactError }}
        </v-alert>
        <div class="amount-entry mb-4">
          <v-number-input
            v-if="smAndUp"
            v-model="exactDesktopAmount"
            label="Amount"
            :precision="null"
            :min="exactEditingEntry ? undefined : 0"
            :autofocus="allowAutomaticFocus"
            :error-messages="exactAmountError"
          />
          <div v-else class="amount-keypad">
            <div class="amount-keypad__display">
              <v-btn
                v-if="exactEditingEntry"
                icon="mdi-plus-minus-variant"
                variant="text"
                aria-label="Change amount sign"
                @click="toggleExactSign"
              />
              <output aria-live="polite">{{ exactAmountInput || '0' }}</output>
            </div>
            <div class="amount-keypad__keys">
              <v-btn
                v-for="key in keypadKeys"
                :key="key"
                size="large"
                variant="tonal"
                :aria-label="key === 'backspace' ? 'Delete last digit' : key === '.' ? 'Decimal point' : key"
                :disabled="key === '.' && exactAmountInput.includes('.')"
                @click="pressKeypad(key)"
              >
                <v-icon v-if="key === 'backspace'" icon="mdi-backspace-outline" />
                <template v-else>{{ key }}</template>
              </v-btn>
            </div>
            <p v-if="exactAmountError" class="text-caption text-error mt-2">
              {{ exactAmountError }}
            </p>
          </div>
        </div>
        <v-combobox
          v-if="exactProgress?.task.entryNotesEnabled"
          :model-value="exactNote"
          :items="exactNoteOptions"
          :loading="exactNoteLoading"
          label="Note (optional)"
          clearable
          :maxlength="TASK_ENTRY_NOTE_MAX_LENGTH"
          hint="Choose a previous note or type a new one"
          persistent-hint
          class="mb-4"
          @update:model-value="updateExactNote"
        />
        <v-btn
          v-if="exactEditingEntry"
          block
          size="large"
          color="secondary"
          :loading="busy && exactAction === 'save'"
          :disabled="!exactCanLogAmount || busy"
          @click="saveTaskLogEntry"
        >
          Save
        </v-btn>
        <div v-else class="exact-actions">
          <v-btn
            block
            size="large"
            class="exact-action exact-action--add"
            color="secondary"
            aria-label="Add"
            :loading="busy && exactAction === 'add'"
            :disabled="!exactCanAdjustAmount || busy"
            @click="submitExact('add')"
          >
            Add
          </v-btn>
          <v-btn
            block
            size="large"
            class="exact-action exact-action--subtract"
            variant="tonal"
            color="error"
            aria-label="Subtract"
            :loading="busy && exactAction === 'subtract'"
            :disabled="!exactCanAdjustAmount || busy"
            @click="submitExact('subtract')"
          >
              Subtract
            <!-- <v-icon icon="mdi-minus" /> -->
          </v-btn>
          <v-btn
            block
            size="large"
            class="exact-action exact-action--set"
            variant="tonal"
            :loading="busy && exactAction === 'set'"
            :disabled="!exactCanSetAmount || busy"
            @click="submitExact('set')"
          >
            Set
          </v-btn>
        </div>
      </v-card>
    </v-dialog>

    <TrackingLogBottomSheet
      v-model="trackingSheetOpen"
      :tracker="trackingSheetTracker"
      :date="trackingSheetDate"
      :context="trackingSheetContext"
    />

    <ActionBottomSheet
      v-model="taskFiltersOpen"
      title="Task filters"
      hide-title
      aria-label="Task filters"
    >
      <v-list-item
        v-for="filter in TASK_FILTER_ITEMS"
        :key="filter.id"
        :title="filter.title"
        rounded="lg"
        @click="toggleTaskFilter(filter.id)"
      >
        <template #append>
          <v-checkbox-btn
            :model-value="taskFilterEnabled(filter.id)"
            color="secondary"
            hide-details="auto"
            :aria-label="filter.ariaLabel"
            @click.stop="toggleTaskFilter(filter.id)"
          />
        </template>
      </v-list-item>
    </ActionBottomSheet>

    <ActionBottomSheet
      v-model="taskSheet"
      :title="taskSheetMode === 'history' ? 'Log history' : taskActionTitle"
      :description="taskSheetDescription"
      :hide-title="taskSheetMode === 'actions'"
      :aria-label="taskSheetMode === 'history' ? `${taskActionTitle} log history` : `${taskActionTitle} actions`"
    >
      <template v-if="taskActionProgress && taskSheetMode === 'actions'">
        <template v-for="action in taskCardActionItems" :key="action.id">
          <v-list-item
            :prepend-icon="action.icon"
            :title="action.title"
            rounded="lg"
            @click="runTaskCardAction(action.id)"
          />
          <v-divider v-if="action.id === 'log-additional-value'" class="my-2" />
        </template>
      </template>
      <template v-else-if="taskSheetMode === 'history'">
        <v-list-item
          v-if="taskLogLoading"
          prepend-icon="mdi-history"
          title="Loading log history…"
        >
          <template #append><v-progress-circular indeterminate color="secondary" :size="22" :width="2" /></template>
        </v-list-item>
        <div v-else-if="taskLogError" class="px-2 py-2">
          <v-alert type="error" variant="tonal" density="compact">
            {{ taskLogError }}
            <template #append>
              <v-btn size="small" variant="text" @click="openTaskLogHistory">Retry</v-btn>
            </template>
          </v-alert>
        </div>
        <template v-else-if="taskLogEntries.length">
          <v-list-item
            v-for="entry in taskLogEntries"
            :key="entry.id"
            :prepend-icon="taskEntryIcon(entry)"
            :title="entry.note || taskEntryKindLabel(entry)"
            rounded="lg"
          >
            <template #subtitle>
              <span>{{ taskEntrySubtitle(entry) }} · {{ taskEntryValue(entry) }}</span>
            </template>
            <template #append>
              <div v-if="!isHealthConnectEntry(entry)" class="task-log-actions">
                <v-btn
                  icon="mdi-pencil-outline"
                  variant="text"
                  class="task-log-action"
                  :disabled="busy || taskActionProgress?.sealed"
                  :aria-label="`Edit ${taskEntryValue(entry)} log entry`"
                  @touchstart.stop
                  @click.stop="editTaskLogEntry(entry)"
                />
                <v-btn
                  icon="mdi-delete-outline"
                  variant="text"
                  color="error"
                  class="task-log-action"
                  :disabled="busy || taskActionProgress?.sealed"
                  :aria-label="`Delete ${taskEntryValue(entry)} log entry`"
                  @touchstart.stop
                  @click.stop="requestTaskLogDeletion(entry)"
                />
              </div>
            </template>
          </v-list-item>
        </template>
        <div v-else class="task-log-empty px-4 py-8 text-center">
          <v-icon icon="mdi-history" size="34" color="medium-emphasis" />
          <h3 class="text-body-1 font-weight-black mt-3">No entries logged</h3>
          <p class="text-body-2 muted mt-1">This task has no log entries for the selected day.</p>
        </div>
      </template>
    </ActionBottomSheet>

    <ConfirmDialog
      v-model="taskStatusDialog"
      :title="taskActionProgress?.task.active ? 'Pause this task?' : 'Unpause this task?'"
      :message="taskActionProgress?.task.active
        ? `${taskActionProgress?.task.name || 'This task'} will stop appearing in your schedule until you unpause it. Its history will be preserved.`
        : `${taskActionProgress?.task.name || 'This task'} will return to its schedule based on its recurrence settings.`"
      :confirm-text="taskActionProgress?.task.active ? 'Pause task' : 'Unpause task'"
      :confirm-color="taskActionProgress?.task.active ? 'warning' : 'secondary'"
      :icon="taskActionProgress?.task.active ? 'mdi-pause' : 'mdi-play'"
      :loading="taskStatusUpdating"
      @confirm="confirmTaskStatusChange"
    />

    <ConfirmDialog
      v-model="taskLogDeleteDialog"
      title="Delete log entry?"
      :message="taskLogDeleteEntry
        ? `Delete ${taskEntryValue(taskLogDeleteEntry)} logged at ${taskEntryTime(taskLogDeleteEntry)}? This cannot be undone.`
        : 'This log entry will be permanently deleted.'"
      confirm-text="Delete"
      icon="mdi-delete-outline"
      :loading="busy"
      @confirm="confirmTaskLogDeletion"
    />

    <ActionBottomSheet
      v-model="reviewSheet"
      title="Resolve open work"
      aria-label="Resolve open task actions"
    >
      <div v-for="item in reviewItems" :key="`${item.task.id}-${item.programStep?.id || ''}`" class="review-row px-2 py-3">
        <div class="flex-grow-1"><strong>{{ item.programStep?.name || item.task.name }}</strong><p class="text-caption muted">Choose how this attempt ends.</p></div>
        <div class="review-actions">
          <v-btn
            size="large"
            variant="tonal"
            color="error"
            prepend-icon="mdi-close-circle-outline"
            :disabled="busy"
            @click="resolveReview(item, 'missed')"
          >
            Mark missed
          </v-btn>
          <v-btn
            size="large"
            variant="tonal"
            prepend-icon="mdi-arrow-right-bold"
            :disabled="busy"
            @click="resolveReview(item, 'carried')"
          >
            Carry forward
          </v-btn>
          <v-btn
            v-if="item.programStep"
            size="large"
            variant="tonal"
            prepend-icon="mdi-calendar-arrow-right"
            :disabled="busy"
            @click="run(() => store.shiftProgram(item))"
          >
            Shift program
          </v-btn>
        </div>
      </div>
    </ActionBottomSheet>

    <ActionBottomSheet
      v-model="activeIntervalSheet"
      title="Interval already running"
      aria-label="Active interval actions"
    >
      <div class="px-2 py-3">
        <p class="text-body-2 muted mb-4">
          {{ intervalStore.activeSession?.name || 'Another interval' }} is already in progress. Finish or end it before starting a different task.
        </p>
        <v-btn block color="secondary" prepend-icon="mdi-play" @click="resumeActiveInterval">
          Resume active interval
        </v-btn>
      </div>
    </ActionBottomSheet>

    <ActionBottomSheet
      v-model="activeReviewSheet"
      title="Review already running"
      aria-label="Active flashcard review actions"
    >
      <div class="px-2 py-3">
        <p class="text-body-2 muted mb-4">
          {{ flashcardStore.activeSession?.name || 'Another review' }} is already in progress. Finish or end it before starting a different task.
        </p>
        <v-btn block color="secondary" prepend-icon="mdi-play" @click="resumeActiveReview">
          Resume active review
        </v-btn>
      </div>
    </ActionBottomSheet>
  </main>
</template>

<style scoped>
.score-card { position: relative; overflow: hidden; }
.score-pattern { position: absolute; top: -70px; right: -40px; width: 220px; height: 220px; border: 35px solid rgba(199,244,100,.07); border-radius: 50%; }
.score-number { font-family: Impact, "Arial Narrow", sans-serif; font-size: 3.2rem; line-height: .9; letter-spacing: -.03em; }
.score-percent { color: #c7f464; font-size: 1.2rem; font-weight: 900; }
.task-section-heading { flex-wrap: wrap; gap: .75rem; }
.task-section-heading__controls { display: flex; min-width: 0; margin-left: auto; align-items: center; justify-content: flex-end; }
.task-stack {
  --task-card-gap: .7rem;

  position: relative;
  display: grid;
  gap: 0;
}
.task-stack:has(> .task-masonry-item) { margin-bottom: calc(0rem - var(--task-card-gap)); }
.task-masonry-item {
  display: grid;
  min-width: 0;
  margin-bottom: var(--task-card-gap);
  border-radius: 1.5rem;
  grid-template-rows: 1fr;
  transition: margin-bottom .22s cubic-bezier(.22, 1, .36, 1);
}
.task-masonry-item > * { min-height: 0; }
.task-masonry-item.long-press-drag-ghost { overflow: hidden; }
.task-stack :deep(.long-press-drag-placeholder) { margin-bottom: var(--task-card-gap); }
.task-masonry-item--draggable :deep([data-task-drag-handle]) { cursor: grab; }
.task-list-enter-active,
.task-list-leave-active {
  overflow: hidden;
  transition:
    grid-template-rows .22s cubic-bezier(.22, 1, .36, 1),
    margin-bottom .22s cubic-bezier(.22, 1, .36, 1),
    opacity .18s ease;
}
.task-list-enter-from,
.task-list-leave-to { margin-bottom: 0; grid-template-rows: 0fr; opacity: 0; }
.task-list-enter-from:only-child,
.task-list-leave-to:only-child { margin-bottom: var(--task-card-gap); }
.task-list-move {
  transition:
    transform .22s cubic-bezier(.22, 1, .36, 1),
    margin-bottom .22s cubic-bezier(.22, 1, .36, 1);
}
.empty-icon { display: grid; width: 64px; height: 64px; place-items: center; border-radius: 20px; background: #c7f464; color: #17200f; }
.amount-keypad { display: grid; gap: 1rem; }
.amount-keypad__display { display: flex; min-height: 72px; align-items: center; justify-content: space-between; padding: .75rem 1rem; border: 1px solid rgb(var(--v-theme-on-surface) / .16); border-radius: 16px; background: rgb(var(--v-theme-surface-variant)); font-size: 2rem; font-weight: 900; line-height: 1; }
.amount-keypad__display output { margin-left: auto; }
.amount-keypad__keys { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .65rem; }
.amount-keypad__keys .v-btn { min-width: 0; height: 54px; font-size: 1.05rem; font-weight: 850; }
.exact-actions {
  display: grid;
  grid-template:
    "set add" 44px
    "subtract add" 44px
    / minmax(0, 1fr) minmax(0, 1fr);
  gap: .5rem;
}
.exact-action { height: 100% !important; }
.exact-action--subtract { grid-area: subtract; }
.exact-action--add { grid-area: add; }
.exact-action--set { grid-area: set; }
.task-log-actions { display: flex; align-items: center; }
.task-log-action { width: 2.75rem !important; min-width: 2.75rem !important; height: 2.75rem !important; }
.task-log-value { display: block; margin-top: .125rem; color: rgb(var(--v-theme-on-surface)); font-size: .8rem; white-space: nowrap; }
.task-log-empty { min-height: 10rem; }
.review-row { display: flex; flex-direction: column; align-items: stretch; gap: 1rem; border-top: 1px solid rgba(255,255,255,.08); }
.review-actions { display: grid; gap: .5rem; }
.review-actions .v-btn { width: 100%; }

@media (prefers-reduced-motion: reduce) {
  .task-masonry-item,
  .task-list-enter-active,
  .task-list-leave-active,
  .task-list-move { transition-duration: 0s; }
}

@media (min-width: 700px) {
  .task-stack { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .review-actions { grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); }
}

@media (min-width: 960px) {
  .task-stack {
    display: block;
    column-count: 2;
    column-gap: .7rem;
  }

  .task-masonry-item {
    width: 100%;
    break-inside: avoid;
  }
}

</style>
