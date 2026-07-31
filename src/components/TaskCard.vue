<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { goalState } from '@/services/schedule'
import type { TaskProgress } from '@/types/domain'

const props = defineProps<{
  progress: TaskProgress
  busy?: boolean
  interval?: { name: string; duration: string }
  canStartInterval?: boolean
  intervalActive?: boolean
}>()
const emit = defineEmits<{
  toggle: [progress: TaskProgress]
  seal: [progress: TaskProgress]
  add: [progress: TaskProgress, amount: number]
  exact: [progress: TaskProgress]
  logTime: [progress: TaskProgress]
  review: [progress: TaskProgress]
  startInterval: [progress: TaskProgress]
}>()

const task = computed(() => props.progress.task)
const step = computed(() => props.progress.programStep)
const optimisticComplete = ref<boolean>()
const displayedComplete = computed(() => optimisticComplete.value ?? props.progress.complete)
const isCheck = computed(() => (step.value ? step.value.completionType === 'check' : task.value.type === 'check'))
const isInterval = computed(() => !step.value && task.value.type === 'interval')
const isDailyTotal = computed(() => !step.value && task.value.type === 'daily_total')
const canLogTime = computed(() => !step.value && task.value.type === 'duration')
const canToggleFromCard = computed(() => isCheck.value && !props.busy && !props.progress.locked)
const target = computed(() => step.value?.targetValue || task.value.targetValue || 0)
const unit = computed(() => step.value?.customUnit || step.value?.unit || task.value.customUnit || task.value.unit || '')
const quickAmounts = computed(() =>
  [...(step.value ? step.value.quickAmounts : task.value.quickAmounts)].sort((left, right) => left - right),
)
const operator = computed(() => ({ gte: 'at least', lte: 'at most', eq: 'exactly' })[step.value?.targetOperator || task.value.targetOperator || 'gte'])
const targetOperator = computed(() => step.value?.targetOperator || task.value.targetOperator || 'gte')
const currentGoalState = computed(() => isCheck.value || isInterval.value ? 'neutral' : goalState(props.progress.value, target.value, targetOperator.value))
const taskColor = computed(() => task.value.color || '#C7F464')
const stateColor = computed(() => {
  if (currentGoalState.value === 'exceeded') return 'warning'
  if (currentGoalState.value === 'not_enough') return 'error'
  return taskColor.value
})
const stateIcon = computed(() => {
  if (props.progress.locked) return 'mdi-lock-outline'
  if (currentGoalState.value === 'exceeded') return 'mdi-alert-outline'
  if (currentGoalState.value === 'not_enough') return 'mdi-trending-down'
  if (props.progress.sealed) return 'mdi-lock-check'
  if (displayedComplete.value) return 'mdi-check-bold'
  if (isInterval.value) return 'mdi-timer-play-outline'
  return isCheck.value ? 'mdi-circle-outline' : 'mdi-lightning-bolt'
})
const stateIconColor = computed(() => {
  return stateColor.value
})
const title = computed(() => step.value?.name || task.value.name)
const subtitle = computed(() => step.value ? `${task.value.name} · Program step` : task.value.description)

function formatValue(value: number) {
  if (task.value.type === 'duration' && !step.value) return `${value % 1 === 0 ? value : value.toFixed(2)}h`
  return `${Number(value.toFixed(2))}${unit.value ? ` ${unit.value}` : ''}`
}

function toggleFromCard() {
  if (!canToggleFromCard.value) return
  optimisticComplete.value = !displayedComplete.value
  emit('toggle', props.progress)
}

watch(() => props.busy, (busy) => {
  if (!busy) optimisticComplete.value = undefined
})
</script>

<template>
  <v-card
    class="task-card surface-card pa-4"
    :class="{ 'task-card--done': displayedComplete, 'task-card--clickable': canToggleFromCard, 'task-card--sealed': progress.sealed }"
    :ripple="canToggleFromCard"
    v-on="canToggleFromCard ? { click: toggleFromCard } : {}"
  >
    <div class="d-flex align-start ga-3">
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
        :disabled="busy || progress.locked"
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

      <v-progress-circular
        v-if="!isCheck"
        :model-value="progress.percent"
        :color="stateColor"
        bg-color="surface-variant"
        :size="48"
        :width="5"
      >
        <span class="progress-number">{{ Math.round(progress.percent) }}</span>
      </v-progress-circular>
    </div>

    <template v-if="isInterval">
      <div class="interval-task-details mt-4">
        <v-icon icon="mdi-timer-play-outline" color="secondary" size="20" />
        <div class="min-width-0">
          <strong class="d-block text-truncate">{{ interval?.name || 'Attached interval' }}</strong>
          <span v-if="interval?.duration" class="text-caption muted">{{ interval.duration }}</span>
        </div>
      </div>
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

    <template v-else-if="!isCheck">
      <div class="metric-row mt-4">
        <div>
          <span class="metric-value">{{ formatValue(progress.value) }}</span>
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

      <div v-if="quickAmounts.length" class="quick-actions mt-4">
        <v-btn
          v-for="amount in quickAmounts"
          :key="amount"
          size="small"
          variant="tonal"
          :disabled="busy || progress.locked || progress.sealed"
          @click="emit('add', progress, amount)"
        >
          +{{ task.type === 'duration' && !step ? `${amount}h` : `${amount}${unit ? ` ${unit}` : ''}` }}
        </v-btn>
      </div>

      <div class="task-action-stack mt-4">
        <v-btn
          block
          size="small"
          variant="tonal"
          prepend-icon="mdi-pencil-plus-outline"
          :disabled="busy || progress.locked || progress.sealed"
          @click="emit('exact', progress)"
        >
          Custom
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

    <div v-if="progress.locked" class="status-banner mt-3 muted">
      <v-icon icon="mdi-lock-outline" size="16" /> Complete or resolve earlier program steps first
    </div>
    <div v-else-if="currentGoalState === 'exceeded'" class="status-banner mt-3 text-warning">
      <v-icon icon="mdi-alert-outline" size="16" /> Target exceeded
    </div>
    <div v-else-if="currentGoalState === 'not_enough'" class="status-banner mt-3 text-error">
      <v-icon icon="mdi-trending-down" size="16" /> Not enough yet
    </div>

    <div v-if="progress.status === 'missed'" class="status-banner mt-3 text-error">
      <v-icon icon="mdi-alert-circle-outline" size="16" /> Missed
    </div>
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

.progress-number {
  font-size: .68rem;
  font-weight: 900;
}

.metric-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

.metric-value {
  font-size: 1.12rem;
  font-weight: 900;
}

.metric-target {
  color: rgb(var(--v-theme-on-surface) / .52);
  font-size: .72rem;
}

.quick-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: .35rem;
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

.interval-task-details {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: .75rem;
  padding: .8rem;
  border-radius: 16px;
  background: rgb(var(--v-theme-surface-variant));
}

.status-banner {
  display: flex;
  align-items: center;
  gap: .35rem;
  font-size: .72rem;
  font-weight: 800;
}
</style>
