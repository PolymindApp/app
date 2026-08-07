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
import type { LongPressDragResult } from '@/directives/longPressDrag'
import { formatIntervalDuration, intervalDuration, intervalStepCount } from '@/services/intervals'
import { TASK_TYPE_OPTIONS } from '@/services/taskTypes'
import { useFlashcardStore } from '@/stores/flashcards'
import { useIntervalStore } from '@/stores/intervals'
import { useTaskStore } from '@/stores/tasks'
import { useTrackingStore } from '@/stores/tracking'
import type { ProgramStepDraft, TaskDraft } from '@/types/domain'

const allowAutomaticFocus = Capacitor.getPlatform() !== 'android'
const route = useRoute()
const router = useRouter()
const store = useTaskStore()
const intervalStore = useIntervalStore()
const flashcardStore = useFlashcardStore()
const trackingStore = useTrackingStore()
const form = ref()
const saving = ref(false)
const deleting = ref(false)
const deleteDialog = ref(false)
const openStep = ref<number>()
const error = ref('')
const stepDragIds = new WeakMap<ProgramStepDraft, string>()
let nextStepDragId = 0
const typeLocked = computed(() => Boolean(route.params.id))
const isEditing = computed(() => Boolean(route.params.id))

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
  entryNotesEnabled: false,
  entryNoteSuggestionsEnabled: false,
  sortOrder: 0,
  intervalTemplate: undefined,
  flashcardReviewSet: undefined,
  trackingTrackers: [],
  steps: [],
})

