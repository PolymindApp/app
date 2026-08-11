<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import {
  changeSelectionFeedback,
  endSelectionFeedback,
  startSelectionFeedback,
} from '@/services/haptics'

const props = withDefaults(defineProps<{
  modelValue: number | string
  maxMinutes?: number
  active?: boolean
  mode?: 'duration' | 'time'
}>(), {
  maxMinutes: 59,
  active: true,
  mode: 'duration',
})
const emit = defineEmits<{ 'update:modelValue': [value: number | string] }>()

const pickerId = useId()
const itemHeight = 52
const wheelElement = ref<HTMLElement>()
const minuteScroller = ref<HTMLElement>()
const secondScroller = ref<HTMLElement>()
const wheelFocused = ref(false)
const minutes = ref(0)
const seconds = ref(0)
const minutePosition = ref(0)
const secondPosition = ref(0)
type WheelPart = 'minutes' | 'seconds'
const scrollFrames: Partial<Record<WheelPart, number>> = {}
const scrollSettleTimers: Partial<Record<WheelPart, number>> = {}
const activePointerParts = new Map<number, WheelPart>()
const activeTouchParts = new Map<number, WheelPart>()
const pendingSettleParts = new Set<WheelPart>()
const releaseReadyParts = new Set<WheelPart>()
const minuteInteracting = ref(false)
const secondInteracting = ref(false)
let selectionActive = false
let selectionEndTimer: number | undefined
const timeMode = computed(() => props.mode === 'time')
const primaryMaximum = computed(() => timeMode.value ? 23 : props.maxMinutes)

function activateWheel() {
  if (wheelFocused.value) return
  wheelFocused.value = true
  nextTick(syncScrollers)
}

function focusWheel() {
  activateWheel()
  wheelElement.value?.focus({ preventScroll: true })
}

function deactivateWheel() {
  if (!wheelFocused.value) return
  settleScroller('minutes', true)
  settleScroller('seconds', true)
  wheelFocused.value = false
  finishSelection()
  const activeElement = document.activeElement
  if (activeElement instanceof HTMLElement && wheelElement.value?.contains(activeElement)) {
    activeElement.blur()
  }
}

function handleWheelFocusOut(event: FocusEvent) {
  const nextTarget = event.relatedTarget
  if (nextTarget instanceof Node && wheelElement.value?.contains(nextTarget)) return
  if (nextTarget) deactivateWheel()
}

function handleOutsidePointerDown(event: PointerEvent) {
  if (!wheelFocused.value || wheelElement.value?.contains(event.target as Node)) return
  deactivateWheel()
}

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

function normalizedParts(value: number | string) {
  if (timeMode.value) {
    const match = typeof value === 'string' ? /^(\d{2}):(\d{2})$/.exec(value) : undefined
    return {
      minutes: Math.min(23, Math.max(0, Number(match?.[1]) || 0)),
      seconds: Math.min(59, Math.max(0, Number(match?.[2]) || 0)),
    }
  }
  const total = Math.max(0, Math.round(Number(value) || 0))
  return {
    minutes: Math.min(primaryMaximum.value, Math.floor(total / 60)),
    seconds: total % 60,
  }
}

function emitValue() {
  emit('update:modelValue', timeMode.value
    ? `${String(minutes.value).padStart(2, '0')}:${String(seconds.value).padStart(2, '0')}`
    : minutes.value * 60 + seconds.value)
}

