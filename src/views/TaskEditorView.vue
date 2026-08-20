<script setup lang="ts">
import { Capacitor } from '@capacitor/core'
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { format } from 'date-fns'
import { useRoute, useRouter } from 'vue-router'
import AppForm from '@/components/AppForm.vue'
import ColorSwatchPicker from '@/components/ColorSwatchPicker.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import DatePickerField from '@/components/DatePickerField.vue'
import FormActionBar from '@/components/FormActionBar.vue'
import TaskReminderSettings from '@/components/TaskReminderSettings.vue'
import TimerWheelPicker from '@/components/TimerWheelPicker.vue'
import type { LongPressDragResult } from '@/directives/longPressDrag'
import { reviewSetCardCount } from '@/services/flashcards'
import { formatIntervalDuration, intervalDuration, intervalStepCount } from '@/services/intervals'
import { createProgramStepCompletion } from '@/services/programStepCompletions'
import { requestTaskReminderPermission, taskReminderSettingsAvailable } from '@/services/taskReminders'
import { TASK_TYPE_OPTIONS, TASK_TYPE_PRESENTATION } from '@/services/taskTypes'
import { useFlashcardStore } from '@/stores/flashcards'
import { useIntervalStore } from '@/stores/intervals'
import { useTaskStore } from '@/stores/tasks'
import { useTrackingStore } from '@/stores/tracking'
import type {
  ProgramStepCompletion,
  ProgramStepCompletionStyleItem,
  ProgramStepDraft,
  TaskDraft,
  TaskType,
} from '@/types/domain'

const allowAutomaticFocus = Capacitor.getPlatform() !== 'android'
const route = useRoute()
const router = useRouter()
const store = useTaskStore()
const intervalStore = useIntervalStore()
const flashcardStore = useFlashcardStore()
const trackingStore = useTrackingStore()
const form = ref()
const saving = ref(false)
const archiving = ref(false)
const archiveDialog = ref(false)
const openStep = ref<number>()
const error = ref('')
const reminderAvailable = taskReminderSettingsAvailable()
const stepDragIds = new WeakMap<ProgramStepDraft, string>()
let nextStepDragId = 0
const typeLocked = computed(() => Boolean(route.params.id))
const isEditing = computed(() => Boolean(route.params.id))
const completionStyleItems = computed<ProgramStepCompletionStyleItem[]>(() => [
  { type: 'subheader', title: 'Basic' },
  {
    type: 'item',
    title: 'Check-off',
    value: 'check',
    completionType: 'check',
    icon: 'mdi-check-circle-outline',
    color: TASK_TYPE_PRESENTATION.check.color,
    props: { subtitle: 'A separate check-off' },
  },
  {
    type: 'item',
    title: 'Quantity target',
    value: 'quantity',
    completionType: 'quantity',
    icon: 'mdi-chart-donut',
    color: TASK_TYPE_PRESENTATION.daily_total.color,
    props: { subtitle: 'Reach a numeric target' },
  },
  { type: 'subheader', title: 'Intervals' },
  ...(intervalStore.templates.length
    ? intervalStore.templates.map(interval => ({
        type: 'item' as const,
        title: interval.name,
        value: `interval:${interval.id}`,
        completionType: 'interval' as const,
        sourceId: interval.id,
        icon: 'mdi-timer-play-outline',
        color: interval.color,
        props: {
          subtitle: `${formatIntervalDuration(intervalDuration(interval.definition))} · ${intervalStepCount(interval.definition)} intervals`,
        },
      }))
    : [{
        type: 'item' as const,
        title: 'No saved intervals',
        value: 'unavailable:interval',
        icon: 'mdi-timer-off-outline',
        color: TASK_TYPE_PRESENTATION.interval.color,
        props: { subtitle: 'Create an interval first', disabled: true },
      }]),
  { type: 'subheader', title: 'Review sets' },
  ...(flashcardStore.reviewSets.length
    ? flashcardStore.reviewSets.map(reviewSet => ({
        type: 'item' as const,
        title: reviewSet.name,
        value: `flashcards:${reviewSet.id}`,
        completionType: 'flashcards' as const,
        sourceId: reviewSet.id,
        icon: 'mdi-cards-playing-outline',
        color: TASK_TYPE_PRESENTATION.flashcards.color,
        props: { subtitle: reviewSetSummary(reviewSet.id) },
      }))
    : [{
        type: 'item' as const,
        title: 'No Review sets',
        value: 'unavailable:flashcards',
        icon: 'mdi-cards-off-outline',
        color: TASK_TYPE_PRESENTATION.flashcards.color,
        props: { subtitle: 'Create a Review set first', disabled: true },
      }]),
])

const weekdays = [
  { value: 1, label: 'M' }, { value: 2, label: 'T' }, { value: 3, label: 'W' },
  { value: 4, label: 'T' }, { value: 5, label: 'F' }, { value: 6, label: 'S' }, { value: 0, label: 'S' },
]
const units = [
  { title: 'Hours', value: 'hours' },
  { title: 'Calories (kcal)', value: 'kcal' },
  { title: 'Grams (g)', value: 'g' },
  { title: 'Litres (L)', value: 'L' },
  { title: 'Count', value: 'count' },
  { title: 'Custom unit', value: 'custom' },
]
const draft = reactive<TaskDraft>({
  name: '',
  description: '',
  type: (route.query.type as TaskType) || 'check',
  color: '#C7F464',
  mandatory: true,
  reviewWhenMissed: false,
  active: true,
  archived: false,
  scheduleMode: 'time_based',
  scheduledTime: '09:00',
  startDate: format(new Date(), 'yyyy-MM-dd'),
  endDate: undefined,
  recurrenceType: 'daily',
  weekdays: [1, 2, 3, 4, 5],
  intervalWeeks: 1,
  targetValue: 1,
  targetOperator: 'gte',
  unit: 'count',
  customUnit: '',
  goalPeriod: 'occurrence',
  cycleLength: 7,
  programRepeat: true,
  programStrict: false,
  logWithImagesEnabled: false,
  sortOrder: 0,
  intervalTemplate: undefined,
  flashcardReviewSet: undefined,
  sessionCountMode: 'task',
  sessionGoalType: 'complete',
  sessionTargetSeconds: 20 * 60,
  trackingTrackers: [],
  reminderEnabled: false,
  reminderTimes: ['20:00'],
  steps: [],
})
const scheduledTimeModel = computed({
  get: () => draft.scheduledTime || '09:00',
  set: (value: number | string) => { draft.scheduledTime = String(value) },
})

