import Dexie, { type EntityTable } from 'dexie'
import type {
  LocalSyncResource,
  SyncIssue,
  SyncMetadata,
  SyncOperation,
  SyncResource,
} from '@/types/sync'
import { healthConnectEntrySession } from '@/services/healthConnectEntries'

const CLIENT_ID_KEY = 'backontrack-sync-client-id'
const SYNC_DATA_CHANGED_EVENT = 'backontrack-sync-data-changed'
const SYNC_OUTBOX_CHANGED_EVENT = 'backontrack-sync-outbox-changed'

interface LocalMediaBlob {
  id: string
  accountId: string
  blob: Blob
  mimeType: string
  createdAt: string
}

interface LocalAlias {
  key: string
  accountId: string
  resource: string
  localId: string
  remoteId: string
}

class BackOnTrackLocalDatabase extends Dexie {
  resources!: EntityTable<LocalSyncResource, 'key'>
  outbox!: EntityTable<SyncOperation, 'operationId'>
  metadata!: EntityTable<SyncMetadata, 'accountId'>
  issues!: EntityTable<SyncIssue, 'id'>
  media!: EntityTable<LocalMediaBlob, 'id'>
  aliases!: EntityTable<LocalAlias, 'key'>

  constructor() {
    super('backontrack-offline')
    this.version(1).stores({
      resources: '&key,[accountId+resource],accountId,resource,id',
      outbox: '&operationId,[accountId+status],accountId,status,sequence,nextAttemptAt,[accountId+resource+recordId]',
      metadata: '&accountId,clientId',
      issues: '&id,[accountId+resolved],accountId,resolved,createdAt',
      media: '&id,accountId,createdAt',
      aliases: '&key,[accountId+resource+localId],accountId,resource,localId',
    })
  }
}

export const localDatabase = new BackOnTrackLocalDatabase()

let logicalCounter = 0
let operationCounter = 0

export function syncClientId() {
  try {
    const existing = localStorage.getItem(CLIENT_ID_KEY)
    if (existing) return existing
    const value = `client-${crypto.randomUUID()}`
    localStorage.setItem(CLIENT_ID_KEY, value)
    return value
  } catch {
    return `client-${crypto.randomUUID()}`
  }
}

export function createLocalRecordId() {
  const bytes = crypto.getRandomValues(new Uint8Array(7))
  return `r${[...bytes].map(value => value.toString(16).padStart(2, '0')).join('')}`
}

export function createOperationId() {
  return `op-${crypto.randomUUID()}`
}

export function createFieldClock() {
  logicalCounter = (logicalCounter + 1) % 1_000_000
  return `${String(Date.now()).padStart(13, '0')}-${String(logicalCounter).padStart(6, '0')}-${syncClientId()}`
}

function resourceKey(accountId: string, resource: string, id: string) {
  return `${accountId}\u001f${resource}\u001f${id}`
}

function aliasKey(accountId: string, resource: string, localId: string) {
  return `${accountId}\u001f${resource}\u001f${localId}`
}

function cloneSyncRecord<T extends Record<string, any>>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function notifyDataChanged(accountId: string, resource: string) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(SYNC_DATA_CHANGED_EVENT, {
    detail: { accountId, resource },
  }))
}

function notifyOutboxChanged(accountId: string, source: 'local' | 'reconciliation' = 'local') {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(SYNC_OUTBOX_CHANGED_EVENT, {
    detail: { accountId, source },
  }))
}

export async function hasLocalBootstrap(accountId: string) {
  if (typeof indexedDB === 'undefined') return false
  try {
    return Boolean((await localDatabase.metadata.get(accountId))?.bootstrapped)
  } catch {
    return false
  }
}

export async function readLocalMetadata(accountId: string) {
  return localDatabase.metadata.get(accountId)
}

export async function initializeLocalMetadata(accountId: string, cursor = 0) {
  const existing = await localDatabase.metadata.get(accountId)
  const metadata: SyncMetadata = {
    accountId,
    clientId: existing?.clientId || syncClientId(),
    cursor: Math.max(cursor, existing?.cursor || 0),
    bootstrapped: existing?.bootstrapped || false,
    lastSyncedAt: existing?.lastSyncedAt || '',
    serverTime: existing?.serverTime || '',
    confirmedReceiptSequence: existing?.confirmedReceiptSequence || 0,
    authToken: existing?.authToken,
    syncUrl: existing?.syncUrl,
  }
  await localDatabase.metadata.put(metadata)
  return metadata
}

