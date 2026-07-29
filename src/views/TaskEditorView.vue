<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { format } from 'date-fns'
import { useRoute, useRouter } from 'vue-router'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import QuickAmountsEditor from '@/components/QuickAmountsEditor.vue'
import { useTaskStore } from '@/stores/tasks'
import type { TaskDraft, TaskType } from '@/types/domain'

const route = useRoute()
const router = useRouter()
const store = useTaskStore()
const form = ref()
const saving = ref(false)
const deleting = ref(false)
const deleteDialog = ref(false)
const openStep = ref<number>()
const error = ref('')
const typeLocked = computed(() => Boolean(route.params.id))
const isEditing = computed(() => Boolean(route.params.id))

const typeOptions: Array<{ type: TaskType; title: string; subtitle: string; icon: string; color: string }> = [
  { type: 'check', title: 'Check-off', subtitle: 'One action, one tap', icon: 'mdi-check-bold', color: '#8FB8FF' },
  { type: 'duration', title: 'Duration', subtitle: 'Track time toward a goal', icon: 'mdi-timer-outline', color: '#D4A5FF' },
  { type: 'daily_total', title: 'Daily total', subtitle: 'Protein, calories, water…', icon: 'mdi-chart-donut', color: '#FFB86B' },
  { type: 'program', title: 'Program', subtitle: 'A flexible sequence', icon: 'mdi-repeat-variant', color: '#C7F464' },
]

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
const routineColors = ['#C7F464', '#8FB8FF', '#FFB86B', '#D4A5FF', '#79C174', '#FF776B']

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
  quickAmounts: [1, 5, 10],
  cycleLength: 7,
  programRepeat: true,
  programStrict: false,
  sortOrder: 0,
  steps: [],
})

const cycleDays = computed(() => Array.from({ length: Math.max(1, draft.cycleLength || 1) }, (_, index) => index + 1))
const showTarget = computed(() => draft.type === 'duration' || draft.type === 'daily_total')

watch(() => draft.type, (type) => {
  if (typeLocked.value) return
  if (type === 'duration') {
    draft.unit = 'hours'; draft.targetValue = 5; draft.quickAmounts = [.25, .5, 1]
  } else if (type === 'daily_total') {
    draft.unit = 'g'; draft.targetValue = 150; draft.quickAmounts = [10, 25, 50]
  } else if (type === 'program' && !draft.steps.length) addStep(false)
})

