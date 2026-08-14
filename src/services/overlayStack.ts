import { onScopeDispose, readonly, shallowRef, toValue, watch, type MaybeRefOrGetter } from 'vue'

export const OVERLAY_STACK_BASE_Z_INDEX = 3000

// Vuetify advances its own overlay stack by ten. Matching that spacing keeps a
// sheet above multiple nested VDialog layers, not only above the first dialog.
const LAYER_STEP = 10
const STACK_RESET_DELAY = 300
const layers = new Map<symbol, number>()
let nextZIndex = OVERLAY_STACK_BASE_Z_INDEX
let resetTimer: ReturnType<typeof setTimeout> | undefined

function acquireLayer(id: symbol) {
  const existingLayer = layers.get(id)
  if (existingLayer !== undefined) return existingLayer

  if (resetTimer !== undefined) {
    clearTimeout(resetTimer)
    resetTimer = undefined
  }

  nextZIndex += LAYER_STEP
  layers.set(id, nextZIndex)
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
 * Gives every app overlay a layer based on when it opened. Keeping dialogs and
 * sheets in the same stack allows either type to safely open the other.
 */
export function useOverlayStack(active: MaybeRefOrGetter<boolean>) {
  const id = Symbol('overlay')
  const zIndex = shallowRef(OVERLAY_STACK_BASE_Z_INDEX)

  watch(
    () => toValue(active),
    (isActive) => {
      if (isActive) zIndex.value = acquireLayer(id)
      else releaseLayer(id)
    },
    { immediate: true, flush: 'sync' },
  )

  onScopeDispose(() => releaseLayer(id))

  return readonly(zIndex)
}
