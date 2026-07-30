const CARD_BUTTON_SELECTOR = '.v-card button, .v-card .v-btn'
const CONTAINED_EVENTS = ['click', 'mousedown', 'touchstart'] as const

export function containCardButtonClicks(root: ParentNode = document) {
  const registered = new Set<HTMLElement>()

  const stopPropagation = (event: Event) => {
    event.stopPropagation()
  }

  const register = (element: HTMLElement) => {
    if (registered.has(element)) return
    registered.add(element)
    CONTAINED_EVENTS.forEach((eventName) => {
      element.addEventListener(eventName, stopPropagation)
    })
  }

  const scan = (node: ParentNode) => {
    if (node instanceof HTMLElement && node.matches(CARD_BUTTON_SELECTOR)) {
      register(node)
    }

    node.querySelectorAll<HTMLElement>(CARD_BUTTON_SELECTOR).forEach(register)
  }

  scan(root)

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof HTMLElement) scan(node)
      }
    }
  })

  observer.observe(root, { childList: true, subtree: true })

  return () => {
    observer.disconnect()
    registered.forEach((element) => {
      CONTAINED_EVENTS.forEach((eventName) => {
        element.removeEventListener(eventName, stopPropagation)
      })
    })
    registered.clear()
  }
}
