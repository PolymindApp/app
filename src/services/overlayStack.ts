import { onScopeDispose, readonly, shallowRef, toValue, watch, type MaybeRefOrGetter } from 'vue'

export const OVERLAY_STACK_BASE_Z_INDEX = 3000

// Vuetify advances its own overlay stack by ten. Matching that spacing keeps a
// sheet above multiple nested VDialog layers, not only above the first dialog.
const LAYER_STEP = 10
const STACK_RESET_DELAY = 300
interface OverlayLayer {
  zIndex: number
  close?: () => void
}

const layers = new Map<symbol, OverlayLayer>()
let nextZIndex = OVERLAY_STACK_BASE_Z_INDEX
let resetTimer: ReturnType<typeof setTimeout> | undefined

function acquireLayer(id: symbol, close?: () => void) {
  const existingLayer = layers.get(id)
  if (existingLayer !== undefined) {
    existingLayer.close = close
    return existingLayer.zIndex
  }

  if (resetTimer !== undefined) {
    clearTimeout(resetTimer)
    resetTimer = undefined
  }

  nextZIndex += LAYER_STEP
  layers.set(id, { zIndex: nextZIndex, close })
  return nextZIndex
}

function releaseLayer(id: symbol) {
  layers.delete(id)
  if (layers.size || resetTimer !== undefined) return

  resetTimer = setTimeout(() => {
    resetTimer = undefined
    if (!layers.size) nextZIndex = OVERLAY_STACK_BASE_Z_INDEX
  }, STACK_RESET_DELAY)
}

/**
 * Closes only the most recently opened dismissible overlay. Returns whether
 * the back action was consumed so callers can skip route navigation.
 */
export function closeTopOverlay() {
  let topId: symbol | undefined
  let topLayer: OverlayLayer | undefined

  for (const [id, layer] of layers) {
    if (!layer.close || (topLayer && layer.zIndex <= topLayer.zIndex)) continue
    topId = id
    topLayer = layer
  }

  if (!topId || !topLayer?.close) return false

  topLayer.close()
  return true
}

/**
 * Gives every app overlay a layer based on when it opened. Keeping dialogs and
 * sheets in the same stack allows either type to safely open the other.
 */
export function useOverlayStack(active: MaybeRefOrGetter<boolean>, close?: () => void) {
  const id = Symbol('overlay')
  const zIndex = shallowRef(OVERLAY_STACK_BASE_Z_INDEX)

  watch(
    () => toValue(active),
    (isActive) => {
      if (isActive) zIndex.value = acquireLayer(id, close)
      else releaseLayer(id)
    },
    { immediate: true, flush: 'sync' },
  )

  onScopeDispose(() => releaseLayer(id))

  return readonly(zIndex)
}
