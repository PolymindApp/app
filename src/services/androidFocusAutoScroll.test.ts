import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installAndroidFocusAutoScroll } from './androidFocusAutoScroll'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  document.body.replaceChildren()
})

describe('Android focus auto-scroll', () => {
  it('does not add a second scroll when Android already revealed the field', () => {
    const wrapper = document.createElement('div')
    wrapper.className = 'v-input'
    wrapper.scrollIntoView = vi.fn()
    const input = document.createElement('input')
    input.getBoundingClientRect = () => ({
      top: 120,
      right: 300,
      bottom: 164,
      left: 20,
      width: 280,
      height: 44,
      x: 20,
      y: 120,
      toJSON: () => undefined,
    })
    wrapper.append(input)
    document.body.append(wrapper)
    const remove = installAndroidFocusAutoScroll(document, null)

    input.focus()
    vi.advanceTimersByTime(120)

    expect(wrapper.scrollIntoView).not.toHaveBeenCalled()
    remove()
  })

  it('reveals the field with the smallest scroll when it is still obscured', () => {
    const wrapper = document.createElement('div')
    wrapper.className = 'v-input'
    wrapper.scrollIntoView = vi.fn()
    const input = document.createElement('input')
    input.getBoundingClientRect = () => ({
      top: 750,
      right: 300,
      bottom: 794,
      left: 20,
      width: 280,
      height: 44,
      x: 20,
      y: 750,
      toJSON: () => undefined,
    })
    wrapper.append(input)
    document.body.append(wrapper)
    const remove = installAndroidFocusAutoScroll(document, null)

    input.focus()
    vi.advanceTimersByTime(120)

    expect(wrapper.scrollIntoView).toHaveBeenCalledWith({
      behavior: 'auto',
      block: 'nearest',
      inline: 'nearest',
    })
    remove()
  })

  it('does not scroll readonly fields', () => {
    const input = document.createElement('input')
    input.readOnly = true
    input.scrollIntoView = vi.fn()
    document.body.append(input)
    const remove = installAndroidFocusAutoScroll(document, null)

    input.focus()
    vi.advanceTimersByTime(120)

    expect(input.scrollIntoView).not.toHaveBeenCalled()
    remove()
  })
})
