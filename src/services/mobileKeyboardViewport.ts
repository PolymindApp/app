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
const ANDROID_FIELD_TOP_GAP = 24
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

function editableFieldFromPointer(event: PointerEvent) {
  const directField = event.composedPath().find(isEditableField)
  if (directField) return directField
  if (!(event.target instanceof Element)) return undefined

  const fieldContainer = event.target.closest<HTMLElement>('.v-input')
  return Array.from(
    fieldContainer?.querySelectorAll<HTMLElement>('input, textarea, [contenteditable="true"]') ?? [],
  ).find(isEditableField)
}

function pixels(value: number) {
  return `${Math.max(0, Math.round(value * 100) / 100)}px`
}

function pixelValue(value: string) {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0
}

export function installMobileKeyboardViewport(
  root: Document = document,
  viewport: ResizeViewport | null = window.visualViewport,
  runtimeWindow: Window = window,
) {
  const rootElement = root.documentElement
  const isAndroid = rootElement.classList.contains('platform-android')
  const fieldTopGap = isAndroid
    ? ANDROID_FIELD_TOP_GAP
    : FIELD_EDGE_GAP
  let focusedField: HTMLElement | undefined
  let pointerFocusedField: HTMLElement | undefined
  let geometryFrame: number | undefined
  let scrollTimer: number | undefined

  const syncViewportGeometry = () => {
    geometryFrame = undefined
    const viewportHeight = viewport?.height ?? runtimeWindow.innerHeight
    // Native resize makes the Android layout viewport authoritative while the
    // visual viewport briefly reports a second, transient keyboard reduction.
    const appViewportHeight = isAndroid
      ? runtimeWindow.innerHeight
      : viewportHeight
    const viewportTop = viewport?.offsetTop ?? 0
    const viewportBottom = Math.max(
      0,
      runtimeWindow.innerHeight - viewportTop - viewportHeight,
    )
    rootElement.style.setProperty('--app-viewport-height', pixels(appViewportHeight))
    rootElement.style.setProperty('--keyboard-viewport-bottom', pixels(viewportBottom))
    rootElement.style.setProperty('--keyboard-scroll-bottom', pixels(FIELD_EDGE_GAP))
  }

  const scheduleViewportSync = () => {
    if (geometryFrame !== undefined) runtimeWindow.cancelAnimationFrame(geometryFrame)
    geometryFrame = runtimeWindow.requestAnimationFrame(syncViewportGeometry)
  }

  const focusedFieldTopEdge = () => {
    const viewportTop = viewport?.offsetTop ?? 0
    const appScroll = root.querySelector<HTMLElement>('.app-scroll')
    const safeAreaTop = !isAndroid
      ? 0
      : Math.max(
          appScroll
            ? pixelValue(runtimeWindow.getComputedStyle(appScroll).paddingTop)
            : 0,
          pixelValue(runtimeWindow.getComputedStyle(rootElement).getPropertyValue('--safe-area-inset-top')),
        )
    return viewportTop + safeAreaTop + fieldTopGap
  }

  const revealFocusedField = () => {
    scrollTimer = undefined
    if (!focusedField?.isConnected || root.activeElement !== focusedField) return

    const fieldContainer = focusedField.closest<HTMLElement>('.v-input') ?? focusedField
    const bounds = fieldContainer.getBoundingClientRect()
    const viewportTop = viewport?.offsetTop ?? 0
    const viewportBottom = isAndroid
      ? runtimeWindow.innerHeight
      : viewportTop + (viewport?.height ?? runtimeWindow.innerHeight)
    const fieldTopEdge = focusedFieldTopEdge()
    const fieldBottomEdge = viewportBottom - FIELD_EDGE_GAP
    const alreadyVisible =
      bounds.top >= fieldTopEdge
      && bounds.bottom <= fieldBottomEdge

    if (alreadyVisible) return

    if (isAndroid) {
      const scrollDelta = bounds.top < fieldTopEdge
        ? bounds.top - fieldTopEdge
        : bounds.bottom - fieldBottomEdge
      const targetScrollTop = Math.max(0, runtimeWindow.scrollY + scrollDelta)

      if (Math.abs(targetScrollTop - runtimeWindow.scrollY) >= 0.5) {
        runtimeWindow.scrollTo({
          top: targetScrollTop,
          behavior: 'auto',
        })
      }
      return
    }

    fieldContainer.scrollIntoView({
      behavior: 'auto',
      block: 'nearest',
      inline: 'nearest',
    })
  }

  const scheduleFocusedFieldReveal = (delay = REVEAL_DELAY) => {
    const activeElement = root.activeElement
    if (!isEditableField(activeElement)) return
    focusedField = activeElement
    if (scrollTimer !== undefined) runtimeWindow.clearTimeout(scrollTimer)
    scrollTimer = runtimeWindow.setTimeout(revealFocusedField, delay)
  }

  const handlePointerDown = (event: PointerEvent) => {
    if (!isAndroid) return
    const field = editableFieldFromPointer(event)
    if (
      !field
      || (keyboardVisibleState.value && root.activeElement === field)
    ) return

    focusedField = field
    pointerFocusedField = field
    field.focus({ preventScroll: true })
    pointerFocusedField = undefined
  }

  const handleFocus = (event: FocusEvent) => {
    if (!isEditableField(event.target)) return
    const focusWasPointerControlled = pointerFocusedField === event.target
    focusedField = event.target
    if (!isAndroid) {
      scheduleFocusedFieldReveal()
    } else if (keyboardVisibleState.value && focusWasPointerControlled) {
      scheduleFocusedFieldReveal(0)
    }
  }

  const handleViewportChange = () => {
    scheduleViewportSync()
    if (!isAndroid) scheduleFocusedFieldReveal()
  }

  const keyboardWillShow = () => {
    keyboardVisibleState.value = true
    rootElement.classList.add('keyboard-open')
    scheduleViewportSync()
    if (isAndroid) {
      revealFocusedField()
    } else {
      scheduleFocusedFieldReveal()
    }
  }

  const keyboardDidShow = () => {
    keyboardVisibleState.value = true
    rootElement.classList.add('keyboard-open')
    scheduleViewportSync()
    scheduleFocusedFieldReveal(isAndroid ? 0 : REVEAL_DELAY)
  }

  const keyboardWillHide = () => {
    if (scrollTimer !== undefined) {
      runtimeWindow.clearTimeout(scrollTimer)
      scrollTimer = undefined
    }
    scheduleViewportSync()
  }

  const keyboardDidHide = () => {
    if (scrollTimer !== undefined) {
      runtimeWindow.clearTimeout(scrollTimer)
      scrollTimer = undefined
    }
    keyboardVisibleState.value = false
    rootElement.classList.remove('keyboard-open')
    focusedField = undefined
    pointerFocusedField = undefined
    scheduleViewportSync()
  }

  root.addEventListener('pointerdown', handlePointerDown, true)
  root.addEventListener('focusin', handleFocus)
  viewport?.addEventListener('resize', handleViewportChange)
  viewport?.addEventListener('scroll', handleViewportChange)
  runtimeWindow.addEventListener('resize', handleViewportChange)
  runtimeWindow.addEventListener('keyboardWillShow', keyboardWillShow)
  runtimeWindow.addEventListener('keyboardDidShow', keyboardDidShow)
  runtimeWindow.addEventListener('keyboardWillHide', keyboardWillHide)
  runtimeWindow.addEventListener('keyboardDidHide', keyboardDidHide)
  syncViewportGeometry()

  return () => {
    root.removeEventListener('pointerdown', handlePointerDown, true)
    root.removeEventListener('focusin', handleFocus)
    viewport?.removeEventListener('resize', handleViewportChange)
    viewport?.removeEventListener('scroll', handleViewportChange)
    runtimeWindow.removeEventListener('resize', handleViewportChange)
    runtimeWindow.removeEventListener('keyboardWillShow', keyboardWillShow)
    runtimeWindow.removeEventListener('keyboardDidShow', keyboardDidShow)
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