export async function completeLocalBootstrap(
  accountId: string,
  cursor: number,
  resources: SyncResource[],
) {
  await localDatabase.transaction(
    'rw',
    localDatabase.resources,
    localDatabase.metadata,
    localDatabase.outbox,
    async () => {
      const existingPending = await localDatabase.outbox
        .where('[accountId+status]')
        .anyOf([[accountId, 'pending'], [accountId, 'sending'], [accountId, 'rejected']])
        .toArray()
      const pendingKeys = new Set(existingPending
        .filter(operation => operation.recordId)
        .map(operation => resourceKey(accountId, operation.resource, operation.recordId!)))
      const rows = resources.map(resource => ({
        ...resource,
        key: resourceKey(accountId, resource.resource, resource.id),
        accountId,
        locallyModified: pendingKeys.has(resourceKey(accountId, resource.resource, resource.id)),
      }))
      const currentRows = await localDatabase.resources.where('accountId').equals(accountId).toArray()
      await localDatabase.resources.bulkDelete(currentRows
        .filter(row => !row.locallyModified && !pendingKeys.has(row.key))
        .map(row => row.key))
      for (const row of rows) {
        if (row.locallyModified) continue
        await localDatabase.resources.put(row)
      }
      const previous = await localDatabase.metadata.get(accountId)
      await localDatabase.metadata.put({
        accountId,
        clientId: previous?.clientId || syncClientId(),
        cursor,
        bootstrapped: true,
        lastSyncedAt: new Date().toISOString(),
        serverTime: previous?.serverTime || '',
        confirmedReceiptSequence: Math.max(
          previous?.confirmedReceiptSequence || 0,
          0,
        ),
        authToken: previous?.authToken,
        syncUrl: previous?.syncUrl,
      })
    },
  )
  window.dispatchEvent(new CustomEvent(SYNC_DATA_CHANGED_EVENT, {
    detail: { accountId, resource: '*' },
  }))
}

export async function listLocalRecords(
  accountId: string,
  resource: string,
  options: { filter?: string; sort?: string } = {},
) {
  const rows = await localDatabase.resources
    .where('[accountId+resource]')
    .equals([accountId, resource])
    .filter(row => !row.deleted && Boolean(row.data))
    .toArray()
  const records = rows.map(row => row.data!)
  return sortRecords(filterRecords(records, options.filter), options.sort)
}

export async function getLocalRecord(accountId: string, resource: string, id: string) {
  const resolvedId = await resolveLocalAlias(accountId, resource, id)
  const row = await localDatabase.resources.get(resourceKey(accountId, resource, resolvedId))
  return row && !row.deleted ? row.data : undefined
}

export async function repairLegacyHealthConnectEntrySync(accountId: string) {
  if (typeof indexedDB === 'undefined') return 0
  let repairedOperations = 0
  await localDatabase.transaction(
    'rw',
    localDatabase.resources,
    localDatabase.outbox,
    localDatabase.issues,
    async () => {
      const rows = await localDatabase.resources
        .where('[accountId+resource]')
        .equals([accountId, 'entries'])
        .toArray()
      for (const row of rows) {
        if (row.data?.source_type !== 'health_connect') continue
        const clock = createFieldClock()
        await localDatabase.resources.put({
          ...row,
          data: {
            ...row.data,
            source_type: '',
            source_session: healthConnectEntrySession(String(row.data.entry_date || '')),
          },
          fieldClocks: {
            ...row.fieldClocks,
            source_type: clock,
            source_session: clock,
          },
          locallyModified: true,
        })
      }

      const operations = await localDatabase.outbox
        .where('accountId')
        .equals(accountId)
        .filter(operation => (
          operation.resource === 'entries'
          && operation.payload.source_type === 'health_connect'
        ))
        .toArray()
      for (const operation of operations) {
        const clock = createFieldClock()
        operation.payload = {
          ...operation.payload,
          source_type: '',
          source_session: healthConnectEntrySession(String(operation.payload.entry_date || '')),
        }
        operation.fieldClocks = {
          ...operation.fieldClocks,
          source_type: clock,
          source_session: clock,
        }
        operation.status = 'pending'
        operation.attempts = 0
        operation.nextAttemptAt = 0
        delete operation.error
        await localDatabase.outbox.put(operation)
        await localDatabase.issues.delete(`issue-${operation.operationId}`)
        repairedOperations += 1
      }
    },
  )
  if (repairedOperations) {
    notifyDataChanged(accountId, 'entries')
    notifyOutboxChanged(accountId)
  }
  return repairedOperations
}

