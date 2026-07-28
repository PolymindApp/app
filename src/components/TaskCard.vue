<script setup lang="ts">
import { computed } from 'vue'
import { goalState } from '@/services/schedule'
import type { TaskProgress } from '@/types/domain'

const props = defineProps<{ progress: TaskProgress; busy?: boolean }>()
const emit = defineEmits<{
  toggle: [progress: TaskProgress]
  add: [progress: TaskProgress, amount: number]
  exact: [progress: TaskProgress]
  review: [progress: TaskProgress]
}>()

const task = computed(() => props.progress.task)
const step = computed(() => props.progress.programStep)
const isCheck = computed(() => (step.value ? step.value.completionType === 'check' : task.value.type === 'check'))
const canToggleFromCard = computed(() => isCheck.value && !props.busy && !props.progress.locked)
const target = computed(() => step.value?.targetValue || task.value.targetValue || 0)
const unit = computed(() => step.value?.customUnit || step.value?.unit || task.value.customUnit || task.value.unit || '')
const quickAmounts = computed(() =>
  [...(step.value ? step.value.quickAmounts : task.value.quickAmounts)].sort((left, right) => left - right),
)
const operator = computed(() => ({ gte: 'at least', lte: 'at most', eq: 'exactly' })[step.value?.targetOperator || task.value.targetOperator || 'gte'])
const targetOperator = computed(() => step.value?.targetOperator || task.value.targetOperator || 'gte')
const currentGoalState = computed(() => isCheck.value ? 'neutral' : goalState(props.progress.value, target.value, targetOperator.value))
const stateColor = computed(() => {
  if (currentGoalState.value === 'exceeded') return 'warning'
  if (currentGoalState.value === 'not_enough') return 'error'
  return props.progress.complete ? 'success' : 'secondary'
})
const stateIcon = computed(() => {
  if (props.progress.locked) return 'mdi-lock-outline'
  if (currentGoalState.value === 'exceeded') return 'mdi-alert-outline'
  if (currentGoalState.value === 'not_enough') return 'mdi-trending-down'
  if (props.progress.complete) return 'mdi-check-bold'
  return isCheck.value ? 'mdi-circle-outline' : 'mdi-lightning-bolt'
})
const stateIconColor = computed(() => {
  if (currentGoalState.value === 'exceeded' || currentGoalState.value === 'not_enough') return stateColor.value
  if (props.progress.complete) return 'on-secondary'
  return isCheck.value ? undefined : stateColor.value
})
const title = computed(() => step.value?.name || task.value.name)
const subtitle = computed(() => step.value ? `${task.value.name} · Program step` : task.value.areaName || task.value.description)

function formatValue(value: number) {
  if (task.value.type === 'duration' && !step.value) return `${value % 1 === 0 ? value : value.toFixed(2)}h`
  return `${Number(value.toFixed(2))}${unit.value ? ` ${unit.value}` : ''}`
}

function toggleFromCard() {
  if (!canToggleFromCard.value) return
  emit('toggle', props.progress)
}
</script>

<template>
  <v-card
    class="task-card surface-card pa-4"
    :class="{ 'task-card--done': progress.complete, 'task-card--clickable': canToggleFromCard }"
    @click="toggleFromCard"
  >
    <div class="d-flex align-start ga-3">
      <button
        class="check-control"
        :class="{ 'check-control--done': progress.complete }"
        :aria-label="progress.complete ? `Mark ${title} incomplete` : `Complete ${title}`"
        :disabled="busy || progress.locked"
        @click.stop="emit('toggle', progress)"
      >
        <v-icon :icon="stateIcon" :color="stateIconColor" size="20" />
      </button>

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

    <template v-if="!isCheck">
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

      <div class="quick-actions mt-4">
        <v-btn
          v-for="amount in quickAmounts"
          :key="amount"
          size="small"
          variant="tonal"
          :disabled="busy || progress.locked"
          @click="emit('add', progress, amount)"
        >
          +{{ task.type === 'duration' && !step ? `${amount}h` : `${amount}${unit ? ` ${unit}` : ''}` }}
        </v-btn>
        <v-btn size="small" variant="text" icon="mdi-tune-variant" aria-label="Enter an exact amount" :disabled="progress.locked" @click="emit('exact', progress)" />
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
  background: rgb(var(--v-theme-secondary));
  color: #192113;
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

.status-banner {
  display: flex;
  align-items: center;
  gap: .35rem;
  font-size: .72rem;
  font-weight: 800;
}
</style>
