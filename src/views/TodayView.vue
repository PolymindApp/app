<script setup lang="ts">
import { Capacitor } from '@capacitor/core'
import { App } from '@capacitor/app'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { addDays, format, isAfter, parseISO, startOfDay, startOfWeek } from 'date-fns'
import { storeToRefs } from 'pinia'
import { useDisplay } from 'vuetify'
import { useRouter } from 'vue-router'
import ActionBottomSheet from '@/components/ActionBottomSheet.vue'
import AppDialog from '@/components/AppDialog.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import StickyActionBanner from '@/components/StickyActionBanner.vue'
import TaskCard from '@/components/TaskCard.vue'
import TaskImageLogBottomSheet from '@/components/TaskImageLogBottomSheet.vue'
import TrackingLogBottomSheet from '@/components/TrackingLogBottomSheet.vue'
import WeekDateNavigator from '@/components/WeekDateNavigator.vue'
import type { LongPressDragResult } from '@/directives/longPressDrag'
import { reviewSetCardCount } from '@/services/flashcards'
import { isNativeHealthConnectSupported } from '@/services/healthConnect'
import { isHealthConnectEntry } from '@/services/healthConnectEntries'
import { formatIntervalDuration, intervalDuration } from '@/services/intervals'
import { bottomAlignedTaskScrollTop, nextIncompleteTaskKey } from '@/services/nextIncompleteTask'
import { taskCompletionMarkerColor, toDateKey } from '@/services/schedule'
import { TASK_CARD_ACTION_ITEMS, taskCanLogAdditionalValue, taskCanLogAmounts, taskIntervalCanStart } from '@/services/taskCardActions'
import type { TaskCardActionId } from '@/services/taskCardActions'
import { formatTrackingValue } from '@/services/tracking'
import {
  formatTaskScheduleTime,
  groupTaskProgressBySchedule,
  taskScheduledTime,
  tasksWithoutProgress,
} from '@/services/taskScheduleLayout'
import { taskIdsFromProgressDrag, taskProgressDragKey } from '@/services/taskReordering'
import { TASK_TYPE_PRESENTATION } from '@/services/taskTypes'
import { useIntervalStore } from '@/stores/intervals'
import { useFlashcardStore } from '@/stores/flashcards'
import { useJournalStore } from '@/stores/journal'
import { useTaskStore } from '@/stores/tasks'
import { useTrackingStore } from '@/stores/tracking'
import type {
  Entry,
  TaskLogImage,
  ProgramStepCompletionProgress,
  ProgramStepRequirementListItem,
  TaskProgress,
  TrackingTracker,
} from '@/types/domain'

const allowAutomaticFocus = Capacitor.getPlatform() !== 'android'
const HEALTH_CONNECT_RESUME_DELAY_MS = 500
const NEXT_TASK_SCROLL_GAP_REM = 1
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
const exactCompletionId = ref('')
const exactCompletion = computed(() => exactProgress.value?.completionItems?.find(
  item => item.id === exactCompletionId.value,
))
const exactAmountInput = ref('')
const exactEditingEntry = ref<Entry>()
const exactLoggingAdditional = ref(false)
const exactError = ref('')
const exactAction = ref<'add' | 'subtract' | 'set' | 'save'>()
const imageLogSheet = ref(false)
const imageLogProgress = ref<TaskProgress>()
const imageLogCompletionId = ref('')
const todayPage = ref<HTMLElement>()
const nextIncompleteProgress = ref<TaskProgress>()
const reviewSheet = ref(false)
const taskSheet = ref(false)
const taskSheetMode = ref<'actions' | 'history'>('actions')
const taskActionProgress = ref<TaskProgress>()
const taskStatusDialog = ref(false)
const taskStatusUpdating = ref(false)
const taskSkipDialog = ref(false)
const taskSkipUpdating = ref(false)
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
const valuePulseVersions = ref<Record<string, number>>({})
const notScheduledExpanded = ref(false)
const reorderingTasks = ref(false)
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
const taskActionTitle = computed(() =>
  taskActionProgress.value?.programStep?.name
    || taskActionProgress.value?.task.name
    || 'Task actions',
)
const taskSheetDescription = computed(() => taskSheetMode.value === 'history'
  ? `${taskActionTitle.value} · ${format(selectedDate.value, 'EEEE, MMMM d')}`
  : undefined)
type TaskMainActionId =
  | 'toggle-complete'
  | 'start-interval'
  | 'start-review'
  | 'log-amount'
  | 'log-with-image'
  | 'log-time'
  | 'toggle-total-lock'
  | 'sync-steps'
  | 'write-journal'

interface TaskMainActionItem {
  id: TaskMainActionId
  title: string
  icon: string
  disabled?: boolean
}

function completionSourceName(completion: ProgramStepCompletionProgress) {
  if (completion.type === 'interval') {
    return intervalStore.templates.find(item => item.id === completion.intervalTemplate)?.name
      || 'Saved interval'
  }
  if (completion.type === 'flashcards') {
    return flashcardStore.reviewSets.find(item => item.id === completion.flashcardReviewSet)?.name
      || 'Review set'
  }
  return completion.type === 'quantity' ? 'Quantity target' : 'Check-off'
}

function completionValueLabel(completion: ProgramStepCompletionProgress) {
  const unit = completion.customUnit || completion.unit || ''
  return `${Number(completion.value.toFixed(2))} of ${completion.targetValue ?? 0}${unit ? ` ${unit}` : ''}`
}

