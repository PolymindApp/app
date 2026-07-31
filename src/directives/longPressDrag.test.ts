import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DirectiveBinding, VNode } from 'vue'
import {
  longPressDrag,
  type LongPressDragOptions,
} from './longPressDrag'

const hapticsMocks = vi.hoisted(() => ({
  dragActivationFeedback: vi.fn(),
}))

vi.mock('@/services/haptics', () => hapticsMocks)

const initialInnerHeight = window.innerHeight

function bounds(top: number, left = 0, width = 200, height = 80): DOMRect {
  return {
    x: left,
    y: top,
    top,
    left,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  }
}

function pointerEvent(
  target: EventTarget,
  type: string,
  { x, y, pointerId = 1 }: { x: number; y: number; pointerId?: number },
) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(event, {
    button: { value: 0 },
    clientX: { value: x },
    clientY: { value: y },
    pointerId: { value: pointerId },
  })
  target.dispatchEvent(event)
}

function mountDirective(element: HTMLElement, options: LongPressDragOptions) {
  longPressDrag.mounted?.(
    element,
    { value: options } as DirectiveBinding<LongPressDragOptions>,
    {} as VNode,
    null,
  )
}

function unmountDirective(element: HTMLElement) {
  longPressDrag.beforeUnmount?.(element, {} as DirectiveBinding, {} as VNode, null)
}

