<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue'
import { goalState } from '@/services/schedule'
import { taskCanLogAmounts } from '@/services/taskCardActions'
import { TASK_TYPE_PRESENTATION } from '@/services/taskTypes'
import type { TaskProgress } from '@/types/domain'

const TASK_CARD_EXPANSION_STORAGE_PREFIX = 'mom-task-card-expanded'

function expansionStorageKey(progress: TaskProgress) {
  const taskId = encodeURIComponent(progress.task.id)
  const stepId = encodeURIComponent(progress.programStep?.id || 'task')
  return `${TASK_CARD_EXPANSION_STORAGE_PREFIX}:${taskId}:${stepId}`
}

function storedExpansionState(progress: TaskProgress) {
  if (typeof sessionStorage === 'undefined') return undefined
  try {
    const stored = sessionStorage.getItem(expansionStorageKey(progress))
    if (stored === 'expanded') return true
    if (stored === 'collapsed') return false
  } catch {
    // The card remains usable when session storage is unavailable.
  }
  return undefined
}

function storeExpansionState(progress: TaskProgress, expanded: boolean) {
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.setItem(expansionStorageKey(progress), expanded ? 'expanded' : 'collapsed')
  } catch {
    // The in-memory component state remains the source of truth.
  }
}

const props = defineProps<{
  progress: TaskProgress
  busy?: boolean
  valuePulse?: number
  interval?: { name: string; duration: string }
  canStartInterval?: boolean
  intervalActive?: boolean
  reviewSet?: { name: string; cardCount: number; mode: 'manual' | 'passive' }
  canStartReview?: boolean
  reviewActive?: boolean
  trackers?: Array<{ id: string; name: string; icon: string; color: string; logged: boolean }>
  canLogTracking?: boolean
  canWriteJournal?: boolean
  syncing?: boolean
  stepCountError?: string
}>()
const emit = defineEmits<{
  toggle: [progress: TaskProgress, complete: boolean]
  seal: [progress: TaskProgress]
  logAmount: [progress: TaskProgress]
  logTime: [progress: TaskProgress]
  review: [progress: TaskProgress]
  startInterval: [progress: TaskProgress]
  startReview: [progress: TaskProgress]
  logTracking: [progress: TaskProgress, trackerId: string]
  writeJournal: [progress: TaskProgress]
  actions: [progress: TaskProgress]
}>()

const task = computed(() => props.progress.task)
const step = computed(() => props.progress.programStep)
const optimisticComplete = ref<boolean>()
const togglePending = ref(false)
const expanded = ref(storedExpansionState(props.progress) ?? !props.progress.complete)
const valueAnimating = ref(false)
const detailsId = useId()
const expansionKey = computed(() => expansionStorageKey(props.progress))
let valueAnimationVersion = 0
const displayedComplete = computed(() => optimisticComplete.value ?? props.progress.complete)
const isCheck = computed(() => (step.value ? step.value.completionType === 'check' : task.value.type === 'check'))
const isInterval = computed(() =>
  (!step.value && task.value.type === 'interval') || step.value?.completionType === 'interval',
)
const isFlashcards = computed(() =>
  (!step.value && task.value.type === 'flashcards') || step.value?.completionType === 'flashcards',
)
const isTracking = computed(() => !step.value && task.value.type === 'tracking')
const isJournal = computed(() => !step.value && task.value.type === 'journal')
const isDailyTotal = computed(() => !step.value && task.value.type === 'daily_total')
const isStepCounter = computed(() => !step.value && task.value.type === 'step_counter')
const canLogAmount = computed(() => taskCanLogAmounts(props.progress))
const canLogTime = computed(() => !step.value && task.value.type === 'duration')
const canToggleCheck = computed(() =>
  isCheck.value && !togglePending.value && !props.busy && !props.progress.locked,
)
const target = computed(() => isTracking.value
  ? task.value.trackingTrackers?.length ?? 0
  : step.value?.targetValue ?? task.value.targetValue ?? 0)
