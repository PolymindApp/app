import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authStore: {
    token: 'sync-token',
    isValid: true,
    record: { id: 'account-1' } as { id: string } | null,
    onChange: vi.fn(() => vi.fn()),
    expireToken: vi.fn(),
  },
  applyExchangeResults: vi.fn(async () => undefined),
  completeLocalBootstrap: vi.fn(async () => undefined),
  hasLocalBootstrap: vi.fn(async () => true),
  initializeLocalMetadata: vi.fn(async () => ({
    accountId: 'account-1',
    clientId: 'client-1',
    cursor: 0,
    bootstrapped: true,
    lastSyncedAt: '',
    serverTime: '',
  })),
  issueCount: vi.fn(async () => 0),
  markOperationsForRetry: vi.fn(async () => undefined),
  markOperationsSending: vi.fn(async () => undefined),
  pendingOperationCount: vi.fn(async () => 0),
  pendingOperations: vi.fn(async () => []),
  readLocalMetadata: vi.fn(async () => ({ lastSyncedAt: '' })),
  recoverInterruptedOperations: vi.fn(async () => 0),
  retryPendingOperationsNow: vi.fn(async () => 0),
  updateLocalAuthToken: vi.fn(async () => undefined),
  writeBackgroundSyncStage: vi.fn(async () => undefined),
  removeBackgroundSyncStage: vi.fn(async () => undefined),
}))

vi.mock('@/lib/api', () => ({ api: { authStore: mocks.authStore } }))

vi.mock('@/lib/localDatabase', () => ({
  applyExchangeResults: mocks.applyExchangeResults,
  completeLocalBootstrap: mocks.completeLocalBootstrap,
  hasLocalBootstrap: mocks.hasLocalBootstrap,
  initializeLocalMetadata: mocks.initializeLocalMetadata,
  issueCount: mocks.issueCount,
  localOutboxChangedEvent: 'test-sync-outbox-changed',
  markOperationsForRetry: mocks.markOperationsForRetry,
  markOperationsSending: mocks.markOperationsSending,
  pendingOperationCount: mocks.pendingOperationCount,
  pendingOperations: mocks.pendingOperations,
  readLocalMetadata: mocks.readLocalMetadata,
  recoverInterruptedOperations: mocks.recoverInterruptedOperations,
  retryPendingOperationsNow: mocks.retryPendingOperationsNow,
  syncClientId: () => 'client-1',
  updateLocalAuthToken: mocks.updateLocalAuthToken,
}))

vi.mock('@/services/backgroundSyncStage', () => ({
  writeBackgroundSyncStage: mocks.writeBackgroundSyncStage,
  removeBackgroundSyncStage: mocks.removeBackgroundSyncStage,
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
}))

vi.mock('@capacitor/app', () => ({
  App: { addListener: vi.fn() },
}))

vi.mock('@capacitor/network', () => ({
  Network: { addListener: vi.fn() },
}))

function exchangeResponse(overrides: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({
    cursor: 0,
    hasMore: false,
    serverTime: '2026-08-12T12:00:00.000Z',
    acknowledgements: [],
    changes: [],
    resetRequired: false,
    protocolVersion: 1,
    ...overrides,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  vi.resetModules()
  vi.useRealTimers()
  mocks.authStore.token = 'sync-token'
  mocks.authStore.isValid = true
  mocks.authStore.record = { id: 'account-1' }
  Object.values(mocks).forEach((mock) => {
    if (typeof mock === 'function' && 'mockClear' in mock) mock.mockClear()
  })
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  vi.stubGlobal('fetch', vi.fn(async () => exchangeResponse()))
})

afterEach(async () => {
  const { stopOfflineSync } = await import('./offlineSync')
  await stopOfflineSync()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('offline synchronization coordination', () => {
  it('debounces a burst of local mutations and ignores reconciliation notifications', async () => {
    vi.useFakeTimers()
    const { startOfflineSync } = await import('./offlineSync')
    await startOfflineSync()

    window.dispatchEvent(new CustomEvent('test-sync-outbox-changed', {
      detail: { source: 'local' },
    }))
    await vi.advanceTimersByTimeAsync(30)
    window.dispatchEvent(new CustomEvent('test-sync-outbox-changed', {
      detail: { source: 'local' },
    }))

    await vi.advanceTimersByTimeAsync(49)
    expect(fetch).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())

    window.dispatchEvent(new CustomEvent('test-sync-outbox-changed', {
      detail: { accountId: 'account-1', source: 'reconciliation' },
    }))
    await vi.advanceTimersByTimeAsync(100)

    expect(fetch).toHaveBeenCalledOnce()
  })

  it('runs one follow-up exchange when a mutation arrives during an active request', async () => {
    let resolveFirstRequest!: (response: Response) => void
    vi.mocked(fetch)
      .mockImplementationOnce(() => new Promise(resolve => {
        resolveFirstRequest = resolve
      }))
      .mockImplementationOnce(async () => exchangeResponse())
    const { syncNow } = await import('./offlineSync')

    const synchronization = syncNow('manual')
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    const queuedSynchronization = syncNow('mutation')
    resolveFirstRequest(exchangeResponse())

    await Promise.all([synchronization, queuedSynchronization])

    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('makes deferred operations eligible when synchronization is requested manually', async () => {
    const operation = {
      operationId: 'operation-1',
      accountId: 'account-1',
      clientId: 'client-1',
      resource: 'tasks',
      recordId: 'task-1',
      kind: 'patch',
      payload: { name: 'Updated task' },
      fieldClocks: { name: '100-client-1' },
      dependsOn: [],
      status: 'pending',
      sequence: 1,
      attempts: 1,
      nextAttemptAt: Date.now() + 60_000,
      createdAt: '2026-08-12T12:00:00.000Z',
    }
    mocks.pendingOperationCount.mockResolvedValue(1)
    mocks.pendingOperations.mockImplementation(async () => (
      mocks.retryPendingOperationsNow.mock.calls.length ? [operation] : []
    ))
    const { syncNow } = await import('./offlineSync')

    await expect(syncNow('manual')).resolves.toBe(true)

    expect(mocks.retryPendingOperationsNow).toHaveBeenCalledWith('account-1')
    const request = vi.mocked(fetch).mock.calls[0]?.[1]
    expect(JSON.parse(String(request?.body))).toMatchObject({
      operations: [{
        operationId: 'operation-1',
        resource: 'tasks',
        recordId: 'task-1',
        kind: 'patch',
        payload: { name: 'Updated task' },
      }],
    })
  })

  it('stops requesting a page when the server cursor does not advance', async () => {
    vi.mocked(fetch).mockResolvedValue(exchangeResponse({ hasMore: true }))
    const { offlineSyncStatus, syncNow } = await import('./offlineSync')

    await expect(syncNow('manual')).resolves.toBe(false)

    expect(fetch).toHaveBeenCalledOnce()
    expect(offlineSyncStatus.phase).toBe('offline')
  })
})