onMounted(async () => {
  if (!store.tasks.length) await store.load()
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
    quickAmounts: [1, 5, 10],
    active: true,
  })
  openStep.value = draft.steps.length - 1
  if (focusName) {
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

async function save() {
  const result = await form.value?.validate()
  if (!result?.valid) return
  if (draft.type === 'program' && !draft.steps.length) {
    error.value = 'Add at least one program step.'
    return
  }
  saving.value = true
  error.value = ''
  try {
    await store.saveTask(draft)
    await router.replace('/plan')
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
    await router.replace('/plan')
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

    <v-form ref="form" validate-on="lazy" @submit.prevent="save">
      <section v-if="!typeLocked" class="mb-6">
        <div class="type-selector">
          <button
            v-for="option in typeOptions"
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
      </section>

      <v-card class="surface-card pa-5 mb-4">
        <div class="field-stack mb-4">
          <v-text-field v-model="draft.name" label="Task name" placeholder="e.g. Hit protein target" :rules="[v => Boolean(v) || 'Name is required']" />
          <v-textarea v-model="draft.description" label="Why does this matter? (optional)" rows="2" auto-grow variant="outlined" />
        </div>
        <label class="field-label">Routine color</label>
        <div class="routine-colors mt-2 mb-4">
          <button
            v-for="color in routineColors"
            :key="color"
            type="button"
            class="color-swatch"
            :class="{ 'color-swatch--selected': draft.color === color }"
            :style="{ background: color }"
            :aria-label="`Use color ${color}`"
            @click="draft.color = color"
          >
            <v-icon v-if="draft.color === color" icon="mdi-check-bold" size="16" />
          </button>
          <label class="custom-color" aria-label="Choose a custom routine color">
            <input v-model="draft.color" type="color" />
            <v-icon icon="mdi-eyedropper-variant" size="18" />
          </label>
        </div>
        <div class="setting-row">
          <div><strong>Required</strong><p>Counts toward your daily score</p></div>
          <v-switch v-model="draft.mandatory" color="secondary" hide-details inset />
        </div>
        <v-divider />
        <div class="setting-row">
          <div><strong>Review if unfinished</strong><p>Ask whether to miss, carry, or reschedule</p></div>
          <v-switch v-model="draft.reviewWhenMissed" color="secondary" hide-details inset />
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
        <div v-if="draft.recurrenceType !== 'daily'">
          <label class="field-label">Scheduled days</label>
          <div class="weekday-scroll mt-2">
            <v-btn-toggle
              v-model="draft.weekdays"
              multiple
              class="weekday-picker"
              color="secondary"
              selected-class="day-picker--selected"
            >
              <v-btn v-for="day in weekdays" :key="day.value" :value="day.value" size="small">{{ day.label }}</v-btn>
            </v-btn-toggle>
          </div>
        </div>
        <v-text-field v-if="draft.recurrenceType === 'interval_weeks'" v-model.number="draft.intervalWeeks" label="Repeat every" type="number" min="1" max="52" suffix="weeks" />
        <div class="date-grid date-range-grid">
          <v-text-field v-model="draft.startDate" label="Starts" type="date" />
          <v-text-field v-model="draft.endDate" label="Ends (optional)" type="date" clearable />
        </div>
      </v-card>

      <v-card v-if="showTarget" class="surface-card field-stack pa-5 mb-4">
        <div class="target-grid">
          <v-select
            v-if="draft.type === 'daily_total'"
            v-model="draft.targetOperator"
            label="Goal"
            :items="[{ title: 'At least', value: 'gte' }, { title: 'At most', value: 'lte' }, { title: 'Exactly', value: 'eq' }]"
          />
          <v-text-field v-model.number="draft.targetValue" label="Target" type="number" min="0" />
          <v-select v-model="draft.unit" label="Unit" :items="units" />
          <v-text-field v-if="draft.unit === 'custom'" v-model="draft.customUnit" label="Custom unit" />
        </div>
        <v-select
          v-if="draft.type === 'duration'"
          v-model="draft.goalPeriod"
          label="Tracking window"
          :items="[{ title: 'Each scheduled day', value: 'occurrence' }, { title: 'Monday–Sunday total', value: 'week' }]"
        />
        <QuickAmountsEditor
          v-model="draft.quickAmounts"
          :unit="draft.customUnit || draft.unit || ''"
        />
      </v-card>

      <template v-if="draft.type === 'program'">
        <v-card class="surface-card pa-5 mb-4">
          <div class="date-grid mb-4">
            <v-text-field v-model.number="draft.cycleLength" label="Cycle length" type="number" min="1" max="365" suffix="days" />
            <v-text-field v-model="draft.startDate" label="Starts" type="date" />
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
          <v-expansion-panel v-for="(step, index) in draft.steps" :key="index" elevation="0" rounded="xl" class="surface-card">
            <v-expansion-panel-title>
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
                  :items="[{ title: 'Check-off', value: 'check' }, { title: 'Quantity target', value: 'quantity' }]"
                />
              </div>
              <div v-if="step.completionType === 'quantity'" class="target-grid mb-4">
                <v-text-field v-model.number="step.targetValue" label="Target" type="number" min="0" />
                <v-select v-model="step.targetOperator" label="Goal" :items="[{ title: 'At least', value: 'gte' }, { title: 'At most', value: 'lte' }, { title: 'Exactly', value: 'eq' }]" />
                <v-select v-model="step.unit" label="Unit" :items="units" />
                <v-text-field v-if="step.unit === 'custom'" v-model="step.customUnit" label="Custom unit" />
              </div>
              <QuickAmountsEditor
                v-if="step.completionType === 'quantity'"
                v-model="step.quickAmounts"
                :unit="step.customUnit || step.unit || ''"
                class="mb-4"
              />
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
    </v-form>

    <div class="save-bar page-action-area">
      <div class="save-bar__inner">
        <v-btn
          class="save-bar__save"
          color="secondary"
          :loading="saving"
          @click="save"
        >
          Save
        </v-btn>
        <v-btn
          class="save-bar__cancel"
          variant="text"
          @click="router.back()"
        >
          Cancel
        </v-btn>
        <v-btn
          v-if="isEditing"
          class="save-bar__delete"
          icon="mdi-delete-outline"
          variant="text"
          color="error"
          aria-label="Delete routine"
          @click="deleteDialog = true"
        />
      </div>
    </div>

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
.weekday-scroll { width: 100%; overflow-x: auto; overscroll-behavior-x: contain; scrollbar-width: none; }
.weekday-scroll::-webkit-scrollbar { display: none; }
.weekday-picker { display: inline-flex; width: max-content; min-width: 100%; max-width: none; justify-content: flex-start; gap: 1rem; }
.weekday-picker :deep(.v-btn) { width: 44px; min-width: 44px; flex: 0 0 44px; }
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
.routine-colors { display: flex; flex-wrap: wrap; align-items: center; gap: .55rem; }
.color-swatch, .custom-color { display: grid; width: 38px; height: 38px; place-items: center; border: 2px solid transparent; border-radius: 12px; color: #17200f; cursor: pointer; }
.color-swatch--selected { border-color: rgb(var(--v-theme-on-surface)); box-shadow: 0 0 0 2px rgb(var(--v-theme-background)); }
.custom-color { position: relative; overflow: hidden; border-color: rgb(var(--v-theme-on-surface) / .18); background: rgb(var(--v-theme-surface-variant)); color: rgb(var(--v-theme-on-surface)); }
.custom-color input { position: absolute; inset: -8px; width: 56px; height: 56px; opacity: 0; cursor: pointer; }
.custom-color .v-icon { pointer-events: none; }
.step-panels :deep(.v-expansion-panel) { border: 1px solid rgb(var(--v-theme-on-surface) / .08); }
.step-number { display: grid; width: 34px; height: 34px; place-items: center; border-radius: 11px; background: rgb(var(--v-theme-secondary)); color: rgb(var(--v-theme-on-secondary)); font-size: .75rem; font-weight: 900; }
.cycle-day-picker { max-height: 145px; overflow-y: auto; }
.step-actions { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
.editor-page,
.editor-page--editing { padding-bottom: 6rem; }
.save-bar { position: fixed; z-index: 20; right: 0; bottom: calc(72px + env(safe-area-inset-bottom)); left: 0; padding: .75rem 1rem; border-top: 1px solid rgba(255,255,255,.08); background: rgba(16,19,16,.9); backdrop-filter: blur(14px); }
.save-bar__inner { display: flex; width: 100%; max-width: 760px; margin: 0 auto; align-items: center; gap: .5rem; }
.save-bar__inner > .v-btn { height: 48px; }
.save-bar__save,
.save-bar__cancel { min-width: 0; flex: 1 1 0; }
.save-bar__delete { order: 1; width: 48px; min-width: 48px; flex: 0 0 48px; }
.save-bar__cancel { order: 2; margin-left: auto; }
.save-bar__save { order: 3; }
@media (min-width: 960px) {
  .editor-type { padding: 2rem; }
  .save-bar { left: 224px; bottom: 0; }
  .editor-page,
  .editor-page--editing { max-width: 760px; padding-bottom: 6rem; }
  .save-bar__inner { justify-content: flex-end; }
  .save-bar__save,
  .save-bar__cancel { max-width: 160px; }
}
@media (min-width: 600px) {
  .type-selector { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .weekday-picker { display: flex; width: 100%; }
  .weekday-picker :deep(.v-btn) { width: auto; min-width: 0; flex: 1 1 0; }
}
</style>