const unit = computed(() => step.value?.customUnit || step.value?.unit || task.value.customUnit || task.value.unit || '')
const operator = computed(() => ({ gte: 'at least', lte: 'at most', eq: 'exactly' })[step.value?.targetOperator || task.value.targetOperator || 'gte'])
const targetOperator = computed(() => step.value?.targetOperator || task.value.targetOperator || 'gte')
const currentGoalState = computed(() => isCheck.value || isInterval.value || isFlashcards.value || isTracking.value || isJournal.value ? 'neutral' : goalState(props.progress.value, target.value, targetOperator.value))
const numericGoalStatus = computed(() => {
  if (isCheck.value || isInterval.value || isFlashcards.value || isTracking.value || isJournal.value) return undefined
  const difference = target.value - props.progress.value
  if (targetOperator.value === 'gte' && currentGoalState.value === 'not_enough' && difference > 0) {
    return {
      title: 'Not enough yet',
      amount: `${formatValue(difference)} remaining`,
      icon: 'mdi-trending-down',
      tone: 'text-error',
    }
  }
  if (isDailyTotal.value && targetOperator.value === 'lte' && difference > 0) {
    return {
      title: 'Within target',
      amount: `${formatValue(difference)} remaining`,
      icon: 'mdi-check-circle-outline',
      tone: 'text-success',
    }
  }
  if (targetOperator.value === 'eq' && currentGoalState.value !== 'met' && difference > 0) {
    return {
      title: 'Exact target not met',
      amount: `${formatValue(difference)} missing`,
      icon: 'mdi-target',
      tone: 'text-error',
    }
  }
  if ((targetOperator.value === 'lte' && currentGoalState.value === 'exceeded')
    || (targetOperator.value === 'eq' && currentGoalState.value !== 'met' && difference < 0)) {
    return {
      title: 'Target exceeded',
      amount: `${formatValue(Math.abs(difference))} over`,
      icon: 'mdi-alert-outline',
      tone: 'text-warning',
    }
  }
  if (isDailyTotal.value && targetOperator.value === 'gte' && difference < 0) {
    return {
      title: 'Target surpassed',
      amount: `${formatValue(Math.abs(difference))} over`,
      icon: 'mdi-trending-up',
      tone: 'text-success',
    }
  }
  return undefined
})
const taskTypePresentation = computed(() => TASK_TYPE_PRESENTATION[task.value.type])
const taskColor = computed(() => task.value.color || taskTypePresentation.value.color)
const stateColor = computed(() => {
  if (numericGoalStatus.value?.tone === 'text-success') return 'success'
  if (numericGoalStatus.value?.tone === 'text-warning') return 'warning'
  if (numericGoalStatus.value?.tone === 'text-error') return 'error'
  if (currentGoalState.value === 'exceeded') return 'warning'
  if (currentGoalState.value === 'not_enough') return 'error'
  return taskColor.value
})
const stateIcon = computed(() => {
  if (displayedComplete.value) return 'mdi-check-bold'
  if (props.progress.locked) return 'mdi-lock-outline'
  return taskTypePresentation.value.icon
})
const showingTaskTypeIcon = computed(() =>
  !displayedComplete.value && !props.progress.locked,
)
const stateIconColor = computed(() => {
  if (showingTaskTypeIcon.value) return '#191C19'
  if (displayedComplete.value) return 'white'
  return stateColor.value
})
const title = computed(() => step.value?.name || task.value.name)
const subtitle = computed(() => {
  if (isInterval.value) {
    return props.interval?.duration ? `Interval · ${props.interval.duration} total` : 'Interval'
  }
  if (isFlashcards.value) {
    if (!props.reviewSet) return 'Flashcards'
    return `${props.reviewSet.mode === 'passive' ? 'Passive' : 'Manual'} review · ${props.reviewSet.cardCount} cards`
  }
  if (isTracking.value) {
    const total = target.value
    return `${props.progress.value} of ${total} ${total === 1 ? 'tracker' : 'trackers'} logged`
  }
  if (isJournal.value) {
    if (props.progress.value > 0) {
      return `${props.progress.value} ${props.progress.value === 1 ? 'reflection' : 'reflections'} written`
    }
    return task.value.description || 'Write a reflection'
  }
  return step.value ? `${task.value.name} · Program step` : task.value.description
})

