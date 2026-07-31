import type { ObjectDirective } from 'vue'
import { dragActivationFeedback } from '@/services/haptics'

export interface LongPressDragResult {
  id: string
  fromIndex: number
  toIndex: number
  orderedIds: string[]
}

export interface LongPressDragOptions {
  id: string
  group?: string
  handle?: string
  disabled?: boolean
  holdMs?: number
  onDrop: (result: LongPressDragResult) => void
}

interface DragGesture {
  pointerId: number
  startX: number
  startY: number
  clientX: number
  clientY: number
  timer?: number
  active: boolean
  originalDisplay: string
  horizontalSlots: boolean
  sourceBounds?: DOMRect
  ghost?: HTMLElement
  placeholder?: HTMLElement
  autoScrollFrame?: number
  fromIndex: number
}

interface DragState {
  element: HTMLElement
  options: LongPressDragOptions
  gesture?: DragGesture
  suppressClick: boolean
  suppressClickTimer?: number
  onPointerDown: (event: PointerEvent) => void
  onPointerMove: (event: PointerEvent) => void
  onPointerUp: (event: PointerEvent) => void
  onPointerCancel: (event: PointerEvent) => void
  onClick: (event: MouseEvent) => void
  onContextMenu: (event: MouseEvent) => void
  onTouchMove: (event: TouchEvent) => void
}

const states = new WeakMap<HTMLElement, DragState>()
const INTERACTIVE_SELECTOR = [
  'a',
  'button',
  'input',
  'select',
  'textarea',
  '[contenteditable="true"]',
  '[data-drag-ignore]',
].join(',')
const MOVE_TOLERANCE = 10
const DEFAULT_HOLD_MS = 500
const AUTO_SCROLL_EDGE_PX = 96
const AUTO_SCROLL_MAX_PX = 18

function sameGroup(left: DragState, right: DragState) {
  return (left.options.group || '') === (right.options.group || '')
}

function isDragStartTarget(state: DragState, target: EventTarget | null) {
  if (!(target instanceof Element)) return false
  if (target.closest('.long-press-drag-item') !== state.element) return false
  if (!state.options.handle) return !target.closest(INTERACTIVE_SELECTOR)

  try {
    const handle = target.closest(state.options.handle)
    return Boolean(
      handle
      && state.element.contains(handle)
      && !target.closest('[data-drag-ignore]'),
    )
  } catch {
    return false
  }
}

function siblingStates(state: DragState) {
  const parent = state.element.parentElement
  if (!parent) return []
  return Array.from(parent.children)
    .map((child) => child instanceof HTMLElement ? states.get(child) : undefined)
    .filter((candidate): candidate is DragState => Boolean(candidate && sameGroup(state, candidate)))
}

function clearWindowListeners(state: DragState) {
  window.removeEventListener('pointermove', state.onPointerMove, true)
  window.removeEventListener('pointerup', state.onPointerUp, true)
  window.removeEventListener('pointercancel', state.onPointerCancel, true)
  document.removeEventListener('touchmove', state.onTouchMove, true)
}

function clearSuppressedClickLater(state: DragState) {
  if (state.suppressClickTimer !== undefined) window.clearTimeout(state.suppressClickTimer)
  state.suppressClickTimer = window.setTimeout(() => {
    state.suppressClick = false
    state.suppressClickTimer = undefined
  }, 400)
}

function cleanCloneIds(element: HTMLElement) {
  element.removeAttribute('id')
  element.querySelectorAll('[id]').forEach((child) => child.removeAttribute('id'))
}

function positionGhost(gesture: DragGesture) {
  if (!gesture.ghost || !gesture.sourceBounds) return
  const x = gesture.clientX - gesture.startX
  const y = gesture.clientY - gesture.startY
  gesture.ghost.style.transform = `translate3d(${x}px, ${y}px, 0)`
}

function hasHorizontalSlots(candidates: DragState[]) {
  return candidates.some((candidate, index) => {
    const bounds = candidate.element.getBoundingClientRect()
    return candidates.slice(index + 1).some((other) => {
      const otherBounds = other.element.getBoundingClientRect()
      const overlap = Math.max(
        0,
        Math.min(bounds.bottom, otherBounds.bottom)
          - Math.max(bounds.top, otherBounds.top),
      )
      return overlap >= Math.min(bounds.height, otherBounds.height) / 2
    })
  })
}

function targetBeforePointer(target: HTMLElement, horizontalSlots: boolean, x: number, y: number) {
  const bounds = target.getBoundingClientRect()
  const withinRow = y >= bounds.top && y <= bounds.bottom
  return horizontalSlots && withinRow
    ? x < bounds.left + bounds.width / 2
    : y < bounds.top + bounds.height / 2
}