export async function putLocalCreate(
  accountId: string,
  resource: string,
  data: Record<string, any>,
  options: { transactionId?: string; dependsOn?: string[] } = {},
) {
  const plainData = cloneSyncRecord(data)
  const id = typeof plainData.id === 'string' && plainData.id ? plainData.id : createLocalRecordId()
  const record = { ...plainData, id, owner: plainData.owner || accountId }
  const fieldClock = createFieldClock()
  const clocks = Object.fromEntries(Object.keys(record).map(field => [field, fieldClock]))
  const operation = makeOperation(accountId, resource, id, 'create', record, clocks, options)
  const row: LocalSyncResource = {
    key: resourceKey(accountId, resource, id),
    accountId,
    resource,
    id,
    revision: 0,
    fieldClocks: clocks,
    deleted: false,
    data: record,
    locallyModified: true,
  }
  await localDatabase.transaction('rw', localDatabase.resources, localDatabase.outbox, async () => {
    await localDatabase.resources.put(row)
    await localDatabase.outbox.add(operation)
  })
  notifyDataChanged(accountId, resource)
  notifyOutboxChanged(accountId)
  return record
}

export async function putLocalPatch(
  accountId: string,
  resource: string,
  id: string,
  patch: Record<string, any>,
  options: { transactionId?: string; dependsOn?: string[] } = {},
) {
  const plainPatch = cloneSyncRecord(patch)
  const resolvedId = await resolveLocalAlias(accountId, resource, id)
  const key = resourceKey(accountId, resource, resolvedId)
  let result: Record<string, any> | undefined
  await localDatabase.transaction('rw', localDatabase.resources, localDatabase.outbox, async () => {
    const current = await localDatabase.resources.get(key)
    if (!current?.data || current.deleted) throw new Error('Local record not found.')
    const fieldClock = createFieldClock()
    const clocks = Object.fromEntries(Object.keys(plainPatch).map(field => [field, fieldClock]))
    result = { ...current.data, ...plainPatch, id: resolvedId }
    await localDatabase.resources.put({
      ...current,
      data: result,
      fieldClocks: { ...current.fieldClocks, ...clocks },
      locallyModified: true,
    })
    const operation = makeOperation(accountId, resource, resolvedId, 'patch', plainPatch, clocks, options)
    const canCoalesce = !options.transactionId && !(options.dependsOn?.length)
    const existing = canCoalesce
      ? (await localDatabase.outbox
          .where('[accountId+resource+recordId]')
          .equals([accountId, resource, resolvedId])
          .filter(candidate => (
            candidate.kind === 'patch'
            && candidate.status === 'pending'
            && candidate.attempts === 0
            && !candidate.dispatchedAt
            && !candidate.transactionId
            && candidate.dependsOn.length === 0
          ))
          .sortBy('sequence'))[0]
      : undefined
    if (existing) {
      existing.payload = { ...existing.payload, ...plainPatch }
      existing.fieldClocks = { ...existing.fieldClocks, ...clocks }
      existing.nextAttemptAt = 0
      delete existing.error
      await localDatabase.outbox.put(existing)
    } else {
      await localDatabase.outbox.add(operation)
    }
  })
  notifyDataChanged(accountId, resource)
  notifyOutboxChanged(accountId)
  return result!
}

