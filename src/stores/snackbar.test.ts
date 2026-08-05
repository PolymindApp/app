import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useSnackbarStore } from './snackbar'

describe('app snackbar', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('shows a fresh deletion confirmation and can dismiss it', () => {
    const store = useSnackbarStore()

    store.showDeletion('Routine')

    expect(store.visible).toBe(true)
    expect(store.message).toBe('Routine deleted.')
    expect(store.revision).toBe(1)

    store.dismiss()
    expect(store.visible).toBe(false)
  })

  it('increments its revision so consecutive deletions restart the snackbar timeout', () => {
    const store = useSnackbarStore()

    store.showDeletion('Log')
    store.showDeletion('Reflection')

    expect(store.visible).toBe(true)
    expect(store.message).toBe('Reflection deleted.')
    expect(store.revision).toBe(2)
  })
})
