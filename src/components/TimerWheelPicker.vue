<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import {
  changeSelectionFeedback,
  endSelectionFeedback,
  startSelectionFeedback,
} from '@/services/haptics'

const props = withDefaults(defineProps<{
  modelValue: number
  maxMinutes?: number
  active?: boolean
}>(), {
  maxMinutes: 59,
  active: true,
})
const emit = defineEmits<{ 'update:modelValue': [value: number] }>()

const pickerId = useId()
const itemHeight = 52
const minuteScroller = ref<HTMLElement>()
const secondScroller = ref<HTMLElement>()
const minutes = ref(0)
const seconds = ref(0)
const minutePosition = ref(0)
const secondPosition = ref(0)
const scrollFrames: Partial<Record<'minutes' | 'seconds', number>> = {}
let selectionActive = false
let selectionEndTimer: number | undefined

function beginSelection() {
  if (selectionActive) return
  selectionActive = true
  startSelectionFeedback()
}

function finishSelection() {
  if (selectionEndTimer) window.clearTimeout(selectionEndTimer)
  selectionEndTimer = undefined
  if (!selectionActive) return
  selectionActive = false
  endSelectionFeedback()
}

function scheduleSelectionEnd() {
  if (selectionEndTimer) window.clearTimeout(selectionEndTimer)
  selectionEndTimer = window.setTimeout(finishSelection, 140)
}

function tickSelection() {
  beginSelection()
  changeSelectionFeedback()
  scheduleSelectionEnd()
}

function normalizedParts(value: number) {
  const total = Math.max(0, Math.round(Number(value) || 0))
  return {
    minutes: Math.min(props.maxMinutes, Math.floor(total / 60)),
    seconds: total % 60,
  }
}

function setLocalValue(value: number) {
  const parts = normalizedParts(value)
  minutes.value = parts.minutes
  seconds.value = parts.seconds
  minutePosition.value = parts.minutes
  secondPosition.value = parts.seconds
}

function scrollToValue(element: HTMLElement | undefined, value: number, behavior: ScrollBehavior = 'auto') {
  element?.scrollTo({ top: value * itemHeight, behavior })
}

function syncScrollers() {
  minutePosition.value = minutes.value
  secondPosition.value = seconds.value
  scrollToValue(minuteScroller.value, minutes.value)
  scrollToValue(secondScroller.value, seconds.value)
}

function updateValue(part: 'minutes' | 'seconds', value: number, behavior: ScrollBehavior = 'smooth') {
  const changed = part === 'minutes' ? minutes.value !== value : seconds.value !== value
  if (part === 'minutes') {
    minutes.value = value
    scrollToValue(minuteScroller.value, value, behavior)
  } else {
    seconds.value = value
    scrollToValue(secondScroller.value, value, behavior)
  }
  emit('update:modelValue', minutes.value * 60 + seconds.value)
  if (changed) tickSelection()
}

function updateInput(part: 'minutes' | 'seconds', value: string | number | null) {
  const maximum = part === 'minutes' ? props.maxMinutes : 59
  const normalized = Math.min(maximum, Math.max(0, Math.round(Number(value) || 0)))
  updateValue(part, normalized, 'auto')
}

function activateCenteredValue(part: 'minutes' | 'seconds') {
  const element = part === 'minutes' ? minuteScroller.value : secondScroller.value
  if (!element) return
  const maximum = part === 'minutes' ? props.maxMinutes : 59
  const value = Math.min(maximum, Math.max(0, Math.round(element.scrollTop / itemHeight)))
  if (part === 'minutes') {
    if (minutes.value === value) return
    minutes.value = value
  } else {
    if (seconds.value === value) return
    seconds.value = value
  }
  emit('update:modelValue', minutes.value * 60 + seconds.value)
  tickSelection()
}

function handleScroll(part: 'minutes' | 'seconds') {
  if (scrollFrames[part]) cancelAnimationFrame(scrollFrames[part])
  scrollFrames[part] = requestAnimationFrame(() => {
    const element = part === 'minutes' ? minuteScroller.value : secondScroller.value
    if (element) {
      const position = element.scrollTop / itemHeight
      if (part === 'minutes') minutePosition.value = position
      else secondPosition.value = position
    }
    activateCenteredValue(part)
    scrollFrames[part] = undefined
  })
}

function optionStyle(value: number, position: number) {
  const distance = Math.max(-2, Math.min(2, value - position))
  const depth = Math.abs(distance)
  const angle = distance * 15
  const angleRadians = angle * Math.PI / 180
  const wheelRadius = 165
  const curvedPosition = Math.sin(angleRadians) * wheelRadius
  const linearPosition = distance * itemHeight
  return {
    '--wheel-rotation': `${angle * -1}deg`,
    '--wheel-offset': `${curvedPosition - linearPosition}px`,
    '--wheel-depth': `${(Math.cos(angleRadians) - 1) * (wheelRadius + 150)}px`,
    '--wheel-opacity': String(Math.max(.18, 1 - depth * .58)),
  }
}

watch(() => props.modelValue, (value) => {
  const parts = normalizedParts(value)
  if (parts.minutes === minutes.value && parts.seconds === seconds.value) return
  minutes.value = parts.minutes
  seconds.value = parts.seconds
  if (props.active) nextTick(syncScrollers)
})

watch(() => props.active, (active) => {
  if (active) nextTick(syncScrollers)
})

onMounted(() => {
  setLocalValue(props.modelValue)
  if (props.active) nextTick(syncScrollers)
})