export async function putLocalDelete(
  accountId: string,
  resource: string,
  id: string,
  options: { transactionId?: string; dependsOn?: string[] } = {},
) {
  const resolvedId = await resolveLocalAlias(accountId, resource, id)
  const key = resourceKey(accountId, resource, resolvedId)
  await localDatabase.transaction('rw', localDatabase.resources, localDatabase.outbox, async () => {
    const current = await localDatabase.resources.get(key)
    if (!current) throw new Error('Local record not found.')
    await localDatabase.resources.put({ ...current, deleted: true, locallyModified: true })
    await localDatabase.outbox.add(makeOperation(
      accountId,
      resource,
      resolvedId,
      'delete',
      {},
      { '*': createFieldClock() },
      options,
    ))
  })
  notifyDataChanged(accountId, resource)
  notifyOutboxChanged(accountId)
}

export async function putLocalCommand(
  accountId: string,
  command: string,
  payload: Record<string, unknown>,
) {
  const plainPayload = cloneSyncRecord(payload)
  const clock = createFieldClock()
  const operation = makeOperation(accountId, command, undefined, 'command', plainPayload, { '*': clock }, {})
  await localDatabase.outbox.add(operation)
  notifyOutboxChanged(accountId)
  return operation
}

export async function putLocalProjectionPatch(
  accountId: string,
  resource: string,
  id: string,
  patch: Record<string, any>,
) {
  const plainPatch = cloneSyncRecord(patch)
  const key = resourceKey(accountId, resource, id)
  let result: Record<string, any> | undefined
  await localDatabase.transaction('rw', localDatabase.resources, async () => {
    const current = await localDatabase.resources.get(key)
    if (!current?.data || current.deleted) throw new Error('Local record not found.')
    result = { ...current.data, ...plainPatch }
    await localDatabase.resources.put({ ...current, data: result })
  })
  notifyDataChanged(accountId, resource)
  return result!
}

export async function putLocalProjectionCreate(
  accountId: string,
  resource: string,
  data: Record<string, any>,
  storageId?: string,
) {
  const plainData = cloneSyncRecord(data)
  const id = typeof plainData.id === 'string' && plainData.id ? plainData.id : createLocalRecordId()
  const record = { ...plainData, id }
  const localId = storageId || id
  await localDatabase.resources.put({
    key: resourceKey(accountId, resource, localId),
    accountId,
    resource,
    id: localId,
    revision: 0,
    fieldClocks: {},
    deleted: false,
    data: record,
    locallyModified: false,
  })
  notifyDataChanged(accountId, resource)
  return record
}

export async function putLocalProjectionDelete(
  accountId: string,
  resource: string,
  id: string,
) {
  const key = resourceKey(accountId, resource, id)
  const current = await localDatabase.resources.get(key)
  if (current) await localDatabase.resources.put({ ...current, deleted: true })
  notifyDataChanged(accountId, resource)
}

export async function putLocalSharedCardCreate(
  accountId: string,
  reviewSetId: string,
  data: Record<string, any>,
) {
  const plainData = cloneSyncRecord(data)
  const cardId = typeof plainData.id === 'string' && plainData.id ? plainData.id : createLocalRecordId()
  const id = `${reviewSetId}:${cardId}`
  const record = { ...plainData, id: cardId, review_set_id: reviewSetId }
  const fieldClock = createFieldClock()
  const clocks = Object.fromEntries(Object.keys(record).map(field => [field, fieldClock]))
  await localDatabase.transaction('rw', localDatabase.resources, localDatabase.outbox, async () => {
    await localDatabase.resources.put({
      key: resourceKey(accountId, 'review_set_cards', id),
      accountId,
      resource: 'review_set_cards',
      id,
      revision: 0,
      fieldClocks: clocks,
      deleted: false,
      data: record,
      locallyModified: true,
    })
    await localDatabase.outbox.add(makeOperation(
      accountId,
      'review_set_cards',
      id,
      'create',
      record,
      clocks,
      {},
    ))
  })
  notifyDataChanged(accountId, 'review_set_cards')
  notifyOutboxChanged(accountId)
  return record
}

