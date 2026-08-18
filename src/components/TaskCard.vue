<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { formatIntervalDuration } from '@/services/intervals'
import { goalState } from '@/services/schedule'
import { TASK_TYPE_PRESENTATION } from '@/services/taskTypes'
import type {
  ProgramStepRequirementListItem,
  TaskLogImage,
  TaskProgress,
  TrackingTaskTracker,
} from '@/types/domain'

const MIN_STEP_SYNC_INDICATOR_MS = 1000

const props = defineProps<{
  progress: TaskProgress
  busy?: boolean
  valuePulse?: number
  interval?: { name: string; duration: string }
  reviewSet?: { name: string; cardCount: number; mode: 'manual' | 'passive' }
  programStepRequirements?: ProgramStepRequirementListItem[]
  trackers?: TrackingTaskTracker[]
  canLogTracking?: boolean
  syncing?: boolean
  stepCountError?: string
  scheduleStatus?: 'not-scheduled' | 'paused' | 'skipped'
  timeLabel?: string
  taskLogImages?: TaskLogImage[]
}>()
const emit = defineEmits<{
  actions: [progress: TaskProgress]
  runProgramStepRequirement: [progress: TaskProgress, completionId: string]
  logTracking: [progress: TaskProgress, trackerId: string]
  logTrackingTime: [progress: TaskProgress, trackerId: string]
}>()

const task = computed(() => props.progress.task)
const step = computed(() => props.progress.programStep)
const stepCompletionItems = computed(() => props.progress.completionItems || [])
const hasMultipleStepCompletions = computed(() => stepCompletionItems.value.length > 1)
const singleStepCompletion = computed(() => stepCompletionItems.value.length === 1
  ? stepCompletionItems.value[0]
  : undefined)
const valueAnimating = ref(false)
const stepSyncIndicatorVisible = ref(Boolean(props.syncing))
let valueAnimationVersion = 0
let stepSyncStartedAt = props.syncing ? Date.now() : 0
let stepSyncHideTimer: ReturnType<typeof setTimeout> | undefined

const isCheck = computed(() => step.value
  ? singleStepCompletion.value?.type === 'check'
  : task.value.type === 'check')
const isInterval = computed(() =>
  (!step.value && task.value.type === 'interval') || singleStepCompletion.value?.type === 'interval',
)
const isFlashcards = computed(() =>
  (!step.value && task.value.type === 'flashcards') || singleStepCompletion.value?.type === 'flashcards',
)
const isSessionDuration = computed(() =>
  !step.value
  && (isInterval.value || isFlashcards.value)
  && task.value.sessionGoalType === 'duration',
)
const isTracking = computed(() => !step.value && task.value.type === 'tracking')
const isJournal = computed(() => !step.value && task.value.type === 'journal')
const isDailyTotal = computed(() => !step.value && task.value.type === 'daily_total')
const isStepCounter = computed(() => !step.value && task.value.type === 'step_counter')
const isNumeric = computed(() => !isCheck.value
  && !hasMultipleStepCompletions.value
  && !isTracking.value
  && !isJournal.value
  && !isInterval.value
  && !isFlashcards.value)
const target = computed(() => isTracking.value
  ? task.value.trackingTrackers?.length ?? 0
  : isSessionDuration.value
    ? task.value.sessionTargetSeconds ?? 0
    : hasMultipleStepCompletions.value
      ? stepCompletionItems.value.length
      : singleStepCompletion.value?.targetValue ?? task.value.targetValue ?? 0)
const unit = computed(() => singleStepCompletion.value?.customUnit || singleStepCompletion.value?.unit || task.value.customUnit || task.value.unit || '')
const operator = computed(() => ({ gte: 'at least', lte: 'at most', eq: 'exactly' })[singleStepCompletion.value?.targetOperator || task.value.targetOperator || 'gte'])
const targetOperator = computed(() => singleStepCompletion.value?.targetOperator || task.value.targetOperator || 'gte')
const currentGoalState = computed(() => isCheck.value
  || hasMultipleStepCompletions.value
  || (isInterval.value && !isSessionDuration.value)
  || (isFlashcards.value && !isSessionDuration.value)
  || isTracking.value
  || isJournal.value
  ? 'neutral'
  : goalState(props.progress.value, target.value, targetOperator.value))
