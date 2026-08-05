<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue'
import { goalState } from '@/services/schedule'
import { taskCanLogAmounts } from '@/services/taskCardActions'
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
  syncing?: boolean
}>()
const emit = defineEmits<{
  toggle: [progress: TaskProgress, complete: boolean]
  seal: [progress: TaskProgress]
  logAmount: [progress: TaskProgress]
  logTime: [progress: TaskProgress]
  review: [progress: TaskProgress]
  startInterval: [progress: TaskProgress]
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
const isDailyTotal = computed(() => !step.value && task.value.type === 'daily_total')
const isStepCounter = computed(() => !step.value && task.value.type === 'step_counter')
const canLogAmount = computed(() => taskCanLogAmounts(props.progress))
const canLogTime = computed(() => !step.value && task.value.type === 'duration')
const canToggleFromCard = computed(() =>
  isCheck.value && !togglePending.value && !props.busy && !props.progress.locked,
)
const target = computed(() => step.value?.targetValue ?? task.value.targetValue ?? 0)
const unit = computed(() => step.value?.customUnit || step.value?.unit || task.value.customUnit || task.value.unit || '')
const operator = computed(() => ({ gte: 'at least', lte: 'at most', eq: 'exactly' })[step.value?.targetOperator || task.value.targetOperator || 'gte'])
const targetOperator = computed(() => step.value?.targetOperator || task.value.targetOperator || 'gte')
const currentGoalState = computed(() => isCheck.value || isInterval.value ? 'neutral' : goalState(props.progress.value, target.value, targetOperator.value))
const numericGoalStatus = computed(() => {
  if (isCheck.value || isInterval.value) return undefined
  const difference = target.value - props.progress.value
  if (targetOperator.value === 'gte' && difference > 0) {
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
  if (targetOperator.value === 'eq' && difference > 0) {
    return {
      title: 'Exact target not met',
      amount: `${formatValue(difference)} missing`,
      icon: 'mdi-target',
      tone: 'text-error',
    }
  }
  if ((targetOperator.value === 'lte' || targetOperator.value === 'eq') && difference < 0) {
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
const taskColor = computed(() => task.value.color || '#C7F464')
const stateColor = computed(() => {
  if (numericGoalStatus.value?.tone === 'text-success') return 'success'
  if (numericGoalStatus.value?.tone === 'text-warning') return 'warning'
  if (numericGoalStatus.value?.tone === 'text-error') return 'error'
  if (currentGoalState.value === 'exceeded') return 'warning'
  if (currentGoalState.value === 'not_enough') return 'error'
  return taskColor.value
})
const stateIcon = computed(() => {
  if (props.progress.locked) return 'mdi-lock-outline'
  if (numericGoalStatus.value?.tone === 'text-success') return numericGoalStatus.value.icon
  if (numericGoalStatus.value?.tone === 'text-warning') return 'mdi-alert-outline'
  if (numericGoalStatus.value?.tone === 'text-error') return numericGoalStatus.value.icon
  if (currentGoalState.value === 'exceeded') return 'mdi-alert-outline'
  if (currentGoalState.value === 'not_enough') return 'mdi-trending-down'
  if (props.progress.sealed) return 'mdi-lock-check'
  if (displayedComplete.value) return 'mdi-check-bold'
  if (isInterval.value) return 'mdi-timer-play-outline'
  if (isStepCounter.value) return 'mdi-shoe-print'
  return isCheck.value ? 'mdi-circle-outline' : 'mdi-lightning-bolt'
})
const stateIconColor = computed(() => {
  return stateColor.value
})
const title = computed(() => step.value?.name || task.value.name)
const subtitle = computed(() => {
  if (isInterval.value) {
    return props.interval?.duration ? `Interval · ${props.interval.duration} total` : 'Interval'
  }
  return step.value ? `${task.value.name} · Program step` : task.value.description
})

function formatValue(value: number) {
  if (task.value.type === 'duration' && !step.value) return `${value % 1 === 0 ? value : value.toFixed(2)}h`
  if (isStepCounter.value) return `${Math.round(value).toLocaleString()} steps`
  return `${Number(value.toFixed(2))}${unit.value ? ` ${unit.value}` : ''}`
}

function toggleFromCard() {
  if (!canToggleFromCard.value) return
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
    :class="{ 'task-card--done': displayedComplete, 'task-card--clickable': canToggleFromCard, 'task-card--sealed': progress.sealed }"
    :style="{ '--task-color': taskColor }"
    :ripple="canToggleFromCard"
    v-on="canToggleFromCard ? { click: toggleFromCard } : {}"
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
        <button
          v-if="isCheck"
          class="check-control"
          :class="{
            'check-control--done': displayedComplete,
            'check-control--warning': currentGoalState === 'exceeded',
            'check-control--error': currentGoalState === 'not_enough',
          }"
          :style="{ '--task-color': taskColor }"
          :aria-label="displayedComplete ? `Mark ${title} incomplete` : `Complete ${title}`"
          :disabled="togglePending || busy || progress.locked"
          @touchstart.stop
          @click.stop="toggleFromCard"
        >
          <v-icon :icon="stateIcon" :color="stateIconColor" size="20" />
        </button>
        <div
          v-else
          class="check-control check-control--status"
          :class="{
            'check-control--done': progress.complete,
            'check-control--warning': currentGoalState === 'exceeded',
            'check-control--error': currentGoalState === 'not_enough',
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

            <div v-if="isStepCounter" class="step-source mt-3">
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

.task-card--clickable {
  cursor: pointer;
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
  border: 1px solid var(--task-color);
  background: color-mix(in srgb, var(--task-color) 18%, transparent);
  color: var(--task-color);
}

.check-control--warning {
  border: 1px solid rgb(var(--v-theme-warning));
  background: rgb(var(--v-theme-warning) / .16);
}

.check-control--error {
  border: 1px solid rgb(var(--v-theme-error));
  background: rgb(var(--v-theme-error) / .16);
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