function updatePlaceholder(state: DragState, x: number, y: number) {
  const gesture = state.gesture
  const parent = state.element.parentElement
  if (!gesture?.active || !gesture.placeholder || !parent) return

  const candidates = siblingStates(state)
    .filter((candidate) => candidate.element !== state.element && !candidate.options.disabled)
  if (!candidates.length) return

  const hit = document.elementFromPoint(x, y)
    ?.closest<HTMLElement>('.long-press-drag-item')
  let target = hit
    ? candidates.find((candidate) => candidate.element === hit)
    : undefined

  if (!target) {
    target = candidates.reduce<{ state: DragState; distance: number } | undefined>((closest, candidate) => {
      const bounds = candidate.element.getBoundingClientRect()
      const distance = Math.hypot(
        x - (bounds.left + bounds.width / 2),
        y - (bounds.top + bounds.height / 2),
      )
      return !closest || distance < closest.distance
        ? { state: candidate, distance }
        : closest
    }, undefined)?.state
  }
  if (!target) return

  if (targetBeforePointer(target.element, gesture.horizontalSlots, x, y)) {
    parent.insertBefore(gesture.placeholder, target.element)
  } else {
    parent.insertBefore(gesture.placeholder, target.element.nextSibling)
  }
}

function pageAutoScrollAmount(clientY: number) {
  const viewportHeight = window.innerHeight
  const edge = Math.min(AUTO_SCROLL_EDGE_PX, viewportHeight / 3)
  if (edge <= 0) return 0

  let direction = 0
  let intensity = 0
  if (clientY < edge) {
    direction = -1
    intensity = Math.min(1, (edge - Math.max(0, clientY)) / edge)
  } else if (clientY > viewportHeight - edge) {
    direction = 1
    intensity = Math.min(
      1,
      (Math.min(viewportHeight, clientY) - (viewportHeight - edge)) / edge,
    )
  }
  if (!direction || intensity <= 0) return 0
  return direction * Math.max(1, Math.round(AUTO_SCROLL_MAX_PX * intensity * intensity))
}

function schedulePageAutoScroll(state: DragState) {
  const gesture = state.gesture
  if (
    !gesture?.active
    || gesture.autoScrollFrame !== undefined
    || pageAutoScrollAmount(gesture.clientY) === 0
  ) return

  gesture.autoScrollFrame = window.requestAnimationFrame(() => {
    const current = state.gesture
    if (!current?.active) return
    current.autoScrollFrame = undefined

    const amount = pageAutoScrollAmount(current.clientY)
    if (!amount) return
    const scrollingElement = document.scrollingElement || document.documentElement
    const previousScrollTop = scrollingElement.scrollTop
    scrollingElement.scrollTop += amount
    if (scrollingElement.scrollTop === previousScrollTop) return

    updatePlaceholder(state, current.clientX, current.clientY)
    schedulePageAutoScroll(state)
  })
}

function stopPageAutoScroll(gesture: DragGesture) {
  if (gesture.autoScrollFrame === undefined) return
  window.cancelAnimationFrame(gesture.autoScrollFrame)
  gesture.autoScrollFrame = undefined
}

function activateDrag(state: DragState) {
  const gesture = state.gesture
  const parent = state.element.parentElement
  if (!gesture || gesture.active || !parent || state.options.disabled) return

  const siblings = siblingStates(state)
  gesture.fromIndex = siblings.findIndex((candidate) => candidate.element === state.element)
  gesture.horizontalSlots = hasHorizontalSlots(siblings)
  gesture.active = true
  gesture.sourceBounds = state.element.getBoundingClientRect()
  gesture.originalDisplay = state.element.style.display

  const placeholder = document.createElement('div')
  placeholder.className = 'long-press-drag-placeholder'
  placeholder.setAttribute('aria-hidden', 'true')
  placeholder.style.width = `${gesture.sourceBounds.width}px`
  placeholder.style.height = `${gesture.sourceBounds.height}px`
  placeholder.style.borderRadius = getComputedStyle(state.element).borderRadius
  state.element.before(placeholder)
  gesture.placeholder = placeholder

  const ghost = state.element.cloneNode(true) as HTMLElement
  cleanCloneIds(ghost)
  ghost.classList.add('long-press-drag-ghost')
  ghost.setAttribute('aria-hidden', 'true')
  ghost.style.top = `${gesture.sourceBounds.top}px`
  ghost.style.left = `${gesture.sourceBounds.left}px`
  ghost.style.width = `${gesture.sourceBounds.width}px`
  ghost.style.height = `${gesture.sourceBounds.height}px`
  document.body.append(ghost)
  gesture.ghost = ghost

  state.element.style.display = 'none'
  state.element.setAttribute('aria-grabbed', 'true')
  document.body.classList.add('long-press-drag-active')
  document.addEventListener('touchmove', state.onTouchMove, { capture: true, passive: false })
  state.suppressClick = true
  positionGhost(gesture)
  dragActivationFeedback()
  schedulePageAutoScroll(state)
}

