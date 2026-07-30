const EDITABLE_INPUT_TYPES = new Set([
  'date',
  'datetime-local',
  'email',
  'month',
  'number',
  'password',
  'search',
  'tel',
  'text',
  'time',
  'url',
  'week',
])

type ResizeViewport = Pick<
  VisualViewport,
  'addEventListener' | 'removeEventListener' | 'height' | 'offsetTop'
>

const FIELD_EDGE_GAP = 16

function isEditableField(node: EventTarget | null): node is HTMLElement {
  if (node instanceof HTMLTextAreaElement) return !node.disabled && !node.readOnly
  if (node instanceof HTMLInputElement) {
    return !node.disabled && !node.readOnly && EDITABLE_INPUT_TYPES.has(node.type)
  }
  return node instanceof HTMLElement && node.isContentEditable
}

export function installAndroidFocusAutoScroll(
  root: Document = document,
  viewport: ResizeViewport | null = window.visualViewport,
) {
  let focusedField: HTMLElement | undefined
  let scrollTimer: number | undefined

  const revealFocusedField = () => {
    scrollTimer = undefined
    if (!focusedField?.isConnected || root.activeElement !== focusedField) return

    const bounds = focusedField.getBoundingClientRect()
    const viewportTop = viewport?.offsetTop ?? 0
    const viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight)
    const alreadyVisible =
      bounds.top >= viewportTop + FIELD_EDGE_GAP &&
      bounds.bottom <= viewportBottom - FIELD_EDGE_GAP

    if (alreadyVisible) return

    const fieldContainer = focusedField.closest<HTMLElement>('.v-input') ?? focusedField
    fieldContainer.scrollIntoView({
      behavior: 'auto',
      block: 'nearest',
      inline: 'nearest',
    })
  }

  const scheduleReveal = (field: HTMLElement) => {
    focusedField = field
    if (scrollTimer !== undefined) window.clearTimeout(scrollTimer)
    scrollTimer = window.setTimeout(revealFocusedField, 120)
  }

  const handleFocus = (event: FocusEvent) => {
    if (isEditableField(event.target)) scheduleReveal(event.target)
  }

  const handleViewportResize = () => {
    if (isEditableField(root.activeElement)) scheduleReveal(root.activeElement)
  }

  root.addEventListener('focusin', handleFocus)
  viewport?.addEventListener('resize', handleViewportResize)

  return () => {
    root.removeEventListener('focusin', handleFocus)
    viewport?.removeEventListener('resize', handleViewportResize)
    if (scrollTimer !== undefined) window.clearTimeout(scrollTimer)
  }
}
