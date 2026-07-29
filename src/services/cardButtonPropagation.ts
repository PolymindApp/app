const CARD_BUTTON_SELECTOR = '.v-card button, .v-card .v-btn'

export function containCardButtonClicks(root: ParentNode = document) {
  const registered = new Set<HTMLElement>()

  const stopClickPropagation = (event: Event) => {
    event.stopPropagation()
  }

  const register = (element: HTMLElement) => {
    if (registered.has(element)) return
    registered.add(element)
    element.addEventListener('click', stopClickPropagation)
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
      element.removeEventListener('click', stopClickPropagation)
    })
    registered.clear()
  }
}