function setLocalValue(value: number | string) {
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

function updateValue(part: WheelPart, value: number, behavior: ScrollBehavior = 'smooth') {
  const changed = part === 'minutes' ? minutes.value !== value : seconds.value !== value
  if (part === 'minutes') {
    minutes.value = value
    scrollToValue(minuteScroller.value, value, behavior)
  } else {
    seconds.value = value
    scrollToValue(secondScroller.value, value, behavior)
  }
  emitValue()
  if (changed) tickSelection()
}

function updateInput(part: WheelPart, value: string | number | null) {
  const maximum = part === 'minutes' ? primaryMaximum.value : 59
  const normalized = Math.min(maximum, Math.max(0, Math.round(Number(value) || 0)))
  updateValue(part, normalized, 'auto')
}

function activateCenteredValue(part: WheelPart) {
  const element = part === 'minutes' ? minuteScroller.value : secondScroller.value
  if (!element) return
  const maximum = part === 'minutes' ? primaryMaximum.value : 59
  const value = Math.min(maximum, Math.max(0, Math.round(element.scrollTop / itemHeight)))
  if (part === 'minutes') {
    if (minutes.value === value) return
    minutes.value = value
  } else {
    if (seconds.value === value) return
    seconds.value = value
  }
  emitValue()
  tickSelection()
}

function partIsInteracting(part: WheelPart) {
  return [...activePointerParts.values(), ...activeTouchParts.values()].includes(part)
}

function updatePartInteraction(part: WheelPart) {
  const interacting = partIsInteracting(part)
  if (part === 'minutes') minuteInteracting.value = interacting
  else secondInteracting.value = interacting
}

function beginPointerInteraction(part: WheelPart, event: PointerEvent) {
  activePointerParts.set(event.pointerId, part)
  updatePartInteraction(part)
}

function beginTouchInteraction(part: WheelPart, event: TouchEvent) {
  Array.from(event.changedTouches).forEach(touch => activeTouchParts.set(touch.identifier, part))
  updatePartInteraction(part)
}

function finishPartInteraction(part: WheelPart) {
  updatePartInteraction(part)
  if (partIsInteracting(part) || !pendingSettleParts.has(part)) return
  if (releaseReadyParts.has(part)) settleScroller(part)
  else scheduleScrollSettle(part)
}

function finishPointerInteraction(event: PointerEvent) {
  const part = activePointerParts.get(event.pointerId)
  if (!part) return
  activePointerParts.delete(event.pointerId)
  finishPartInteraction(part)
}

function finishTouchInteraction(event: TouchEvent) {
  const parts = new Set<WheelPart>()
  Array.from(event.changedTouches).forEach(touch => {
    const part = activeTouchParts.get(touch.identifier)
    if (part) parts.add(part)
    activeTouchParts.delete(touch.identifier)
  })
  parts.forEach(finishPartInteraction)
}

function settleScroller(part: WheelPart, force = false) {
  if (scrollSettleTimers[part]) window.clearTimeout(scrollSettleTimers[part])
  scrollSettleTimers[part] = undefined
  if (!wheelFocused.value || !pendingSettleParts.has(part)) return
  if (!force && partIsInteracting(part)) {
    releaseReadyParts.add(part)
    return
  }

  const element = part === 'minutes' ? minuteScroller.value : secondScroller.value
  if (!element) return
  pendingSettleParts.delete(part)
  releaseReadyParts.delete(part)
  const maximum = part === 'minutes' ? primaryMaximum.value : 59
  const value = Math.min(maximum, Math.max(0, Math.round(element.scrollTop / itemHeight)))
  activateCenteredValue(part)
  if (part === 'minutes') minutePosition.value = value
  else secondPosition.value = value
  scrollToValue(element, value, 'smooth')
}

function scheduleScrollSettle(part: WheelPart) {
  if (scrollSettleTimers[part]) window.clearTimeout(scrollSettleTimers[part])
  scrollSettleTimers[part] = window.setTimeout(() => settleScroller(part), 120)
}

function handleScroll(part: WheelPart) {
  if (!wheelFocused.value) return
  pendingSettleParts.add(part)
  releaseReadyParts.delete(part)
  scheduleScrollSettle(part)
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
  document.addEventListener('pointerdown', handleOutsidePointerDown, true)
  document.addEventListener('pointerup', finishPointerInteraction, true)
  document.addEventListener('pointercancel', finishPointerInteraction, true)
  document.addEventListener('touchend', finishTouchInteraction, true)
  document.addEventListener('touchcancel', finishTouchInteraction, true)
  setLocalValue(props.modelValue)
  if (props.active) nextTick(syncScrollers)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handleOutsidePointerDown, true)
  document.removeEventListener('pointerup', finishPointerInteraction, true)
  document.removeEventListener('pointercancel', finishPointerInteraction, true)
  document.removeEventListener('touchend', finishTouchInteraction, true)
  document.removeEventListener('touchcancel', finishTouchInteraction, true)
  Object.values(scrollFrames).forEach((frame) => frame && cancelAnimationFrame(frame))
  Object.values(scrollSettleTimers).forEach((timer) => timer && window.clearTimeout(timer))
  finishSelection()
})
</script>