const taskLogImageDeck = computed(() => props.taskLogImages || [])
const taskImageDeckRef = ref<HTMLElement | null>(null)
const taskImageDeckDefaultGapPx = 4
const taskImageDeckGap = ref(`${taskImageDeckDefaultGapPx}px`)
const taskImageDeckMinOverlapRatio = 0.72
let taskImageDeckResizeObserver: ResizeObserver | undefined

function updateTaskImageDeckGap() {
  const container = taskImageDeckRef.value
  if (!container) return

  const imageElements = Array.from(container.querySelectorAll('.task-image-deck__item')) as HTMLElement[]
  if (!imageElements.length) {
    taskImageDeckGap.value = `${taskImageDeckDefaultGapPx}px`
    return
  }

  const firstImage = imageElements[0]
  const imageSize = firstImage.offsetWidth || 0
  if (imageSize <= 0) return

  const imageCount = imageElements.length
  if (imageCount === 1) {
    taskImageDeckGap.value = `${taskImageDeckDefaultGapPx}px`
    return
  }

  const fullSpan = imageSize * imageCount + taskImageDeckDefaultGapPx * (imageCount - 1)
  if (fullSpan <= container.clientWidth) {
    taskImageDeckGap.value = `${taskImageDeckDefaultGapPx}px`
    return
  }

  const neededGap = (container.clientWidth - imageCount * imageSize) / (imageCount - 1)
  const minimumGap = -imageSize * taskImageDeckMinOverlapRatio
  taskImageDeckGap.value = `${Math.max(neededGap, minimumGap)}px`
}

async function scheduleTaskImageDeckGapUpdate() {
  await nextTick()
  updateTaskImageDeckGap()
}

function formatValue(value: number) {
  if (hasMultipleStepCompletions.value) {
    return `${value} of ${stepCompletionItems.value.length} requirements`
  }
  if (isSessionDuration.value) return formatIntervalDuration(value)
  if (task.value.type === 'duration' && !step.value) return `${value % 1 === 0 ? value : value.toFixed(2)}h`
  if (isStepCounter.value) return `${Math.round(value).toLocaleString()} steps`
  return `${Number(value.toFixed(2))}${unit.value ? ` ${unit.value}` : ''}`
}

