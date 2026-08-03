<script setup lang="ts">
import { Capacitor } from '@capacitor/core'
import { App } from '@capacitor/app'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { addDays, format, isAfter, isSameDay, startOfDay, startOfWeek } from 'date-fns'
import { storeToRefs } from 'pinia'
import { useDisplay } from 'vuetify'
import { useRouter } from 'vue-router'
import ActionBottomSheet from '@/components/ActionBottomSheet.vue'
import TaskCard from '@/components/TaskCard.vue'
import WeekDateNavigator from '@/components/WeekDateNavigator.vue'
import { isNativeHealthConnectSupported } from '@/services/healthConnect'
import { formatIntervalDuration, intervalDuration } from '@/services/intervals'
import { taskCompletionMarkerColor, toDateKey } from '@/services/schedule'
import { TASK_CARD_ACTION_ITEMS, taskCanLogAmounts } from '@/services/taskCardActions'
import type { TaskCardActionId } from '@/services/taskCardActions'
import {
  TASK_ENTRY_NOTE_MAX_LENGTH,
  sanitizeTaskEntryNote,
  taskEntryNoteForAmount,
  taskEntryNoteOptions,
} from '@/services/taskEntryNotes'
import { useIntervalStore } from '@/stores/intervals'
import { useTaskStore } from '@/stores/tasks'
import type { Entry, TaskProgress } from '@/types/domain'

const allowAutomaticFocus = Capacitor.getPlatform() !== 'android'
const store = useTaskStore()
const intervalStore = useIntervalStore()
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
const exactNoteAutoFilled = ref(false)
let exactNoteHistoryRequest = 0
const exactAction = ref<'add' | 'subtract' | 'set'>()
const reviewSheet = ref(false)
const taskSheet = ref(false)
const taskSheetMode = ref<'actions' | 'history'>('actions')
const taskActionProgress = ref<TaskProgress>()
const taskLogEntries = ref<Entry[]>([])
const taskLogLoading = ref(false)
const taskLogError = ref('')
let taskLogRequest = 0
const activeIntervalSheet = ref(false)
const intervalStartError = ref('')
const valuePulseVersions = ref<Record<string, number>>({})
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
  action.id !== 'view-log-history' || taskCanLogAmounts(taskActionProgress.value),
))
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

const required = computed(() => selectedProgress.value.filter((item) => item.task.mandatory))
const optional = computed(() => selectedProgress.value.filter((item) => !item.task.mandatory))
const reviewItems = computed(() =>
  selectedProgress.value.filter((item) => item.task.reviewWhenMissed && item.status === 'pending' && !item.complete),
)
const doneCount = computed(() => selectedProgress.value.filter((item) => item.complete).length)
const selectedDateIsToday = computed(() => isSameDay(selectedDate.value, new Date()))
const hasStepCounter = computed(() => selectedProgress.value.some(item => item.task.type === 'step_counter'))
let appStateListener: Awaited<ReturnType<typeof App.addListener>> | undefined

onMounted(async () => {
  try {
    await Promise.all([store.load(), intervalStore.load()])
  } catch { /* Store error states are displayed in the view. */ }
  await loadVisibleTaskProgress()
  if (!isNativeHealthConnectSupported()) await store.refreshStepCount(selectedDate.value)

  if (Capacitor.isNativePlatform()) {
    appStateListener = await App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) void store.refreshStepCount(selectedDate.value)
    })
  }
})

onBeforeUnmount(() => {
  void appStateListener?.remove()
})

watch(selectedDate, date => {
  void store.refreshStepCount(date)
})

watch(visibleWeekStart, () => {
  if (store.tasks.length) void loadVisibleTaskProgress()
})

