import { afterEach, describe, expect, it, vi } from 'vitest'
import { containCardButtonClicks } from './cardButtonPropagation'

afterEach(() => {
  document.body.replaceChildren()
})

describe('card button propagation', () => {
  it('runs the button action without bubbling to its card', () => {
    const card = document.createElement('div')
    card.className = 'v-card'
    const button = document.createElement('button')
    card.append(button)
    document.body.append(card)

    const cardAction = vi.fn()
    const buttonAction = vi.fn()
    card.addEventListener('click', cardAction)
    button.addEventListener('click', buttonAction)
    const remove = containCardButtonClicks()

    button.click()

    expect(buttonAction).toHaveBeenCalledOnce()
    expect(cardAction).not.toHaveBeenCalled()
    remove()
  })

  it.each(['mousedown', 'touchstart'])(
    'contains the %s event that starts a parent card ripple',
    (eventName) => {
      const card = document.createElement('div')
      card.className = 'v-card'
      const button = document.createElement('button')
      card.append(button)
      document.body.append(card)

      const cardAction = vi.fn()
      const buttonAction = vi.fn()
      card.addEventListener(eventName, cardAction)
      button.addEventListener(eventName, buttonAction)
      const remove = containCardButtonClicks()

      button.dispatchEvent(new Event(eventName, { bubbles: true }))

      expect(buttonAction).toHaveBeenCalledOnce()
      expect(cardAction).not.toHaveBeenCalled()
      remove()
    },
  )

  it('registers buttons added to cards after installation', async () => {
    const card = document.createElement('div')
    card.className = 'v-card'
    const cardAction = vi.fn()
    card.addEventListener('click', cardAction)
    document.body.append(card)
    const remove = containCardButtonClicks()

    const button = document.createElement('button')
    card.append(button)
    await Promise.resolve()
    button.click()

    expect(cardAction).not.toHaveBeenCalled()
    remove()
  })

  it('does not alter buttons outside cards', () => {
    const container = document.createElement('div')
    const button = document.createElement('button')
    const containerAction = vi.fn()
    container.addEventListener('click', containerAction)
    container.append(button)
    document.body.append(container)
    const remove = containCardButtonClicks()

    button.click()

    expect(containerAction).toHaveBeenCalledOnce()
    remove()
  })
})
