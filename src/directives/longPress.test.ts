import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DirectiveBinding, VNode } from 'vue'
import { longPress } from './longPress'

function pointerEvent(type: string, x = 20, y = 20) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y })
  Object.defineProperties(event, {
    isPrimary: { value: true },
    pointerId: { value: 1 },
    pointerType: { value: 'touch' },
  })
  return event
}

function mountLongPress(element: HTMLElement, onLongPress: () => void) {
  longPress.mounted?.(
    element,
    { value: { onLongPress } } as DirectiveBinding,
    {} as VNode,
    null,
  )
}

function unmountLongPress(element: HTMLElement) {
  longPress.beforeUnmount?.(element, {} as DirectiveBinding, {} as VNode, null)
}

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('longPress', () => {
  it('activates after holding and suppresses the following click', () => {
    vi.useFakeTimers()
    const element = document.createElement('button')
    const onLongPress = vi.fn()
    const onClick = vi.fn()
    element.addEventListener('click', onClick)
    document.body.append(element)
    mountLongPress(element, onLongPress)

    element.dispatchEvent(pointerEvent('pointerdown'))
    vi.advanceTimersByTime(500)
    element.click()

    expect(onLongPress).toHaveBeenCalledOnce()
    expect(onClick).not.toHaveBeenCalled()
    unmountLongPress(element)
  })

  it('cancels when the pointer moves so scrolling remains available', () => {
    vi.useFakeTimers()
    const element = document.createElement('button')
    const onLongPress = vi.fn()
    document.body.append(element)
    mountLongPress(element, onLongPress)

    element.dispatchEvent(pointerEvent('pointerdown'))
    window.dispatchEvent(pointerEvent('pointermove', 20, 40))
    vi.advanceTimersByTime(500)

    expect(onLongPress).not.toHaveBeenCalled()
    unmountLongPress(element)
  })

  it('opens from the context-menu gesture for mouse and keyboard access', () => {
    const element = document.createElement('button')
    const onLongPress = vi.fn()
    document.body.append(element)
    mountLongPress(element, onLongPress)

    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    element.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(onLongPress).toHaveBeenCalledOnce()
    unmountLongPress(element)
  })
})
