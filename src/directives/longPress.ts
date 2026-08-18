import type { ObjectDirective } from 'vue'
import { dragActivationFeedback } from '@/services/haptics'

export interface LongPressOptions {
  disabled?: boolean
  holdMs?: number
  onLongPress: () => void
}

interface LongPressGesture {
  pointerId: number
  startX: number
  startY: number
  timer: number
}

interface LongPressState {
  options: LongPressOptions
  gesture?: LongPressGesture
  suppressClick: boolean
  clearSuppressTimer?: number
  onPointerDown: (event: PointerEvent) => void
  onPointerMove: (event: PointerEvent) => void
  onPointerEnd: (event: PointerEvent) => void
  onClick: (event: MouseEvent) => void
  onContextMenu: (event: MouseEvent) => void
}

const states = new WeakMap<HTMLElement, LongPressState>()
const DEFAULT_HOLD_MS = 500
const MOVE_TOLERANCE = 10

function clearGesture(state: LongPressState) {
  if (!state.gesture) return
  window.clearTimeout(state.gesture.timer)
  state.gesture = undefined
  window.removeEventListener('pointermove', state.onPointerMove, true)
  window.removeEventListener('pointerup', state.onPointerEnd, true)
  window.removeEventListener('pointercancel', state.onPointerEnd, true)
}

function suppressNextClick(state: LongPressState) {
  state.suppressClick = true
  if (state.clearSuppressTimer !== undefined) window.clearTimeout(state.clearSuppressTimer)
  state.clearSuppressTimer = window.setTimeout(() => {
    state.suppressClick = false
    state.clearSuppressTimer = undefined
  }, 700)
}

function createState(options: LongPressOptions): LongPressState {
  const state: LongPressState = {
    options,
    suppressClick: false,
    onPointerDown(event) {
      if (
        state.options.disabled
        || !event.isPrimary
        || (event.pointerType === 'mouse' && event.button !== 0)
      ) return
      clearGesture(state)
      const pointerId = event.pointerId
      const timer = window.setTimeout(() => {
        if (state.gesture?.pointerId !== pointerId) return
        clearGesture(state)
        suppressNextClick(state)
        dragActivationFeedback()
        state.options.onLongPress()
      }, Math.max(1, state.options.holdMs ?? DEFAULT_HOLD_MS))
      state.gesture = {
        pointerId,
        startX: event.clientX,
        startY: event.clientY,
        timer,
      }
      window.addEventListener('pointermove', state.onPointerMove, true)
      window.addEventListener('pointerup', state.onPointerEnd, true)
      window.addEventListener('pointercancel', state.onPointerEnd, true)
    },
    onPointerMove(event) {
      const gesture = state.gesture
      if (!gesture || gesture.pointerId !== event.pointerId) return
      if (
        Math.abs(event.clientX - gesture.startX) > MOVE_TOLERANCE
        || Math.abs(event.clientY - gesture.startY) > MOVE_TOLERANCE
      ) clearGesture(state)
    },
    onPointerEnd(event) {
      if (state.gesture?.pointerId === event.pointerId) clearGesture(state)
    },
    onClick(event) {
      if (!state.suppressClick) return
      event.preventDefault()
      event.stopImmediatePropagation()
      state.suppressClick = false
    },
    onContextMenu(event) {
      if (state.options.disabled) return
      event.preventDefault()
      clearGesture(state)
      if (state.suppressClick) return
      suppressNextClick(state)
      dragActivationFeedback()
      state.options.onLongPress()
    },
  }
  return state
}

export const longPress: ObjectDirective<HTMLElement, LongPressOptions> = {
  mounted(element, binding) {
    const state = createState(binding.value)
    states.set(element, state)
    element.addEventListener('pointerdown', state.onPointerDown)
    element.addEventListener('click', state.onClick, true)
    element.addEventListener('contextmenu', state.onContextMenu)
  },
  updated(element, binding) {
    const state = states.get(element)
    if (!state) return
    state.options = binding.value
    if (state.options.disabled) clearGesture(state)
  },
  beforeUnmount(element) {
    const state = states.get(element)
    if (!state) return
    clearGesture(state)
    if (state.clearSuppressTimer !== undefined) window.clearTimeout(state.clearSuppressTimer)
    element.removeEventListener('pointerdown', state.onPointerDown)
    element.removeEventListener('click', state.onClick, true)
    element.removeEventListener('contextmenu', state.onContextMenu)
    states.delete(element)
  },
}
