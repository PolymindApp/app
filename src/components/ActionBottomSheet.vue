<script setup lang="ts">
import { onBeforeUnmount, onMounted, shallowRef, useId, watch } from 'vue'
import { useDisplay } from 'vuetify'

const props = withDefaults(defineProps<{
  title: string
  description?: string
  ariaLabel?: string
  hideTitle?: boolean
  menuTarget?: string | Element | [number, number]
}>(), {
  ariaLabel: 'Actions',
  hideTitle: false,
})

const model = defineModel<boolean>({ default: false })
const { smAndDown } = useDisplay()
const sheetId = useId()
const desktopTarget = shallowRef<string | Element | [number, number]>()
let lastInteractionElement: Element | undefined
let lastPointerPosition: [number, number] | undefined

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

function closestInteractionElement(target: EventTarget | null) {
  if (!(target instanceof Element)) return undefined
  return target.closest('button, a, [role="button"], [tabindex]') || target
}

function rememberPointerTarget(event: PointerEvent) {
  lastInteractionElement = closestInteractionElement(event.target)
  lastPointerPosition = [event.clientX, event.clientY]
}

function rememberKeyboardTarget(event: KeyboardEvent) {
  if (event.key !== 'Enter' && event.key !== ' ') return
  lastInteractionElement = closestInteractionElement(event.target)
}

function resolveDesktopTarget() {
  if (props.menuTarget) return props.menuTarget
  if (lastInteractionElement?.isConnected) return lastInteractionElement
  if (lastPointerPosition) return lastPointerPosition
  const focused = document.activeElement
  if (focused instanceof Element && focused !== document.body && focused !== document.documentElement) return focused
  return [Math.round(window.innerWidth / 2), Math.min(Math.round(window.innerHeight / 2), 320)] as [number, number]
}

watch(model, (open) => {
  if (open) {
    if (!smAndDown.value) desktopTarget.value = resolveDesktopTarget()
    return
  }
  drag = undefined
  clearPointerListeners()
  clearSettleTimer()
  clearInlineGestureStyles()
})

watch(model, (open) => {
  const scrim = sheetElement()?.nextElementSibling
  if (!(scrim instanceof HTMLElement) || !scrim.classList.contains('v-navigation-drawer__scrim')) return
  if (open) scrim.style.removeProperty('pointer-events')
  else scrim.style.setProperty('pointer-events', 'none', 'important')
}, { flush: 'post' })

watch(smAndDown, (mobile) => {
  if (!model.value) return
  if (mobile) desktopTarget.value = undefined
  else desktopTarget.value = resolveDesktopTarget()
})

onMounted(() => {
  document.addEventListener('pointerdown', rememberPointerTarget, true)
  document.addEventListener('keydown', rememberKeyboardTarget, true)
  if (model.value && !smAndDown.value) desktopTarget.value = resolveDesktopTarget()
})

onBeforeUnmount(() => {
  drag = undefined
  clearPointerListeners()
  clearSettleTimer()
  clearInlineGestureStyles()
  document.removeEventListener('pointerdown', rememberPointerTarget, true)
  document.removeEventListener('keydown', rememberKeyboardTarget, true)
})
</script>

