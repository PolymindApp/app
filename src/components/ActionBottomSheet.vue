<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

withDefaults(defineProps<{
  title: string
  ariaLabel?: string
}>(), {
  ariaLabel: 'Actions',
})

const model = defineModel<boolean>({ default: false })
const drawer = ref<HTMLElement | { $el?: HTMLElement }>()

interface SheetTouch {
  identifier: number
  startX: number
  startY: number
  lastY: number
  lastAt: number
  offset: number
  velocity: number
  dragging: boolean
}

let touch: SheetTouch | undefined
let settleTimer: number | undefined

function sheetElement() {
  const value = drawer.value
  if (value instanceof HTMLElement) return value
  return value?.$el
}

function touchWithId(touches: TouchList, identifier: number) {
  for (let index = 0; index < touches.length; index += 1) {
    const candidate = touches.item(index)
    if (candidate?.identifier === identifier) return candidate
  }
  return undefined
}

function clearSettleTimer() {
  if (settleTimer === undefined) return
  window.clearTimeout(settleTimer)
  settleTimer = undefined
}

function clearInlineGestureStyles() {
  const sheet = sheetElement()
  sheet?.style.removeProperty('transition')
  sheet?.style.removeProperty('transform')
  sheet?.classList.remove('action-bottom-sheet--dragging')
}

function clearTouchListeners() {
  window.removeEventListener('touchmove', onTouchMove, true)
  window.removeEventListener('touchend', onTouchEnd, true)
  window.removeEventListener('touchcancel', onTouchCancel, true)
}

function finishTouch(cancelled = false) {
  const current = touch
  if (!current) return
  touch = undefined
  clearTouchListeners()

  const sheet = sheetElement()
  if (!sheet || !current.dragging) {
    clearInlineGestureStyles()
    return
  }

  sheet.classList.remove('action-bottom-sheet--dragging')
  sheet.style.transition = 'transform 180ms cubic-bezier(.4, 0, 1, 1)'
  const closeDistance = Math.min(120, sheet.getBoundingClientRect().height * .28)
  const shouldClose = !cancelled && (
    current.offset >= closeDistance
    || (current.offset >= 24 && current.velocity >= .65)
  )

  if (shouldClose) {
    sheet.style.transform = 'translateY(100%)'
    settleTimer = window.setTimeout(() => {
      settleTimer = undefined
      model.value = false
      void nextTick().then(clearInlineGestureStyles)
    }, 180)
    return
  }

  sheet.style.transform = 'translateY(0)'
  settleTimer = window.setTimeout(() => {
    settleTimer = undefined
    clearInlineGestureStyles()
  }, 180)
}

function onTouchStart(event: TouchEvent) {
  if (!model.value || touch || event.touches.length !== 1) return
  const initial = event.touches.item(0)
  if (!initial) return

  clearSettleTimer()
  clearInlineGestureStyles()
  touch = {
    identifier: initial.identifier,
    startX: initial.clientX,
    startY: initial.clientY,
    lastY: initial.clientY,
    lastAt: event.timeStamp,
    offset: 0,
    velocity: 0,
    dragging: false,
  }
  window.addEventListener('touchmove', onTouchMove, { capture: true, passive: false })
  window.addEventListener('touchend', onTouchEnd, true)
  window.addEventListener('touchcancel', onTouchCancel, true)
}

function onTouchMove(event: TouchEvent) {
  const current = touch
  if (!current) return
  const active = touchWithId(event.touches, current.identifier)
  if (!active) return

  const deltaX = active.clientX - current.startX
  const deltaY = active.clientY - current.startY
  if (!current.dragging) {
    if (Math.abs(deltaX) > 6 && Math.abs(deltaX) > Math.abs(deltaY)) {
      finishTouch(true)
      return
    }
    if (deltaY <= 4 || Math.abs(deltaY) <= Math.abs(deltaX)) return
    current.dragging = true
    const sheet = sheetElement()
    sheet?.classList.add('action-bottom-sheet--dragging')
    if (sheet) sheet.style.transition = 'none'
  }

  const elapsed = Math.max(1, event.timeStamp - current.lastAt)
  current.velocity = (active.clientY - current.lastY) / elapsed
  current.lastY = active.clientY
  current.lastAt = event.timeStamp
  current.offset = Math.max(0, deltaY)
  if (event.cancelable) event.preventDefault()
  if (sheetElement()) sheetElement()!.style.transform = `translateY(${current.offset}px)`
}

function onTouchEnd(event: TouchEvent) {
  if (touch && touchWithId(event.changedTouches, touch.identifier)) finishTouch()
}

function onTouchCancel(event: TouchEvent) {
  if (
    touch
    && (
      event.changedTouches.length === 0
      || touchWithId(event.changedTouches, touch.identifier)
    )
  ) finishTouch(true)
}

watch(model, (open) => {
  if (open) return
  touch = undefined
  clearTouchListeners()
  clearSettleTimer()
  clearInlineGestureStyles()
})

onBeforeUnmount(() => {
  touch = undefined
  clearTouchListeners()
  clearSettleTimer()
  clearInlineGestureStyles()
})
</script>

<template>
  <v-navigation-drawer
    ref="drawer"
    v-model="model"
    temporary
    location="bottom"
    touchless
    :width="430"
    class="action-bottom-sheet"
    :aria-label="ariaLabel"
  >
    <div class="action-bottom-sheet__header" @touchstart.passive="onTouchStart">
      <div class="action-bottom-sheet__handle" aria-hidden="true" />
      <div class="px-4 pt-2 pb-2">
        <strong class="d-block text-truncate">{{ title }}</strong>
      </div>
    </div>
    <v-list class="px-2 pb-4">
      <slot />
    </v-list>
  </v-navigation-drawer>
</template>

<style scoped>
.action-bottom-sheet {
  bottom: max(
    env(safe-area-inset-bottom, 0px),
    var(--safe-area-inset-bottom, 0px)
  ) !important;
  height: auto !important;
  max-height: min(80dvh, 430px);
  overflow: hidden;
  border-radius: 24px 24px 0 0;
}

.action-bottom-sheet__header {
  position: sticky;
  z-index: 1;
  top: 0;
  background: rgb(var(--v-theme-surface));
  cursor: grab;
  touch-action: none;
}

.action-bottom-sheet--dragging .action-bottom-sheet__header { cursor: grabbing; }

.action-bottom-sheet__handle {
  width: 42px;
  height: 5px;
  margin: 10px auto 0;
  border-radius: 999px;
  background: rgba(var(--v-theme-on-surface), .42);
}
</style>