const numericGoalStatus = computed(() => {
  if (!isNumeric.value && !isSessionDuration.value) return undefined
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
const isPausedTask = computed(() => props.scheduleStatus === 'paused')
const isSkippedTask = computed(() => props.scheduleStatus === 'skipped')
const stateColor = computed(() => {
  if (isSkippedTask.value) return 'warning'
  if (numericGoalStatus.value?.tone === 'text-success') return 'success'
  if (numericGoalStatus.value?.tone === 'text-warning') return 'warning'
  if (numericGoalStatus.value?.tone === 'text-error') return 'error'
  if (currentGoalState.value === 'exceeded') return 'warning'
  if (currentGoalState.value === 'not_enough') return 'error'
  return taskColor.value
})
const stateIcon = computed(() => {
  if (isPausedTask.value) return 'mdi-pause'
  if (isSkippedTask.value) return 'mdi-skip-next-outline'
  if (props.progress.complete) return 'mdi-check-bold'
  if (props.progress.locked) return 'mdi-lock-outline'
  return taskTypePresentation.value.icon
})
const showingTaskTypeIcon = computed(() =>
  !isPausedTask.value && !isSkippedTask.value && !props.progress.complete && !props.progress.locked,
)
const stateIconColor = computed(() => {
  if (isPausedTask.value) return 'on-surface'
  if (isSkippedTask.value) return 'warning'
  if (showingTaskTypeIcon.value) return '#191C19'
  if (props.progress.complete) return 'white'
  return stateColor.value
})
const title = computed(() => step.value?.name || task.value.name)
const baseSubtitle = computed(() => {
  if (hasMultipleStepCompletions.value) {
    const completed = stepCompletionItems.value.filter(item => item.complete).length
    return `${task.value.name} · ${completed} of ${stepCompletionItems.value.length} requirements complete`
  }
  if (isInterval.value) {
    return props.interval?.duration ? `Interval · ${props.interval.duration} total` : 'Interval'
  }
  if (isFlashcards.value) {
    if (!props.reviewSet) return 'Review set'
    const cardLabel = props.reviewSet.cardCount === 1 ? 'card' : 'cards'
    return `${props.reviewSet.name} · ${props.reviewSet.mode === 'passive' ? 'Passive' : 'Manual'} · ${props.reviewSet.cardCount} ${cardLabel}`
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
const subtitle = computed(() => [props.timeLabel, baseSubtitle.value || 'Personal'].filter(Boolean).join(' · '))
const showsProgress = computed(() => hasMultipleStepCompletions.value
  || isTracking.value
  || isNumeric.value
  || isSessionDuration.value)
const hasPersistentDetails = computed(() => showsProgress.value
  || Boolean(step.value && props.programStepRequirements?.length)
  || Boolean(props.stepCountError)
  || Boolean(numericGoalStatus.value)
  || props.progress.locked
  || props.progress.status === 'missed')

watch(() => props.valuePulse, async (pulse, previousPulse) => {
  if (!pulse || pulse === previousPulse) return
  const version = ++valueAnimationVersion
  valueAnimating.value = false
  await nextTick()
  if (version === valueAnimationVersion) valueAnimating.value = true
})

watch(() => props.syncing, (syncing) => {
  clearTimeout(stepSyncHideTimer)
  stepSyncHideTimer = undefined

  if (syncing) {
    stepSyncStartedAt = Date.now()
    stepSyncIndicatorVisible.value = true
    return
  }

  const remaining = MIN_STEP_SYNC_INDICATOR_MS - (Date.now() - stepSyncStartedAt)
  if (!stepSyncIndicatorVisible.value || remaining <= 0) {
    stepSyncIndicatorVisible.value = false
    return
  }

  stepSyncHideTimer = setTimeout(() => {
    stepSyncIndicatorVisible.value = false
    stepSyncHideTimer = undefined
  }, remaining)
})

onMounted(() => {
  scheduleTaskImageDeckGapUpdate()
  window.addEventListener('resize', scheduleTaskImageDeckGapUpdate)
  taskImageDeckResizeObserver = new ResizeObserver(scheduleTaskImageDeckGapUpdate)
  if (taskImageDeckRef.value) taskImageDeckResizeObserver.observe(taskImageDeckRef.value)
})

watch(taskLogImageDeck, () => {
  scheduleTaskImageDeckGapUpdate()
}, { deep: true, flush: 'post' })

onBeforeUnmount(() => {
  clearTimeout(stepSyncHideTimer)
  window.removeEventListener('resize', scheduleTaskImageDeckGapUpdate)
  taskImageDeckResizeObserver?.disconnect()
})
</script>

<template>
  <v-card
    class="task-card surface-card pa-4"
    :class="{
      'task-card--done': progress.complete,
      'task-card--sealed': progress.sealed,
      'task-card--outside-schedule': scheduleStatus,
    }"
    :style="{ '--task-color': taskColor }"
    role="button"
    tabindex="0"
    :aria-label="`Open actions for ${title}`"
    @click="emit('actions', progress)"
    @keydown.enter.self.prevent="emit('actions', progress)"
    @keydown.space.self.prevent="emit('actions', progress)"
  >
    <div class="d-flex align-start ga-3" data-task-drag-handle>
      <div class="task-icon-area">
        <div
          class="check-control check-control--status"
          :class="{
            'check-control--type': showingTaskTypeIcon,
            'check-control--done': progress.complete && !isPausedTask,
            'check-control--paused': isPausedTask,
          }"
          :style="{ '--task-color': taskColor }"
          aria-hidden="true"
        >
          <v-progress-circular
            v-if="stepSyncIndicatorVisible"
            class="task-sync-progress"
            indeterminate
            size="1.125rem"
            color="secondary"
            :width="2"
          />
          <v-icon v-else :icon="stateIcon" :color="stateIconColor" size="1.25rem" />
        </div>
        <span
          v-if="task.mandatory && !progress.complete"
          class="task-required-badge"
          role="img"
          aria-label="Required task"
          title="Required"
        />
      </div>

      <div class="flex-grow-1 min-width-0 overflow-hidden">
        <h3 class="task-title">{{ title }}</h3>
        <Transition name="task-tag">
          <span v-if="scheduleStatus" :key="scheduleStatus" class="schedule-status mt-1">
            {{ scheduleStatus === 'paused'
              ? 'Paused'
              : scheduleStatus === 'skipped' ? 'Skipped' : 'Not scheduled' }}
          </span>
        </Transition>
        <p class="task-subtitle text-truncate mt-1">{{ subtitle }}</p>
      </div>

    </div>

    <div v-if="hasPersistentDetails" class="task-card-body">
      <div v-if="isNumeric || isSessionDuration" class="metric-row mt-4">
        <div>
          <span
            class="metric-value"
            :class="{ 'metric-value--updated': valueAnimating }"
            @animationend="valueAnimating = false"
          >{{ formatValue(progress.value) }}</span>
          <span class="metric-target">
            / {{ isSessionDuration ? '' : `${operator} ` }}{{ formatValue(target) }}
          </span>
        </div>
        <span v-if="task.goalPeriod === 'week' && !step" class="period-pill">This week</span>
      </div>
      <v-progress-linear
        v-if="showsProgress"
        :model-value="progress.percent"
        :color="taskColor"
        bg-color="white"
        :bg-opacity="0.14"
        rounded
        style="height: 0.5625rem; --v-progress-linear-height: 0.5625rem"
        :class="isTracking || hasMultipleStepCompletions ? 'mt-4' : 'mt-2'"
      />

      <v-list
        v-if="step && programStepRequirements?.length"
        class="task-detail-list pa-0 mt-3"
        bg-color="transparent"
        :aria-label="`${title} completion requirements`"
        @touchstart.stop
        @click.stop
      >
        <v-list-item
          v-for="requirement in programStepRequirements"
          :key="requirement.id"
          class="task-detail-item"
          :title="requirement.title"
          :subtitle="requirement.subtitle"
          :disabled="requirement.disabled || busy"
          rounded="lg"
          @click="emit('runProgramStepRequirement', progress, requirement.id)"
        >
          <template #prepend>
            <span class="task-detail-item__icon" :style="{ background: requirement.color || taskColor }">
              <v-icon :icon="requirement.icon" size="1.125rem" />
            </span>
          </template>
          <template #append>
            <v-icon
              v-if="requirement.complete"
              icon="mdi-check-circle"
              color="success"
              size="1.125rem"
              class="mr-2"
              aria-label="Complete"
            />
          </template>
        </v-list-item>
      </v-list>

      <v-list
        v-if="isTracking && trackers?.length"
        class="task-detail-list pa-0 mt-3"
        bg-color="transparent"
        @touchstart.stop
        @click.stop
      >
        <template v-for="tracker in trackers" :key="tracker.id">
          <v-list-item
            class="task-detail-item"
            :title="tracker.name"
            :subtitle="tracker.loggedValue
              ? `${tracker.loggedValue} logged for this date`
              : tracker.logged ? 'Logged for this date' : 'Not logged for this date'"
            :disabled="!canLogTracking || busy || progress.locked"
            rounded="lg"
            @click="tracker.kind !== 'duration' && emit('logTracking', progress, tracker.id)"
          >
            <template #prepend>
              <span class="task-detail-item__icon" :style="{ background: tracker.color }">
                <v-icon :icon="tracker.icon" size="1.125rem" />
              </span>
            </template>
            <template #append>
              <v-icon
                v-if="tracker.logged"
                icon="mdi-check-circle"
                color="success"
                size="1.125rem"
                class="mr-2"
                aria-label="Logged"
              />
            </template>
          </v-list-item>
          <div v-if="tracker.kind === 'duration'" class="tracking-duration-actions">
            <v-btn
              block
              variant="tonal"
              prepend-icon="mdi-plus-minus-variant"
              :disabled="!canLogTracking || busy || progress.locked"
              @click="emit('logTracking', progress, tracker.id)"
            >
              Log amount
            </v-btn>
            <v-btn
              block
              variant="tonal"
              color="secondary"
              prepend-icon="mdi-timer-outline"
              :disabled="!canLogTracking || busy || progress.locked"
              @click="emit('logTrackingTime', progress, tracker.id)"
            >
              Log time
            </v-btn>
          </div>
        </template>
      </v-list>

      <div
        v-if="isTracking && !canLogTracking && !progress.complete && progress.status === 'pending'"
        class="status-banner mt-3 muted"
      >
        <v-icon icon="mdi-calendar-today-outline" size="1rem" /> Select today or an earlier date to log tracking
      </div>

      <div v-if="isStepCounter && stepCountError" class="step-source-message mt-3 text-warning">
        <v-icon icon="mdi-alert-circle-outline" size="1rem" />
        <span>{{ stepCountError }}</span>
      </div>

      <div
        v-if="!progress.locked && numericGoalStatus"
        :class="['status-banner', 'mt-3', numericGoalStatus.tone]"
      >
        <span class="status-banner__label">
          <v-icon :icon="numericGoalStatus.icon" size="1rem" />
          {{ numericGoalStatus.title }}
        </span>
        <strong class="status-banner__amount">{{ numericGoalStatus.amount }}</strong>
      </div>

      <div v-if="progress.locked" class="status-banner mt-3 muted">
        <v-icon icon="mdi-lock-outline" size="1rem" /> Complete or resolve earlier program steps first
      </div>

      <div v-if="progress.status === 'missed'" class="status-banner mt-3 text-error">
        <v-icon icon="mdi-alert-circle-outline" size="1rem" /> Missed
      </div>
    </div>
    <div
      v-if="taskLogImageDeck.length"
      ref="taskImageDeckRef"
      class="task-image-deck mt-3"
      :style="{ '--task-image-deck-gap': taskImageDeckGap }"
    >
      <div
        v-for="(image, index) in taskLogImageDeck"
        :key="`${image.id}-${index}`"
        class="task-image-deck__item"
        :style="{ zIndex: taskLogImageDeck.length - index }"
      >
        <v-img
          class="task-image-deck__item-image"
          :src="image.image"
          :alt="image.label || 'Task log image'"
          aspect-ratio="1"
          cover
        />
      </div>
    </div>
  </v-card>
</template>

<style scoped>
.task-card {
  position: relative;
  overflow: hidden;
  cursor: pointer;
  transition: opacity .18s ease;
}

.task-card:focus-visible {
  outline: .125rem solid rgba(var(--v-theme-secondary), .82);
  outline-offset: .2rem;
}

.task-card--done {
  background: transparent;
  filter: grayscale(1);
  opacity: .55;
}

.task-card--outside-schedule:not(.task-card--done) { opacity: .74; }
.task-icon-area { position: relative; flex: 0 0 auto; }

.check-control {
  display: grid;
  width: 2.75rem;
  height: 2.75rem;
  place-items: center;
  border-radius: .875rem;
  background: rgb(var(--v-theme-surface-variant));
  color: rgb(var(--v-theme-on-surface) / .62);
}

.check-control--done { background: transparent; color: var(--task-color); }
.check-control--type { background: var(--task-color); color: #191c19; }
.check-control--paused { background: rgb(var(--v-theme-on-surface) / .14); }

.task-required-badge {
  position: absolute;
  top: -.2rem;
  right: -.2rem;
  width: .8rem;
  height: .8rem;
  border: .15rem solid rgb(var(--v-theme-surface));
  border-radius: 50%;
  background: rgb(var(--v-theme-error));
  box-shadow: 0 .1rem .35rem rgba(0, 0, 0, .32);
}

.task-title { font-size: .98rem; font-weight: 850; line-height: 1.25; }
.task-subtitle { max-width: 28rem; color: rgb(var(--v-theme-on-surface) / .5); font-size: .75rem; }
.schedule-status,
.period-pill {
  display: inline-block;
  padding: .1875rem .4375rem;
  border-radius: 999rem;
  background: rgb(var(--v-theme-surface-variant));
  color: rgb(var(--v-theme-on-surface) / .62);
  font-size: .57rem;
  font-weight: 850;
  letter-spacing: .07em;
  text-transform: uppercase;
}

.task-tag-enter-active,
.task-tag-leave-active { transition: opacity .16s ease; }
.task-tag-enter-from,
.task-tag-leave-to { opacity: 0; }
.period-pill { color: rgb(var(--v-theme-on-surface) / .72); }

.metric-row { display: flex; align-items: baseline; justify-content: space-between; gap: .75rem; }
.metric-value { display: inline-block; border-radius: .35rem; font-size: 1.12rem; font-weight: 900; transform-origin: left center; }
.metric-value--updated { animation: metric-value-pulse 560ms cubic-bezier(.22, 1, .36, 1); }
.metric-target { color: rgb(var(--v-theme-on-surface) / .52); font-size: .72rem; }

.task-detail-list { display: grid; gap: .4rem; }
.task-detail-item { min-height: 2.75rem; background: rgba(var(--v-theme-on-surface), .04); }
.task-detail-item__icon {
  display: grid;
  width: 2rem;
  height: 2rem;
  margin-inline-end: .7rem;
  place-items: center;
  border-radius: .65rem;
  color: #17200f;
}
.tracking-duration-actions { display: grid; margin-top: -.2rem; padding: .2rem .4rem .5rem; gap: .5rem; }
.tracking-duration-actions .v-btn { min-height: 2.75rem; }

.task-image-deck {
  display: flex;
  flex-wrap: nowrap;
  overflow: hidden;
  align-items: center;
  --task-image-deck-gap: 4px;
}

.task-image-deck__item {
  flex: 0 0 auto;
  width: 1.6rem;
  height: 1.6rem;
  min-width: 1.6rem;
  min-height: 1.6rem;
  border-radius: .35rem;
  background: rgb(var(--v-theme-surface-variant));
  border: .0625rem solid rgb(var(--v-theme-on-surface) / .12);
  overflow: hidden;
}

.task-image-deck__item-image {
  width: 100% !important;
  height: 100% !important;
}

.task-image-deck__item-image :deep(.v-img__img) {
  width: 100% !important;
  height: 100% !important;
  object-fit: cover;
}

.task-image-deck__item:not(:first-child) {
  margin-inline-start: var(--task-image-deck-gap);
}

.step-source-message {
  display: flex;
  align-items: flex-start;
  gap: .4rem;
  font-size: .72rem;
  font-weight: 700;
  line-height: 1.4;
}
.step-source-message .v-icon { margin-top: .05rem; flex: 0 0 auto; }

.status-banner {
  display: flex;
  align-items: center;
  gap: .35rem;
  font-size: .72rem;
  font-weight: 800;
}
.status-banner__label { display: inline-flex; min-width: 0; align-items: center; gap: .35rem; }
.status-banner__amount { margin-left: auto; text-align: right; }

@keyframes metric-value-pulse {
  0%, 100% { background: transparent; box-shadow: 0 0 0 0 transparent; color: inherit; }
  38% {
    background: color-mix(in srgb, var(--task-color) 24%, transparent);
    box-shadow: 0 0 0 .3rem color-mix(in srgb, var(--task-color) 16%, transparent);
    color: var(--task-color);
  }
}

@media (prefers-reduced-motion: reduce) {
  .task-card { transition-duration: 0s; }
  .metric-value--updated { animation-duration: 0s; }
}
</style>