function formatValue(value: number) {
  if (task.value.type === 'duration' && !step.value) return `${value % 1 === 0 ? value : value.toFixed(2)}h`
  if (isStepCounter.value) return `${Math.round(value).toLocaleString()} steps`
  return `${Number(value.toFixed(2))}${unit.value ? ` ${unit.value}` : ''}`
}

function toggleCheckCompletion() {
  if (!canToggleCheck.value) return
  const complete = !displayedComplete.value
  optimisticComplete.value = complete
  togglePending.value = true
  emit('toggle', props.progress, complete)
}

function toggleExpandedFromHeader() {
  if (isCheck.value) return
  expanded.value = !expanded.value
  storeExpansionState(props.progress, expanded.value)
}

watch(() => props.busy, (busy) => {
  if (!busy) {
    optimisticComplete.value = undefined
    togglePending.value = false
  }
})

watch(() => props.progress.complete, (complete) => {
  if (complete === optimisticComplete.value || !props.busy) {
    optimisticComplete.value = undefined
    togglePending.value = false
  }
})

watch(expansionKey, () => {
  expanded.value = storedExpansionState(props.progress) ?? !props.progress.complete
})

watch(displayedComplete, (complete, wasComplete) => {
  if (!isCheck.value && complete && !wasComplete) {
    expanded.value = false
    storeExpansionState(props.progress, false)
  }
})

watch(() => props.valuePulse, async (pulse, previousPulse) => {
  if (!pulse || pulse === previousPulse) return
  const version = ++valueAnimationVersion
  valueAnimating.value = false
  await nextTick()
  if (version === valueAnimationVersion) valueAnimating.value = true
})
</script>

