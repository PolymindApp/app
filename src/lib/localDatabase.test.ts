import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import {
  applyExchangeResults,
  completeLocalBootstrap,
  discardAllSyncIssues,
  getLocalRecord,
  hasLocalBootstrap,
  issueCount,
  listLocalRecords,
  listSyncIssues,
  localDatabase,
  localOutboxChangedEvent,
  markOperationsSending,
  pendingOperationCount,
  pendingOperations,
  putLocalCreate,
  putLocalPatch,
  recoverInterruptedOperations,
  retryPendingOperationsNow,
  resolveLocalAlias,
} from './localDatabase'

const accountId = 'offline-account'

describe('offline local database', () => {
  beforeEach(async () => {
    localDatabase.close()
    await localDatabase.delete()
    await localDatabase.open()
    localStorage.clear()
  })

  it('hydrates a snapshot and serves optimistic writes without network access', async () => {
    await completeLocalBootstrap(accountId, 4, [{
      resource: 'tasks',
      id: 'task-1',
      revision: 1,
      fieldClocks: { name: '100-server' },
      deleted: false,
      data: { id: 'task-1', owner: accountId, name: 'Initial task', sort_order: 0 },
    }])

    expect(await hasLocalBootstrap(accountId)).toBe(true)
    expect(await listLocalRecords(accountId, 'tasks')).toEqual([
      { id: 'task-1', owner: accountId, name: 'Initial task', sort_order: 0 },
    ])

    const updated = await putLocalPatch(accountId, 'tasks', 'task-1', { name: 'Changed offline' })
    expect(updated.name).toBe('Changed offline')
    expect(await pendingOperationCount(accountId)).toBe(1)
    expect((await pendingOperations(accountId))[0]).toMatchObject({
      resource: 'tasks',
      recordId: 'task-1',
      kind: 'patch',
      payload: { name: 'Changed offline' },
    })
  })

  it('stores nested Vue reactive values as plain sync data', async () => {
    await completeLocalBootstrap(accountId, 0, [])
    const trackers = reactive(['tracker-1'])
    const trackerSnapshot = reactive({ 'tracker-1': 'Mood' })

    const record = await putLocalCreate(accountId, 'journal_entries', {
      title: 'Offline reflection',
      tracker: trackers,
      tracker_snapshot: trackerSnapshot,
    })

    expect(record.tracker).toEqual(['tracker-1'])
    expect(record.tracker_snapshot).toEqual({ 'tracker-1': 'Mood' })
    expect(await getLocalRecord(accountId, 'journal_entries', record.id)).toMatchObject({
      tracker: ['tracker-1'],
      tracker_snapshot: { 'tracker-1': 'Mood' },
    })
    expect((await pendingOperations(accountId))[0]?.payload).toMatchObject({
      tracker: ['tracker-1'],
      tracker_snapshot: { 'tracker-1': 'Mood' },
    })
  })

  it('recovers operations interrupted while sending so they can retry', async () => {
    await completeLocalBootstrap(accountId, 0, [])
    await putLocalCreate(accountId, 'journal_entries', { title: 'Interrupted upload' })
    const operation = (await pendingOperations(accountId))[0]!

    await markOperationsSending([operation.operationId])

    expect(await pendingOperationCount(accountId)).toBe(1)
    expect(await pendingOperations(accountId)).toEqual([])

    expect(await recoverInterruptedOperations(accountId)).toBe(1)
    expect(await pendingOperations(accountId)).toEqual([
      expect.objectContaining({
        operationId: operation.operationId,
        status: 'pending',
        nextAttemptAt: 0,
      }),
    ])
  })

  it('makes deferred operations immediately eligible for a sign-out sync', async () => {
    await completeLocalBootstrap(accountId, 0, [])
    await putLocalCreate(accountId, 'journal_entries', { title: 'Deferred upload' })
    const operation = (await pendingOperations(accountId))[0]!

    await localDatabase.outbox.update(operation.operationId, {
      nextAttemptAt: Date.now() + 60_000,
      error: 'Previous request failed.',
    })

    expect(await pendingOperationCount(accountId)).toBe(1)
    expect(await pendingOperations(accountId)).toEqual([])

    expect(await retryPendingOperationsNow(accountId)).toBe(1)
    const eligibleOperations = await pendingOperations(accountId)
    expect(eligibleOperations).toEqual([
      expect.objectContaining({
        operationId: operation.operationId,
        nextAttemptAt: 0,
      }),
    ])
    expect(eligibleOperations[0]).not.toHaveProperty('error')
  })

  it('does not announce an outbox mutation after an empty remote pull', async () => {
    await completeLocalBootstrap(accountId, 0, [])
    const listener = vi.fn()
    window.addEventListener(localOutboxChangedEvent, listener)

    try {
      await applyExchangeResults(accountId, 0, '2026-08-10T12:00:00.000Z', [], [])
      expect(listener).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener(localOutboxChangedEvent, listener)
    }
  })

  it('identifies server reconciliation separately from a new local mutation', async () => {
    await completeLocalBootstrap(accountId, 0, [])
    await putLocalCreate(accountId, 'journal_entries', { title: 'Synced reflection' })
    const operation = (await pendingOperations(accountId))[0]!
    const listener = vi.fn()
    window.addEventListener(localOutboxChangedEvent, listener)

    try {
      await applyExchangeResults(accountId, 1, '2026-08-10T12:00:00.000Z', [{
        operationId: operation.operationId,
        status: 'applied',
      }], [])

      expect(listener).toHaveBeenCalledOnce()
      expect((listener.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({
        accountId,
        source: 'reconciliation',
      })
    } finally {
      window.removeEventListener(localOutboxChangedEvent, listener)
    }
  })

  it('lists newest issues first and discards all rejected local changes together', async () => {
    await completeLocalBootstrap(accountId, 0, [])
    for (let index = 0; index < 6; index += 1) {
      await putLocalCreate(accountId, 'journal_entries', { title: `Rejected ${index}` })
    }
    const operations = await pendingOperations(accountId)
    await applyExchangeResults(
      accountId,
      1,
      '2026-08-11T12:00:00.000Z',
      operations.map(operation => ({
        operationId: operation.operationId,
        status: 'rejected',
        error: { message: `Issue ${operation.payload.title}` },
      })),
      [],
    )
    await Promise.all(operations.map((operation, index) => localDatabase.issues.update(
      `issue-${operation.operationId}`,
      { createdAt: `2026-08-11T12:00:0${index}.000Z` },
    )))

    const issues = await listSyncIssues(accountId)
    expect(issues.map(issue => issue.createdAt)).toEqual([
      '2026-08-11T12:00:05.000Z',
      '2026-08-11T12:00:04.000Z',
      '2026-08-11T12:00:03.000Z',
      '2026-08-11T12:00:02.000Z',
      '2026-08-11T12:00:01.000Z',
      '2026-08-11T12:00:00.000Z',
    ])

    expect(await discardAllSyncIssues(accountId)).toBe(6)
    expect(await issueCount(accountId)).toBe(0)
    expect(await localDatabase.outbox.where('accountId').equals(accountId).count()).toBe(0)
    expect((await localDatabase.metadata.get(accountId))?.bootstrapped).toBe(false)
    await Promise.all(operations.map(async operation => {
      expect(await getLocalRecord(accountId, operation.resource, operation.recordId!)).toBeUndefined()
    }))
  })

  it('reconciles acknowledgements, aliases, and remote delete-wins changes', async () => {
    await completeLocalBootstrap(accountId, 0, [])
    await putLocalCreate(accountId, 'flashcard_tags', { id: 'local-tag', name: 'Focus' })
    const create = (await pendingOperations(accountId))[0]!

    await applyExchangeResults(accountId, 8, '2026-08-09T12:00:00.000Z', [{
      operationId: create.operationId,
      status: 'merged',
      replacementId: 'server-tag',
      resource: {
        resource: 'flashcard_tags',
        id: 'server-tag',
        revision: 2,
        fieldClocks: { '*': '200-server' },
        deleted: false,
        data: { id: 'server-tag', owner: accountId, name: 'Focus' },
      },
    }], [])

    expect(await resolveLocalAlias(accountId, 'flashcard_tags', 'local-tag')).toBe('server-tag')
    expect((await getLocalRecord(accountId, 'flashcard_tags', 'local-tag'))?.id).toBe('server-tag')
    expect(await pendingOperationCount(accountId)).toBe(0)

    await putLocalPatch(accountId, 'flashcard_tags', 'server-tag', { name: 'Pending rename' })
    await applyExchangeResults(accountId, 9, '2026-08-09T12:01:00.000Z', [], [{
      resource: 'flashcard_tags',
      id: 'server-tag',
      revision: 3,
      fieldClocks: { '*': '300-server' },
      deleted: true,
    }])

    expect(await getLocalRecord(accountId, 'flashcard_tags', 'server-tag')).toBeUndefined()
    expect(await pendingOperationCount(accountId)).toBe(0)
  })
})