export async function putLocalSharedCardPatch(
  accountId: string,
  reviewSetId: string,
  cardId: string,
  patch: Record<string, any>,
) {
  const plainPatch = cloneSyncRecord(patch)
  const id = `${reviewSetId}:${cardId}`
  const key = resourceKey(accountId, 'review_set_cards', id)
  let result: Record<string, any> | undefined
  await localDatabase.transaction('rw', localDatabase.resources, localDatabase.outbox, async () => {
    const current = await localDatabase.resources.get(key)
    if (!current?.data || current.deleted) throw new Error('Local record not found.')
    const fieldClock = createFieldClock()
    const clocks = Object.fromEntries(Object.keys(plainPatch).map(field => [field, fieldClock]))
    result = { ...current.data, ...plainPatch, id: cardId, review_set_id: reviewSetId }
    await localDatabase.resources.put({
      ...current,
      data: result,
      fieldClocks: { ...current.fieldClocks, ...clocks },
      locallyModified: true,
    })
    await localDatabase.outbox.add(makeOperation(
      accountId,
      'review_set_cards',
      id,
      'patch',
      { ...plainPatch, review_set_id: reviewSetId },
      clocks,
      {},
    ))
  })
  notifyDataChanged(accountId, 'review_set_cards')
  notifyOutboxChanged(accountId)
  return result!
}

export async function putLocalSharedCardDelete(
  accountId: string,
  reviewSetId: string,
  cardId: string,
) {
  const id = `${reviewSetId}:${cardId}`
  const key = resourceKey(accountId, 'review_set_cards', id)
  await localDatabase.transaction('rw', localDatabase.resources, localDatabase.outbox, async () => {
    const current = await localDatabase.resources.get(key)
    if (!current) throw new Error('Local record not found.')
    await localDatabase.resources.put({ ...current, deleted: true, locallyModified: true })
    await localDatabase.outbox.add(makeOperation(
      accountId,
      'review_set_cards',
      id,
      'delete',
      { review_set_id: reviewSetId },
      { '*': createFieldClock() },
      {},
    ))
  })
  notifyDataChanged(accountId, 'review_set_cards')
  notifyOutboxChanged(accountId)
}

function makeOperation(
  accountId: string,
  resource: string,
  recordId: string | undefined,
  kind: SyncOperation['kind'],
  payload: Record<string, unknown>,
  fieldClocks: Record<string, string>,
  options: { transactionId?: string; dependsOn?: string[] },
): SyncOperation {
  operationCounter = (operationCounter + 1) % 1000
  return {
    operationId: createOperationId(),
    transactionId: options.transactionId,
    accountId,
    clientId: syncClientId(),
    resource,
    recordId,
    kind,
    payload,
    fieldClocks,
    dependsOn: options.dependsOn || [],
    status: 'pending',
    sequence: Date.now() * 1000 + operationCounter,
    attempts: 0,
    nextAttemptAt: 0,
    createdAt: new Date().toISOString(),
  }
}

export async function pendingOperations(accountId: string, limit = 100) {
  const now = Date.now()
  return localDatabase.outbox
    .where('[accountId+status]')
    .equals([accountId, 'pending'])
    .filter(operation => operation.nextAttemptAt <= now)
    .sortBy('sequence')
    .then(operations => operations.slice(0, limit))
}

export async function pendingOperationCount(accountId: string) {
  return localDatabase.outbox
    .where('[accountId+status]')
    .anyOf([[accountId, 'pending'], [accountId, 'sending']])
    .count()
}

export async function issueCount(accountId: string) {
  return localDatabase.issues.where('[accountId+resolved]').equals([accountId, 0]).count()
}

export async function listSyncIssues(accountId: string) {
  const issues = await localDatabase.issues
    .where('[accountId+resolved]')
    .equals([accountId, 0])
    .toArray()
  return issues.sort((left, right) => (
    right.createdAt.localeCompare(left.createdAt)
    || right.id.localeCompare(left.id)
  ))
}

export async function markOperationsSending(operationIds: string[]) {
  const dispatchedAt = new Date().toISOString()
  await localDatabase.outbox.where('operationId').anyOf(operationIds).modify(operation => {
    operation.status = 'sending'
    operation.dispatchedAt ||= dispatchedAt
  })
}

