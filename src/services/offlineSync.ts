import { reactive } from 'vue'
import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { Network } from '@capacitor/network'
import { api } from '@/lib/api'
import {
  removeBackgroundSyncStage,
  writeBackgroundSyncStage,
} from '@/services/backgroundSyncStage'
import {
  applyExchangeResults,
  completeLocalBootstrap,
  hasLocalBootstrap,
  initializeLocalMetadata,
  issueCount,
  localOutboxChangedEvent,
  markOperationsForRetry,
  markOperationsSending,
  pendingOperationCount,
  pendingOperations,
  readLocalMetadata,
  recoverInterruptedOperations,
  retryPendingOperationsNow,
  syncClientId,
  updateLocalAuthToken,
} from '@/lib/localDatabase'
import type {
  SyncBootstrapResponse,
  SyncExchangeResponse,
  SyncPhase,
  SyncStatusSnapshot,
} from '@/types/sync'
import {
  ACTIVE_SYNC_PULL_INTERVAL_MS,
  nextSyncPullDelay,
} from '@/services/syncPolling'

const baseUrl = (import.meta.env.VITE_API_URL || '/api').replace(/\/+$/, '')
const STATUS_EVENT = 'mom-sync-status-changed'

export const offlineSyncStatus = reactive<SyncStatusSnapshot>({
  phase: 'idle',
  pendingCount: 0,
  issueCount: 0,
  lastSyncedAt: '',
  message: '',
})

let started = false
let currentAccountId = ''
let syncPromise: Promise<boolean> | undefined
let retryTimer: number | undefined
let pullTimer: number | undefined
let retryAttempt = 0
let pullDelay = ACTIVE_SYNC_PULL_INTERVAL_MS
let lastSyncHadActivity = false
let removeAuthListener: (() => void) | undefined
let removeNetworkListener: Awaited<ReturnType<typeof Network.addListener>> | undefined
let removeAppListener: Awaited<ReturnType<typeof App.addListener>> | undefined

function setStatus(phase: SyncPhase, message = '') {
  offlineSyncStatus.phase = phase
  offlineSyncStatus.message = message
  window.dispatchEvent(new CustomEvent(STATUS_EVENT, { detail: { ...offlineSyncStatus } }))
}

async function refreshCounts() {
  if (!currentAccountId) {
    offlineSyncStatus.pendingCount = 0
    offlineSyncStatus.issueCount = 0
    offlineSyncStatus.lastSyncedAt = ''
    return
  }
  const [pending, issues, metadata] = await Promise.all([
    pendingOperationCount(currentAccountId),
    issueCount(currentAccountId),
    readLocalMetadata(currentAccountId),
  ])
  offlineSyncStatus.pendingCount = pending
  offlineSyncStatus.issueCount = issues
  offlineSyncStatus.lastSyncedAt = metadata?.lastSyncedAt || ''
  if (issues) setStatus('attention', `${issues} synchronization issue${issues === 1 ? '' : 's'} need attention.`)
}

export async function startOfflineSync() {
  if (started) return
  started = true
  removeAuthListener = api.authStore.onChange((_token, record) => {
    void switchAccount(record?.id || '')
  }, true)
  window.addEventListener(localOutboxChangedEvent, handleOutboxChanged)
  window.addEventListener('online', handleReconnect)
  window.addEventListener('focus', handleReconnect)
  window.addEventListener('pointerdown', handleUserActivity, { passive: true })
  window.addEventListener('keydown', handleUserActivity)
  document.addEventListener('visibilitychange', handleVisibilityChange)

  if (Capacitor.isNativePlatform()) {
    removeNetworkListener = await Network.addListener('networkStatusChange', status => {
      if (status.connected) void syncNow('connectivity')
      else setStatus('offline', 'Changes are saved on this device.')
    })
    removeAppListener = await App.addListener('appStateChange', state => {
      if (state.isActive) void syncNow('resume')
    })
  }
  scheduleActivePull()
}

export async function stopOfflineSync() {
  started = false
  removeAuthListener?.()
  await removeNetworkListener?.remove()
  await removeAppListener?.remove()
  window.removeEventListener(localOutboxChangedEvent, handleOutboxChanged)
  window.removeEventListener('online', handleReconnect)
  window.removeEventListener('focus', handleReconnect)
  window.removeEventListener('pointerdown', handleUserActivity)
  window.removeEventListener('keydown', handleUserActivity)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  if (retryTimer !== undefined) window.clearTimeout(retryTimer)
  if (pullTimer !== undefined) window.clearTimeout(pullTimer)
}

async function switchAccount(accountId: string) {
  currentAccountId = accountId
  retryAttempt = 0
  if (!accountId) {
    setStatus('idle')
    await refreshCounts()
    return
  }
  await initializeLocalMetadata(accountId)
  await refreshCounts()
  void syncNow('account')
}