<template>
  <v-card
    class="task-card surface-card pa-4"
    :class="{ 'task-card--done': displayedComplete, 'task-card--sealed': progress.sealed }"
    :style="{ '--task-color': taskColor }"
  >
    <div class="d-flex align-start ga-3">
      <div
        class="task-card-header-main d-flex align-start ga-3 flex-grow-1 min-width-0"
        :class="{ 'task-card-header-main--expandable': !isCheck }"
        :role="!isCheck ? 'button' : undefined"
        :tabindex="!isCheck ? 0 : undefined"
        :aria-label="!isCheck ? `${expanded ? 'Collapse' : 'Expand'} ${title}` : undefined"
        :aria-expanded="!isCheck ? expanded : undefined"
        :aria-controls="!isCheck ? detailsId : undefined"
        @click="toggleExpandedFromHeader"
        @keydown.enter.prevent="toggleExpandedFromHeader"
        @keydown.space.prevent="toggleExpandedFromHeader"
      >
        <div
          class="check-control check-control--status"
          :class="{
            'check-control--type': showingTaskTypeIcon,
            'check-control--done': displayedComplete,
          }"
          :style="{ '--task-color': taskColor }"
          aria-hidden="true"
        >
          <v-icon :icon="stateIcon" :color="stateIconColor" size="20" />
        </div>

        <div class="flex-grow-1 min-width-0">
          <div class="d-flex align-center ga-2 flex-wrap">
            <h3 class="task-title">{{ title }}</h3>
            <span v-if="task.mandatory" class="required-dot">Required</span>
          </div>
          <p class="task-subtitle text-truncate mt-1">{{ subtitle || 'Personal' }}</p>
        </div>
      </div>

      <div class="task-card-header-actions d-flex align-center ga-1 flex-shrink-0">
        <v-btn
          v-if="canLogAmount"
          class="task-menu-button"
          icon="mdi-dots-vertical"
          variant="text"
          size="small"
          :aria-label="`More actions for ${title}`"
          @touchstart.stop
          @click.stop="emit('actions', progress)"
        />
      </div>
    </div>

    <v-expand-transition>
      <div
        v-show="isCheck || expanded"
        :id="!isCheck ? detailsId : undefined"
        class="task-card-body"
      >
        <v-btn
          v-if="isCheck"
          block
          class="task-check-toggle mt-4"
          color="secondary"
          :variant="displayedComplete ? 'tonal' : 'flat'"
          :prepend-icon="displayedComplete ? 'mdi-undo-variant' : 'mdi-check-bold'"
          :disabled="!canToggleCheck"
          :aria-label="displayedComplete ? `Uncomplete ${title}` : `Complete ${title}`"
          @touchstart.stop
          @click.stop="toggleCheckCompletion"
        >
          {{ displayedComplete ? 'Uncomplete' : 'Complete' }}
        </v-btn>

        <div v-if="!isCheck" class="task-card-details">
        <template v-if="isInterval">
            <v-btn
              v-if="!displayedComplete && canStartInterval"
              block
              class="mt-4"
              color="secondary"
              prepend-icon="mdi-play"
              :disabled="busy || progress.locked"
              @touchstart.stop
              @click.stop="emit('startInterval', progress)"
            >
              {{ intervalActive ? 'Resume interval' : 'Start interval' }}
            </v-btn>
            <div v-else-if="!displayedComplete && progress.status === 'pending'" class="status-banner mt-3 muted">
              <v-icon icon="mdi-calendar-today-outline" size="16" /> Select today to start this interval
          </div>
        </template>

        <template v-else-if="isFlashcards">
          <v-btn
            v-if="!displayedComplete && canStartReview"
            block
            class="mt-4"
            color="secondary"
            prepend-icon="mdi-cards-playing-outline"
            :disabled="busy || progress.locked || !reviewSet?.cardCount"
            @touchstart.stop
            @click.stop="emit('startReview', progress)"
          >
            {{ reviewActive ? 'Resume review' : 'Start review' }}
          </v-btn>
          <div v-else-if="!displayedComplete && progress.status === 'pending'" class="status-banner mt-3 muted">
            <v-icon icon="mdi-calendar-today-outline" size="16" /> Select today to start this review
          </div>
        </template>

        <template v-else-if="isTracking">
          <v-progress-linear
            :model-value="progress.percent"
            color="secondary"
            bg-color="surface-variant"
            rounded
            height="7"
            class="mt-4"
          />
          <v-list v-if="trackers?.length" class="tracking-task-trackers pa-0 mt-3" bg-color="transparent">
            <v-list-item
              v-for="tracker in trackers"
              :key="tracker.id"
              class="tracking-task-tracker"
              :title="tracker.name"
              :subtitle="tracker.logged ? 'Logged for this date' : 'Not logged for this date'"
              :disabled="!canLogTracking || busy || progress.locked"
              rounded="lg"
              @click="emit('logTracking', progress, tracker.id)"
            >
              <template #prepend>
                <span class="tracking-task-tracker__icon" :style="{ background: tracker.color }">
                  <v-icon :icon="tracker.icon" size="18" />
                </span>
              </template>
              <template #append>
                <v-icon
                  v-if="tracker.logged"
                  icon="mdi-check-circle"
                  color="success"
                  size="18"
                  class="mr-2"
                  aria-label="Logged"
                />
              </template>
            </v-list-item>
          </v-list>
          <div v-if="!canLogTracking && !displayedComplete && progress.status === 'pending'" class="status-banner mt-3 muted">
            <v-icon icon="mdi-calendar-today-outline" size="16" /> Select today or an earlier date to log tracking
          </div>
        </template>

        <template v-else-if="isJournal">
          <v-btn
            v-if="canWriteJournal"
            block
            class="mt-4"
            color="secondary"
            prepend-icon="mdi-notebook-edit-outline"
            :disabled="busy || progress.locked"
            @touchstart.stop
            @click.stop="emit('writeJournal', progress)"
          >
            {{ displayedComplete ? 'Write another reflection' : 'Write reflection' }}
          </v-btn>
          <div v-else-if="!displayedComplete && progress.status === 'pending'" class="status-banner mt-3 muted">
            <v-icon icon="mdi-calendar-today-outline" size="16" /> Select today or an earlier date to write
          </div>
        </template>

        <template v-else>
            <div class="metric-row mt-4">
              <div>
                <span
                  class="metric-value"
                  :class="{ 'metric-value--updated': valueAnimating }"
                  @animationend="valueAnimating = false"
                >{{ formatValue(progress.value) }}</span>
                <span class="metric-target"> / {{ operator }} {{ formatValue(target) }}</span>
              </div>
              <span v-if="task.goalPeriod === 'week' && !step" class="period-pill">This week</span>
            </div>
            <v-progress-linear
              :model-value="progress.percent"
              :color="stateColor"
              bg-color="surface-variant"
              rounded
              height="7"
              class="mt-2"
            />

            <div v-if="isStepCounter && stepCountError" class="step-source-message mt-3 text-warning">
              <v-icon icon="mdi-alert-circle-outline" size="16" />
              <span>{{ stepCountError }}</span>
            </div>

            <div v-if="isStepCounter" class="step-source" :class="stepCountError ? 'mt-2' : 'mt-3'">
              <v-progress-circular v-if="syncing" indeterminate color="secondary" :size="16" :width="2" />
              <v-icon v-else icon="mdi-heart-pulse" color="secondary" size="17" />
              <span>{{ syncing ? 'Syncing steps…' : 'Health Connect' }}</span>
            </div>

            <div v-if="canLogAmount" class="task-action-stack mt-4">
              <v-btn
                block
                size="small"
                variant="tonal"
                prepend-icon="mdi-plus-minus-variant"
                :disabled="busy || progress.locked || progress.sealed"
                @touchstart.stop
                @click.stop="emit('logAmount', progress)"
              >
                Log amount
              </v-btn>
              <v-btn
                v-if="canLogTime"
                block
                size="small"
                variant="tonal"
                color="secondary"
                prepend-icon="mdi-timer-outline"
                :disabled="busy || progress.locked || progress.sealed"
                @click="emit('logTime', progress)"
              >
                Log time
              </v-btn>
              <v-btn
                v-if="isDailyTotal"
                block
                size="small"
                variant="tonal"
                :color="progress.sealed ? undefined : 'secondary'"
                :prepend-icon="progress.sealed ? 'mdi-lock-open-variant-outline' : 'mdi-lock-check-outline'"
                :disabled="busy || progress.locked"
                @touchstart.stop
                @click.stop="emit('seal', progress)"
              >
                {{ progress.sealed ? 'Unlock total' : 'Lock in total' }}
              </v-btn>
            </div>
          </template>

          <div
            v-if="!progress.locked && numericGoalStatus"
            :class="['status-banner', 'mt-3', numericGoalStatus.tone]"
          >
            <span class="status-banner__label">
              <v-icon :icon="numericGoalStatus.icon" size="16" />
              {{ numericGoalStatus.title }}
            </span>
            <strong class="status-banner__amount">{{ numericGoalStatus.amount }}</strong>
          </div>
        </div>

        <div v-if="progress.locked" class="status-banner mt-3 muted">
          <v-icon icon="mdi-lock-outline" size="16" /> Complete or resolve earlier program steps first
        </div>

        <div v-if="progress.status === 'missed'" class="status-banner mt-3 text-error">
          <v-icon icon="mdi-alert-circle-outline" size="16" /> Missed
        </div>
      </div>
    </v-expand-transition>
  </v-card>