function programStepRequirementItems(progress: TaskProgress): ProgramStepRequirementListItem[] {
  const completions = progress.completionItems || []
  return completions.map((completion, index) => {
    const sourceName = completionSourceName(completion)
    const title = completions.length > 1 ? `${index + 1}. ${sourceName}` : sourceName
    const locked = Boolean(progress.locked)

    if (completion.type === 'check') {
      return {
        id: completion.id,
        title,
        subtitle: completion.complete ? 'Checked off' : 'Not checked off',
        icon: completion.complete ? 'mdi-check-circle' : 'mdi-check-circle-outline',
        complete: completion.complete,
        disabled: locked,
      }
    }

    if (completion.type === 'quantity') {
      return {
        id: completion.id,
        title,
        subtitle: completionValueLabel(completion),
        icon: 'mdi-plus-minus-variant',
        complete: completion.complete,
        disabled: locked || Boolean(progress.sealed),
      }
    }

    if (completion.type === 'interval') {
      const interval = intervalMeta(progress, completion)
      return {
        id: completion.id,
        title,
        subtitle: [completion.complete ? 'Complete' : '', interval?.duration ? `${interval.duration} total` : 'Saved interval unavailable']
          .filter(Boolean)
          .join(' · '),
        icon: completion.complete ? 'mdi-check-circle' : 'mdi-timer-play-outline',
        color: interval?.color || TASK_TYPE_PRESENTATION.interval.color,
        complete: completion.complete,
        disabled: locked || (!completion.complete && !intervalCanStart(progress)),
      }
    }

    const reviewSet = reviewSetMeta(progress, completion)
    const cardLabel = reviewSet?.cardCount === 1 ? 'card' : 'cards'
    const reviewDetails = reviewSet
      ? `${reviewSet.mode === 'passive' ? 'Passive' : 'Manual'} · ${reviewSet.cardCount} ${cardLabel}`
      : 'Review set unavailable'
    return {
      id: completion.id,
      title,
      subtitle: [completion.complete ? 'Complete' : '', reviewDetails].filter(Boolean).join(' · '),
      icon: completion.complete ? 'mdi-check-circle' : 'mdi-cards-playing-outline',
      color: TASK_TYPE_PRESENTATION.flashcards.color,
      complete: completion.complete,
      disabled: locked || (!completion.complete && (
        !progressIsToday(progress)
        || progress.status !== 'pending'
        || !reviewSet?.cardCount
      )),
    }
  })
}