describe('long press drag directive', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    hapticsMocks.dragActivationFeedback.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    document.body.replaceChildren()
    document.body.classList.remove('long-press-drag-active')
    document.documentElement.scrollTop = 0
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: initialInnerHeight,
    })
  })

  it('starts after 500ms, moves the placeholder, and reports the dropped order', () => {
    const list = document.createElement('div')
    const first = document.createElement('article')
    const second = document.createElement('article')
    first.textContent = 'First'
    second.textContent = 'Second'
    list.append(first, second)
    document.body.append(list)
    vi.spyOn(first, 'getBoundingClientRect').mockReturnValue(bounds(0))
    vi.spyOn(second, 'getBoundingClientRect').mockReturnValue(bounds(100))
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => second),
    })

    const onDrop = vi.fn()
    mountDirective(first, { id: 'first', group: 'tasks', onDrop })
    mountDirective(second, { id: 'second', group: 'tasks', onDrop: vi.fn() })

    pointerEvent(first, 'pointerdown', { x: 100, y: 40 })
    vi.advanceTimersByTime(499)
    expect(document.querySelector('.long-press-drag-placeholder')).toBeNull()
    expect(hapticsMocks.dragActivationFeedback).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(document.querySelector('.long-press-drag-placeholder')).not.toBeNull()
    expect(document.querySelector('.long-press-drag-ghost')).not.toBeNull()
    expect(first.getAttribute('aria-grabbed')).toBe('true')
    expect(hapticsMocks.dragActivationFeedback).toHaveBeenCalledOnce()

    pointerEvent(first, 'pointermove', { x: 100, y: 175 })
    pointerEvent(first, 'pointerup', { x: 100, y: 175 })

    expect(onDrop).toHaveBeenCalledWith({
      id: 'first',
      fromIndex: 0,
      toIndex: 1,
      orderedIds: ['second', 'first'],
    })
    expect(document.querySelector('.long-press-drag-placeholder')).toBeNull()
    expect(document.querySelector('.long-press-drag-ghost')).toBeNull()
    expect(first.getAttribute('aria-grabbed')).toBe('false')

    const cardClick = vi.fn()
    first.addEventListener('click', cardClick)
    first.click()
    expect(cardClick).not.toHaveBeenCalled()

    unmountDirective(first)
    unmountDirective(second)
  })

  it('keeps normal scrolling available when movement happens before the hold delay', () => {
    const card = document.createElement('article')
    document.body.append(card)
    const onDrop = vi.fn()
    mountDirective(card, { id: 'task', onDrop })

    pointerEvent(card, 'pointerdown', { x: 30, y: 30 })
    pointerEvent(card, 'pointermove', { x: 30, y: 45 })
    vi.advanceTimersByTime(500)

    expect(document.querySelector('.long-press-drag-placeholder')).toBeNull()
    expect(onDrop).not.toHaveBeenCalled()

    unmountDirective(card)
  })

  it('uses horizontal placement when the cards share a grid row', () => {
    const list = document.createElement('div')
    const first = document.createElement('article')
    const second = document.createElement('article')
    list.append(first, second)
    document.body.append(list)
    vi.spyOn(first, 'getBoundingClientRect').mockReturnValue(bounds(0, 0, 100))
    vi.spyOn(second, 'getBoundingClientRect').mockReturnValue(bounds(0, 120, 100))
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => first),
    })

    const onDrop = vi.fn()
    mountDirective(first, { id: 'first', group: 'tasks', onDrop: vi.fn() })
    mountDirective(second, { id: 'second', group: 'tasks', onDrop })

    pointerEvent(second, 'pointerdown', { x: 170, y: 40 })
    vi.advanceTimersByTime(500)
    pointerEvent(second, 'pointermove', { x: 20, y: 70 })
    pointerEvent(second, 'pointerup', { x: 20, y: 70 })

    expect(onDrop).toHaveBeenCalledWith({
      id: 'second',
      fromIndex: 1,
      toIndex: 0,
      orderedIds: ['second', 'first'],
    })

    unmountDirective(first)
    unmountDirective(second)
  })

  it('starts only from the configured handle, even when the handle is a button', () => {
    const card = document.createElement('article')
    const handle = document.createElement('button')
    const content = document.createElement('div')
    handle.className = 'card-handle'
    card.append(handle, content)
    document.body.append(card)
    vi.spyOn(card, 'getBoundingClientRect').mockReturnValue(bounds(0))
    mountDirective(card, {
      id: 'handled-card',
      handle: '.card-handle',
      onDrop: vi.fn(),
    })

    pointerEvent(content, 'pointerdown', { x: 30, y: 30 })
    vi.advanceTimersByTime(500)
    expect(document.querySelector('.long-press-drag-placeholder')).toBeNull()

    pointerEvent(handle, 'pointerdown', { x: 30, y: 30 })
    vi.advanceTimersByTime(500)
    expect(document.querySelector('.long-press-drag-placeholder')).not.toBeNull()
    expect(hapticsMocks.dragActivationFeedback).toHaveBeenCalledOnce()

    pointerEvent(handle, 'pointerup', { x: 30, y: 30 })
    unmountDirective(card)
  })

  it('does not activate an ancestor draggable from a nested card handle', () => {
    const parentCard = document.createElement('article')
    const parentHandle = document.createElement('button')
    const childCard = document.createElement('article')
    const childHandle = document.createElement('button')
    parentHandle.className = 'card-handle'
    childHandle.className = 'card-handle'
    childCard.append(childHandle)
    parentCard.append(parentHandle, childCard)
    document.body.append(parentCard)
    vi.spyOn(parentCard, 'getBoundingClientRect').mockReturnValue(bounds(0))
    vi.spyOn(childCard, 'getBoundingClientRect').mockReturnValue(bounds(40))
    mountDirective(parentCard, {
      id: 'parent',
      handle: '.card-handle',
      onDrop: vi.fn(),
    })
    mountDirective(childCard, {
      id: 'child',
      handle: '.card-handle',
      onDrop: vi.fn(),
    })

    pointerEvent(childHandle, 'pointerdown', { x: 30, y: 50 })
    vi.advanceTimersByTime(500)

    expect(childCard.getAttribute('aria-grabbed')).toBe('true')
    expect(parentCard.getAttribute('aria-grabbed')).toBe('false')
    expect(hapticsMocks.dragActivationFeedback).toHaveBeenCalledOnce()

    pointerEvent(childHandle, 'pointerup', { x: 30, y: 50 })
    unmountDirective(childCard)
    unmountDirective(parentCard)
  })

  it.each([
    { edge: 'top', pointerY: 5, startingScrollTop: 100, direction: -1 },
    { edge: 'bottom', pointerY: 795, startingScrollTop: 100, direction: 1 },
  ])('scrolls the page near the $edge edge while dragging', ({
    pointerY,
    startingScrollTop,
    direction,
  }) => {
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 800,
    })
    document.documentElement.scrollTop = startingScrollTop
    let scrollFrame: FrameRequestCallback | undefined
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        scrollFrame = callback
        return 42
      })
    const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame')
      .mockImplementation(() => undefined)
    const card = document.createElement('article')
    document.body.append(card)
    vi.spyOn(card, 'getBoundingClientRect').mockReturnValue(bounds(0))
    mountDirective(card, { id: 'scrolling-card', onDrop: vi.fn() })

    pointerEvent(card, 'pointerdown', { x: 30, y: pointerY })
    vi.advanceTimersByTime(500)
    expect(requestFrame).toHaveBeenCalled()

    scrollFrame?.(16)

    expect(Math.sign(document.documentElement.scrollTop - startingScrollTop))
      .toBe(direction)

    pointerEvent(card, 'pointerup', { x: 30, y: pointerY })
    expect(cancelFrame).toHaveBeenCalledWith(42)
    unmountDirective(card)
  })
})