</template>

<style scoped>
.task-card {
  position: relative;
  overflow: hidden;
  transition: opacity .18s ease;
}

.task-card--done {
  opacity: .72;
}

.task-card--sealed {
  cursor: default;
}

.task-card-header-main {
  border-radius: .75rem;
}

.task-card-header-main--expandable {
  cursor: pointer;
}

.task-card-header-main--expandable:focus-visible {
  outline: .125rem solid rgba(var(--v-theme-secondary), .82);
  outline-offset: .25rem;
}

.task-menu-button {
  min-width: 2.75rem;
  min-height: 2.75rem;
}

.task-check-toggle {
  min-height: 2.75rem;
}

.tracking-task-trackers {
  display: grid;
  gap: .4rem;
}

.tracking-task-tracker {
  background: rgba(var(--v-theme-on-surface), .04);
}

.tracking-task-tracker__icon {
  display: grid;
  width: 2rem;
  height: 2rem;
  margin-inline-end: .7rem;
  place-items: center;
  border-radius: .65rem;
  color: #17200f;
}

.check-control {
  display: grid;
  flex: 0 0 auto;
  width: 44px;
  height: 44px;
  place-items: center;
  border: 0;
  border-radius: 14px;
  background: rgb(var(--v-theme-surface-variant));
  color: rgb(var(--v-theme-on-surface) / .62);
  cursor: pointer;
}