const taskActionIsScheduled = computed(() => {
  const progress = taskActionProgress.value
  return Boolean(progress && selectedProgress.value.some(item => progressKey(item) === progressKey(progress)))
})
const taskMainActionItems = computed<TaskMainActionItem[]>(() => {
  const progress = taskActionProgress.value
  if (!progress || !taskActionIsScheduled.value || progress.status === 'skipped') return []
  const items: TaskMainActionItem[] = []
  if (progress.programStep) return items
  const completionType = progress.programStep?.completionType || progress.task.type
  const completionDriven = ['check', 'interval', 'flashcards'].includes(completionType)
  const locked = Boolean(progress.locked)

  if (completionDriven && progress.complete) {
    items.push({ id: 'toggle-complete', title: 'Undone', icon: 'mdi-undo-variant', disabled: locked })
    return items
  }

  if (completionType === 'interval' && intervalCanStart(progress)) {
    items.push({
      id: 'start-interval',
      title: sessionMatchesProgress(progress) ? 'Resume interval' : 'Start interval',
      icon: 'mdi-play',
      disabled: locked,
    })
  }
  if (completionType === 'flashcards' && progressIsToday(progress) && progress.status === 'pending') {
    items.push({
      id: 'start-review',
      title: reviewSessionMatchesProgress(progress) ? 'Resume review' : 'Start review',
      icon: 'mdi-cards-playing-outline',
      disabled: locked || !reviewSetMeta(progress)?.cardCount,
    })
  }
  if (completionDriven) {
    items.push({ id: 'toggle-complete', title: 'Done', icon: 'mdi-check-bold', disabled: locked })
  }

  if (taskCanLogAmounts(progress)) {
    items.push({
      id: 'log-amount',
      title: 'Log amount',
      icon: 'mdi-plus-minus-variant',
      disabled: locked || Boolean(progress.sealed),
    })
    if (progress.task.logWithImagesEnabled) {
      items.push({
        id: 'log-with-image',
        title: 'Log with image',
        icon: 'mdi-image-plus-outline',
        disabled: locked || Boolean(progress.sealed),
      })
    }
    if (!progress.programStep && progress.task.type === 'duration') {
      items.push({
        id: 'log-time',
        title: 'Log time',
        icon: 'mdi-timer-outline',
        disabled: locked || Boolean(progress.sealed),
      })
    }
  }
  if (!progress.programStep && progress.task.type === 'daily_total') {
    items.push({
      id: 'toggle-total-lock',
      title: progress.sealed ? 'Unlock total' : 'Lock in total',
      icon: progress.sealed ? 'mdi-lock-open-variant-outline' : 'mdi-lock-check-outline',
      disabled: locked,
    })
  }
  if (!progress.programStep && progress.task.type === 'step_counter') {
    items.push({
      id: 'sync-steps',
      title: stepCountLoading.value ? 'Syncing steps…' : 'Sync Health Connect',
      icon: 'mdi-heart-pulse',
      disabled: stepCountLoading.value,
    })
    items.push({
      id: 'log-amount',
      title: 'Log additional value',
      icon: 'mdi-plus-minus-variant',
      disabled: locked,
    })
    if (progress.task.logWithImagesEnabled) {
      items.push({
        id: 'log-with-image',
        title: 'Log with image',
        icon: 'mdi-image-plus-outline',
        disabled: locked,
      })
    }
  }
  if (!progress.programStep && progress.task.type === 'journal' && journalCanWrite(progress)) {
    items.push({
      id: 'write-journal',
      title: progress.complete ? 'Write another reflection' : 'Write reflection',
      icon: 'mdi-notebook-edit-outline',
      disabled: locked,
    })
  }
  return items
})
const taskCardActionItems = computed(() => TASK_CARD_ACTION_ITEMS.filter((action) =>
  action.id === 'skip-task'
    ? taskActionIsScheduled.value
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
  : action.id === 'skip-task'
    ? {
        ...action,
        title: taskActionProgress.value?.status === 'skipped' ? 'Unskip' : 'Skip',
        icon: taskActionProgress.value?.status === 'skipped' ? 'mdi-backup-restore' : 'mdi-skip-next-outline',
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
const scheduleLayout = computed(() => groupTaskProgressBySchedule(selectedProgress.value))
const allDayProgress = computed(() => scheduleLayout.value.allDay)
const timedProgressGroups = computed(() => scheduleLayout.value.timed)
const progressByVisibilityKey = computed(() => new Map(
  selectedProgress.value.map(progress => [visibilityKey(progress), progress]),
))
const reviewItems = computed(() => store.reviewProgressForDate(selectedDate.value))
const scoredProgress = computed(() => selectedProgress.value.filter(item => item.status !== 'skipped'))
const doneCount = computed(() => scoredProgress.value.filter((item) => item.complete).length)
const taskLogImageDeckByTask = computed(() => {
  const imageById = new Map(store.taskLogImages.map(item => [item.id, item]))
  const decks = new Map<string, TaskLogImage[]>()
  for (const progress of selectedProgress.value) {
    const deck = store.entriesFor(progress.task, selectedDate.value, progress.programStep)
      .map(item => item.taskLogImage)
      .filter((id): id is string => Boolean(id))
      .map(id => imageById.get(id))
      .filter((image): image is TaskLogImage => Boolean(image))
    if (deck.length) decks.set(visibilityKey(progress), deck)
  }
  return decks
})
const tasksWithImageLogEntries = computed(() => Array.from(new Set(selectedProgress.value.flatMap((progress) => {
  const hasImageEntry = store.entriesFor(
    progress.task,
    selectedDate.value,
    progress.programStep,
  ).some(entry => Boolean(entry.taskLogImage))
  return hasImageEntry ? [progress.task.id] : []
}))))
const loadedTaskLogImageTasks = new Set<string>()
const loadingTaskLogImageTasks = new Set<string>()

watch(tasksWithImageLogEntries, (taskIds) => {
  const pendingTaskIds = taskIds.filter((taskId) => (
    !loadedTaskLogImageTasks.has(taskId)
    && !loadingTaskLogImageTasks.has(taskId)
  ))
  if (!pendingTaskIds.length) return
  for (const taskId of pendingTaskIds) loadingTaskLogImageTasks.add(taskId)
  void Promise.all(pendingTaskIds.map(async (taskId) => {
    try {
      await store.loadTaskLogImages(taskId)
      loadedTaskLogImageTasks.add(taskId)
    } finally {
      loadingTaskLogImageTasks.delete(taskId)
    }
  }))
}, { immediate: true })
let appStateListener: Awaited<ReturnType<typeof App.addListener>> | undefined
let stepCountResumeTimer: ReturnType<typeof setTimeout> | undefined
let nextTaskFrame = 0
let nextTaskResizeObserver: ResizeObserver | undefined

function scheduleNextIncompleteTask() {
  window.cancelAnimationFrame(nextTaskFrame)
  nextTaskFrame = window.requestAnimationFrame(updateNextIncompleteTask)
}

function updateNextIncompleteTask() {
  nextTaskFrame = 0
  const page = todayPage.value
  if (!page) return

  const taskElements = [...page.querySelectorAll<HTMLElement>('[data-task-progress-key]')]
  taskElements.forEach(element => nextTaskResizeObserver?.observe(element))

  const appBarBottom = document.querySelector<HTMLElement>('.app-bar')
    ?.getBoundingClientRect().bottom ?? 0
  const bottomNavigationTop = document.querySelector<HTMLElement>('.bottom-nav')
    ?.getBoundingClientRect().top ?? window.innerHeight
  const bannerTop = page.querySelector<HTMLElement>('.next-incomplete-task-banner')
    ?.getBoundingClientRect().top
  const visibleBottom = bannerTop === undefined
    ? bottomNavigationTop
    : Math.min(bannerTop, bottomNavigationTop)
  const scrollingElement = document.scrollingElement ?? document.documentElement
  const atPageBottom = scrollingElement.scrollTop + scrollingElement.clientHeight
    >= scrollingElement.scrollHeight - 1
  const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
  const key = nextIncompleteTaskKey(
    taskElements.flatMap((element) => {
      const progressKey = element.dataset.taskProgressKey
      const progress = progressKey ? progressByVisibilityKey.value.get(progressKey) : undefined
      if (!progressKey || !progress) return []
      const bounds = element.getBoundingClientRect()
      return [{
        key: progressKey,
        incomplete: !progress.complete && progress.status !== 'skipped',
        top: bounds.top,
        left: bounds.left,
        bottom: bounds.bottom,
      }]
    }),
    appBarBottom,
    visibleBottom,
    window.scrollY <= 1,
    NEXT_TASK_SCROLL_GAP_REM * rootFontSize,
    atPageBottom,
  )
  const nextProgress = key ? progressByVisibilityKey.value.get(key) : undefined

  if (nextProgress === nextIncompleteProgress.value) return
  nextIncompleteProgress.value = nextProgress
  void nextTick(scheduleNextIncompleteTask)
}

function scrollToNextIncompleteTask() {
  const progress = nextIncompleteProgress.value
  const page = todayPage.value
  if (!progress || !page) return
  const key = visibilityKey(progress)
  const target = [...page.querySelectorAll<HTMLElement>('[data-task-progress-key]')]
    .find(element => element.dataset.taskProgressKey === key)
  if (!target) return
  const bannerTop = page.querySelector<HTMLElement>('.next-incomplete-task-banner')
    ?.getBoundingClientRect().top
  const bottomNavigationTop = document.querySelector<HTMLElement>('.bottom-nav')
    ?.getBoundingClientRect().top ?? window.innerHeight
  const containerBottom = bannerTop === undefined
    ? bottomNavigationTop
    : Math.min(bannerTop, bottomNavigationTop)
  const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  window.scrollTo({
    top: bottomAlignedTaskScrollTop(
      window.scrollY,
      target.getBoundingClientRect().bottom,
      containerBottom,
      NEXT_TASK_SCROLL_GAP_REM * rootFontSize,
    ),
    behavior: reducedMotion ? 'auto' : 'smooth',
  })
}

onMounted(async () => {
  window.addEventListener('scroll', scheduleNextIncompleteTask, { passive: true })
  window.addEventListener('resize', scheduleNextIncompleteTask, { passive: true })
  if (typeof ResizeObserver !== 'undefined') {
    nextTaskResizeObserver = new ResizeObserver(scheduleNextIncompleteTask)
    if (todayPage.value) nextTaskResizeObserver.observe(todayPage.value)
  }
  scheduleNextIncompleteTask()
  try {
    await Promise.all([store.load(), intervalStore.load(), flashcardStore.load(), trackingStore.load()])
  } catch { /* Store error states are displayed in the view. */ }
  await loadVisibleTaskProgress()
  scheduleNextIncompleteTask()
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
  window.removeEventListener('scroll', scheduleNextIncompleteTask)
  window.removeEventListener('resize', scheduleNextIncompleteTask)
  window.cancelAnimationFrame(nextTaskFrame)
  nextTaskResizeObserver?.disconnect()
})

watch(selectedDate, date => {
  if (isNativeHealthConnectSupported()) void store.refreshStepCount(date)
})

watch(visibleWeekStart, () => {
  if (store.tasks.length) void loadVisibleTaskProgress()
})

watch(
  () => selectedProgress.value.map(progress => (
    `${visibilityKey(progress)}:${progress.complete}:${progress.status}`
  )).join('|'),
  () => void nextTick(scheduleNextIncompleteTask),
  { flush: 'post' },
)

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
async function run<T>(action: () => Promise<T>) {
  busy.value = true
  try { return await action() } finally { busy.value = false }
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

function taskScheduleStatus(progress: TaskProgress) {
  if (progress.status === 'skipped') return 'skipped' as const
  return undefined
}

function taskTimeLabel(progress: TaskProgress) {
  const time = taskScheduledTime(progress.task)
  return time ? formatTaskScheduleTime(time) : undefined
}

function notScheduledSubtitle(progress: TaskProgress) {
  if (!progress.task.active) return 'Paused'
  const time = taskTimeLabel(progress)
  return time ? `Not scheduled · ${time}` : 'Not scheduled for this day'
}

function taskPresentation(progress: TaskProgress) {
  return TASK_TYPE_PRESENTATION[progress.task.type]
}

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
  const update = runForProgress(item, () => store.setStatus(item, status))
  if (!reviewItems.value.length) reviewSheet.value = false
  await update
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

function runTaskMainAction(action: TaskMainActionItem) {
  const progress = taskActionProgress.value
  if (!progress || action.disabled) return
  taskSheet.value = false
  if (action.id === 'toggle-complete') {
    void runForProgress(progress, () => store.setStatus(progress, progress.complete ? 'pending' : 'completed'))
    return
  }
  if (action.id === 'start-interval') {
    void startIntervalTask(progress)
    return
  }
  if (action.id === 'start-review') {
    void startFlashcardTask(progress)
    return
  }
  if (action.id === 'log-amount') {
    void openExact(progress, progress.task.type === 'step_counter')
    return
  }
  if (action.id === 'log-with-image') {
    openImageLogger(progress)
    return
  }
  if (action.id === 'log-time') {
    openTimeLogger(progress)
    return
  }
  if (action.id === 'toggle-total-lock') {
    void runForProgress(progress, () => store.setDailyTotalSealed(progress))
    return
  }
  if (action.id === 'sync-steps') {
    syncStepCount()
    return
  }
  if (action.id === 'write-journal') openJournalTask(progress)
}

function runProgramStepRequirement(progress: TaskProgress, completionId: string) {
  const completion = progress.completionItems?.find(item => item.id === completionId)
  const requirement = programStepRequirementItems(progress).find(item => item.id === completionId)
  if (!completion || requirement?.disabled || progressIsBusy(progress)) return

  if (completion.type === 'check') {
    void runForProgress(progress, () => store.setProgramStepCompletion(
      progress,
      completion.id,
      !completion.complete,
    ))
    return
  }
  if (completion.type === 'quantity') {
    if (progress.task.logWithImagesEnabled) openImageLogger(progress, completion.id)
    else void openExact(progress, false, completion.id)
    return
  }
  if (completion.complete) {
    void runForProgress(progress, () => store.setProgramStepCompletion(progress, completion.id, false))
    return
  }
  if (completion.type === 'interval') {
    void startIntervalTask(progress, completion)
    return
  }
  void startFlashcardTask(progress, completion)
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

function taskEntryImage(entry: Entry) {
  if (!entry.taskLogImage) return undefined
  return store.taskLogImages.find(item => item.id === entry.taskLogImage)?.image
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
    ...(entry.label || entry.note ? [taskEntryKindLabel(entry)] : []),
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
    const [entries] = await Promise.all([
      store.loadEntriesForDay(
        progress.task.id,
        progress.scheduledDate,
        progress.programStep?.id,
      ),
      store.loadTaskLogImages(progress.task.id).catch(() => []),
    ])
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
  if (action === 'skip-task') {
    if (!taskActionProgress.value) return
    taskSheet.value = false
    taskSkipDialog.value = true
    return
  }
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
  if (action === 'view-log-history') void openTaskLogHistory()
}

async function confirmTaskSkipChange() {
  const progress = taskActionProgress.value
  if (!progress || taskSkipUpdating.value) return
  const skipping = progress.status !== 'skipped'
  taskSkipUpdating.value = true
  taskSkipDialog.value = false
  try {
    await store.toggleSkipped(progress, skipping)
    taskActionProgress.value = undefined
  } catch (cause) {
    taskSkipDialog.value = true
    store.error = cause instanceof Error ? cause.message : 'Could not update this task.'
  } finally {
    taskSkipUpdating.value = false
  }
}

async function confirmTaskStatusChange() {
  const task = taskActionProgress.value?.task
  if (!task || taskStatusUpdating.value) return
  taskStatusUpdating.value = true
  taskStatusDialog.value = false
  try {
    await store.toggleTaskActive(task)
    taskActionProgress.value = undefined
  } catch (cause) {
    taskStatusDialog.value = true
    store.error = cause instanceof Error ? cause.message : 'Could not update this task.'
  } finally {
    taskStatusUpdating.value = false
  }
}

async function openExact(progress: TaskProgress, additional = false, completionId = '') {
  exactProgress.value = progress
  exactCompletionId.value = completionId
  exactEditingEntry.value = undefined
  exactLoggingAdditional.value = additional
  exactAmountInput.value = ''
  exactAction.value = undefined
  exactError.value = ''
  exactDialog.value = true
}

function openImageLogger(progress: TaskProgress, completionId = '') {
  imageLogProgress.value = progress
  imageLogCompletionId.value = completionId
  imageLogSheet.value = true
}

function editTaskLogEntry(entry: Entry) {
  const progress = taskActionProgress.value
  if (!progress || progress.sealed || busy.value || isHealthConnectEntry(entry)) return
  exactProgress.value = progress
  exactCompletionId.value = entry.programStepCompletion || ''
  exactEditingEntry.value = entry
  exactLoggingAdditional.value = false
  exactAmountInput.value = String(Number(entry.value.toFixed(2)))
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

function intervalMeta(progress: TaskProgress, completion?: ProgramStepCompletionProgress) {
  const templateId = completion?.intervalTemplate
    || progress.programStep?.intervalTemplate
    || progress.task.intervalTemplate
  const template = intervalStore.templates.find((item) => item.id === templateId)
  if (!template) return undefined
  return {
    name: template.name,
    duration: formatIntervalDuration(intervalDuration(template.definition)),
    color: template.color,
  }
}

function reviewSetMeta(progress: TaskProgress, completion?: ProgramStepCompletionProgress) {
  const reviewSetId = completion?.flashcardReviewSet
    || progress.programStep?.flashcardReviewSet
    || progress.task.flashcardReviewSet
  const reviewSet = flashcardStore.reviewSets.find(item => item.id === reviewSetId)
  if (!reviewSet) return undefined
  return {
    name: reviewSet.name,
    mode: reviewSet.mode,
    cardCount: reviewSetCardCount(reviewSet),
  }
}

function reviewSessionMatchesProgress(progress: TaskProgress, completionId = '') {
  const active = flashcardStore.activeSession
  return active?.task === progress.task.id
    && (active.programStep || '') === (progress.programStep?.id || '')
    && (active.programStepCompletion || '') === completionId
    && active.taskDate === progress.scheduledDate
}

async function startFlashcardTask(
  progress: TaskProgress,
  completion?: ProgramStepCompletionProgress,
) {
  flashcardStartError.value = ''
  const active = flashcardStore.activeSession
  if (active) {
    if (reviewSessionMatchesProgress(progress, completion?.id)) {
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
  const reviewSetId = completion?.flashcardReviewSet
    || progress.programStep?.flashcardReviewSet
    || progress.task.flashcardReviewSet
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
      ...(completion ? { completion: completion.id } : {}),
      date: progress.scheduledDate,
      from: 'tasks',
    },
  })
}

function sessionMatchesProgress(progress: TaskProgress, completionId = '') {
  const active = intervalStore.activeSession
  return active?.task === progress.task.id
    && (active.programStep || '') === (progress.programStep?.id || '')
    && (active.programStepCompletion || '') === completionId
}

async function startIntervalTask(
  progress: TaskProgress,
  completion?: ProgramStepCompletionProgress,
) {
  intervalStartError.value = ''
  const active = intervalStore.activeSession
  if (active) {
    if (sessionMatchesProgress(progress, completion?.id)) {
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
  const templateId = completion?.intervalTemplate
    || progress.programStep?.intervalTemplate
    || progress.task.intervalTemplate
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
      ...(completion ? { completion: completion.id } : {}),
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
    ? exactAmount.value - (exactCompletion.value?.value ?? progress.value)
    : mode === 'subtract'
      ? -exactAmount.value
      : exactAmount.value
  if (amount === 0) {
    if (mode === 'set') exactDialog.value = false
    return
  }
  exactError.value = ''
  const update = run(() => store.addEntry(
    progress,
    amount,
    mode === 'add' ? undefined : 'adjustment',
    exactCompletionId.value,
  ))
  pulseProgressValue(progress)
  exactDialog.value = false
  try {
    await update
  } catch (cause) {
    exactError.value = cause instanceof Error ? cause.message : 'Could not save this log entry.'
    exactDialog.value = true
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
  const update = run(() => store.updateEntry(
    progress,
    entry.id,
    exactAmount.value!,
  ))
  pulseProgressValue(progress)
  exactDialog.value = false
  try {
    const updated = await update
    if (updated) {
      const index = taskLogEntries.value.findIndex(item => item.id === updated.id)
      if (index >= 0) taskLogEntries.value.splice(index, 1, updated)
    }
    exactEditingEntry.value = undefined
  } catch (cause) {
    exactError.value = cause instanceof Error ? cause.message : 'Could not update this log entry.'
    exactDialog.value = true
  } finally {
    exactAction.value = undefined
  }
}
</script>

<template>
  <main ref="todayPage" class="app-page today-page">
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
            {{ doneCount }} of {{ scoredProgress.length }} scheduled tasks complete
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
    <div class="section-heading task-section-heading">
      <h2>Tasks</h2>
      <v-btn size="small" variant="text" prepend-icon="mdi-plus" to="/tasks/new">
        New
      </v-btn>
    </div>

    <v-row no-gutters align="start">
      <v-col cols="12" md="6" class="pr-md-2">
        <section v-if="timedProgressGroups.length" class="task-schedule-section">
          <div class="task-timeline">
            <section v-for="group in timedProgressGroups" :key="group.hour" class="task-hour-group">
              <time class="task-hour-label" :datetime="`${group.hour}:00`">{{ group.label }}</time>
              <div class="task-stack task-hour-stack">
                <div
                  v-for="item in group.tasks"
                  :key="visibilityKey(item)"
                  :data-task-progress-key="visibilityKey(item)"
                  class="task-masonry-item"
                >
                  <TaskCard
                    :progress="item"
                    :time-label="taskTimeLabel(item)"
                    :schedule-status="taskScheduleStatus(item)"
                    :busy="progressIsBusy(item)"
                    :value-pulse="valuePulseFor(item)"
                    :syncing="item.task.type === 'step_counter' && stepCountLoading"
                    :step-count-error="item.task.type === 'step_counter' ? stepCountError : ''"
                    :interval="intervalMeta(item)"
                    :review-set="reviewSetMeta(item)"
                    :program-step-requirements="programStepRequirementItems(item)"
                    :trackers="trackingMeta(item)"
                    :can-log-tracking="trackingCanLog(item)"
                    :task-log-images="taskLogImageDeckByTask.get(visibilityKey(item)) || []"
                    @log-tracking="openTrackingLogger"
                    @log-tracking-time="openTrackingTimeLogger"
                    @run-program-step-requirement="runProgramStepRequirement"
                    @actions="openTaskActions"
                  />
                </div>
              </div>
            </section>
          </div>
        </section>
      </v-col>

      <v-col cols="12" md="6" class="pl-md-2">
        <section
          v-if="allDayProgress.length"
          class="task-schedule-section task-all-day-group"
          :class="timedProgressGroups.length ? 'mt-6 mt-md-0' : undefined"
        >
          <h3 class="task-schedule-label task-all-day-label">All day</h3>
          <div class="task-stack task-all-day-stack">
            <div
              v-for="item in allDayProgress"
              :key="visibilityKey(item)"
              :data-task-progress-key="visibilityKey(item)"
              v-long-press-drag="{
                id: progressKey(item),
                group: 'all-day-task-cards',
                handle: '[data-task-drag-handle]',
                disabled: draggableTaskCount(allDayProgress) < 2 || busy || reorderingTasks,
                onDrop: result => reorderTaskCards(result, allDayProgress),
              }"
              class="task-masonry-item"
              :class="{ 'task-masonry-item--draggable': draggableTaskCount(allDayProgress) > 1 }"
            >
              <TaskCard
                :progress="item"
                :schedule-status="taskScheduleStatus(item)"
                :busy="progressIsBusy(item)"
                :value-pulse="valuePulseFor(item)"
                :syncing="item.task.type === 'step_counter' && stepCountLoading"
                :step-count-error="item.task.type === 'step_counter' ? stepCountError : ''"
                :interval="intervalMeta(item)"
                :review-set="reviewSetMeta(item)"
                :program-step-requirements="programStepRequirementItems(item)"
                :trackers="trackingMeta(item)"
                :can-log-tracking="trackingCanLog(item)"
                :task-log-images="taskLogImageDeckByTask.get(visibilityKey(item)) || []"
                @log-tracking="openTrackingLogger"
                @log-tracking-time="openTrackingTimeLogger"
                @run-program-step-requirement="runProgramStepRequirement"
                @actions="openTaskActions"
              />
            </div>
          </div>
        </section>
      </v-col>
    </v-row>

    <v-card v-if="!selectedProgress.length && !loading" class="surface-card empty-card pa-8 text-center">
      <div class="empty-icon mx-auto mb-4"><v-icon icon="mdi-arm-flex-outline" size="32" /></div>
      <h2 class="text-h6 font-weight-black">No tasks scheduled</h2>
      <p class="text-body-2 muted mt-2 mb-5">
        {{ store.tasks.length
          ? 'Nothing is planned for this day. Your other tasks are available below.'
          : 'Build your first routine and it will show up here.' }}
      </p>
      <v-btn color="secondary" prepend-icon="mdi-plus" to="/tasks/new">
        {{ store.tasks.length ? 'New' : 'Create a task' }}
      </v-btn>
    </v-card>

    <section v-if="notScheduledProgress.length" class="not-scheduled-section mt-6">
      <v-btn
        block
        variant="text"
        class="not-scheduled-section__heading px-4"
        :aria-expanded="notScheduledExpanded"
        aria-controls="not-scheduled-tasks"
        @click="notScheduledExpanded = !notScheduledExpanded"
      >
        <h3>Not scheduled</h3>
        <span class="not-scheduled-section__count">{{ notScheduledProgress.length }}</span>
        <v-icon :icon="notScheduledExpanded ? 'mdi-chevron-up' : 'mdi-chevron-down'" size="small" />
      </v-btn>
      <v-expand-transition>
        <v-list
          v-show="notScheduledExpanded"
          id="not-scheduled-tasks"
          bg-color="transparent"
          class="pa-0"
        >
          <v-list-item
            v-for="item in notScheduledProgress"
            :key="visibilityKey(item)"
            :title="item.task.name"
            :subtitle="notScheduledSubtitle(item)"
            rounded="lg"
            class="not-scheduled-task"
            @click="openTaskActions(item)"
          >
            <template #prepend>
              <div class="not-scheduled-task__icon-wrap mr-3">
                <span
                  class="not-scheduled-task__icon"
                  :style="{ background: item.task.color || taskPresentation(item).color }"
                >
                  <v-icon :icon="item.task.active ? taskPresentation(item).icon : 'mdi-pause'" size="1rem" />
                </span>
                <span
                  v-if="item.task.mandatory && !item.complete"
                  class="not-scheduled-task__required"
                  role="img"
                  aria-label="Required task"
                  title="Required"
                />
              </div>
            </template>
            <template #append>
              <v-icon icon="mdi-chevron-right" size="small" color="medium-emphasis" />
            </template>
          </v-list-item>
        </v-list>
      </v-expand-transition>
    </section>

    <Transition
      name="next-task-banner"
      @after-enter="scheduleNextIncompleteTask"
      @after-leave="scheduleNextIncompleteTask"
    >
      <StickyActionBanner
        v-if="nextIncompleteProgress"
        class="next-incomplete-task-banner page-action-area--route-slide"
        label="Next incomplete"
        :title="nextIncompleteProgress.programStep?.name || nextIncompleteProgress.task.name"
        action-label="View"
        action-icon="mdi-arrow-down"
        aria-live="polite"
        @action="scrollToNextIncompleteTask"
      />
    </Transition>

    <AppDialog
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
    </AppDialog>

    <TaskImageLogBottomSheet
      v-model="imageLogSheet"
      :progress="imageLogProgress"
      :completion-id="imageLogCompletionId"
      @logged="imageLogProgress && pulseProgressValue(imageLogProgress)"
    />

    <TrackingLogBottomSheet
      v-model="trackingSheetOpen"
      :tracker="trackingSheetTracker"
      :date="trackingSheetDate"
      :context="trackingSheetContext"
    />

    <ActionBottomSheet
      v-model="taskSheet"
      :title="taskSheetMode === 'history' ? 'Log history' : taskActionTitle"
      :description="taskSheetDescription"
      :hide-title="taskSheetMode === 'actions'"
      :aria-label="taskSheetMode === 'history' ? `${taskActionTitle} log history` : `${taskActionTitle} actions`"
    >
      <template v-if="taskActionProgress && taskSheetMode === 'actions'">
        <v-list-item
          v-for="action in taskMainActionItems"
          :key="action.id"
          class="task-main-action"
          :prepend-icon="action.icon"
          :title="action.title"
          :disabled="action.disabled || progressIsBusy(taskActionProgress)"
          rounded="lg"
          @click="runTaskMainAction(action)"
        />
        <v-divider v-if="taskMainActionItems.length && taskCardActionItems.length" class="my-2" />
        <template v-for="action in taskCardActionItems" :key="action.id">
          <v-list-item
            :prepend-icon="action.icon"
            :title="action.title"
            rounded="lg"
            @click="runTaskCardAction(action.id)"
          />
          <v-divider v-if="'dividerAfter' in action && action.dividerAfter" class="my-2" />
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
            :title="entry.label || entry.note || taskEntryKindLabel(entry)"
            rounded="lg"
          >
            <template #prepend>
              <v-avatar
                v-if="taskEntryImage(entry)"
                class="task-log-thumbnail"
                rounded="lg"
                size="48"
              >
                <v-img
                  :src="taskEntryImage(entry)"
                  :alt="entry.label ? `${entry.label} log image` : 'Task log image'"
                  cover
                >
                  <template #error>
                    <v-icon :icon="taskEntryIcon(entry)" color="medium-emphasis" />
                  </template>
                </v-img>
              </v-avatar>
              <v-icon v-else :icon="taskEntryIcon(entry)" />
            </template>
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
      v-model="taskSkipDialog"
      :title="taskActionProgress?.status === 'skipped' ? 'Unskip this task?' : 'Skip this task?'"
      :message="taskActionProgress?.status === 'skipped'
        ? `${taskActionTitle} will return to this day.`
        : `${taskActionTitle} will be excluded from this day’s completion score.`"
      :confirm-text="taskActionProgress?.status === 'skipped' ? 'Unskip' : 'Skip'"
      :confirm-color="taskActionProgress?.status === 'skipped' ? 'secondary' : 'warning'"
      :icon="taskActionProgress?.status === 'skipped' ? 'mdi-backup-restore' : 'mdi-skip-next-outline'"
      :loading="taskSkipUpdating"
      @confirm="confirmTaskSkipChange"
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
            :disabled="progressIsBusy(item)"
            @click="resolveReview(item, 'missed')"
          >
            Mark missed
          </v-btn>
          <v-btn
            size="large"
            variant="tonal"
            prepend-icon="mdi-arrow-right-bold"
            :disabled="progressIsBusy(item)"
            @click="resolveReview(item, 'carried')"
          >
            Carry forward
          </v-btn>
          <v-btn
            v-if="item.programStep"
            size="large"
            variant="tonal"
            prepend-icon="mdi-calendar-arrow-right"
            :disabled="progressIsBusy(item)"
            @click="runForProgress(item, () => store.shiftProgram(item))"
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
.score-pattern { position: absolute; top: -4.375rem; right: -2.5rem; width: 13.75rem; height: 13.75rem; border: 2.1875rem solid rgba(199,244,100,.07); border-radius: 50%; }
.score-number { font-family: Impact, "Arial Narrow", sans-serif; font-size: 3.2rem; line-height: .9; letter-spacing: -.03em; }
.score-percent { color: #c7f464; font-size: 1.2rem; font-weight: 900; }
.task-section-heading { flex-wrap: wrap; gap: .75rem; }
.task-schedule-section { min-width: 0; }
.task-schedule-label {
  color: rgb(var(--v-theme-on-surface) / .62);
  font-size: .72rem;
  font-weight: 900;
  letter-spacing: .08em;
  text-transform: uppercase;
}
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
}
.task-masonry-item > * { min-height: 0; }
.task-masonry-item.long-press-drag-ghost { overflow: hidden; }
.task-stack :deep(.long-press-drag-placeholder) { margin-bottom: var(--task-card-gap); }
.task-masonry-item--draggable :deep([data-task-drag-handle]) { cursor: grab; }
.task-timeline { display: grid; gap: 1rem; }
.task-hour-group { display: grid; min-width: 0; grid-template-columns: 2.5rem minmax(0, 1fr); gap: .75rem; }
.task-hour-label {
  padding-top: .9rem;
  color: rgb(var(--v-theme-on-surface) / .62);
  font-size: .72rem;
  font-variant-numeric: tabular-nums;
  font-weight: 900;
  letter-spacing: .02em;
  text-align: right;
  white-space: nowrap;
}
.task-all-day-group { display: grid; grid-template-columns: 2.5rem minmax(0, 1fr); gap: .75rem; }
.task-hour-label,
.task-all-day-label {
  position: sticky;
  top: calc(3.75rem + max(env(safe-area-inset-top, 0rem), var(--safe-area-inset-top, 0rem)));
  align-self: start;
}
.task-all-day-label {
  padding-top: .9rem;
  text-align: right;
}
.task-all-day-stack { min-width: 0; }
.task-hour-stack { min-width: 0; }
.empty-card { margin-top: 0; }
.empty-icon { display: grid; width: 4rem; height: 4rem; place-items: center; border-radius: 1.25rem; background: #c7f464; color: #17200f; }
.not-scheduled-section__heading { min-height: 2.75rem; }
.not-scheduled-section__heading :deep(.v-btn__content) { width: 100%; justify-content: flex-start; gap: .5rem; }
.not-scheduled-section__heading h3 { font-size: .75rem; font-weight: 900; letter-spacing: .04em; }
.not-scheduled-section__count { margin-left: auto; color: rgb(var(--v-theme-on-surface) / .54); font-size: .68rem; font-weight: 800; }
.not-scheduled-task { min-height: 3.5rem; }
.not-scheduled-task__icon-wrap { position: relative; flex: 0 0 auto; }
.not-scheduled-task__icon { display: grid; width: 2rem; height: 2rem; place-items: center; border-radius: .65rem; color: #17200f; }
.not-scheduled-task__required {
  position: absolute;
  top: -.18rem;
  right: -.18rem;
  width: .65rem;
  height: .65rem;
  border: .12rem solid rgb(var(--v-theme-surface));
  border-radius: 50%;
  background: rgb(var(--v-theme-error));
}
.task-main-action :deep(.v-list-item__prepend > .v-icon) { color: rgb(var(--v-theme-secondary)); }
.amount-keypad { display: grid; gap: 1rem; }
.amount-keypad__display { display: flex; min-height: 4.5rem; align-items: center; justify-content: space-between; padding: .75rem 1rem; border: .0625rem solid rgb(var(--v-theme-on-surface) / .16); border-radius: 1rem; background: rgb(var(--v-theme-surface-variant)); font-size: 2rem; font-weight: 900; line-height: 1; }
.amount-keypad__display output { margin-left: auto; }
.amount-keypad__keys { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .65rem; }
.amount-keypad__keys .v-btn { min-width: 0; height: 3.375rem; font-size: 1.05rem; font-weight: 850; }
.exact-actions {
  display: grid;
  grid-template:
    "set add" 2.75rem
    "subtract add" 2.75rem
    / minmax(0, 1fr) minmax(0, 1fr);
  gap: .5rem;
}
.exact-action { height: 100% !important; }
.exact-action--subtract { grid-area: subtract; }
.exact-action--add { grid-area: add; }
.exact-action--set { grid-area: set; }
.task-log-actions { display: flex; align-items: center; }
.task-log-action { width: 2.75rem !important; min-width: 2.75rem !important; height: 2.75rem !important; }
.task-log-thumbnail { border: .0625rem solid rgb(var(--v-theme-on-surface) / .12); background: rgb(var(--v-theme-surface-variant)); }
.task-log-value { display: block; margin-top: .125rem; color: rgb(var(--v-theme-on-surface)); font-size: .8rem; white-space: nowrap; }
.task-log-empty { min-height: 10rem; }
.review-row { display: flex; flex-direction: column; align-items: stretch; gap: 1rem; border-top: .0625rem solid rgb(var(--v-theme-on-surface) / .08); }
.review-actions { display: grid; gap: .5rem; }
.review-actions .v-btn { width: 100%; }
.next-task-banner-enter-active {
  transition: transform 220ms cubic-bezier(.22, 1, .36, 1), opacity 180ms ease;
}
.next-task-banner-leave-active {
  transition: transform 180ms cubic-bezier(.4, 0, 1, 1), opacity 160ms ease;
}
.next-task-banner-enter-from,
.next-task-banner-leave-to {
  opacity: 0;
  transform: translateY(100%);
}

@media (min-width: 43.75rem) {
  .task-stack { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .task-hour-stack,
  .task-all-day-stack { grid-template-columns: 1fr; }
  .review-actions { grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); }
}

@media (prefers-reduced-motion: reduce) {
  .next-task-banner-enter-active,
  .next-task-banner-leave-active { transition-duration: .01ms; }
}

</style>