onBeforeUnmount(() => {
  Object.values(scrollFrames).forEach((frame) => frame && cancelAnimationFrame(frame))
  finishSelection()
})
</script>

<template>
  <div class="timer-wheel-picker">
    <div class="timer-wheel__inputs">
      <v-number-input
        :model-value="minutes"
        label="Minutes"
        :min="0"
        :max="maxMinutes"
        :step="1"
        variant="outlined"
        density="comfortable"
        rounded="lg"
        hide-details="auto"
        @update:model-value="updateInput('minutes', $event)"
      />
      <v-number-input
        :model-value="seconds"
        label="Seconds"
        :min="0"
        :max="59"
        :step="1"
        variant="outlined"
        density="comfortable"
        rounded="lg"
        hide-details="auto"
        @update:model-value="updateInput('seconds', $event)"
      />
    </div>

    <div class="timer-wheel">
      <div class="timer-wheel__selection" aria-hidden="true" />
      <div
        ref="minuteScroller"
        class="timer-wheel__column"
        role="listbox"
        aria-label="Minutes"
        :aria-activedescendant="`${pickerId}-minutes-${minutes}`"
        @scroll.passive="handleScroll('minutes')"
      >
        <div class="timer-wheel__spacer" aria-hidden="true" />
        <button
          v-for="value in maxMinutes + 1"
          :id="`${pickerId}-minutes-${value - 1}`"
          :key="value - 1"
          type="button"
          role="option"
          class="timer-wheel__option"
          :class="{ 'timer-wheel__option--selected': minutes === value - 1 }"
          :style="optionStyle(value - 1, minutePosition)"
          :aria-selected="minutes === value - 1"
          @click="updateValue('minutes', value - 1)"
        >
          <span>{{ String(value - 1).padStart(2, '0') }}</span>
          <small aria-hidden="true">m</small>
        </button>
        <div class="timer-wheel__spacer" aria-hidden="true" />
      </div>

      <span class="timer-wheel__separator" aria-hidden="true">:</span>

      <div
        ref="secondScroller"
        class="timer-wheel__column"
        role="listbox"
        aria-label="Seconds"
        :aria-activedescendant="`${pickerId}-seconds-${seconds}`"
        @scroll.passive="handleScroll('seconds')"
      >
        <div class="timer-wheel__spacer" aria-hidden="true" />
        <button
          v-for="value in 60"
          :id="`${pickerId}-seconds-${value - 1}`"
          :key="value - 1"
          type="button"
          role="option"
          class="timer-wheel__option"
          :class="{ 'timer-wheel__option--selected': seconds === value - 1 }"
          :style="optionStyle(value - 1, secondPosition)"
          :aria-selected="seconds === value - 1"
          @click="updateValue('seconds', value - 1)"
        >
          <span>{{ String(value - 1).padStart(2, '0') }}</span>
          <small aria-hidden="true">s</small>
        </button>
        <div class="timer-wheel__spacer" aria-hidden="true" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.timer-wheel-picker {
  width: 100%;
  margin: 0 auto;
  border-radius: 24px;
  background: rgb(var(--v-theme-background));
}
.timer-wheel__inputs {
  display: none;
}
.timer-wheel {
  position: relative;
  display: grid;
  height: 156px;
  grid-template-columns: minmax(0, 1fr) 1.75rem minmax(0, 1fr);
  overflow: hidden;
  border-radius: 20px;
  background: transparent;
}
.timer-wheel__selection {
  position: absolute;
  z-index: 0;
  top: 52px;
  right: .5rem;
  left: .5rem;
  height: 52px;
  border-block: 1px solid rgb(var(--v-theme-secondary) / .6);
  background: rgb(var(--v-theme-secondary) / .1);
  pointer-events: none;
}
.timer-wheel__column {
  position: relative;
  z-index: 1;
  height: 156px;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  perspective: 260px;
  scrollbar-width: none;
  scroll-snap-type: y mandatory;
  touch-action: pan-y;
}
.timer-wheel__column::-webkit-scrollbar { display: none; }
.timer-wheel__spacer { height: 52px; scroll-snap-align: none; }
.timer-wheel__option {
  display: flex;
  width: 100%;
  height: 52px;
  padding: 0;
  border: 0;
  align-items: center;
  justify-content: center;
  gap: .28rem;
  scroll-snap-align: center;
  background: transparent;
  color: rgb(var(--v-theme-on-surface) / .58);
  font: inherit;
  font-size: 1.35rem;
  font-variant-numeric: tabular-nums;
  font-weight: 750;
  opacity: var(--wheel-opacity, .42);
  transform:
    translate3d(0, var(--wheel-offset, 0), var(--wheel-depth, 0))
    rotateX(var(--wheel-rotation, 0deg));
  transform-origin: center;
  transform-style: preserve-3d;
  backface-visibility: hidden;
  will-change: transform, opacity;
  cursor: pointer;
}
.timer-wheel__option--selected {
  color: rgb(var(--v-theme-secondary));
  font-weight: 900;
}
.timer-wheel__option small {
  color: currentColor;
  font-size: .68rem;
  font-weight: 750;
  opacity: .55;
}
.timer-wheel__separator {
  position: relative;
  z-index: 2;
  display: grid;
  place-items: center;
  color: rgb(var(--v-theme-secondary));
  font-size: 1.5rem;
  font-weight: 900;
  pointer-events: none;
}

@media (min-width: 960px) {
  .timer-wheel-picker {
    width: 100%;
    max-width: none;
    border-radius: 0;
    background: transparent;
  }

  .timer-wheel__inputs {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1rem;
  }

  .timer-wheel {
    display: none;
  }
}
</style>