<template>
  <v-menu
    v-if="!smAndDown"
    v-model="model"
    :target="desktopTarget"
    location="bottom end"
    :close-on-content-click="false"
    :max-width="430"
    :aria-label="ariaLabel"
  >
    <v-list
      v-if="hideTitle && !$slots.content"
      density="compact"
      class="action-menu pa-1"
    >
      <slot />
    </v-list>
    <v-card
      v-else
      class="action-menu"
      :class="{ 'action-menu--content': $slots.content }"
      rounded="lg"
    >
      <div v-if="!hideTitle" class="action-menu__header px-4 py-3">
        <strong class="d-block text-truncate">{{ title }}</strong>
        <p v-if="description" class="action-bottom-sheet__description mt-1 mb-0">
          {{ description }}
        </p>
      </div>
      <div v-if="$slots.content" class="action-menu__content pa-4">
        <slot name="content" />
      </div>
      <v-list v-if="$slots.default" density="compact" class="action-menu__list pa-1">
        <slot />
      </v-list>
    </v-card>
  </v-menu>

  <Teleport v-else to="body">
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
      <div
        class="action-bottom-sheet__header"
        :class="{ 'action-bottom-sheet__header--handle-only': hideTitle }"
        @pointerdown="onPointerDown"
      >
        <div class="action-bottom-sheet__handle" aria-hidden="true" />
        <div v-if="!hideTitle" class="px-4 pt-2 pb-2">
          <strong class="d-block text-truncate">{{ title }}</strong>
          <p v-if="description" class="action-bottom-sheet__description mt-1 mb-0">
            {{ description }}
          </p>
        </div>
      </div>
      <div class="action-bottom-sheet__scroll">
        <div v-if="$slots.content" class="action-bottom-sheet__content px-4 pt-2 pb-4">
          <slot name="content" />
        </div>
        <v-list v-if="$slots.default" class="action-bottom-sheet__content px-2 pb-4">
          <slot />
        </v-list>
      </div>
    </v-navigation-drawer>
  </Teleport>
</template>

<style scoped>
.action-menu {
  min-width: 14rem;
  max-height: calc(100dvh - 2rem);
  overflow-y: auto;
  border: .0625rem solid rgb(var(--v-theme-on-surface) / .1);
  background: rgb(var(--v-theme-surface));
}

.action-menu--content { width: min(26.875rem, calc(100vw - 2rem)); }
.action-menu__header { border-bottom: .0625rem solid rgb(var(--v-theme-on-surface) / .08); }
.action-menu__content + .action-menu__list { border-top: .0625rem solid rgb(var(--v-theme-on-surface) / .08); }

.action-bottom-sheet {
  bottom: max(
    env(safe-area-inset-bottom, 0px),
    var(--safe-area-inset-bottom, 0px)
  ) !important;
  height: auto !important;
  max-height: 80dvh;
  overflow: hidden;
  border-radius: 24px 24px 0 0;
  background: rgb(var(--v-theme-surface));
  isolation: isolate;
}

.action-bottom-sheet :deep(.v-navigation-drawer__content) {
  display: flex;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
}

/* Vuetify hides bottom drawers using the numeric drawer width (430px). The
   sheet itself can be taller, so use its rendered height when it is closed. */
.action-bottom-sheet:not(.v-navigation-drawer--active) {
  transform: translateY(100%) !important;
}

.action-bottom-sheet__header {
  position: sticky;
  z-index: 1;
  top: 0;
  background: rgb(var(--v-theme-surface));
  cursor: grab;
  touch-action: none;
  padding-top: 10px;
}

.action-bottom-sheet__scroll {
  min-height: 0;
  flex: 1 1 auto;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior-y: contain;
  -webkit-overflow-scrolling: touch;
}

.action-bottom-sheet__content {
  position: relative;
  z-index: 0;
}

.action-bottom-sheet--dragging .action-bottom-sheet__header { cursor: grabbing; }
.action-bottom-sheet__header--handle-only { padding-bottom: .5rem; }

/* The drawer scrim is a sibling rendered by Vuetify and remains in the DOM
   while fading out. Once it is leaving, it must no longer consume a quick
   follow-up tap meant for the page beneath the sheet. */
:global(.action-bottom-sheet + .v-navigation-drawer__scrim) {
  position: fixed;
  inset: 0;
  width: auto;
  height: auto;
}

:global(.v-navigation-drawer__scrim.fade-transition-leave-active) {
  pointer-events: none !important;
}

.action-bottom-sheet__description {
  color: rgb(var(--v-theme-on-surface) / .56);
  font-size: .75rem;
  line-height: 1.4;
}

.action-bottom-sheet__handle {
  width: 42px;
  height: 5px;
  margin: 0 auto 0;
  border-radius: 999px;
  background: rgba(var(--v-theme-on-surface), .42);
}
</style>