export async function markOperationsDispatched(operationIds: string[]) {
  const dispatchedAt = new Date().toISOString()
  await localDatabase.outbox.where('operationId').anyOf(operationIds).modify(operation => {
    operation.dispatchedAt ||= dispatchedAt
  })
}

export async function recoverInterruptedOperations(accountId: string) {
  return localDatabase.outbox
    .where('[accountId+status]')
    .equals([accountId, 'sending'])
    .modify(operation => {
      operation.status = 'pending'
      operation.nextAttemptAt = 0
      delete operation.error
    })
}

export async function retryPendingOperationsNow(accountId: string) {
  return localDatabase.outbox
    .where('[accountId+status]')
    .equals([accountId, 'pending'])
    .modify(operation => {
      operation.nextAttemptAt = 0
      delete operation.error
    })
}

export async function markOperationsForRetry(operationIds: string[], delayMs: number, message: string) {
  await localDatabase.outbox.where('operationId').anyOf(operationIds).modify(operation => {
    operation.status = 'pending'
    operation.attempts += 1
    operation.nextAttemptAt = Date.now() + delayMs
    operation.error = message
  })
}

export async function applyExchangeResults(
  accountId: string,
  cursor: number,
  serverTime: string,
  acknowledgements: Array<{
    operationId: string
    status: string
    resource?: SyncResource
    replacementId?: string
    error?: { message: string; details?: Record<string, unknown> }
  }>,
  changes: SyncResource[],
  receiptWatermark = 0,
) {
  const changedResources = new Set<string>()
  await localDatabase.transaction(
    'rw',
    localDatabase.resources,
    localDatabase.outbox,
    localDatabase.metadata,
    localDatabase.issues,
    localDatabase.aliases,
    async () => {
      for (const acknowledgement of acknowledgements) {
        const operation = await localDatabase.outbox.get(acknowledgement.operationId)
        if (!operation) continue
        if (acknowledgement.status === 'rejected') {
          operation.status = 'rejected'
          operation.error = acknowledgement.error?.message || 'This change needs attention.'
          await localDatabase.outbox.put(operation)
          await localDatabase.issues.put({
            id: `issue-${acknowledgement.operationId}`,
            accountId,
            operationId: acknowledgement.operationId,
            resource: operation.resource,
            recordId: operation.recordId,
            message: operation.error,
            details: acknowledgement.error?.details || {},
            createdAt: new Date().toISOString(),
            resolved: 0,
          })
          continue
        }
        if (acknowledgement.replacementId && operation.recordId) {
          await saveLocalAlias(accountId, operation.resource, operation.recordId, acknowledgement.replacementId)
        }
        if (acknowledgement.resource) {
          await mergeRemoteResource(accountId, acknowledgement.resource)
          changedResources.add(acknowledgement.resource.resource)
        }
        await localDatabase.outbox.delete(operation.operationId)
        const settledResource = acknowledgement.resource?.resource || operation.resource
        const settledId = acknowledgement.resource?.id
          || acknowledgement.replacementId
          || operation.recordId
        if (settledId) {
          const superseded = await localDatabase.outbox
            .where('[accountId+resource+recordId]')
            .equals([accountId, operation.resource, operation.recordId || ''])
            .filter(candidate => candidate.status === 'rejected')
            .toArray()
          if (superseded.length) {
            await localDatabase.outbox.bulkDelete(superseded.map(candidate => candidate.operationId))
            await localDatabase.issues.bulkDelete(
              superseded.map(candidate => `issue-${candidate.operationId}`),
            )
          }
          const remaining = await localDatabase.outbox
            .where('[accountId+resource+recordId]')
            .equals([accountId, settledResource, settledId])
            .count()
          await localDatabase.resources
            .where('key')
            .equals(resourceKey(accountId, settledResource, settledId))
            .modify({ locallyModified: remaining > 0 })
        }
      }
      for (const change of changes) {
        await mergeRemoteResource(accountId, change)
        changedResources.add(change.resource)
      }
      const previous = await localDatabase.metadata.get(accountId)
      await localDatabase.metadata.put({
        accountId,
        clientId: previous?.clientId || syncClientId(),
        cursor,
        bootstrapped: true,
        lastSyncedAt: new Date().toISOString(),
        serverTime,
        confirmedReceiptSequence: Math.max(
          previous?.confirmedReceiptSequence || 0,
          receiptWatermark,
        ),
        authToken: previous?.authToken,
        syncUrl: previous?.syncUrl,
      })
    },
  )
  for (const resource of changedResources) notifyDataChanged(accountId, resource)
  if (acknowledgements.length || changes.length) {
    notifyOutboxChanged(accountId, 'reconciliation')
  }
}

