<script setup lang="ts">
import { onBeforeUnmount, useId, watch } from 'vue'

withDefaults(defineProps<{
  title: string
  description?: string
  ariaLabel?: string
}>(), {
  ariaLabel: 'Actions',
})

const model = defineModel<boolean>({ default: false })
const sheetId = useId()

interface SheetDrag {
  pointerId: number
  startX: number
  startY: number
  lastY: number
  lastAt: number
  offset: number
  velocity: number
  dragging: boolean
}

let drag: SheetDrag | undefined
let settleTimer: number | undefined

function sheetElement(): HTMLElement | undefined {
  return document.getElementById(sheetId) || undefined
}

function clearSettleTimer() {
  if (settleTimer === undefined) return
  window.clearTimeout(settleTimer)
  settleTimer = undefined
}

function clearInlineGestureStyles() {
  const sheet = sheetElement()
  sheet?.style?.removeProperty('transition')
  sheet?.style?.removeProperty('transform')
  sheet?.classList.remove('action-bottom-sheet--dragging')
}

function clearPointerListeners() {
  window.removeEventListener('pointermove', onPointerMove, true)
  window.removeEventListener('pointerup', onPointerUp, true)
  window.removeEventListener('pointercancel', onPointerCancel, true)
  window.removeEventListener('blur', onWindowBlur)
}

function finishDrag(cancelled = false) {
  const current = drag
  if (!current) return
  drag = undefined
  clearPointerListeners()

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
    model.value = false
    return
  }

  sheet.style.transform = 'translateY(0)'
  settleTimer = window.setTimeout(() => {
    settleTimer = undefined
    clearInlineGestureStyles()
  }, 180)
}

function onPointerDown(event: PointerEvent) {
  if (
    !model.value
    || drag
    || !event.isPrimary
    || (event.pointerType === 'mouse' && event.button !== 0)
  ) return

  clearSettleTimer()
  clearInlineGestureStyles()
  drag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    lastY: event.clientY,
    lastAt: event.timeStamp,
    offset: 0,
    velocity: 0,
    dragging: false,
  }
  window.addEventListener('pointermove', onPointerMove, { capture: true, passive: false })
  window.addEventListener('pointerup', onPointerUp, true)
  window.addEventListener('pointercancel', onPointerCancel, true)
  window.addEventListener('blur', onWindowBlur)
}

function onPointerMove(event: PointerEvent) {
  const current = drag
  if (!current || event.pointerId !== current.pointerId) return

  const deltaX = event.clientX - current.startX
  const deltaY = event.clientY - current.startY
  if (!current.dragging) {
    if (Math.abs(deltaX) > 6 && Math.abs(deltaX) > Math.abs(deltaY)) {
      finishDrag(true)
      return
    }
    if (deltaY <= 4 || Math.abs(deltaY) <= Math.abs(deltaX)) return
    current.dragging = true
    const sheet = sheetElement()
    sheet?.classList.add('action-bottom-sheet--dragging')
    if (sheet) sheet.style.transition = 'none'
  }

  const elapsed = Math.max(1, event.timeStamp - current.lastAt)
  current.velocity = (event.clientY - current.lastY) / elapsed
  current.lastY = event.clientY
  current.lastAt = event.timeStamp
  current.offset = Math.max(0, deltaY)
  if (event.cancelable) event.preventDefault()
  const sheet = sheetElement()
  if (sheet) sheet.style.transform = `translateY(${current.offset}px)`
}

function onPointerUp(event: PointerEvent) {
  if (drag?.pointerId === event.pointerId) finishDrag()
}

function onPointerCancel(event: PointerEvent) {
  if (drag?.pointerId === event.pointerId) finishDrag(true)
}

function onWindowBlur() {
  finishDrag(true)
}

watch(model, (open) => {
  if (open) return
  drag = undefined
  clearPointerListeners()
  clearSettleTimer()
  clearInlineGestureStyles()
})

onBeforeUnmount(() => {
  drag = undefined
  clearPointerListeners()
  clearSettleTimer()
  clearInlineGestureStyles()
})
</script>

<template>
  <v-navigation-drawer
    :id="sheetId"
    v-model="model"
    temporary
    location="bottom"
    touchless
    :width="430"
    class="action-bottom-sheet"
    :aria-label="ariaLabel"
  >
    <div class="action-bottom-sheet__header" @pointerdown="onPointerDown">
      <div class="action-bottom-sheet__handle" aria-hidden="true" />
      <div class="px-4 pt-2 pb-2">
        <strong class="d-block text-truncate">{{ title }}</strong>
        <p v-if="description" class="action-bottom-sheet__description mt-1 mb-0">
          {{ description }}
        </p>
      </div>
    </div>
    <div v-if="$slots.content" class="px-4 pt-2 pb-4">
      <slot name="content" />
    </div>
    <v-list v-if="$slots.default" class="px-2 pb-4">
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

/* The drawer scrim is a sibling rendered by Vuetify and remains in the DOM
   while fading out. Once it is leaving, it must no longer consume a quick
   follow-up tap meant for the page beneath the sheet. */
:global(.action-bottom-sheet + .v-navigation-drawer__scrim.fade-transition-leave-active) {
  pointer-events: none;
}

.action-bottom-sheet__description {
  color: rgb(var(--v-theme-on-surface) / .56);
  font-size: .75rem;
  line-height: 1.4;
}

.action-bottom-sheet__handle {
  width: 42px;
  height: 5px;
  margin: 10px auto 0;
  border-radius: 999px;
  background: rgba(var(--v-theme-on-surface), .42);
}
</style>