function handleOutboxChanged(event: Event) {
  const accountId = (event as CustomEvent<{ accountId?: string }>).detail?.accountId
  if (accountId && accountId !== currentAccountId) return
  void refreshCounts()
  void registerWebBackgroundSync()
  void syncNow('mutation')
}

function handleReconnect() {
  void syncNow('connectivity')
}

function handleVisibilityChange() {
  if (document.visibilityState === 'visible') void syncNow('visibility')
}

function scheduleActivePull() {
  if (pullTimer !== undefined) window.clearTimeout(pullTimer)
  if (!started) return
  pullTimer = window.setTimeout(async () => {
    pullTimer = undefined
    if (document.visibilityState === 'visible') {
      await syncNow('poll')
      pullDelay = nextSyncPullDelay(pullDelay, lastSyncHadActivity)
    }
    scheduleActivePull()
  }, pullDelay)
}

function handleUserActivity() {
  if (pullDelay === ACTIVE_SYNC_PULL_INTERVAL_MS) return
  resetPullCadence()
}

function resetPullCadence() {
  pullDelay = ACTIVE_SYNC_PULL_INTERVAL_MS
  scheduleActivePull()
}

export function syncNow(reason = 'manual') {
  if (reason !== 'poll' && reason !== 'retry') resetPullCadence()
  if (syncPromise) return syncPromise
  syncPromise = performSync().finally(() => {
    syncPromise = undefined
  })
  return syncPromise
}

export async function flushBeforeSignOut(accountId: string) {
  await recoverInterruptedOperations(accountId)
  await retryPendingOperationsNow(accountId)
  await syncNow('sign-out')
  await refreshCounts()
  const [pending, issues] = await Promise.all([
    pendingOperationCount(accountId),
    issueCount(accountId),
  ])
  return pending + issues
}

export async function clearBackgroundSyncStage() {
  if (!Capacitor.isNativePlatform()) return
  try {
    await removeBackgroundSyncStage()
  } catch {
    // The account database is still erased; an empty idempotent batch cannot be restaged.
  }
}

export async function clearOfflineMediaCache() {
  if (!('caches' in window)) return
  await caches.delete('polymind-media-v1')
}

async function performSync() {
  const accountId = currentAccountId || api.authStore.record?.id || ''
  lastSyncHadActivity = false
  if (!accountId) return false
  currentAccountId = accountId
  await initializeLocalMetadata(accountId)
  await recoverInterruptedOperations(accountId)
  await refreshCounts()

  if (!api.authStore.token || !api.authStore.isValid) {
    const bootstrapped = await hasLocalBootstrap(accountId)
    setStatus(bootstrapped ? 'auth-required' : 'offline', bootstrapped
      ? 'Sign in to resume synchronization. Your changes remain on this device.'
      : 'Connect and sign in once to finish preparing offline access.')
    return false
  }

  await updateLocalAuthToken(accountId, api.authStore.token, `${baseUrl}/sync/exchange`)
  await stageNativeBackgroundBatch(accountId)

  if (!navigator.onLine) {
    setStatus('offline', 'Changes are saved on this device.')
    return false
  }

  try {
    if (!await hasLocalBootstrap(accountId)) {
      setStatus('hydrating', 'Preparing offline data…')
      await bootstrap(accountId)
    }
    setStatus('syncing', offlineSyncStatus.pendingCount ? 'Sending saved changes…' : 'Checking for changes…')
    let hasMore = true
    let loops = 0
    while (hasMore && loops < 20) {
      const result = await exchange(accountId)
      hasMore = result.hasMore
      lastSyncHadActivity ||= result.hadActivity
      loops += 1
    }
    retryAttempt = 0
    await refreshCounts()
    if (!offlineSyncStatus.issueCount) setStatus('synced')
    return true
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Synchronization failed.'
    if (cause instanceof SyncAuthenticationError) {
      api.authStore.expireToken()
      setStatus('auth-required', 'Sign in to resume synchronization. Your changes remain on this device.')
      return false
    }
    setStatus('offline', 'Changes are saved on this device and will retry automatically.')
    retryAttempt += 1
    const delay = retryDelay(retryAttempt)
    scheduleRetry(delay)
    if (import.meta.env.DEV) console.warn('[offline-sync]', message)
    return false
  }
}

async function bootstrap(accountId: string) {
  const response = await syncRequest<SyncBootstrapResponse>('/sync/bootstrap', {
    clientId: syncClientId(),
  })
  await completeLocalBootstrap(accountId, response.watermark, response.resources)
  void warmMediaCache(response.resources)
}