async function mergeRemoteResource(accountId: string, remote: SyncResource) {
  const key = resourceKey(accountId, remote.resource, remote.id)
  const current = await localDatabase.resources.get(key)
  if (remote.deleted) {
    await localDatabase.resources.put({
      key,
      accountId,
      ...remote,
      locallyModified: false,
    })
    if (current?.locallyModified) {
      await localDatabase.outbox
        .where('[accountId+resource+recordId]')
        .equals([accountId, remote.resource, remote.id])
        .delete()
    }
    return
  }
  if (!current?.locallyModified || !current.data) {
    await localDatabase.resources.put({ key, accountId, ...remote, locallyModified: false })
    return
  }
  const data = { ...(remote.data || {}) }
  const clocks = { ...remote.fieldClocks }
  for (const [field, value] of Object.entries(current.data)) {
    const localClock = current.fieldClocks[field] || current.fieldClocks['*'] || ''
    const remoteClock = remote.fieldClocks[field] || remote.fieldClocks['*'] || ''
    if (localClock && localClock >= remoteClock) {
      data[field] = value
      clocks[field] = localClock
    }
  }
  await localDatabase.resources.put({
    key,
    accountId,
    ...remote,
    data,
    fieldClocks: clocks,
    locallyModified: true,
  })
}

async function saveLocalAlias(accountId: string, resource: string, localId: string, remoteId: string) {
  await localDatabase.aliases.put({
    key: aliasKey(accountId, resource, localId),
    accountId,
    resource,
    localId,
    remoteId,
  })
  const localKey = resourceKey(accountId, resource, localId)
  const current = await localDatabase.resources.get(localKey)
  if (current?.data) {
    await localDatabase.resources.put({
      ...current,
      key: resourceKey(accountId, resource, remoteId),
      id: remoteId,
      data: { ...current.data, id: remoteId },
    })
    await localDatabase.resources.delete(localKey)
  }
  await localDatabase.outbox
    .where('accountId')
    .equals(accountId)
    .modify(operation => {
      if (operation.recordId === localId && operation.resource === resource) operation.recordId = remoteId
      operation.payload = replaceRelationId(operation.payload, localId, remoteId)
    })
}

function replaceRelationId(value: unknown, localId: string, remoteId: string): any {
  if (value === localId) return remoteId
  if (Array.isArray(value)) return value.map(item => replaceRelationId(item, localId, remoteId))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceRelationId(item, localId, remoteId)]))
  }
  return value
}

export async function resolveLocalAlias(accountId: string, resource: string, id: string) {
  return (await localDatabase.aliases.get(aliasKey(accountId, resource, id)))?.remoteId || id
}

export async function saveLocalMedia(accountId: string, blob: Blob) {
  const id = `media-${crypto.randomUUID()}`
  await localDatabase.media.put({
    id,
    accountId,
    blob,
    mimeType: blob.type,
    createdAt: new Date().toISOString(),
  })
  return { id, url: URL.createObjectURL(blob) }
}

export async function eraseLocalAccount(accountId: string) {
  await localDatabase.transaction(
    'rw',
    localDatabase.resources,
    localDatabase.outbox,
    localDatabase.metadata,
    localDatabase.issues,
    localDatabase.media,
    localDatabase.aliases,
    async () => {
      await Promise.all([
        localDatabase.resources.where('accountId').equals(accountId).delete(),
        localDatabase.outbox.where('accountId').equals(accountId).delete(),
        localDatabase.metadata.delete(accountId),
        localDatabase.issues.where('accountId').equals(accountId).delete(),
        localDatabase.media.where('accountId').equals(accountId).delete(),
        localDatabase.aliases.where('accountId').equals(accountId).delete(),
      ])
    },
  )
}