const showTarget = computed(() =>
  draft.type === 'duration' || draft.type === 'daily_total' || draft.type === 'step_counter',
)
const showImageLogSettings = computed(() =>
  ['duration', 'daily_total', 'step_counter', 'program'].includes(draft.type),
)
const selectedInterval = computed(() => intervalStore.templates.find((item) => item.id === draft.intervalTemplate))
const intervalItems = computed(() => intervalStore.templates.map((item) => ({
  title: item.name,
  value: item.id,
  props: {
    subtitle: `${formatIntervalDuration(intervalDuration(item.definition))} · ${intervalStepCount(item.definition)} intervals`,
  },
})))
const selectedReviewSet = computed(() => flashcardStore.reviewSets.find(item => item.id === draft.flashcardReviewSet))
const isSessionTask = computed(() => draft.type === 'interval' || draft.type === 'flashcards')
const sessionSourceLabel = computed(() => draft.type === 'interval' ? 'interval' : 'Review set')
const sessionCountItems = computed(() => [
  {
    title: 'Only sessions started from this task',
    value: 'task',
  },
  {
    title: `Any session of this ${sessionSourceLabel.value}`,
    value: 'linked',
  },
])
const reviewSetItems = computed(() => flashcardStore.reviewSets.map(item => ({
  title: item.name,
  value: item.id,
  props: {
    subtitle: `${item.mode === 'passive' ? 'Passive' : 'Manual'} · ${reviewSetCardCount(item)} cards`,
  },
})))
const trackingTrackerItems = computed(() => trackingStore.trackers
  .filter(tracker => tracker.active || draft.trackingTrackers?.includes(tracker.id))
  .sort((a, b) => Number(b.active) - Number(a.active) || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
  .map(tracker => ({
    title: tracker.name,
    value: tracker.id,
    icon: tracker.icon,
    color: tracker.color,
    props: {
      subtitle: `${tracker.role === 'factor' ? 'Factor' : 'Outcome'} · ${tracker.category}${tracker.active ? '' : ' · Archived'}`,
    },
  })))

function removeTrackingTracker(id: string) {
  draft.trackingTrackers = (draft.trackingTrackers ?? []).filter(trackerId => trackerId !== id)
}

function trackingTrackerFor(id: string) {
  return trackingStore.trackers.find(tracker => tracker.id === id)
}

function reviewSetSummary(reviewSetId?: string) {
  const reviewSet = flashcardStore.reviewSets.find(item => item.id === reviewSetId)
  if (!reviewSet) return ''
  return `${reviewSet.mode === 'passive' ? 'Passive' : 'Manual'} · ${reviewSetCardCount(reviewSet)} cards`
}

function dayOffStep(sortOrder: number): ProgramStepDraft {
  return {
    name: 'Day off',
    description: '',
    sortOrder,
    cycleDays: [sortOrder + 1],
    completionType: 'day_off',
    active: true,
    completions: [],
  }
}

function syncStepCompletionProjection(step: ProgramStepDraft) {
  if (step.completionType === 'day_off') return
  const primary = step.completions?.[0]
  step.completionType = primary?.type || 'check'
  step.targetValue = primary?.targetValue
  step.targetOperator = primary?.targetOperator
  step.unit = primary?.unit
  step.customUnit = primary?.customUnit
  step.intervalTemplate = primary?.intervalTemplate
  step.flashcardReviewSet = primary?.flashcardReviewSet
}

function completionStyleItem(value: unknown) {
  return completionStyleItems.value.find(item => item.value === value && item.completionType)
}

function completionStyleValue(completion: ProgramStepCompletion) {
  const value = completion.type === 'interval'
    ? `interval:${completion.intervalTemplate || ''}`
    : completion.type === 'flashcards'
      ? `flashcards:${completion.flashcardReviewSet || ''}`
      : completion.type
  return completionStyleItem(value) ? value : undefined
}

function setCompletionStyle(
  step: ProgramStepDraft,
  completion: ProgramStepCompletion,
  value: unknown,
) {
  const item = completionStyleItem(value)
  if (!item?.completionType) return
  const type = item.completionType
  completion.type = type
  completion.targetValue = type === 'quantity' ? completion.targetValue || 1 : undefined
  completion.targetOperator = type === 'quantity' ? completion.targetOperator || 'gte' : undefined
  completion.unit = type === 'quantity' ? completion.unit || 'count' : undefined
  completion.customUnit = type === 'quantity' ? completion.customUnit : undefined
  completion.intervalTemplate = type === 'interval' ? item.sourceId : undefined
  completion.flashcardReviewSet = type === 'flashcards' ? item.sourceId : undefined
  syncStepCompletionProjection(step)
}

function addCompletion(step: ProgramStepDraft) {
  step.completions ||= []
  step.completions.push(createProgramStepCompletion('check'))
  syncStepCompletionProjection(step)
}

function removeCompletion(step: ProgramStepDraft, completionId: string) {
  if (!step.completions || step.completions.length <= 1) return
  step.completions = step.completions.filter(item => item.id !== completionId)
  syncStepCompletionProjection(step)
}

function reorderStepCompletions(step: ProgramStepDraft, result: LongPressDragResult) {
  const completions = step.completions || []
  const byId = new Map(completions.map(item => [item.id, item]))
  const ordered = result.orderedIds
    .map(id => byId.get(id))
    .filter((item): item is ProgramStepCompletion => Boolean(item))
  if (ordered.length !== completions.length) return
  step.completions = ordered
  syncStepCompletionProjection(step)
}

function completionDropHandler(step: ProgramStepDraft) {
  return (result: LongPressDragResult) => reorderStepCompletions(step, result)
}

function syncProgramSequence() {
  draft.steps.forEach((step, index) => {
    step.sortOrder = index
    step.cycleDays = [index + 1]
  })
  draft.cycleLength = draft.steps.length
}

function orderedProgramItems(steps: ProgramStepDraft[], cycleLength: number) {
  const sortedSteps = [...steps].sort((a, b) => a.sortOrder - b.sortOrder)
  if (sortedSteps.some(step => step.completionType === 'day_off')) return sortedSteps

  const stepsByDay = new Map<number, ProgramStepDraft[]>()
  const unassigned: ProgramStepDraft[] = []
  for (const step of sortedSteps) {
    const assignedDays = [...new Set(step.cycleDays)]
      .filter(day => Number.isInteger(day) && day > 0 && day <= cycleLength)
      .sort((a, b) => a - b)
    if (!assignedDays.length) {
      unassigned.push(step)
      continue
    }
    assignedDays.forEach((day, assignmentIndex) => {
      const scheduledStep = assignmentIndex === 0
        ? step
        : {
            ...step,
            id: undefined,
            completions: step.completions?.map(completion => ({
              ...completion,
              id: createProgramStepCompletion(completion.type).id,
            })),
          }
      const daySteps = stepsByDay.get(day) || []
      daySteps.push(scheduledStep)
      stepsByDay.set(day, daySteps)
    })
  }

  const items: ProgramStepDraft[] = []
  for (let day = 1; day <= cycleLength; day += 1) {
    const daySteps = stepsByDay.get(day)
    if (daySteps?.length) items.push(...daySteps)
    else items.push(dayOffStep(items.length))
  }
  items.push(...unassigned)
  return items
}

watch(() => draft.type, (type) => {
  if (typeLocked.value) return
  if (type === 'duration') {
    draft.unit = 'hours'; draft.targetValue = 5
  } else if (type === 'daily_total') {
    draft.unit = 'g'; draft.targetValue = 150
  } else if (type === 'step_counter') {
    draft.unit = 'steps'; draft.customUnit = ''; draft.targetValue = 10000; draft.targetOperator = 'gte'
  } else if (type === 'program' && !draft.steps.length) addStep(false)
}, { immediate: true })

onMounted(async () => {
  await Promise.all([
    store.tasks.length ? Promise.resolve() : store.load(),
    intervalStore.loaded ? Promise.resolve() : intervalStore.load(),
    flashcardStore.loaded ? Promise.resolve() : flashcardStore.load(),
    trackingStore.loaded ? Promise.resolve() : trackingStore.load(),
  ])
  if (!route.params.id) {
    if (draft.type === 'program' && !draft.steps.length) addStep(false)
    return
  }
  const task = store.tasks.find((item) => item.id === route.params.id)
  if (!task) {
    error.value = 'That task could not be found.'
    return
  }
  Object.assign(draft, {
    ...task,
    steps: orderedProgramItems(
      store.steps
        .filter((step) => step.active && step.task === task.id)
        .map(({ task: _task, ...step }) => ({ ...step })),
      task.cycleLength || 0,
    ),
  })
  if (task.type === 'program') syncProgramSequence()
})

async function addStep(focusName = true) {
  if (draft.steps.length >= 365) return
  draft.steps.push({
    name: '',
    description: '',
    sortOrder: draft.steps.length,
    cycleDays: [draft.steps.length + 1],
    completionType: 'check',
    targetValue: 1,
    targetOperator: 'gte',
    unit: 'count',
    customUnit: '',
    active: true,
    intervalTemplate: undefined,
    flashcardReviewSet: undefined,
    completions: [createProgramStepCompletion()],
  })
  syncProgramSequence()
  openStep.value = draft.steps.length - 1
  if (focusName && allowAutomaticFocus) {
    await nextTick()
    document.querySelector<HTMLInputElement>(`[data-step-index="${openStep.value}"] input`)?.focus()
  }
}

function addDayOff() {
  if (draft.steps.length >= 365) return
  draft.steps.push(dayOffStep(draft.steps.length))
  syncProgramSequence()
  openStep.value = undefined
}

function removeStep(index: number) {
  draft.steps.splice(index, 1)
  syncProgramSequence()
  if (openStep.value === index) openStep.value = undefined
  else if (openStep.value !== undefined && openStep.value > index) openStep.value -= 1
}

function moveStep(index: number, direction: -1 | 1) {
  const targetIndex = index + direction
  if (targetIndex < 0 || targetIndex >= draft.steps.length) return
  const [step] = draft.steps.splice(index, 1)
  if (!step) return
  draft.steps.splice(targetIndex, 0, step)
  syncProgramSequence()

  if (openStep.value === index) openStep.value = targetIndex
  else if (openStep.value === targetIndex) openStep.value = index
}

function stepDragId(step: ProgramStepDraft) {
  if (step.id) return step.id
  const existing = stepDragIds.get(step)
  if (existing) return existing
  nextStepDragId += 1
  const id = `new-program-step-${nextStepDragId}`
  stepDragIds.set(step, id)
  return id
}

function reorderStepsByDrag(result: LongPressDragResult) {
  const expandedStep = openStep.value === undefined
    ? undefined
    : draft.steps[openStep.value]
  const stepsById = new Map(draft.steps.map(step => [stepDragId(step), step]))
  const orderedSteps = result.orderedIds
    .map(id => stepsById.get(id))
    .filter((step): step is ProgramStepDraft => Boolean(step))
  if (orderedSteps.length !== draft.steps.length) return

  draft.steps.splice(0, draft.steps.length, ...orderedSteps)
  syncProgramSequence()
  openStep.value = expandedStep
    ? draft.steps.indexOf(expandedStep)
    : undefined
}

async function save() {
  if (draft.type === 'program') syncProgramSequence()
  const result = await form.value?.validate()
  if (!result?.valid) return
  if (draft.type === 'program' && !draft.steps.some(step => step.completionType !== 'day_off')) {
    error.value = 'Add at least one program step.'
    return
  }
  if (draft.type === 'interval' && !draft.intervalTemplate) {
    error.value = 'Select an interval for this task.'
    return
  }
  if (draft.type === 'flashcards' && !draft.flashcardReviewSet) {
    error.value = 'Select a Review set for this task.'
    return
  }
  if (draft.type === 'tracking' && !draft.trackingTrackers?.length) {
    error.value = 'Select at least one tracker for this task.'
    return
  }
  if (isSessionTask.value && draft.sessionGoalType === 'duration' && !draft.sessionTargetSeconds) {
    error.value = 'Choose a duration greater than zero.'
    return
  }
  if (draft.reminderEnabled && !draft.reminderTimes.length) {
    error.value = 'Add at least one notification time.'
    return
  }
  if (new Set(draft.reminderTimes).size !== draft.reminderTimes.length) {
    error.value = 'Choose a different time for each notification.'
    return
  }
  if (draft.scheduleMode === 'time_based' && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(draft.scheduledTime || '')) {
    error.value = 'Choose a valid time for this task.'
    return
  }
  const emptyCompletionStep = draft.type === 'program'
    ? draft.steps.findIndex(step => step.completionType !== 'day_off' && !step.completions?.length)
    : -1
  if (emptyCompletionStep >= 0) {
    openStep.value = emptyCompletionStep
    error.value = 'Add at least one completion requirement to every program step.'
    return
  }
  const incompleteIntervalStep = draft.type === 'program'
    ? draft.steps.findIndex(step => step.completions?.some(item => (
      item.type === 'interval' && !item.intervalTemplate
    )))
    : -1
  if (incompleteIntervalStep >= 0) {
    openStep.value = incompleteIntervalStep
    error.value = 'Select an interval for every interval requirement.'
    return
  }
  const incompleteFlashcardStep = draft.type === 'program'
    ? draft.steps.findIndex(step => step.completions?.some(item => (
      item.type === 'flashcards' && !item.flashcardReviewSet
    )))
    : -1
  if (incompleteFlashcardStep >= 0) {
    openStep.value = incompleteFlashcardStep
    error.value = 'Select a Review set for every Review set requirement.'
    return
  }
  saving.value = true
  error.value = ''
  try {
    if (draft.reminderEnabled && reminderAvailable && !await requestTaskReminderPermission()) {
      throw new Error('Notification permission is required to enable daily reminders.')
    }
    const persistence = store.saveTask(draft)
    await router.replace('/tasks')
    await persistence
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not save the task.'
  } finally {
    saving.value = false
  }
}

async function setTaskArchived() {
  if (!draft.id) return
  const task = store.tasks.find(item => item.id === draft.id)
  if (!task) return
  archiving.value = true
  error.value = ''
  try {
    await store.setTaskArchived(task, !task.archived)
    archiveDialog.value = false
    await router.replace('/tasks')
  } catch (cause) {
    error.value = cause instanceof Error
      ? cause.message
      : `Could not ${draft.archived ? 'restore' : 'archive'} the task.`
    archiveDialog.value = false
  } finally {
    archiving.value = false
  }
}

</script>

<template>
  <main class="app-page app-page--editor editor-page" :class="{ 'editor-page--editing': isEditing }">
    <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>

    <AppForm ref="form" validate-on="lazy" @submit.prevent="save">
      <v-card class="surface-card pa-5 mb-4">
        <div class="field-stack mb-4">
          <v-text-field v-model="draft.name" label="Task name" placeholder="e.g. Hit protein target" :rules="[v => Boolean(v) || 'Name is required']" />
          <v-textarea v-model="draft.description" label="Why does this matter? (optional)" rows="2" auto-grow variant="outlined" />
        </div>
        <div v-if="!typeLocked" class="mb-4">
          <label class="field-label">Task type</label>
          <div class="type-selector mt-2">
            <button
              v-for="option in TASK_TYPE_OPTIONS"
              :key="option.type"
              type="button"
              class="editor-type"
              :class="{ 'editor-type--selected': draft.type === option.type }"
              :aria-pressed="draft.type === option.type"
              @click="draft.type = option.type"
            >
              <span :style="{ background: option.color }"><v-icon :icon="option.icon" /></span>
              <strong>{{ option.title }}</strong>
              <small>{{ option.subtitle }}</small>
            </button>
          </div>
        </div>
        <ColorSwatchPicker
          v-model="draft.color"
          label="Routine color"
          custom-label="Choose a custom routine color"
          class="mb-4"
        />
        <div class="setting-row">
          <div><strong>Required</strong><p>Counts toward your daily score</p></div>
          <v-switch v-model="draft.mandatory" color="secondary" hide-details inset />
        </div>
        <v-divider />
        <div class="setting-row">
          <div><strong>Review if unfinished</strong><p>Ask whether to miss, carry, or reschedule</p></div>
          <v-switch v-model="draft.reviewWhenMissed" color="secondary" hide-details inset />
        </div>
        <template v-if="showImageLogSettings">
          <v-divider />
          <div class="setting-row">
            <div><strong>Log with images</strong><p>Quickly log a labeled amount from a photo</p></div>
            <v-switch v-model="draft.logWithImagesEnabled" color="secondary" hide-details="auto" inset />
          </div>
        </template>
      </v-card>

      <v-card v-if="draft.type === 'interval'" class="surface-card field-stack pa-5 mb-4">
        <template v-if="intervalStore.templates.length">
          <v-select
            v-model="draft.intervalTemplate"
            label="Attached interval"
            :items="intervalItems"
            :rules="[v => Boolean(v) || 'Select an interval']"
          />
          <div v-if="selectedInterval" class="interval-attachment-summary">
            <div class="interval-attachment-icon" :style="{ background: selectedInterval.color }">
              <v-icon icon="mdi-timer-play-outline" />
            </div>
            <div class="min-width-0">
              <strong class="d-block text-truncate">{{ selectedInterval.name }}</strong>
              <p class="text-caption muted">
                {{ formatIntervalDuration(intervalDuration(selectedInterval.definition)) }} ·
                {{ intervalStepCount(selectedInterval.definition) }} intervals
              </p>
            </div>
          </div>
        </template>
        <div v-else class="text-center py-3">
          <v-icon icon="mdi-timer-plus-outline" size="36" class="mb-3" />
          <h2 class="text-body-1 font-weight-black">Create an interval first</h2>
          <p class="text-body-2 muted mt-2 mb-4">Interval tasks need a saved interval to run.</p>
          <v-btn color="secondary" variant="tonal" to="/intervals/new">Create interval</v-btn>
        </div>
      </v-card>

      <v-card v-if="draft.type === 'flashcards'" class="surface-card field-stack pa-5 mb-4">
        <template v-if="flashcardStore.reviewSets.length">
          <v-select
            v-model="draft.flashcardReviewSet"
            label="Review set"
            :items="reviewSetItems"
            autocomplete="off"
            :rules="[v => Boolean(v) || 'Select a Review set']"
          />
          <div v-if="selectedReviewSet" class="interval-attachment-summary">
            <div class="flashcard-attachment-icon">
              <v-icon icon="mdi-cards-playing-outline" />
            </div>
            <div class="min-width-0">
              <strong class="d-block text-truncate">{{ selectedReviewSet.name }}</strong>
              <p class="text-caption muted">{{ reviewSetSummary(selectedReviewSet.id) }}</p>
            </div>
          </div>
        </template>
        <div v-else class="text-center py-3">
          <v-icon icon="mdi-cards-outline" size="36" class="mb-3" />
          <h2 class="text-body-1 font-weight-black">Create a Review set first</h2>
          <p class="text-body-2 muted mt-2 mb-4">Review set tasks need a saved Review set to run.</p>
          <v-btn color="secondary" variant="tonal" to="/flashcards/review-sets/new">Create Review set</v-btn>
        </div>
      </v-card>

      <v-card v-if="isSessionTask" class="surface-card field-stack pa-5 mb-4">
        <div>
          <h2 class="text-body-1 font-weight-black">Session objective</h2>
          <p class="text-body-2 muted mt-1">Choose which sessions count and what finishes this task each day.</p>
        </div>
        <v-select
          v-model="draft.sessionCountMode"
          label="What counts"
          :items="sessionCountItems"
        />
        <v-select
          v-model="draft.sessionGoalType"
          label="Goal"
          :items="[
            { title: 'Complete one session', value: 'complete' },
            { title: 'Reach a duration', value: 'duration' },
          ]"
        />
        <v-expand-transition>
          <div v-if="draft.sessionGoalType === 'duration'" class="session-duration-setting">
            <label class="field-label">Daily duration</label>
            <TimerWheelPicker
              v-model="draft.sessionTargetSeconds"
              :max-minutes="180"
              mode="duration"
              class="mt-2"
            />
            <p class="field-help mt-2">
              Time from completed sessions and sessions you end early is added to this task.
            </p>
          </div>
        </v-expand-transition>
      </v-card>

      <v-card v-if="draft.type === 'tracking'" class="surface-card field-stack pa-5 mb-4">
        <template v-if="trackingTrackerItems.length">
          <v-select
            v-model="draft.trackingTrackers"
            label="Trackers to log"
            :items="trackingTrackerItems"
            autocomplete="off"
            multiple
            chips
            :rules="[value => Boolean(value?.length) || 'Select at least one tracker']"
            hint="This task completes after every selected tracker is logged for the scheduled date."
            persistent-hint
          >
            <template #item="{ props: itemProps, item }">
              <v-list-item v-bind="itemProps">
                <template #prepend>
                  <span class="tracking-attachment-icon mr-3" :style="{ background: item.raw.color }">
                    <v-icon :icon="item.raw.icon" size="18" />
                  </span>
                </template>
              </v-list-item>
            </template>
            <template #selection="{ item }">
              <v-chip size="small" closable @click:close.stop="removeTrackingTracker(item.value)">
                <span
                  v-if="trackingTrackerFor(item.value)"
                  class="tracking-selection-icon mr-1"
                  :style="{ background: trackingTrackerFor(item.value)?.color }"
                >
                  <v-icon :icon="trackingTrackerFor(item.value)?.icon" size="14" />
                </span>
                {{ item.title }}
              </v-chip>
            </template>
          </v-select>
        </template>
        <div v-else class="text-center py-3">
          <v-icon icon="mdi-chart-box-plus-outline" size="36" class="mb-3" />
          <h2 class="text-body-1 font-weight-black">Create a tracker first</h2>
          <p class="text-body-2 muted mt-2 mb-4">Tracking tasks need at least one tracker to log.</p>
          <v-btn color="secondary" variant="tonal" to="/tracking/new">Create tracker</v-btn>
        </div>
      </v-card>

      <v-card v-if="draft.type === 'journal'" class="surface-card pa-5 mb-4">
        <div class="journal-task-summary">
          <v-icon icon="mdi-notebook-edit-outline" color="secondary" size="24" />
          <div>
            <h2 class="text-body-1 font-weight-black">Write one reflection</h2>
            <p>A linked journal entry completes this task for its scheduled date.</p>
          </div>
        </div>
      </v-card>

      <v-card class="surface-card field-stack pa-5 mb-4">
        <div>
          <h2 class="text-body-1 font-weight-black">Time</h2>
          <p class="text-body-2 muted mt-1">Place this task in the all-day list or at a specific time.</p>
        </div>
        <v-btn-toggle
          v-model="draft.scheduleMode"
          class="schedule-mode-toggle"
          color="secondary"
          selected-class="schedule-mode-toggle--selected"
          mandatory
        >
          <v-btn value="all_day" prepend-icon="mdi-calendar-blank-outline">
            All day
          </v-btn>
          <v-btn value="time_based" prepend-icon="mdi-clock-outline">
            Time based
          </v-btn>
        </v-btn-toggle>
        <v-expand-transition>
          <div v-if="draft.scheduleMode === 'time_based'" class="scheduled-time-setting">
            <label class="field-label">Scheduled time <span class="text-error">*</span></label>
            <TimerWheelPicker
              v-model="scheduledTimeModel"
              mode="time"
              class="mt-2"
            />
          </div>
        </v-expand-transition>
      </v-card>

      <TaskReminderSettings
        v-model:enabled="draft.reminderEnabled"
        v-model:times="draft.reminderTimes"
        :available="reminderAvailable"
      />

      <v-card v-if="draft.type !== 'program'" class="surface-card field-stack pa-5 mb-4">
        <v-select
          v-model="draft.recurrenceType"
          label="Repeat"
          :items="[
            { title: 'Every day', value: 'daily' },
            { title: 'Selected weekdays', value: 'weekdays' },
            { title: 'Every N weeks', value: 'interval_weeks' },
          ]"
        />
        <div v-if="draft.recurrenceType !== 'daily'" class="scheduled-days">
          <label class="field-label">Scheduled days</label>
          <div class="weekday-wrap mt-2">
            <v-btn-toggle
              v-model="draft.weekdays"
              multiple
              class="weekday-picker"
              color="secondary"
              selected-class="day-picker--selected"
            >
              <v-btn v-for="day in weekdays" :key="day.value" :value="day.value" size="small" class="px-0">{{ day.label }}</v-btn>
            </v-btn-toggle>
          </div>
        </div>
        <v-number-input
          v-if="draft.recurrenceType === 'interval_weeks'"
          v-model="draft.intervalWeeks"
          label="Repeat every"
          :min="1"
          :max="52"
          :step="1"
          suffix="weeks"
        />
        <div class="date-grid date-range-grid">
          <DatePickerField v-model="draft.startDate" label="Starts" />
          <DatePickerField v-model="draft.endDate" label="Ends (optional)" clearable />
        </div>
      </v-card>

      <v-card v-if="showTarget" class="surface-card field-stack pa-5 mb-4">
        <div class="target-grid">
          <v-select
            v-if="draft.type === 'daily_total' || draft.type === 'step_counter'"
            v-model="draft.targetOperator"
            label="Goal"
            :items="[{ title: 'At least', value: 'gte' }, { title: 'At most', value: 'lte' }, { title: 'Exactly', value: 'eq' }]"
          />
          <v-number-input
            v-model="draft.targetValue"
            label="Target"
            :min="0"
            :precision="null"
          />
          <v-select v-if="draft.type !== 'step_counter'" v-model="draft.unit" label="Unit" :items="units" />
          <v-text-field v-else model-value="Steps" label="Unit" readonly />
          <v-text-field v-if="draft.type !== 'step_counter' && draft.unit === 'custom'" v-model="draft.customUnit" label="Custom unit" />
        </div>
        <div v-if="draft.type === 'step_counter'" class="step-source-note">
          <v-icon icon="mdi-heart-pulse" color="secondary" size="20" />
          <p>Progress updates automatically from the Health Connect source configured in Settings.</p>
        </div>
        <v-select
          v-if="draft.type === 'duration'"
          v-model="draft.goalPeriod"
          label="Tracking window"
          :items="[{ title: 'Each scheduled day', value: 'occurrence' }, { title: 'Monday–Sunday total', value: 'week' }]"
        />
      </v-card>

      <template v-if="draft.type === 'program'">
        <v-card class="surface-card pa-5 mb-4">
          <div class="mb-4">
            <DatePickerField v-model="draft.startDate" label="Starts" />
          </div>
          <div class="setting-row">
            <div><strong>Repeat program</strong><p>Restart after the final cycle day</p></div>
            <v-switch v-model="draft.programRepeat" color="secondary" hide-details inset />
          </div>
          <v-divider />
          <div class="setting-row">
            <div><strong>Strict sequence</strong><p>Earlier steps must be resolved first</p></div>
            <v-switch v-model="draft.programStrict" color="secondary" hide-details inset />
          </div>
        </v-card>

        <div class="section-heading">
          <h2>Program steps</h2>
          <div class="d-flex flex-wrap justify-end ga-2">
            <v-btn
              size="small"
              variant="text"
              prepend-icon="mdi-power-sleep"
              :disabled="draft.steps.length >= 365"
              @click="addDayOff"
            >
            Day off
            </v-btn>
            <v-btn
              size="small"
              variant="tonal"
              prepend-icon="mdi-plus"
              :disabled="draft.steps.length >= 365"
              @click="addStep()"
            >
              Step
            </v-btn>
          </div>
        </div>
        <v-expansion-panels v-model="openStep" variant="accordion" class="step-panels mb-4">
          <v-expansion-panel
            v-for="(step, index) in draft.steps"
            :key="stepDragId(step)"
            :value="index"
            v-long-press-drag="{
              id: stepDragId(step),
              group: 'program-steps',
              handle: '.program-step__drag-handle',
              disabled: draft.steps.length < 2,
              onDrop: reorderStepsByDrag,
            }"
            elevation="0"
            rounded="xl"
            class="surface-card program-step-panel"
            :class="{
              'program-step-panel--draggable': draft.steps.length > 1,
              'program-step-panel--day-off': step.completionType === 'day_off',
            }"
            :readonly="step.completionType === 'day_off'"
          >
            <v-expansion-panel-title
              class="program-step__drag-handle"
              :hide-actions="step.completionType === 'day_off'"
            >
              <div v-if="step.completionType === 'day_off'" class="day-off-row">
                <span class="step-number day-off-icon"><v-icon icon="mdi-power-sleep" size="18" /></span>
                <div class="min-width-0 flex-grow-1">
                  <strong>Day off</strong>
                  <p class="text-caption muted">Day {{ index + 1 }} · No task scheduled</p>
                </div>
                <div class="d-flex" @touchstart.stop @click.stop>
                  <v-btn
                    icon="mdi-delete-outline"
                    color="error"
                    variant="text"
                    size="small"
                    class="mr-n4"
                    aria-label="Remove day off"
                    @click.stop="removeStep(index)"
                  />
                </div>
              </div>
              <div v-else class="d-flex align-center ga-3">
                <span class="step-number">{{ index + 1 }}</span>
                <div><strong>{{ step.name || `Step ${index + 1}` }}</strong><p class="text-caption muted">Day {{ index + 1 }}</p></div>
              </div>
            </v-expansion-panel-title>
            <v-expansion-panel-text v-if="step.completionType !== 'day_off'">
              <div class="field-stack mt-2 mb-4">
                <v-text-field
                  v-model="step.name"
                  :data-step-index="index"
                  label="Step name"
                  :rules="[v => Boolean(v) || 'Name is required']"
                />
                <v-textarea v-model="step.description" label="Instructions (optional)" rows="2" variant="outlined" />
              </div>
              <div class="completion-requirements mb-4">
                <div class="d-flex align-center justify-space-between ga-3 mb-3">
                  <div>
                    <strong class="text-body-2">Completion requirements</strong>
                    <p class="text-caption muted">Complete every item. Hold and drag to reorder.</p>
                  </div>
                  <v-btn
                    size="small"
                    variant="tonal"
                    prepend-icon="mdi-plus"
                    @click="addCompletion(step)"
                  >
                    Add
                  </v-btn>
                </div>
                <div class="completion-requirement-list">
                  <div
                    v-for="(completion, completionIndex) in step.completions"
                    :key="completion.id"
                    v-long-press-drag="{
                      id: completion.id,
                      group: `program-step-completions-${stepDragId(step)}`,
                      handle: '.completion-requirement__drag-handle',
                      disabled: (step.completions?.length || 0) < 2,
                      onDrop: completionDropHandler(step),
                    }"
                    class="completion-requirement"
                  >
                    <div class="completion-requirement__drag-handle">
                      <v-icon icon="mdi-drag" size="20" color="medium-emphasis" />
                      <strong>Requirement {{ completionIndex + 1 }}</strong>
                      <v-btn
                        icon="mdi-delete-outline"
                        color="error"
                        variant="text"
                        size="small"
                        :disabled="(step.completions?.length || 0) <= 1"
                        :aria-label="`Remove requirement ${completionIndex + 1}`"
                        @touchstart.stop
                        @click.stop="removeCompletion(step, completion.id)"
                      />
                    </div>
                    <v-select
                      :model-value="completionStyleValue(completion)"
                      label="Completion style"
                      :items="completionStyleItems"
                      autocomplete="off"
                      :rules="[v => Boolean(v) || 'Select a completion style']"
                      @update:model-value="setCompletionStyle(step, completion, $event)"
                    >
                      <template #item="{ props: itemProps, item }">
                        <v-list-item v-bind="itemProps">
                          <template #prepend>
                            <span
                              class="completion-style-icon mr-3"
                              :style="{ background: item.raw.color }"
                            >
                              <v-icon :icon="item.raw.icon" size="18" />
                            </span>
                          </template>
                        </v-list-item>
                      </template>
                      <template #selection="{ item }">
                        <span class="completion-style-selection">
                          <span
                            class="completion-style-selection__icon"
                            :style="{ background: item.raw.color }"
                          >
                            <v-icon :icon="item.raw.icon" size="14" />
                          </span>
                          <span class="text-truncate">{{ item.title }}</span>
                        </span>
                      </template>
                    </v-select>
                    <div v-if="completion.type === 'check'" class="completion-check-summary">
                      <v-icon icon="mdi-check-circle-outline" color="secondary" />
                      <span>A separate check-off is required.</span>
                    </div>
                    <div v-if="completion.type === 'quantity'" class="target-grid">
                      <v-number-input
                        v-model="completion.targetValue"
                        label="Target"
                        :min="0"
                        :precision="null"
                      />
                      <v-select v-model="completion.targetOperator" label="Goal" :items="[{ title: 'At least', value: 'gte' }, { title: 'At most', value: 'lte' }, { title: 'Exactly', value: 'eq' }]" />
                      <v-select v-model="completion.unit" label="Unit" :items="units" />
                      <v-text-field v-if="completion.unit === 'custom'" v-model="completion.customUnit" label="Custom unit" autocomplete="off" />
                    </div>
                  </div>
                </div>
              </div>
              <v-btn
                block
                class="mt-3"
                color="error"
                variant="tonal"
                prepend-icon="mdi-delete-outline"
                @click="removeStep(index)"
              >
                Remove step
              </v-btn>
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>
      </template>
    </AppForm>

    <FormActionBar
      :primary-text="isEditing ? 'Save' : 'Create'"
      :loading="saving"
      :show-archive="isEditing"
      :archived="draft.archived"
      :archive-label="draft.archived ? 'Restore routine' : 'Archive routine'"
      :archive-disabled="archiving"
      @submit="save"
      @cancel="router.back()"
      @archive="archiveDialog = true"
    />

    <ConfirmDialog
      v-model="archiveDialog"
      :title="draft.archived ? 'Restore this routine?' : 'Archive this routine?'"
      :message="draft.archived
        ? 'This routine will return to the Tasks view with its previous active or paused state.'
        : 'This routine will leave your schedule, while its settings, logged entries, and history remain available.'"
      :confirm-text="draft.archived ? 'Restore routine' : 'Archive routine'"
      :confirm-color="draft.archived ? 'secondary' : 'warning'"
      :icon="draft.archived ? 'mdi-archive-arrow-up-outline' : 'mdi-archive-arrow-down-outline'"
      :loading="archiving"
      @confirm="setTaskArchived"
    />
  </main>