function orderedIdsAtDrop(state: DragState) {
  const gesture = state.gesture
  const parent = state.element.parentElement
  if (!gesture?.placeholder || !parent) return []

  const result: string[] = []
  Array.from(parent.children).forEach((child) => {
    if (child === gesture.placeholder) {
      result.push(state.options.id)
      return
    }
    if (!(child instanceof HTMLElement) || child === state.element) return
    const candidate = states.get(child)
    if (candidate && sameGroup(state, candidate)) result.push(candidate.options.id)
  })
  return result
}

function finishGesture(state: DragState, drop: boolean) {
  const gesture = state.gesture
  if (!gesture) return

  if (gesture.timer !== undefined) window.clearTimeout(gesture.timer)
  stopPageAutoScroll(gesture)
  clearWindowListeners(state)

  const orderedIds = gesture.active && drop ? orderedIdsAtDrop(state) : []
  const toIndex = orderedIds.indexOf(state.options.id)
  gesture.ghost?.remove()
  gesture.placeholder?.remove()
  state.element.style.display = gesture.originalDisplay
  state.element.setAttribute('aria-grabbed', 'false')
  document.body.classList.remove('long-press-drag-active')
  state.gesture = undefined

  if (gesture.active) {
    clearSuppressedClickLater(state)
    if (drop && gesture.fromIndex >= 0 && toIndex >= 0 && gesture.fromIndex !== toIndex) {
      state.options.onDrop({
        id: state.options.id,
        fromIndex: gesture.fromIndex,
        toIndex,
        orderedIds,
      })
    }
  }
}

function createState(element: HTMLElement, options: LongPressDragOptions): DragState {
  const state = {
    element,
    options,
    suppressClick: false,
  } as DragState

  state.onPointerDown = (event) => {
    if (
      state.options.disabled
      || event.button !== 0
      || state.gesture
      || !isDragStartTarget(state, event.target)
    ) return

    const gesture: DragGesture = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      clientX: event.clientX,
      clientY: event.clientY,
      active: false,
      originalDisplay: '',
      horizontalSlots: false,
      fromIndex: -1,
    }
    state.gesture = gesture
    gesture.timer = window.setTimeout(
      () => activateDrag(state),
      Math.max(0, state.options.holdMs ?? DEFAULT_HOLD_MS),
    )
    window.addEventListener('pointermove', state.onPointerMove, true)
    window.addEventListener('pointerup', state.onPointerUp, true)
    window.addEventListener('pointercancel', state.onPointerCancel, true)
  }

  state.onPointerMove = (event) => {
    const gesture = state.gesture
    if (!gesture || event.pointerId !== gesture.pointerId) return
    gesture.clientX = event.clientX
    gesture.clientY = event.clientY

    if (!gesture.active) {
      if (Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) > MOVE_TOLERANCE) {
        finishGesture(state, false)
      }
      return
    }

    if (event.cancelable) event.preventDefault()
    positionGhost(gesture)
    updatePlaceholder(state, event.clientX, event.clientY)
    schedulePageAutoScroll(state)
  }

  state.onPointerUp = (event) => {
    if (event.pointerId === state.gesture?.pointerId) finishGesture(state, true)
  }

  state.onPointerCancel = (event) => {
    if (event.pointerId === state.gesture?.pointerId) finishGesture(state, false)
  }

  state.onClick = (event) => {
    if (!state.suppressClick) return
    state.suppressClick = false
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  state.onContextMenu = (event) => {
    if (!state.gesture) return
    event.preventDefault()
  }

  state.onTouchMove = (event) => {
    if (state.gesture?.active && event.cancelable) event.preventDefault()
  }

  return state
}

export const longPressDrag: ObjectDirective<HTMLElement, LongPressDragOptions> = {
  mounted(element, binding) {
    const state = createState(element, binding.value)
    states.set(element, state)
    element.classList.add('long-press-drag-item')
    element.setAttribute('aria-grabbed', 'false')
    element.addEventListener('pointerdown', state.onPointerDown)
    element.addEventListener('click', state.onClick, true)
    element.addEventListener('contextmenu', state.onContextMenu)
  },

  updated(element, binding) {
    const state = states.get(element)
    if (!state) return
    state.options = binding.value
    if (state.options.disabled && state.gesture) finishGesture(state, false)
  },

  beforeUnmount(element) {
    const state = states.get(element)
    if (!state) return
    finishGesture(state, false)
    if (state.suppressClickTimer !== undefined) window.clearTimeout(state.suppressClickTimer)
    element.removeEventListener('pointerdown', state.onPointerDown)
    element.removeEventListener('click', state.onClick, true)
    element.removeEventListener('contextmenu', state.onContextMenu)
    element.classList.remove('long-press-drag-item')
    element.removeAttribute('aria-grabbed')
    states.delete(element)
  },
}