<template>
  <div class="timer-wheel-picker">
    <div class="timer-wheel__inputs">
      <v-number-input
        :model-value="minutes"
        :label="timeMode ? 'Hours' : 'Minutes'"
        :min="0"
        :max="primaryMaximum"
        :step="1"
        variant="outlined"
        density="comfortable"
        rounded="lg"
        hide-details="auto"
        @update:model-value="updateInput('minutes', $event)"
      />
      <v-number-input
        :model-value="seconds"
        :label="timeMode ? 'Minutes' : 'Seconds'"
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

    <div
      ref="wheelElement"
      class="timer-wheel"
      :class="{ 'timer-wheel--focused': wheelFocused }"
      role="group"
      :aria-label="timeMode ? 'Time wheel' : 'Duration wheel'"
      tabindex="0"
      @focusin="activateWheel"
      @focusout="handleWheelFocusOut"
      @keydown.esc.stop="deactivateWheel"
    >
      <div
        v-if="!wheelFocused"
        class="timer-wheel__focus-guard"
        :aria-label="timeMode ? 'Focus time wheel to adjust' : 'Focus duration wheel to adjust'"
        @click="focusWheel"
      >
        <span>Tap to adjust</span>
      </div>
      <div class="timer-wheel__selection" aria-hidden="true" />
      <div
        ref="minuteScroller"
        class="timer-wheel__column"
        :class="{ 'timer-wheel__column--interacting': minuteInteracting }"
        role="listbox"
        :aria-label="timeMode ? 'Hours' : 'Minutes'"
        :aria-activedescendant="`${pickerId}-minutes-${minutes}`"
        @scroll.passive="handleScroll('minutes')"
        @scrollend.passive="settleScroller('minutes')"
        @pointerdown="beginPointerInteraction('minutes', $event)"
        @touchstart.passive="beginTouchInteraction('minutes', $event)"
      >
        <div class="timer-wheel__spacer" aria-hidden="true" />
        <button
          v-for="value in primaryMaximum + 1"
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
          <small aria-hidden="true">{{ timeMode ? 'h' : 'm' }}</small>
        </button>
        <div class="timer-wheel__spacer" aria-hidden="true" />
      </div>

      <span class="timer-wheel__separator" aria-hidden="true">:</span>

      <div
        ref="secondScroller"
        class="timer-wheel__column"
        :class="{ 'timer-wheel__column--interacting': secondInteracting }"
        role="listbox"
        :aria-label="timeMode ? 'Minutes' : 'Seconds'"
        :aria-activedescendant="`${pickerId}-seconds-${seconds}`"
        @scroll.passive="handleScroll('seconds')"
        @scrollend.passive="settleScroller('seconds')"
        @pointerdown="beginPointerInteraction('seconds', $event)"
        @touchstart.passive="beginTouchInteraction('seconds', $event)"
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
          <small aria-hidden="true">{{ timeMode ? 'm' : 's' }}</small>
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
  outline: .125rem solid transparent;
  outline-offset: .125rem;
  transition: outline-color 180ms ease;
}
.timer-wheel--focused {
  outline-color: rgba(var(--v-theme-secondary), .9);
}
.timer-wheel__focus-guard {
  position: absolute;
  z-index: 4;
  inset: 0;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding-bottom: .35rem;
  cursor: pointer;
  touch-action: pan-y;
}
.timer-wheel__focus-guard span {
  padding: .2rem .5rem;
  border-radius: 999rem;
  background: rgba(var(--v-theme-background), .82);
  color: rgba(var(--v-theme-on-surface), .62);
  font-size: .625rem;
  font-weight: 800;
  letter-spacing: .04em;
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
  overflow-y: hidden;
  overscroll-behavior: contain;
  perspective: 260px;
  scrollbar-width: none;
  scroll-snap-type: y mandatory;
  touch-action: none;
}
.timer-wheel--focused .timer-wheel__column {
  overflow-y: auto;
  touch-action: pan-y;
}
.timer-wheel__column--interacting {
  scroll-snap-type: none;
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

@media (prefers-reduced-motion: reduce) {
  .timer-wheel { transition: none; }
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