</template>

<style scoped>
.type-selector { display: grid; grid-template-columns: 1fr; gap: .6rem; }
.editor-type { position: relative; display: grid; grid-template-columns: 44px 1fr; grid-template-rows: auto auto; align-content: center; column-gap: .65rem; padding: .9rem; border: 0; border-radius: 20px; background: rgb(var(--v-theme-surface-variant) / .72); color: rgb(var(--v-theme-on-surface)); text-align: left; cursor: pointer; }
.editor-type::after { position: absolute; inset: 0; border: 2px solid #626a61; border-radius: inherit; content: ""; pointer-events: none; }
.editor-type > span { display: grid; width: 42px; height: 42px; grid-row: 1 / 3; place-items: center; border-radius: 13px; color: #17200f; }
.editor-type strong { align-self: end; font-size: .85rem; }
.editor-type small { align-self: start; color: rgb(var(--v-theme-on-surface) / .72); font-size: .68rem; }
.editor-type--selected { background: rgb(var(--v-theme-secondary) / .16); box-shadow: 0 8px 22px rgb(var(--v-theme-secondary) / .12); }
.editor-type--selected::after { border: 3px solid #c7f464; }
.editor-type:focus-visible { outline: 3px solid rgb(var(--v-theme-primary) / .55); outline-offset: 3px; }
.setting-row { display: flex; min-height: 70px; align-items: center; justify-content: space-between; gap: 1rem; }
.setting-row strong { font-size: .83rem; }
.setting-row p { margin-top: .15rem; color: rgb(var(--v-theme-on-surface) / .5); font-size: .7rem; }
.field-label { color: rgb(var(--v-theme-on-surface) / .68); font-size: .75rem; font-weight: 750; }
.scheduled-days, .weekday-wrap { width: 100%; min-width: 0; max-width: 100%; }
.weekday-picker { display: flex; width: 100%; min-width: 0; max-width: 100%; flex-wrap: wrap; justify-content: flex-start; gap: .5rem; height: auto }
.weekday-picker :deep(.v-btn) { width: auto; min-width: 2.75rem; flex: 1 1 calc(25% - .5rem); height: 2rem !important; }
.weekday-picker :deep(.day-picker--selected) {
  background: rgb(var(--v-theme-secondary)) !important;
  color: rgb(var(--v-theme-on-secondary)) !important;
  opacity: 1;
}
.field-stack { display: grid; gap: 1rem; }
.schedule-mode-toggle { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); height: auto; }
.schedule-mode-toggle :deep(.v-btn) { min-width: 0; min-height: 2.75rem; }
.schedule-mode-toggle :deep(.schedule-mode-toggle--selected) {
  background: rgb(var(--v-theme-secondary));
  color: rgb(var(--v-theme-on-secondary));
  opacity: 1;
}
.scheduled-time-setting { min-width: 0; }
.date-grid, .target-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; }
.date-range-grid { grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr)); }
.step-source-note { display: flex; align-items: flex-start; gap: .65rem; padding: .8rem; border-radius: 16px; background: rgb(var(--v-theme-surface-variant)); }
.step-source-note p { color: rgb(var(--v-theme-on-surface) / .58); font-size: .72rem; line-height: 1.45; }
.step-panels :deep(.v-expansion-panel) { border: 1px solid rgb(var(--v-theme-on-surface) / .08); }
.step-panels :deep(.program-step-panel--draggable .program-step__drag-handle) { cursor: grab; }
.step-panels :deep(.program-step-panel--day-off) { background: rgb(var(--v-theme-background)); }
.completion-requirement-list { display: grid; }
.completion-requirement { display: grid; padding: 0 1rem .5rem; border: .0625rem solid rgb(var(--v-theme-on-surface) / .1); border-radius: 1rem; background: rgb(var(--v-theme-background) / .6); }
.completion-requirement .target-grid { grid-template-columns: 1fr; }
.completion-requirement__drag-handle { display: flex; min-height: 2.75rem; align-items: center; gap: .65rem; cursor: grab; }
.completion-requirement__drag-handle strong { min-width: 0; flex: 1 1 auto; font-size: .78rem; }
.completion-check-summary { display: flex; min-height: 2.75rem; align-items: center; gap: .65rem; color: rgb(var(--v-theme-on-surface) / .68); font-size: .75rem; }
.completion-style-icon { display: grid; width: 2.125rem; height: 2.125rem; flex: 0 0 auto; place-items: center; border-radius: .6875rem; color: #17200f; }
.completion-style-selection { display: inline-flex; min-width: 0; align-items: center; gap: .5rem; }
.completion-style-selection__icon { display: inline-grid; width: 1.5rem; height: 1.5rem; flex: 0 0 auto; place-items: center; border-radius: .5rem; color: #17200f; }
.day-off-row { display: flex; width: 100%; min-width: 0; align-items: center; gap: .75rem; }
.step-number.day-off-icon { background: rgb(var(--v-theme-background)); color: rgb(var(--v-theme-on-surface) / .68); }
.interval-attachment-summary { display: flex; align-items: center; gap: .75rem; padding: .85rem; border-radius: 16px; background: rgb(var(--v-theme-surface-variant)); }
.interval-attachment-icon { display: grid; width: 42px; height: 42px; flex: 0 0 auto; place-items: center; border-radius: 14px; color: #17200f; }
.flashcard-attachment-icon { display: grid; width: 42px; height: 42px; flex: 0 0 auto; place-items: center; border-radius: 14px; background: rgb(var(--v-theme-secondary)); color: rgb(var(--v-theme-on-secondary)); }
.tracking-attachment-icon { display: grid; width: 34px; height: 34px; flex: 0 0 auto; place-items: center; border-radius: 11px; color: #17200f; }
.tracking-selection-icon { display: inline-grid; width: 1.25rem; height: 1.25rem; flex: 0 0 auto; place-items: center; border-radius: .4rem; color: #17200f; }
.journal-task-summary { display: flex; align-items: flex-start; gap: .75rem; }
.journal-task-summary p { margin-top: .2rem; color: rgba(var(--v-theme-on-surface), .58); font-size: .72rem; line-height: 1.45; }
.step-number { display: grid; width: 34px; height: 34px; place-items: center; border-radius: 11px; background: rgb(var(--v-theme-secondary)); color: rgb(var(--v-theme-on-secondary)); font-size: .75rem; font-weight: 900; }
.editor-page,
.editor-page--editing { padding-bottom: 5rem; }
@media (min-width: 60rem) {
  .editor-type { padding: 2rem; }
  .editor-page,
  .editor-page--editing { padding-bottom: 5rem; }
}
@media (min-width: 37.5rem) {
  .type-selector { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .weekday-picker :deep(.v-btn) { width: auto; min-width: 0; flex: 1 1 0; }
  .completion-requirement .target-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