export async function discardSyncIssue(issueId: string) {
  const issue = await localDatabase.issues.get(issueId)
  if (!issue) return
  await localDatabase.transaction(
    'rw',
    localDatabase.resources,
    localDatabase.outbox,
    localDatabase.metadata,
    localDatabase.issues,
    async () => {
      await localDatabase.outbox.delete(issue.operationId)
      await localDatabase.issues.delete(issueId)
      if (issue.recordId) {
        await localDatabase.resources.delete(resourceKey(
          issue.accountId,
          issue.resource,
          issue.recordId,
        ))
      }
      const metadata = await localDatabase.metadata.get(issue.accountId)
      if (metadata) await localDatabase.metadata.put({ ...metadata, bootstrapped: false })
    },
  )
  notifyDataChanged(issue.accountId, issue.resource)
  notifyOutboxChanged(issue.accountId)
}

export async function discardAllSyncIssues(accountId: string) {
  const issues = await localDatabase.issues
    .where('[accountId+resolved]')
    .equals([accountId, 0])
    .toArray()
  if (!issues.length) return 0

  await localDatabase.transaction(
    'rw',
    localDatabase.resources,
    localDatabase.outbox,
    localDatabase.metadata,
    localDatabase.issues,
    async () => {
      await localDatabase.outbox.bulkDelete(issues.map(issue => issue.operationId))
      await localDatabase.issues.bulkDelete(issues.map(issue => issue.id))
      await localDatabase.resources.bulkDelete([...new Set(issues.flatMap(issue => (
        issue.recordId ? [resourceKey(accountId, issue.resource, issue.recordId)] : []
      )))])
      const metadata = await localDatabase.metadata.get(accountId)
      if (metadata) await localDatabase.metadata.put({ ...metadata, bootstrapped: false })
    },
  )

  for (const resource of new Set(issues.map(issue => issue.resource))) {
    notifyDataChanged(accountId, resource)
  }
  notifyOutboxChanged(accountId)
  return issues.length
}

export async function updateLocalAuthToken(accountId: string, authToken: string, syncUrl: string) {
  const metadata = await initializeLocalMetadata(accountId)
  await localDatabase.metadata.put({ ...metadata, authToken, syncUrl })
}

function filterRecords(records: Record<string, any>[], filter = '') {
  const expression = filter.trim()
  if (!expression) return records
  return records.filter(record => expression.split(/\s+\|\|\s+/).some(orPart =>
    orPart.replace(/^\(|\)$/g, '').split(/\s+&&\s+/).every(andPart => {
      const match = andPart.trim().replace(/^\(|\)$/g, '').match(/^([a-z_]+)\s*(=|!=|>=|<=|>|<)\s*(?:"([^"]*)"|(true|false|-?\d+(?:\.\d+)?))$/)
      if (!match) return true
      const [, field, operator, quoted, literal] = match
      const expected: any = quoted !== undefined
        ? quoted
        : literal === 'true'
          ? true
          : literal === 'false'
            ? false
            : Number(literal)
      const actual = record[field!]
      if (operator === '=') return actual === expected
      if (operator === '!=') return actual !== expected
      if (operator === '>=') return actual >= expected
      if (operator === '<=') return actual <= expected
      if (operator === '>') return actual > expected
      return actual < expected
    }),
  ))
}

function sortRecords(records: Record<string, any>[], sort = '') {
  const fields = sort.split(',').map(value => value.trim()).filter(Boolean)
  if (!fields.length) return records
  return [...records].sort((left, right) => {
    for (const raw of fields) {
      const descending = raw.startsWith('-')
      const field = raw.replace(/^[+-]/, '')
      const comparison = String(left[field] ?? '').localeCompare(String(right[field] ?? ''), undefined, {
        numeric: true,
      })
      if (comparison) return descending ? -comparison : comparison
    }
    return 0
  })
}

export const localDataChangedEvent = SYNC_DATA_CHANGED_EVENT
export const localOutboxChangedEvent = SYNC_OUTBOX_CHANGED_EVENT