const cycleDays = computed(() => Array.from({ length: Math.max(1, draft.cycleLength || 1) }, (_, index) => index + 1))
const showTarget = computed(() =>
  draft.type === 'duration' || draft.type === 'daily_total' || draft.type === 'step_counter',
)
const showEntryNoteSettings = computed(() =>
  draft.type === 'duration' || draft.type === 'daily_total' || draft.type === 'program',
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
const reviewSetItems = computed(() => flashcardStore.reviewSets.map(item => ({
  title: item.name,
  value: item.id,
  props: {
    subtitle: `${item.mode === 'passive' ? 'Passive' : 'Manual'} · ${flashcardStore.matchingCards(item.tags).length} cards`,
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

function intervalForStep(step: ProgramStepDraft) {
  return intervalStore.templates.find((item) => item.id === step.intervalTemplate)
}

function intervalSummaryForStep(step: ProgramStepDraft) {
  const interval = intervalForStep(step)
  if (!interval) return ''
  return `${formatIntervalDuration(intervalDuration(interval.definition))} · ${intervalStepCount(interval.definition)} intervals`
}

function reviewSetForStep(step: ProgramStepDraft) {
  return flashcardStore.reviewSets.find(item => item.id === step.flashcardReviewSet)
}

function reviewSetSummary(reviewSetId?: string) {
  const reviewSet = flashcardStore.reviewSets.find(item => item.id === reviewSetId)
  if (!reviewSet) return ''
  return `${reviewSet.mode === 'passive' ? 'Passive' : 'Manual'} · ${flashcardStore.matchingCards(reviewSet.tags).length} cards`
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
    steps: store.steps.filter((step) => step.active && step.task === task.id).map(({ task: _task, ...step }) => ({ ...step })),
  })
})

async function addStep(focusName = true) {
  const nextDay = Math.min(draft.steps.length + 1, draft.cycleLength || 1)
  draft.steps.push({
    name: '',
    description: '',
    sortOrder: draft.steps.length,
    cycleDays: [nextDay],
    completionType: 'check',
    targetValue: 1,
    targetOperator: 'gte',
    unit: 'count',
    customUnit: '',
    active: true,
    intervalTemplate: undefined,
    flashcardReviewSet: undefined,
  })
  openStep.value = draft.steps.length - 1
  if (focusName && allowAutomaticFocus) {
    await nextTick()
    document.querySelector<HTMLInputElement>(`[data-step-index="${openStep.value}"] input`)?.focus()
  }
}

function removeStep(index: number) {
  draft.steps.splice(index, 1)
  draft.steps.forEach((step, stepIndex) => {
    step.sortOrder = stepIndex
  })
  if (openStep.value === index) openStep.value = undefined
  else if (openStep.value !== undefined && openStep.value > index) openStep.value -= 1
}

function moveStep(index: number, direction: -1 | 1) {
  const targetIndex = index + direction
  if (targetIndex < 0 || targetIndex >= draft.steps.length) return
  const [step] = draft.steps.splice(index, 1)
  if (!step) return
  draft.steps.splice(targetIndex, 0, step)
  draft.steps.forEach((item, stepIndex) => {
    item.sortOrder = stepIndex
  })

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
  draft.steps.forEach((step, index) => {
    step.sortOrder = index
  })
  openStep.value = expandedStep
    ? draft.steps.indexOf(expandedStep)
    : undefined
}

async function save() {
  const result = await form.value?.validate()
  if (!result?.valid) return
  if (draft.type === 'program' && !draft.steps.length) {
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
  const incompleteIntervalStep = draft.type === 'program'
    ? draft.steps.findIndex(step => step.completionType === 'interval' && !step.intervalTemplate)
    : -1
  if (incompleteIntervalStep >= 0) {
    openStep.value = incompleteIntervalStep
    error.value = 'Select an interval for every interval program step.'
    return
  }
  const incompleteFlashcardStep = draft.type === 'program'
    ? draft.steps.findIndex(step => step.completionType === 'flashcards' && !step.flashcardReviewSet)
    : -1
  if (incompleteFlashcardStep >= 0) {
    openStep.value = incompleteFlashcardStep
    error.value = 'Select a Review set for every flashcard program step.'
    return
  }
  saving.value = true
  error.value = ''
  try {
    await store.saveTask(draft)
    await router.replace('/tasks/manage')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not save the task.'
  } finally {
    saving.value = false
  }
}

async function removeTask() {
  if (!draft.id) return
  deleting.value = true
  error.value = ''
  try {
    await store.deleteTask(draft.id)
    deleteDialog.value = false
    await router.replace('/tasks/manage')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not delete the task.'
    deleteDialog.value = false
  } finally {
    deleting.value = false
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
        <template v-if="showEntryNoteSettings">
          <v-divider />
          <div class="setting-row">
            <div><strong>Notes when logging</strong><p>Add an optional note to each amount entry</p></div>
            <v-switch v-model="draft.entryNotesEnabled" color="secondary" hide-details="auto" inset />
          </div>
          <v-expand-transition>
            <div v-if="draft.entryNotesEnabled">
              <v-divider />
              <div class="setting-row">
                <div><strong>Match notes by amount</strong><p>Prefill the latest note previously used for the same amount</p></div>
                <v-switch v-model="draft.entryNoteSuggestionsEnabled" color="secondary" hide-details="auto" inset />
              </div>
            </div>
          </v-expand-transition>
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
            label="Attached Review set"
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
          <p class="text-body-2 muted mt-2 mb-4">Flashcard tasks need a saved Review set to run.</p>
          <v-btn color="secondary" variant="tonal" to="/flashcards/review-sets/new">Create Review set</v-btn>
        </div>
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
          <div class="date-grid mb-4">
            <v-number-input
              v-model="draft.cycleLength"
              label="Cycle length"
              :min="1"
              :max="365"
              :step="1"
              suffix="days"
            />
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

        <div class="section-heading"><h2>Program steps</h2><v-btn size="small" variant="tonal" prepend-icon="mdi-plus" @click="addStep()">Add step</v-btn></div>
        <v-expansion-panels v-model="openStep" variant="accordion" class="step-panels mb-4">
          <v-expansion-panel
            v-for="(step, index) in draft.steps"
            :key="stepDragId(step)"
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
            :class="{ 'program-step-panel--draggable': draft.steps.length > 1 }"
          >
            <v-expansion-panel-title class="program-step__drag-handle">
              <div class="d-flex align-center ga-3">
                <span class="step-number">{{ index + 1 }}</span>
                <div><strong>{{ step.name || `Step ${index + 1}` }}</strong><p class="text-caption muted">Day {{ step.cycleDays.join(', ') || 'not set' }}</p></div>
              </div>
            </v-expansion-panel-title>
            <v-expansion-panel-text>
              <div class="field-stack mb-4">
                <v-text-field
                  v-model="step.name"
                  :data-step-index="index"
                  label="Step name"
                  :rules="[v => Boolean(v) || 'Name is required']"
                />
                <v-textarea v-model="step.description" label="Instructions (optional)" rows="2" variant="outlined" />
                <v-select
                  v-model="step.completionType"
                  label="Completion style"
                  :items="[
                    { title: 'Check-off', value: 'check' },
                    { title: 'Quantity target', value: 'quantity' },
                    { title: 'Complete a saved interval', value: 'interval' },
                    { title: 'Complete a Review set', value: 'flashcards' },
                  ]"
                />
              </div>
              <div v-if="step.completionType === 'quantity'" class="target-grid mb-4">
                <v-number-input
                  v-model="step.targetValue"
                  label="Target"
                  :min="0"
                  :precision="null"
                />
                <v-select v-model="step.targetOperator" label="Goal" :items="[{ title: 'At least', value: 'gte' }, { title: 'At most', value: 'lte' }, { title: 'Exactly', value: 'eq' }]" />
                <v-select v-model="step.unit" label="Unit" :items="units" />
                <v-text-field v-if="step.unit === 'custom'" v-model="step.customUnit" label="Custom unit" />
              </div>
              <div v-if="step.completionType === 'interval'" class="field-stack mb-4">
                <template v-if="intervalStore.templates.length">
                  <v-select
                    v-model="step.intervalTemplate"
                    label="Attached interval"
                    :items="intervalItems"
                    :rules="[v => Boolean(v) || 'Select an interval']"
                  />
                  <div v-if="intervalForStep(step)" class="interval-attachment-summary">
                    <div
                      class="interval-attachment-icon"
                      :style="{ background: intervalForStep(step)?.color }"
                    >
                      <v-icon icon="mdi-timer-play-outline" />
                    </div>
                    <div class="min-width-0">
                      <strong class="d-block text-truncate">{{ intervalForStep(step)?.name }}</strong>
                      <p class="text-caption muted">{{ intervalSummaryForStep(step) }}</p>
                    </div>
                  </div>
                </template>
                <v-alert v-else type="warning" variant="tonal" density="compact">
                  Create a saved interval before using this completion style.
                </v-alert>
              </div>
              <div v-if="step.completionType === 'flashcards'" class="field-stack mb-4">
                <template v-if="flashcardStore.reviewSets.length">
                  <v-select
                    v-model="step.flashcardReviewSet"
                    label="Attached Review set"
                    :items="reviewSetItems"
                    autocomplete="off"
                    :rules="[v => Boolean(v) || 'Select a Review set']"
                  />
                  <div v-if="reviewSetForStep(step)" class="interval-attachment-summary">
                    <div class="flashcard-attachment-icon">
                      <v-icon icon="mdi-cards-playing-outline" />
                    </div>
                    <div class="min-width-0">
                      <strong class="d-block text-truncate">{{ reviewSetForStep(step)?.name }}</strong>
                      <p class="text-caption muted">{{ reviewSetSummary(step.flashcardReviewSet) }}</p>
                    </div>
                  </div>
                </template>
                <v-alert v-else type="warning" variant="tonal" density="compact">
                  Create a Review set before using this completion style.
                </v-alert>
              </div>
              <label class="field-label">Place on cycle days</label>
              <v-chip-group
                v-model="step.cycleDays"
                multiple
                selected-class="day-picker--selected"
                class="cycle-day-picker mt-2"
              >
                <v-chip v-for="day in cycleDays" :key="day" :value="day" filter>Day {{ day }}</v-chip>
              </v-chip-group>
              <div class="step-actions mt-3">
                <div class="d-flex ga-2">
                  <v-btn
                    icon="mdi-arrow-up"
                    variant="tonal"
                    size="small"
                    :disabled="index === 0"
                    :aria-label="`Move ${step.name || `step ${index + 1}`} up`"
                    @click="moveStep(index, -1)"
                  />
                  <v-btn
                    icon="mdi-arrow-down"
                    variant="tonal"
                    size="small"
                    :disabled="index === draft.steps.length - 1"
                    :aria-label="`Move ${step.name || `step ${index + 1}`} down`"
                    @click="moveStep(index, 1)"
                  />
                </div>
                <v-btn
                  icon="mdi-delete-outline"
                  color="error"
                  variant="text"
                  size="small"
                  :aria-label="`Remove ${step.name || `step ${index + 1}`}`"
                  @click="removeStep(index)"
                />
              </div>
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>
      </template>
    </AppForm>

    <FormActionBar
      :primary-text="isEditing ? 'Save' : 'Create'"
      :loading="saving"
      :show-delete="isEditing"
      delete-label="Delete routine"
      :delete-disabled="deleting"
      @submit="save"
      @cancel="router.back()"
      @delete="deleteDialog = true"
    />

    <ConfirmDialog
      v-model="deleteDialog"
      title="Delete this routine?"
      message="This permanently removes the routine, its program steps, logged entries, and history. This action cannot be undone."
      confirm-text="Delete routine"
      icon="mdi-delete-outline"
      :loading="deleting"
      @confirm="removeTask"
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
.cycle-day-picker :deep(.day-picker--selected) {
  background: rgb(var(--v-theme-primary)) !important;
  color: rgb(var(--v-theme-on-primary)) !important;
  opacity: 1;
}
.field-stack { display: grid; gap: 1rem; }
.date-grid, .target-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; }
.date-range-grid { grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr)); }
.step-source-note { display: flex; align-items: flex-start; gap: .65rem; padding: .8rem; border-radius: 16px; background: rgb(var(--v-theme-surface-variant)); }
.step-source-note p { color: rgb(var(--v-theme-on-surface) / .58); font-size: .72rem; line-height: 1.45; }
.step-panels :deep(.v-expansion-panel) { border: 1px solid rgb(var(--v-theme-on-surface) / .08); }
.step-panels :deep(.program-step-panel--draggable .program-step__drag-handle) { cursor: grab; }
.interval-attachment-summary { display: flex; align-items: center; gap: .75rem; padding: .85rem; border-radius: 16px; background: rgb(var(--v-theme-surface-variant)); }
.interval-attachment-icon { display: grid; width: 42px; height: 42px; flex: 0 0 auto; place-items: center; border-radius: 14px; color: #17200f; }
.flashcard-attachment-icon { display: grid; width: 42px; height: 42px; flex: 0 0 auto; place-items: center; border-radius: 14px; background: rgb(var(--v-theme-secondary)); color: rgb(var(--v-theme-on-secondary)); }
.tracking-attachment-icon { display: grid; width: 34px; height: 34px; flex: 0 0 auto; place-items: center; border-radius: 11px; color: #17200f; }
.tracking-selection-icon { display: inline-grid; width: 1.25rem; height: 1.25rem; flex: 0 0 auto; place-items: center; border-radius: .4rem; color: #17200f; }
.journal-task-summary { display: flex; align-items: flex-start; gap: .75rem; }
.journal-task-summary p { margin-top: .2rem; color: rgba(var(--v-theme-on-surface), .58); font-size: .72rem; line-height: 1.45; }
.step-number { display: grid; width: 34px; height: 34px; place-items: center; border-radius: 11px; background: rgb(var(--v-theme-secondary)); color: rgb(var(--v-theme-on-secondary)); font-size: .75rem; font-weight: 900; }
.cycle-day-picker { max-height: 145px; overflow-y: auto; }
.step-actions { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
.editor-page,
.editor-page--editing { padding-bottom: 6rem; }
@media (min-width: 60rem) {
  .editor-type { padding: 2rem; }
  .editor-page,
  .editor-page--editing { padding-bottom: 6rem; }
}
@media (min-width: 37.5rem) {
  .type-selector { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .weekday-picker :deep(.v-btn) { width: auto; min-width: 0; flex: 1 1 0; }
}
</style>
