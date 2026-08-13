import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  installMobileKeyboardViewport,
  mobileKeyboardVisible,
} from './mobileKeyboardViewport'

const initialInnerHeight = window.innerHeight
const initialScrollY = window.scrollY

function rectangle(top: number, bottom: number): DOMRect {
  return {
    top,
    right: 300,
    bottom,
    left: 20,
    width: 280,
    height: bottom - top,
    x: 20,
    y: top,
    toJSON: () => undefined,
  }
}

function createViewport(height = 800, offsetTop = 0) {
  const events = new EventTarget()
  return {
    height,
    offsetTop,
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    callback(0)
    return 1
  })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  document.body.replaceChildren()
  document.documentElement.classList.remove('keyboard-open')
  document.documentElement.classList.remove('platform-android')
  document.documentElement.removeAttribute('style')
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    value: initialInnerHeight,
  })
  Object.defineProperty(window, 'scrollY', {
    configurable: true,
    value: initialScrollY,
  })
})

describe('mobile keyboard viewport', () => {
  it('tracks native keyboard visibility through the full hide animation', () => {
    const remove = installMobileKeyboardViewport(document, null)

    window.dispatchEvent(new Event('keyboardWillShow'))
    expect(mobileKeyboardVisible.value).toBe(true)
    expect(document.documentElement.classList).toContain('keyboard-open')

    window.dispatchEvent(new Event('keyboardWillHide'))
    expect(mobileKeyboardVisible.value).toBe(true)

    window.dispatchEvent(new Event('keyboardDidHide'))
    expect(mobileKeyboardVisible.value).toBe(false)
    expect(document.documentElement.classList).not.toContain('keyboard-open')
    remove()
  })

  it('publishes visual viewport geometry without using a keyboard height', () => {
    const viewport = createViewport(520, 24)
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 })
    const remove = installMobileKeyboardViewport(document, viewport)

    expect(document.documentElement.style.getPropertyValue('--app-viewport-height')).toBe('520px')
    expect(document.documentElement.style.getPropertyValue('--keyboard-viewport-bottom')).toBe('300px')

    viewport.height = 500
    viewport.dispatchEvent(new Event('resize'))
    expect(document.documentElement.style.getPropertyValue('--app-viewport-height')).toBe('500px')
    expect(document.documentElement.style.getPropertyValue('--keyboard-viewport-bottom')).toBe('320px')

    viewport.offsetTop = 40
    viewport.dispatchEvent(new Event('scroll'))
    expect(document.documentElement.style.getPropertyValue('--keyboard-viewport-bottom')).toBe('304px')

    remove()
  })

  it('uses the resized Android layout viewport while the visual viewport settles', () => {
    document.documentElement.classList.add('platform-android')
    const viewport = createViewport(118)
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 480 })
    const remove = installMobileKeyboardViewport(document, viewport)

    expect(document.documentElement.style.getPropertyValue('--app-viewport-height')).toBe('480px')

    viewport.height = 480
    viewport.dispatchEvent(new Event('resize'))
    expect(document.documentElement.style.getPropertyValue('--app-viewport-height')).toBe('480px')

    remove()
  })

  it('does not add a second scroll when the field is already visible', () => {
    const wrapper = document.createElement('div')
    wrapper.className = 'v-input'
    wrapper.scrollIntoView = vi.fn()
    wrapper.getBoundingClientRect = () => rectangle(120, 180)
    const input = document.createElement('input')
    wrapper.append(input)
    document.body.append(wrapper)
    const remove = installMobileKeyboardViewport(document, null)

    input.focus()
    vi.advanceTimersByTime(120)

    expect(wrapper.scrollIntoView).not.toHaveBeenCalled()
    remove()
  })

  it('does not scroll an Android field that remains visible after the app bar hides', () => {
    document.documentElement.classList.add('platform-android')
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation((options) => {
      const top = typeof options === 'object' ? options.top : options
      Object.defineProperty(window, 'scrollY', { configurable: true, value: top ?? 0 })
    })
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 100 })
    const wrapper = document.createElement('div')
    wrapper.className = 'v-input'
    wrapper.scrollIntoView = vi.fn()
    wrapper.getBoundingClientRect = () => {
      const documentTop = document.documentElement.classList.contains('keyboard-open')
        ? 140
        : 200
      return rectangle(documentTop - window.scrollY, documentTop + 60 - window.scrollY)
    }
    const input = document.createElement('input')
    wrapper.append(input)
    document.body.append(wrapper)
    const remove = installMobileKeyboardViewport(document, null)

    const focus = vi.spyOn(input, 'focus')
    input.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }))

    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
    expect(document.activeElement).toBe(input)

    window.dispatchEvent(new Event('keyboardWillShow'))
    window.dispatchEvent(new Event('keyboardDidShow'))
    vi.runOnlyPendingTimers()

    expect(document.documentElement.classList).toContain('keyboard-open')
    expect(scrollTo).not.toHaveBeenCalled()
    expect(wrapper.scrollIntoView).not.toHaveBeenCalled()

    window.dispatchEvent(new Event('keyboardDidHide'))
    focus.mockClear()
    input.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }))
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
    remove()
  })

  it('applies the Android safe top offset before the keyboard frame can paint', () => {
    document.documentElement.classList.add('platform-android')
    document.documentElement.style.setProperty('--safe-area-inset-top', '52px')
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation((options) => {
      const top = typeof options === 'object' ? options.top : options
      Object.defineProperty(window, 'scrollY', { configurable: true, value: top ?? 0 })
    })
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 100 })
    const appScroll = document.createElement('main')
    appScroll.className = 'app-scroll'
    document.body.append(appScroll)
    const wrapper = document.createElement('div')
    wrapper.className = 'v-input'
    wrapper.getBoundingClientRect = () => {
      const documentTop = document.documentElement.classList.contains('keyboard-open')
        ? 140
        : 200
      return rectangle(documentTop - window.scrollY, documentTop + 60 - window.scrollY)
    }
    const input = document.createElement('input')
    wrapper.append(input)
    appScroll.append(wrapper)
    const remove = installMobileKeyboardViewport(document, null)

    input.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }))
    window.dispatchEvent(new Event('keyboardWillShow'))

    expect(scrollTo).toHaveBeenCalledOnce()
    expect(scrollTo).toHaveBeenCalledWith({
      top: 64,
      behavior: 'auto',
    })

    window.dispatchEvent(new Event('keyboardDidShow'))
    vi.runOnlyPendingTimers()
    expect(scrollTo).toHaveBeenCalledOnce()
    remove()
  })

  it('adds only the scroll needed to reveal an Android field from the captured position', () => {
    document.documentElement.classList.add('platform-android')
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation((options) => {
      const top = typeof options === 'object' ? options.top : options
      Object.defineProperty(window, 'scrollY', { configurable: true, value: top ?? 0 })
    })
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 100 })
    const wrapper = document.createElement('div')
    wrapper.className = 'v-input'
    wrapper.scrollIntoView = vi.fn()
    wrapper.getBoundingClientRect = () => {
      const documentTop = document.documentElement.classList.contains('keyboard-open')
        ? 690
        : 750
      return rectangle(documentTop - window.scrollY, documentTop + 60 - window.scrollY)
    }
    const input = document.createElement('input')
    wrapper.append(input)
    document.body.append(wrapper)
    const viewport = createViewport(800)
    const remove = installMobileKeyboardViewport(document, viewport)

    input.focus()
    viewport.height = 552
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 552 })
    window.dispatchEvent(new Event('keyboardWillShow'))

    expect(scrollTo).toHaveBeenCalledOnce()
    expect(scrollTo).toHaveBeenCalledWith({
      top: 214,
      behavior: 'auto',
    })

    window.dispatchEvent(new Event('keyboardDidShow'))
    vi.runOnlyPendingTimers()

    expect(scrollTo).toHaveBeenCalledOnce()
    expect(wrapper.scrollIntoView).not.toHaveBeenCalled()
    remove()
  })

  it('reveals a field obscured by the visual viewport', () => {
    const wrapper = document.createElement('div')
    wrapper.className = 'v-input'
    wrapper.scrollIntoView = vi.fn()
    wrapper.getBoundingClientRect = () => rectangle(510, 570)
    const input = document.createElement('input')
    wrapper.append(input)
    document.body.append(wrapper)
    const viewport = createViewport(552)
    const remove = installMobileKeyboardViewport(document, viewport)

    input.focus()
    window.dispatchEvent(new Event('keyboardDidShow'))
    vi.advanceTimersByTime(120)

    expect(wrapper.scrollIntoView).toHaveBeenCalledWith({
      behavior: 'auto',
      block: 'nearest',
      inline: 'nearest',
    })
    expect(document.documentElement.style.getPropertyValue('--keyboard-scroll-bottom')).toBe('16px')
    remove()
  })

  it('ignores readonly fields and removes every installed side effect', () => {
    const input = document.createElement('input')
    input.readOnly = true
    input.scrollIntoView = vi.fn()
    document.body.append(input)
    const remove = installMobileKeyboardViewport(document, null)

    input.focus()
    window.dispatchEvent(new Event('keyboardDidShow'))
    vi.advanceTimersByTime(120)
    remove()
    window.dispatchEvent(new Event('keyboardDidShow'))

    expect(input.scrollIntoView).not.toHaveBeenCalled()
    expect(mobileKeyboardVisible.value).toBe(false)
    expect(document.documentElement.classList).not.toContain('keyboard-open')
    expect(document.documentElement.style.getPropertyValue('--app-viewport-height')).toBe('')
  })
})
