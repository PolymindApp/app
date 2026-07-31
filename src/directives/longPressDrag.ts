import type { ObjectDirective } from 'vue'
import { dragActivationFeedback } from '@/services/haptics'

export interface LongPressDragResult {
  id: string
  fromIndex: number
  toIndex: number
  orderedIds: string[]
  type?: string
  fromDropZoneId?: string
  toDropZoneId?: string
}

export interface LongPressDragOptions {
  id: string
  type?: string
  group?: string
  handle?: string
  disabled?: boolean
  holdMs?: number
  onDrop: (result: LongPressDragResult) => void
}

export interface LongPressDropOptions {
  id: string
  accepts: string[]
  disabled?: boolean
}

interface DragGesture {
  input: 'pointer' | 'touch'
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
  layoutTransitionFrame?: number
  layoutTransitionTimer?: number
  layoutTransitionElements?: Set<HTMLElement>
  autoScrollFrame?: number
  sourceDropZone?: DropState
  activeDropZone?: DropState
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
  onTouchStart: (event: TouchEvent) => void
  onTouchMove: (event: TouchEvent) => void
  onTouchEnd: (event: TouchEvent) => void
  onTouchCancel: (event: TouchEvent) => void
  onClick: (event: MouseEvent) => void
  onContextMenu: (event: MouseEvent) => void
}

interface DropState {
  element: HTMLElement
  options: LongPressDropOptions
}

const states = new WeakMap<HTMLElement, DragState>()
const dropStates = new WeakMap<HTMLElement, DropState>()
const registeredDropStates = new Set<DropState>()
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
const DROP_HYSTERESIS_PX = 6
const LAYOUT_TRANSITION_CLEANUP_MS = 120
const AUTO_SCROLL_EDGE_PX = 96
const AUTO_SCROLL_MAX_PX = 18

function sameGroup(left: DragState, right: DragState) {
  return (left.options.group || '') === (right.options.group || '')
}