async function warmMediaCache(resources: SyncBootstrapResponse['resources']) {
  if (!('caches' in window)) return
  const urls = new Set<string>()
  const add = (value: unknown) => {
    if (typeof value !== 'string' || !value) return
    if (/^(?:data:|blob:)/i.test(value)) return
    if (/^https?:\/\//i.test(value)) urls.add(value)
    else if (value.startsWith('/')) urls.add(`${baseUrl}${value}`)
  }
  for (const resource of resources) {
    const data = resource.data
    if (!data) continue
    add(data.avatar)
    if (typeof data.image_file === 'string' && data.image_file) {
      add(`/flashcard-images/${data.image_file}`)
    } else {
      add(data.image_url)
    }
    const cards = Array.isArray(data.queue_state)
      ? data.queue_state
      : Array.isArray(data.cards)
        ? data.cards
        : []
    cards.forEach(card => add(card?.image))
  }
  const cache = await caches.open('polymind-media-v1')
  await Promise.allSettled([...urls].map(async url => {
    const request = new Request(url, { mode: new URL(url, location.href).origin === location.origin ? 'same-origin' : 'no-cors' })
    if (await cache.match(request)) return
    const response = await fetch(request)
    if (response.ok || response.type === 'opaque') await cache.put(request, response)
  }))
}

async function exchange(accountId: string) {
  const metadata = await initializeLocalMetadata(accountId)
  const operations = await pendingOperations(accountId)
  const operationIds = operations.map(operation => operation.operationId)
  if (operationIds.length) await markOperationsSending(operationIds)
  try {
    const response = await syncRequest<SyncExchangeResponse>('/sync/exchange', {
      clientId: metadata.clientId,
      cursor: metadata.cursor,
      operations: operations.map(operation => ({
        operationId: operation.operationId,
        transactionId: operation.transactionId,
        resource: operation.resource,
        recordId: operation.recordId,
        kind: operation.kind,
        payload: operation.payload,
        fieldClocks: operation.fieldClocks,
        dependsOn: operation.dependsOn,
      })),
    })
    if (response.resetRequired) {
      await bootstrap(accountId)
      return { hasMore: true, hadActivity: true }
    }
    await applyExchangeResults(
      accountId,
      response.cursor,
      response.serverTime,
      response.acknowledgements,
      response.changes,
    )
    await stageNativeBackgroundBatch(accountId)
    return {
      hasMore: response.hasMore,
      hadActivity: operations.length > 0
        || response.acknowledgements.length > 0
        || response.changes.length > 0,
    }
  } catch (cause) {
    if (operationIds.length) {
      const attempt = Math.max(1, ...operations.map(operation => operation.attempts + 1))
      await markOperationsForRetry(
        operationIds,
        retryDelay(attempt),
        cause instanceof Error ? cause.message : 'Synchronization failed.',
      )
    }
    throw cause
  }
}

async function stageNativeBackgroundBatch(accountId: string) {
  if (!Capacitor.isNativePlatform() || !api.authStore.token) return
  const [metadata, operations] = await Promise.all([
    initializeLocalMetadata(accountId),
    pendingOperations(accountId),
  ])
  try {
    await writeBackgroundSyncStage({
      url: `${baseUrl}/sync/exchange`,
      token: api.authStore.token,
      clientId: metadata.clientId,
      cursor: metadata.cursor,
      operations: operations.map(operation => ({
        operationId: operation.operationId,
        transactionId: operation.transactionId,
        resource: operation.resource,
        recordId: operation.recordId,
        kind: operation.kind,
        payload: operation.payload,
        fieldClocks: operation.fieldClocks,
        dependsOn: operation.dependsOn,
      })),
    })
  } catch {
    // Background scheduling is opportunistic; foreground sync remains authoritative.
  }
}

async function registerWebBackgroundSync() {
  if (Capacitor.isNativePlatform() || !('serviceWorker' in navigator)) return
  try {
    const registration = await navigator.serviceWorker.ready
    await (registration as ServiceWorkerRegistration & {
      sync?: { register(tag: string): Promise<void> }
    }).sync?.register('polymind-sync')
  } catch {
    // Unsupported browsers retry on the next focus, online event, or app open.
  }
}

async function syncRequest<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 15_000)
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${api.authStore.token}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const payload = await response.json().catch(() => ({}))
    if (response.status === 401) throw new SyncAuthenticationError()
    if (!response.ok) {
      throw new Error(typeof payload.message === 'string'
        ? payload.message
        : `Synchronization failed (${response.status}).`)
    }
    return payload as T
  } finally {
    window.clearTimeout(timeout)
  }
}

function retryDelay(attempt: number) {
  const base = Math.min(300_000, 1_000 * 2 ** Math.min(attempt, 8))
  return Math.round(base * (0.75 + Math.random() * 0.5))
}

function scheduleRetry(delay: number) {
  if (retryTimer !== undefined) window.clearTimeout(retryTimer)
  retryTimer = window.setTimeout(() => void syncNow('retry'), delay)
}

class SyncAuthenticationError extends Error {}

export const syncStatusChangedEvent = STATUS_EVENT