async function loadVisibleTaskProgress() {
  const dates = visibleWeekDates.value
  await store.loadProgressRange(toDateKey(dates[0]), toDateKey(dates[6])).catch(() => undefined)
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

function progressKey(progress: TaskProgress) {
  return `${progress.task.id}:${progress.programStep?.id || ''}`
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

async function writeTaskReflection() {
  const progress = taskActionProgress.value
  if (!progress) return
  taskSheet.value = false
  await nextTick()
  await router.push({
    name: 'journal-new',
    query: { task: progress.task.id, date: toDateKey(selectedDate.value) },
  })
}

async function viewTaskReflections() {
  const progress = taskActionProgress.value
  if (!progress) return
  taskSheet.value = false
  await nextTick()
  await router.push({
    name: 'journal',
    query: { task: progress.task.id, date: toDateKey(selectedDate.value) },
  })
}

function taskEntryKindLabel(entry: Entry) {
  if (entry.kind === 'duration') return 'Duration'
  if (entry.kind === 'adjustment') return 'Adjustment'
  return 'Quantity'
}

function taskEntryIcon(entry: Entry) {
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
      toDateKey(selectedDate.value),
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
  if (action === 'write-reflection') {
    void writeTaskReflection()
    return
  }
  if (action === 'view-reflections') {
    void viewTaskReflections()
    return
  }
  void openTaskLogHistory()
}

async function openExact(progress: TaskProgress) {
  exactProgress.value = progress
  exactAmountInput.value = ''
  exactNote.value = ''
  exactNoteAutoFilled.value = false
  exactNoteHistory.value = store.entries.filter((entry) => entry.task === progress.task.id)
  exactAction.value = undefined
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

watch([exactAmount, exactNoteHistory], ([amount]) => {
  if (!exactProgress.value?.task.entryNoteSuggestionsEnabled) return
  if (amount === null) {
    if (exactNoteAutoFilled.value) exactNote.value = ''
    exactNoteAutoFilled.value = false
    return
  }
  if (exactNote.value && !exactNoteAutoFilled.value) return
  const note = taskEntryNoteForAmount(
    exactNoteHistory.value,
    exactProgress.value?.task.id || '',
    amount,
  )
  exactNote.value = note
  exactNoteAutoFilled.value = Boolean(note)
})

function updateExactNote(value: unknown) {
  exactNoteAutoFilled.value = false
  exactNote.value = sanitizeTaskEntryNote(value)
}

function openTimeLogger(progress: TaskProgress) {
  void router.push({
    name: 'task-timer',
    params: { id: progress.task.id },
    query: { date: toDateKey(selectedDate.value) },
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
        query: { from: 'tasks' },
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
    query: { from: 'tasks' },
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
  if (!exactProgress.value || exactAmount.value === null) return
  const progress = exactProgress.value
  exactAction.value = mode
  const amount = mode === 'set'
    ? exactAmount.value - progress.value
    : mode === 'subtract'
      ? -exactAmount.value
      : exactAmount.value
  try {
    await run(() => store.addEntry(
      progress,
      amount,
      mode === 'add' ? undefined : 'adjustment',
      progress.task.entryNotesEnabled ? exactNote.value.trim() : '',
    ))
    pulseProgressValue(progress)
    exactDialog.value = false
  } finally {
    exactAction.value = undefined
  }
}
</script>

<template>
  <main class="app-page today-page">
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
    <v-alert
      v-if="hasStepCounter && stepCountError"
      type="warning"
      variant="tonal"
      class="mt-4"
    >
      {{ stepCountError }}
      <template #append>
        <v-btn size="small" variant="text" to="/settings">Settings</v-btn>
      </template>
    </v-alert>

    <template v-if="selectedProgress.length">
      <section v-if="required.length">
        <div class="section-heading"><h2>Required tasks</h2><span class="text-caption muted">{{ required.filter(i => i.complete).length }}/{{ required.length }}</span></div>
        <div class="task-stack">
          <TaskCard
            v-for="item in required"
            :key="`${item.task.id}-${item.programStep?.id || ''}`"
            :progress="item"
            :busy="progressIsBusy(item)"
            :value-pulse="valuePulseFor(item)"
            :syncing="item.task.type === 'step_counter' && stepCountLoading"
            :interval="intervalMeta(item)"
            :can-start-interval="selectedDateIsToday && item.status === 'pending'"
            :interval-active="sessionMatchesProgress(item)"
            @toggle="(progress, complete) => runForProgress(progress, () => store.toggleComplete(progress, complete))"
            @seal="progress => runForProgress(progress, () => store.setDailyTotalSealed(progress))"
            @log-amount="openExact"
            @log-time="openTimeLogger"
            @start-interval="startIntervalTask"
            @actions="openTaskActions"
          />
        </div>
      </section>

      <section v-if="optional.length">
        <div class="section-heading"><h2>Extra credit</h2><span class="text-caption muted">Optional</span></div>
        <div class="task-stack">
          <TaskCard
            v-for="item in optional"
            :key="`${item.task.id}-${item.programStep?.id || ''}`"
            :progress="item"
            :busy="progressIsBusy(item)"
            :value-pulse="valuePulseFor(item)"
            :syncing="item.task.type === 'step_counter' && stepCountLoading"
            :interval="intervalMeta(item)"
            :can-start-interval="selectedDateIsToday && item.status === 'pending'"
            :interval-active="sessionMatchesProgress(item)"
            @toggle="(progress, complete) => runForProgress(progress, () => store.toggleComplete(progress, complete))"
            @seal="progress => runForProgress(progress, () => store.setDailyTotalSealed(progress))"
            @log-amount="openExact"
            @log-time="openTimeLogger"
            @start-interval="startIntervalTask"
            @actions="openTaskActions"
          />
        </div>
      </section>
    </template>

    <v-card v-else-if="!loading" class="surface-card empty-card pa-8 mt-6 text-center">
      <div class="empty-icon mx-auto mb-4"><v-icon icon="mdi-arm-flex-outline" size="32" /></div>
      <h2 class="text-h6 font-weight-black">No tasks scheduled</h2>
      <p class="text-body-2 muted mt-2 mb-5">Build your first routine and it will show up here.</p>
      <v-btn color="secondary" append-icon="mdi-plus" to="/tasks/new">Create a task</v-btn>
    </v-card>

    <v-btn
      class="manage-tasks-button mt-8"
      block
      size="large"
      variant="outlined"
      color="secondary"
      prepend-icon="mdi-format-list-checks"
      to="/tasks/manage"
    >
      Manage tasks
    </v-btn>

    <v-dialog
      v-model="exactDialog"
      max-width="440"
      :transition="smAndUp ? 'dialog-transition' : 'digit-pad-scale-transition'"
    >
      <v-card class="pa-5">
        <div class="d-flex align-center justify-space-between mb-5">
          <div class="min-width-0">
            <h2 class="text-h6 font-weight-black">Log amount</h2>
            <p class="text-body-2 muted text-truncate mt-1">{{ exactProgress?.programStep?.name || exactProgress?.task.name }}</p>
          </div>
          <v-btn icon="mdi-close" variant="text" aria-label="Close amount logger" @click="exactDialog = false" />
        </div>
        <div class="amount-entry mb-4">
          <v-number-input
            v-if="smAndUp"
            v-model="exactDesktopAmount"
            label="Amount"
            :precision="null"
            :autofocus="allowAutomaticFocus"
          />
          <div v-else class="amount-keypad">
            <output class="amount-keypad__display" aria-live="polite">
              {{ exactAmountInput || '0' }}
            </output>
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
        <div class="exact-actions">
          <v-btn
            block
            size="large"
            class="exact-action exact-action--add"
            color="secondary"
            aria-label="Add"
            :loading="busy && exactAction === 'add'"
            :disabled="exactAmount === null || (busy && exactAction !== 'add')"
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
            :disabled="exactAmount === null || (busy && exactAction !== 'subtract')"
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
            :disabled="exactAmount === null || (busy && exactAction !== 'set')"
            @click="submitExact('set')"
          >
            Set
          </v-btn>
        </div>
      </v-card>
    </v-dialog>

    <ActionBottomSheet
      v-model="taskSheet"
      :title="taskSheetMode === 'history' ? 'Log history' : taskActionTitle"
      :description="taskSheetDescription"
      :hide-title="taskSheetMode === 'actions'"
      :aria-label="taskSheetMode === 'history' ? `${taskActionTitle} log history` : `${taskActionTitle} actions`"
    >
      <template v-if="taskActionProgress && taskSheetMode === 'actions'">
        <v-list-item
          v-for="action in taskCardActionItems"
          :key="action.id"
          :prepend-icon="action.icon"
          :title="action.title"
          rounded="lg"
          @click="runTaskCardAction(action.id)"
        />
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
            :subtitle="`${taskEntryTime(entry)} · ${taskEntryKindLabel(entry)}`"
            rounded="lg"
          >
            <template #append><strong class="task-log-value">{{ taskEntryValue(entry) }}</strong></template>
          </v-list-item>
        </template>
        <div v-else class="task-log-empty px-4 py-8 text-center">
          <v-icon icon="mdi-history" size="34" color="medium-emphasis" />
          <h3 class="text-body-1 font-weight-black mt-3">No entries logged</h3>
          <p class="text-body-2 muted mt-1">This task has no log entries for the selected day.</p>
        </div>
      </template>
    </ActionBottomSheet>

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
  </main>
</template>

<style scoped>
.score-card { position: relative; overflow: hidden; }
.score-pattern { position: absolute; top: -70px; right: -40px; width: 220px; height: 220px; border: 35px solid rgba(199,244,100,.07); border-radius: 50%; }
.score-number { font-family: Impact, "Arial Narrow", sans-serif; font-size: 3.2rem; line-height: .9; letter-spacing: -.03em; }
.score-percent { color: #c7f464; font-size: 1.2rem; font-weight: 900; }
.task-stack { display: grid; gap: .7rem; }
.manage-tasks-button { min-height: 52px; }
.empty-icon { display: grid; width: 64px; height: 64px; place-items: center; border-radius: 20px; background: #c7f464; color: #17200f; }
.amount-keypad { display: grid; gap: 1rem; }
.amount-keypad__display { display: flex; min-height: 72px; align-items: center; justify-content: flex-end; padding: .75rem 1rem; border: 1px solid rgb(var(--v-theme-on-surface) / .16); border-radius: 16px; background: rgb(var(--v-theme-surface-variant)); font-size: 2rem; font-weight: 900; line-height: 1; }
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
.task-log-value { max-width: 8rem; font-size: .78rem; text-align: right; white-space: nowrap; }
.task-log-empty { min-height: 10rem; }
.review-row { display: flex; flex-direction: column; align-items: stretch; gap: 1rem; border-top: 1px solid rgba(255,255,255,.08); }
.review-actions { display: grid; gap: .5rem; }
.review-actions .v-btn { width: 100%; }

@media (min-width: 700px) {
  .task-stack { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .review-actions { grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); }
}

</style>
