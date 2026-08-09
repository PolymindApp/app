import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { reactive } from 'vue'
import {
  applyExchangeResults,
  completeLocalBootstrap,
  getLocalRecord,
  hasLocalBootstrap,
  listLocalRecords,
  localDatabase,
  pendingOperationCount,
  pendingOperations,
  putLocalCreate,
  putLocalPatch,
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