function acceptsDrag(dropState: DropState, dragState: DragState) {
  const type = dragState.options.type
  return Boolean(
    !dropState.options.disabled
    && type
    && (
      dropState.options.accepts.includes(type)
      || dropState.options.accepts.includes('*')
    ),
  )
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

function directDragStates(parent: HTMLElement) {
  return Array.from(parent.children)
    .map((child) => child instanceof HTMLElement ? states.get(child) : undefined)
    .filter((candidate): candidate is DragState => Boolean(candidate))
}

function availableDropStates(state: DragState) {
  return Array.from(registeredDropStates).filter((dropState) =>
    acceptsDrag(dropState, state)
    && !state.element.contains(dropState.element),
  )
}

function dropStateAtPoint(state: DragState, x: number, y: number) {
  let target = document.elementFromPoint(x, y)
  while (target) {
    if (target instanceof HTMLElement) {
      const dropState = dropStates.get(target)
      if (
        dropState
        && acceptsDrag(dropState, state)
        && !state.element.contains(dropState.element)
      ) return dropState
    }
    target = target.parentElement
  }
  return undefined
}

function setActiveDropState(gesture: DragGesture, dropState?: DropState) {
  if (gesture.activeDropZone === dropState) return
  gesture.activeDropZone?.element.classList.remove('long-press-drop-zone--active')
  gesture.activeDropZone = dropState
  dropState?.element.classList.add('long-press-drop-zone--active')
}

function showAvailableDropStates(state: DragState) {
  for (const dropState of availableDropStates(state)) {
    dropState.element.classList.add('long-press-drop-zone--available')
  }
}

function clearDropStateFeedback(gesture: DragGesture) {
  gesture.activeDropZone?.element.classList.remove('long-press-drop-zone--active')
  for (const dropState of registeredDropStates) {
    dropState.element.classList.remove(
      'long-press-drop-zone--active',
      'long-press-drop-zone--available',
    )
  }
  gesture.activeDropZone = undefined
}

function clearWindowListeners(state: DragState) {
  window.removeEventListener('pointermove', state.onPointerMove, true)
  window.removeEventListener('pointerup', state.onPointerUp, true)
  window.removeEventListener('pointercancel', state.onPointerCancel, true)
  window.removeEventListener('touchmove', state.onTouchMove, true)
  window.removeEventListener('touchend', state.onTouchEnd, true)
  window.removeEventListener('touchcancel', state.onTouchCancel, true)
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

function syncGhostWidth(gesture: DragGesture) {
  if (!gesture.ghost || !gesture.placeholder || !gesture.sourceBounds) return
  const placeholderWidth = gesture.placeholder.getBoundingClientRect().width
  const width = placeholderWidth > 0 ? placeholderWidth : gesture.sourceBounds.width
  gesture.ghost.style.setProperty('width', `${width}px`, 'important')
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

function placeholderRelation(
  placeholder: HTMLElement,
  target: HTMLElement,
): 'before' | 'after' | undefined {
  const parent = placeholder.parentElement
  if (!parent || target.parentElement !== parent) return undefined

  const visibleSlots = Array.from(parent.children).filter((child) => (
    child === placeholder
    || (
      child instanceof HTMLElement
      && child.style.display !== 'none'
      && states.has(child)
    )
  ))
  const placeholderIndex = visibleSlots.indexOf(placeholder)
  const targetIndex = visibleSlots.indexOf(target)
  if (placeholderIndex + 1 === targetIndex) return 'before'
  if (targetIndex + 1 === placeholderIndex) return 'after'
  return undefined
}

function targetBeforePointer(
  target: HTMLElement,
  placeholder: HTMLElement,
  horizontalSlots: boolean,
  x: number,
  y: number,
) {
  const bounds = target.getBoundingClientRect()
  const withinRow = y >= bounds.top && y <= bounds.bottom
  const horizontal = horizontalSlots && withinRow
  const pointerPosition = horizontal ? x : y
  const midpoint = horizontal
    ? bounds.left + bounds.width / 2
    : bounds.top + bounds.height / 2
  const relation = placeholderRelation(placeholder, target)
  if (relation === 'before') return pointerPosition < midpoint + DROP_HYSTERESIS_PX
  if (relation === 'after') return pointerPosition < midpoint - DROP_HYSTERESIS_PX
  return pointerPosition < midpoint
}

function clearLayoutTransition(gesture: DragGesture) {
  if (gesture.layoutTransitionFrame !== undefined) {
    window.cancelAnimationFrame(gesture.layoutTransitionFrame)
    gesture.layoutTransitionFrame = undefined
  }
  if (gesture.layoutTransitionTimer !== undefined) {
    window.clearTimeout(gesture.layoutTransitionTimer)
    gesture.layoutTransitionTimer = undefined
  }
  gesture.layoutTransitionElements?.forEach((element) => {
    element.classList.remove('long-press-drag-shifting')
    element.style.removeProperty('transform')
  })
  gesture.layoutTransitionElements = undefined
}

function movePlaceholderVertically(
  gesture: DragGesture,
  destination: HTMLElement,
  move: () => void,
) {
  const placeholder = gesture.placeholder
  if (!placeholder) return

  const source = placeholder.parentElement
  const elements = new Set<HTMLElement>([placeholder])
  if (source instanceof HTMLElement) {
    directDragStates(source).forEach(({ element }) => {
      if (element.style.display !== 'none') elements.add(element)
    })
  }
  directDragStates(destination).forEach(({ element }) => {
    if (element.style.display !== 'none') elements.add(element)
  })

  const before = new Map(
    Array.from(elements, element => [element, element.getBoundingClientRect()] as const),
  )
  clearLayoutTransition(gesture)
  move()

  const moving = new Set<HTMLElement>()
  elements.forEach((element) => {
    const previous = before.get(element)
    if (!previous || !element.isConnected) return
    const offsetY = previous.top - element.getBoundingClientRect().top
    if (!Number.isFinite(offsetY) || Math.abs(offsetY) < 1) return
    element.style.transform = `translate3d(0, ${offsetY}px, 0)`
    moving.add(element)
  })
  if (!moving.size) return

  gesture.layoutTransitionElements = moving
  void placeholder.offsetHeight
  gesture.layoutTransitionFrame = window.requestAnimationFrame(() => {
    gesture.layoutTransitionFrame = undefined
    moving.forEach((element) => {
      element.classList.add('long-press-drag-shifting')
      element.style.transform = 'translate3d(0, 0, 0)'
    })
    gesture.layoutTransitionTimer = window.setTimeout(() => {
      clearLayoutTransition(gesture)
    }, LAYOUT_TRANSITION_CLEANUP_MS)
  })
}

function placePlaceholderAtEnd(gesture: DragGesture, parent: HTMLElement) {
  if (
    gesture.placeholder?.parentElement === parent
    && gesture.placeholder.nextSibling === null
  ) return
  movePlaceholderVertically(gesture, parent, () => {
    if (gesture.placeholder) parent.append(gesture.placeholder)
  })
}

function placePlaceholderBefore(
  gesture: DragGesture,
  parent: HTMLElement,
  reference: ChildNode | null,
) {
  if (
    gesture.placeholder?.parentElement === parent
    && (
      reference === gesture.placeholder
      || gesture.placeholder.nextSibling === reference
    )
  ) return
  movePlaceholderVertically(gesture, parent, () => {
    if (gesture.placeholder) parent.insertBefore(gesture.placeholder, reference)
  })
}

function updatePlaceholder(state: DragState, x: number, y: number) {
  const gesture = state.gesture
  const sourceParent = state.element.parentElement
  if (!gesture?.active || !gesture.placeholder || !sourceParent) return

  const pointedDropState = dropStateAtPoint(state, x, y)
  const currentDropState = gesture.placeholder.parentElement instanceof HTMLElement
    ? dropStates.get(gesture.placeholder.parentElement)
    : undefined
  const targetDropState = pointedDropState
    || (
      currentDropState
      && acceptsDrag(currentDropState, state)
      && !state.element.contains(currentDropState.element)
        ? currentDropState
        : gesture.sourceDropZone
    )
  const parent = targetDropState?.element || sourceParent
  const dropStateChanged = gesture.activeDropZone !== targetDropState
  setActiveDropState(gesture, targetDropState)

  const candidates = (
    targetDropState
      ? directDragStates(parent)
      : siblingStates(state)
  ).filter((candidate) =>
    candidate.element !== state.element
    && (targetDropState || !candidate.options.disabled),
  )
  if (targetDropState && dropStateChanged) {
    gesture.horizontalSlots = hasHorizontalSlots(candidates)
  }
  if (!candidates.length) {
    placePlaceholderAtEnd(gesture, parent)
    syncGhostWidth(gesture)
    return
  }

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

  if (targetBeforePointer(
    target.element,
    gesture.placeholder,
    gesture.horizontalSlots,
    x,
    y,
  )) {
    placePlaceholderBefore(gesture, parent, target.element)
  } else {
    placePlaceholderBefore(gesture, parent, target.element.nextSibling)
  }
  syncGhostWidth(gesture)
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
  const sourceDropZone = dropStates.get(parent)
  gesture.sourceDropZone = sourceDropZone && acceptsDrag(sourceDropZone, state)
    ? sourceDropZone
    : undefined
  const sourceItems = gesture.sourceDropZone
    ? directDragStates(parent)
    : siblings
  gesture.fromIndex = sourceItems.findIndex((candidate) => candidate.element === state.element)
  gesture.horizontalSlots = hasHorizontalSlots(sourceItems)
  gesture.active = true
  gesture.sourceBounds = state.element.getBoundingClientRect()
  gesture.originalDisplay = state.element.style.display

  const placeholder = document.createElement('div')
  placeholder.className = 'long-press-drag-placeholder'
  placeholder.setAttribute('aria-hidden', 'true')
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
  ghost.style.height = `${gesture.sourceBounds.height}px`
  document.body.append(ghost)
  gesture.ghost = ghost
  syncGhostWidth(gesture)

  state.element.style.display = 'none'
  state.element.setAttribute('aria-grabbed', 'true')
  document.body.classList.add('long-press-drag-active')
  if (gesture.input === 'pointer') {
    document.addEventListener('touchmove', state.onTouchMove, { capture: true, passive: false })
  }
  state.suppressClick = true
  showAvailableDropStates(state)
  setActiveDropState(gesture, gesture.sourceDropZone)
  positionGhost(gesture)
  dragActivationFeedback()
  schedulePageAutoScroll(state)
}

function orderedIdsAtDrop(state: DragState) {
  const gesture = state.gesture
  const parent = gesture?.placeholder?.parentElement
  if (!gesture?.placeholder || !parent) return []

  const result: string[] = []
  const dropState = parent instanceof HTMLElement ? dropStates.get(parent) : undefined
  Array.from(parent.children).forEach((child) => {
    if (child === gesture.placeholder) {
      result.push(state.options.id)
      return
    }
    if (!(child instanceof HTMLElement) || child === state.element) return
    const candidate = states.get(child)
    if (
      candidate
      && (
        (dropState && acceptsDrag(dropState, candidate))
        || (!dropState && sameGroup(state, candidate))
      )
    ) result.push(candidate.options.id)
  })
  return result
}

function finishGesture(state: DragState, drop: boolean) {
  const gesture = state.gesture
  if (!gesture) return

  if (gesture.timer !== undefined) window.clearTimeout(gesture.timer)
  clearLayoutTransition(gesture)
  stopPageAutoScroll(gesture)
  clearWindowListeners(state)

  const orderedIds = gesture.active && drop ? orderedIdsAtDrop(state) : []
  const toIndex = orderedIds.indexOf(state.options.id)
  const targetDropZone = gesture.placeholder?.parentElement instanceof HTMLElement
    ? dropStates.get(gesture.placeholder.parentElement)
    : undefined
  const movedDropZone = gesture.sourceDropZone?.options.id !== targetDropZone?.options.id
  clearDropStateFeedback(gesture)
  gesture.ghost?.remove()
  gesture.placeholder?.remove()
  state.element.style.display = gesture.originalDisplay
  state.element.setAttribute('aria-grabbed', 'false')
  document.body.classList.remove('long-press-drag-active')
  state.gesture = undefined

  if (gesture.active) {
    clearSuppressedClickLater(state)
    if (
      drop
      && gesture.fromIndex >= 0
      && toIndex >= 0
      && (gesture.fromIndex !== toIndex || movedDropZone)
    ) {
      const result: LongPressDragResult = {
        id: state.options.id,
        fromIndex: gesture.fromIndex,
        toIndex,
        orderedIds,
      }
      if (state.options.type) result.type = state.options.type
      if (gesture.sourceDropZone) {
        result.fromDropZoneId = gesture.sourceDropZone.options.id
      }
      if (targetDropZone) result.toDropZoneId = targetDropZone.options.id
      state.options.onDrop(result)
    }
  }
}

function touchWithId(touches: TouchList, identifier: number) {
  for (let index = 0; index < touches.length; index += 1) {
    const touch = touches.item(index)
    if (touch?.identifier === identifier) return touch
  }
  return undefined
}

function createState(element: HTMLElement, options: LongPressDragOptions): DragState {
  const state = {
    element,
    options,
    suppressClick: false,
  } as DragState

  const startGesture = (
    input: DragGesture['input'],
    pointerId: number,
    x: number,
    y: number,
    target: EventTarget | null,
  ) => {
    if (
      state.options.disabled
      || state.gesture
      || !isDragStartTarget(state, target)
    ) return false

    const gesture: DragGesture = {
      input,
      pointerId,
      startX: x,
      startY: y,
      clientX: x,
      clientY: y,
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
    return true
  }

  const moveGesture = (x: number, y: number, preventDefault: () => void) => {
    const gesture = state.gesture
    if (!gesture) return
    gesture.clientX = x
    gesture.clientY = y

    if (!gesture.active) {
      if (Math.hypot(x - gesture.startX, y - gesture.startY) > MOVE_TOLERANCE) {
        finishGesture(state, false)
      }
      return
    }

    preventDefault()
    positionGhost(gesture)
    updatePlaceholder(state, x, y)
    schedulePageAutoScroll(state)
  }

  state.onPointerDown = (event) => {
    if (event.button !== 0) return
    if (!startGesture(
      'pointer',
      event.pointerId,
      event.clientX,
      event.clientY,
      event.target,
    )) return

    window.addEventListener('pointermove', state.onPointerMove, true)
    window.addEventListener('pointerup', state.onPointerUp, true)
    window.addEventListener('pointercancel', state.onPointerCancel, true)
  }

  state.onPointerMove = (event) => {
    const gesture = state.gesture
    if (
      !gesture
      || gesture.input !== 'pointer'
      || event.pointerId !== gesture.pointerId
    ) return
    moveGesture(event.clientX, event.clientY, () => {
      if (event.cancelable) event.preventDefault()
    })
  }

  state.onPointerUp = (event) => {
    if (
      state.gesture?.input === 'pointer'
      && event.pointerId === state.gesture.pointerId
    ) finishGesture(state, true)
  }

  state.onPointerCancel = (event) => {
    if (
      state.gesture?.input === 'pointer'
      && event.pointerId === state.gesture.pointerId
    ) finishGesture(state, false)
  }

  state.onTouchStart = (event) => {
    if (state.gesture) {
      if (state.gesture.input === 'touch' && event.touches.length > 1) {
        finishGesture(state, false)
      }
      return
    }
    if (event.touches.length !== 1) return
    const touch = event.touches.item(0)
    if (!touch || !startGesture(
      'touch',
      touch.identifier,
      touch.clientX,
      touch.clientY,
      event.target,
    )) return

    window.addEventListener('touchmove', state.onTouchMove, { capture: true, passive: false })
    window.addEventListener('touchend', state.onTouchEnd, true)
    window.addEventListener('touchcancel', state.onTouchCancel, true)
  }

  state.onTouchMove = (event) => {
    const gesture = state.gesture
    if (!gesture) return
    if (gesture.input === 'pointer') {
      if (gesture.active && event.cancelable) event.preventDefault()
      return
    }

    const touch = touchWithId(event.touches, gesture.pointerId)
    if (!touch) return
    moveGesture(touch.clientX, touch.clientY, () => {
      if (event.cancelable) event.preventDefault()
    })
  }

  state.onTouchEnd = (event) => {
    const gesture = state.gesture
    if (
      gesture?.input === 'touch'
      && touchWithId(event.changedTouches, gesture.pointerId)
    ) finishGesture(state, true)
  }

  state.onTouchCancel = (event) => {
    const gesture = state.gesture
    if (
      gesture?.input === 'touch'
      && (
        event.changedTouches.length === 0
        || touchWithId(event.changedTouches, gesture.pointerId)
      )
    ) finishGesture(state, false)
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

  return state
}

export const longPressDrag: ObjectDirective<HTMLElement, LongPressDragOptions> = {
  mounted(element, binding) {
    const state = createState(element, binding.value)
    states.set(element, state)
    element.classList.add('long-press-drag-item')
    element.setAttribute('aria-grabbed', 'false')
    element.addEventListener('pointerdown', state.onPointerDown)
    element.addEventListener('touchstart', state.onTouchStart, { passive: true })
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
    element.removeEventListener('touchstart', state.onTouchStart)
    element.removeEventListener('click', state.onClick, true)
    element.removeEventListener('contextmenu', state.onContextMenu)
    element.classList.remove('long-press-drag-item')
    element.removeAttribute('aria-grabbed')
    states.delete(element)
  },
}

export const longPressDrop: ObjectDirective<HTMLElement, LongPressDropOptions> = {
  mounted(element, binding) {
    const state: DropState = { element, options: binding.value }
    dropStates.set(element, state)
    registeredDropStates.add(state)
    element.classList.add('long-press-drop-zone')
  },

  updated(element, binding) {
    const state = dropStates.get(element)
    if (state) state.options = binding.value
  },

  beforeUnmount(element) {
    const state = dropStates.get(element)
    if (!state) return
    registeredDropStates.delete(state)
    dropStates.delete(element)
    element.classList.remove(
      'long-press-drop-zone',
      'long-press-drop-zone--active',
      'long-press-drop-zone--available',
    )
  },
}
