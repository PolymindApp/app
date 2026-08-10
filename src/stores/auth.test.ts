import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const apiMocks = vi.hoisted(() => ({
  authStore: {
    record: { id: 'account-1', email: 'test@coulombe.dev' } as Record<string, any> | null,
    hasLocalSession: true,
    onChange: vi.fn(),
    clear: vi.fn(),
  },
}))
const databaseMocks = vi.hoisted(() => ({
  eraseLocalAccount: vi.fn(),
}))
const syncMocks = vi.hoisted(() => ({
  clearBackgroundSyncStage: vi.fn(),
  clearOfflineMediaCache: vi.fn(),
  flushBeforeSignOut: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  api: {
    authStore: apiMocks.authStore,
  },
}))

vi.mock('@/lib/localDatabase', () => ({
  eraseLocalAccount: databaseMocks.eraseLocalAccount,
}))

vi.mock('@/services/offlineSync', () => ({
  clearBackgroundSyncStage: syncMocks.clearBackgroundSyncStage,
  clearOfflineMediaCache: syncMocks.clearOfflineMediaCache,
  flushBeforeSignOut: syncMocks.flushBeforeSignOut,
}))

vi.mock('@/services/passkeys', () => ({
  createAndroidPasskey: vi.fn(),
  getAndroidPasskey: vi.fn(),
  PasskeyCancelledError: class PasskeyCancelledError extends Error {},
}))

import { UnsyncedChangesError, useAuthStore } from './auth'

describe('auth sign-out', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    apiMocks.authStore.record = { id: 'account-1', email: 'test@coulombe.dev' }
    apiMocks.authStore.hasLocalSession = true
    apiMocks.authStore.onChange.mockReset()
    apiMocks.authStore.clear.mockReset()
    apiMocks.authStore.clear.mockImplementation(() => {
      apiMocks.authStore.record = null
      apiMocks.authStore.hasLocalSession = false
    })
    databaseMocks.eraseLocalAccount.mockReset()
    syncMocks.clearBackgroundSyncStage.mockReset()
    syncMocks.clearOfflineMediaCache.mockReset()
    syncMocks.flushBeforeSignOut.mockReset()
  })

  it('preserves local data until unsynced changes are explicitly discarded', async () => {
    syncMocks.flushBeforeSignOut.mockResolvedValue(2)
    const auth = useAuthStore()

    await expect(auth.logout()).rejects.toEqual(expect.objectContaining({
      changeCount: 2,
      name: 'UnsyncedChangesError',
    } satisfies Partial<UnsyncedChangesError>))

    expect(databaseMocks.eraseLocalAccount).not.toHaveBeenCalled()
    expect(apiMocks.authStore.clear).not.toHaveBeenCalled()
  })

  it('allows a confirmed sign-out to discard unsynced local data', async () => {
    const auth = useAuthStore()

    await auth.logout({ discardUnsynced: true })

    expect(syncMocks.flushBeforeSignOut).not.toHaveBeenCalled()
    expect(syncMocks.clearBackgroundSyncStage).toHaveBeenCalledOnce()
    expect(databaseMocks.eraseLocalAccount).toHaveBeenCalledWith('account-1')
    expect(syncMocks.clearOfflineMediaCache).toHaveBeenCalledOnce()
    expect(apiMocks.authStore.clear).toHaveBeenCalledOnce()
  })

  it('offers confirmed sign-out when the pending-data check itself fails', async () => {
    syncMocks.flushBeforeSignOut.mockRejectedValue(new Error('IndexedDB failed'))
    const auth = useAuthStore()

    await expect(auth.logout()).rejects.toEqual(expect.objectContaining({
      changeCount: undefined,
      name: 'UnsyncedChangesError',
    } satisfies Partial<UnsyncedChangesError>))

    expect(apiMocks.authStore.clear).not.toHaveBeenCalled()
  })

  it('clears the session even when every offline cleanup step fails', async () => {
    syncMocks.clearBackgroundSyncStage.mockRejectedValue(new Error('Native stage failed'))
    databaseMocks.eraseLocalAccount.mockRejectedValue(new Error('IndexedDB failed'))
    syncMocks.clearOfflineMediaCache.mockRejectedValue(new Error('Cache failed'))
    const auth = useAuthStore()

    await expect(auth.logout({ discardUnsynced: true })).resolves.toBeUndefined()

    expect(apiMocks.authStore.clear).toHaveBeenCalledOnce()
    expect(auth.isAuthenticated).toBe(false)
    expect(auth.error).toBe('You are signed out, but some offline data could not be removed from this device.')
  })
})