.check-control--done {
  background: rgba(var(--v-theme-surface-variant), 0);
  color: var(--task-color);
}

.check-control--type {
  background: var(--task-color);
  color: #191c19;
}

.check-control--status {
  cursor: default;
}

.task-title {
  font-size: .98rem;
  font-weight: 850;
  line-height: 1.25;
}

.task-subtitle {
  max-width: 230px;
  color: rgb(var(--v-theme-on-surface) / .5);
  font-size: .75rem;
}

.required-dot,
.period-pill {
  padding: 3px 7px;
  border-radius: 999px;
  background: rgb(var(--v-theme-surface-variant));
  color: #fff;
  font-size: .57rem;
  font-weight: 850;
  letter-spacing: .07em;
  text-transform: uppercase;
}

.period-pill {
  background: rgb(var(--v-theme-surface-variant));
  color: rgb(var(--v-theme-on-surface) / .72);
}

.metric-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

.metric-value {
  display: inline-block;
  border-radius: .35rem;
  font-size: 1.12rem;
  font-weight: 900;
  transform-origin: left center;
}

.metric-value--updated {
  animation: metric-value-pulse 560ms cubic-bezier(.22, 1, .36, 1);
}

.step-source {
  display: flex;
  min-height: 24px;
  align-items: center;
  gap: .45rem;
  color: rgb(var(--v-theme-on-surface) / .56);
  font-size: .7rem;
  font-weight: 800;
}

.step-source-message {
  display: flex;
  align-items: flex-start;
  gap: .4rem;
  font-size: .72rem;
  font-weight: 700;
  line-height: 1.4;
}

.step-source-message .v-icon {
  margin-top: .05rem;
  flex: 0 0 auto;
}

@keyframes metric-value-pulse {
  0%, 100% {
    background: transparent;
    box-shadow: 0 0 0 0 transparent;
    color: inherit;
    transform: scale(1);
  }

  38% {
    background: color-mix(in srgb, var(--task-color) 24%, transparent);
    box-shadow: 0 0 0 .3rem color-mix(in srgb, var(--task-color) 16%, transparent);
    color: var(--task-color);
    transform: scale(1.28);
  }
}

.metric-target {
  color: rgb(var(--v-theme-on-surface) / .52);
  font-size: .72rem;
}

.task-action-stack {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: .5rem;
}

.task-action-stack .v-btn {
  min-height: 40px;
}

.task-action-stack .v-btn:last-child:nth-child(odd) {
  grid-column: 1 / -1;
}

.status-banner {
  display: flex;
  align-items: center;
  gap: .35rem;
  font-size: .72rem;
  font-weight: 800;
}

.status-banner__label {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: .35rem;
}

.status-banner__amount {
  margin-left: auto;
  padding-left: .75rem;
  text-align: right;
  white-space: nowrap;
}
</style>
