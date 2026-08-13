import { readonly, ref } from 'vue'

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
const REVEAL_DELAY = 120
const keyboardVisibleState = ref(false)

export const mobileKeyboardVisible = readonly(keyboardVisibleState)

function isEditableField(node: EventTarget | null): node is HTMLElement {
  if (node instanceof HTMLTextAreaElement) return !node.disabled && !node.readOnly
  if (node instanceof HTMLInputElement) {
    return !node.disabled && !node.readOnly && EDITABLE_INPUT_TYPES.has(node.type)
  }
  return node instanceof HTMLElement && node.isContentEditable
}

function pixels(value: number) {
  return `${Math.max(0, Math.round(value * 100) / 100)}px`
}

export function installMobileKeyboardViewport(
  root: Document = document,
  viewport: ResizeViewport | null = window.visualViewport,
  runtimeWindow: Window = window,
) {
  const rootElement = root.documentElement
  let focusedField: HTMLElement | undefined
  let geometryFrame: number | undefined
  let scrollTimer: number | undefined

  const syncViewportGeometry = () => {
    geometryFrame = undefined
    const viewportHeight = viewport?.height ?? runtimeWindow.innerHeight
    const viewportTop = viewport?.offsetTop ?? 0
    const viewportBottom = Math.max(
      0,
      runtimeWindow.innerHeight - viewportTop - viewportHeight,
    )
    rootElement.style.setProperty('--app-viewport-height', pixels(viewportHeight))
    rootElement.style.setProperty('--keyboard-viewport-bottom', pixels(viewportBottom))
    rootElement.style.setProperty('--keyboard-scroll-bottom', pixels(FIELD_EDGE_GAP))
  }

  const scheduleViewportSync = () => {
    if (geometryFrame !== undefined) runtimeWindow.cancelAnimationFrame(geometryFrame)
    geometryFrame = runtimeWindow.requestAnimationFrame(syncViewportGeometry)
  }

  const revealFocusedField = () => {
    scrollTimer = undefined
    if (!focusedField?.isConnected || root.activeElement !== focusedField) return

    const fieldContainer = focusedField.closest<HTMLElement>('.v-input') ?? focusedField
    const bounds = fieldContainer.getBoundingClientRect()
    const viewportTop = viewport?.offsetTop ?? 0
    const viewportBottom = viewportTop + (viewport?.height ?? runtimeWindow.innerHeight)
    const alreadyVisible =
      bounds.top >= viewportTop + FIELD_EDGE_GAP
      && bounds.bottom <= viewportBottom - FIELD_EDGE_GAP

    if (alreadyVisible) return

    fieldContainer.scrollIntoView({
      behavior: 'auto',
      block: 'nearest',
      inline: 'nearest',
    })
  }

  const scheduleFocusedFieldReveal = () => {
    const activeElement = root.activeElement
    if (!isEditableField(activeElement)) return
    focusedField = activeElement
    if (scrollTimer !== undefined) runtimeWindow.clearTimeout(scrollTimer)
    scrollTimer = runtimeWindow.setTimeout(revealFocusedField, REVEAL_DELAY)
  }

  const handleFocus = (event: FocusEvent) => {
    if (!isEditableField(event.target)) return
    focusedField = event.target
    scheduleFocusedFieldReveal()
  }

  const handleViewportChange = () => {
    scheduleViewportSync()
    scheduleFocusedFieldReveal()
  }

  const showKeyboard = () => {
    keyboardVisibleState.value = true
    rootElement.classList.add('keyboard-open')
    scheduleViewportSync()
    scheduleFocusedFieldReveal()
  }

  const keyboardWillHide = () => {
    scheduleViewportSync()
  }

  const keyboardDidHide = () => {
    keyboardVisibleState.value = false
    rootElement.classList.remove('keyboard-open')
    scheduleViewportSync()
  }

  root.addEventListener('focusin', handleFocus)
  viewport?.addEventListener('resize', handleViewportChange)
  viewport?.addEventListener('scroll', handleViewportChange)
  runtimeWindow.addEventListener('resize', handleViewportChange)
  runtimeWindow.addEventListener('keyboardWillShow', showKeyboard)
  runtimeWindow.addEventListener('keyboardDidShow', showKeyboard)
  runtimeWindow.addEventListener('keyboardWillHide', keyboardWillHide)
  runtimeWindow.addEventListener('keyboardDidHide', keyboardDidHide)
  syncViewportGeometry()

  return () => {
    root.removeEventListener('focusin', handleFocus)
    viewport?.removeEventListener('resize', handleViewportChange)
    viewport?.removeEventListener('scroll', handleViewportChange)
    runtimeWindow.removeEventListener('resize', handleViewportChange)
    runtimeWindow.removeEventListener('keyboardWillShow', showKeyboard)
    runtimeWindow.removeEventListener('keyboardDidShow', showKeyboard)
    runtimeWindow.removeEventListener('keyboardWillHide', keyboardWillHide)
    runtimeWindow.removeEventListener('keyboardDidHide', keyboardDidHide)
    if (geometryFrame !== undefined) runtimeWindow.cancelAnimationFrame(geometryFrame)
    if (scrollTimer !== undefined) runtimeWindow.clearTimeout(scrollTimer)
    keyboardVisibleState.value = false
    rootElement.classList.remove('keyboard-open')
    rootElement.style.removeProperty('--app-viewport-height')
    rootElement.style.removeProperty('--keyboard-viewport-bottom')
    rootElement.style.removeProperty('--keyboard-scroll-bottom')
  }
}
