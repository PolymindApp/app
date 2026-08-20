/// <reference lib="webworker" />

import Dexie from 'dexie'
import type { SyncMetadata, SyncOperation } from '@/types/sync'

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision?: string }>
}

const CACHE_NAME = 'backontrack-shell-v8'
const MEDIA_CACHE_NAME = 'backontrack-media-v2'
const precacheUrls = self.__WB_MANIFEST.map(entry => new URL(entry.url, self.location.origin).pathname)

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(precacheUrls)))
  void self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(key => key !== CACHE_NAME && key !== MEDIA_CACHE_NAME)
        .map(key => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', event => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET') return
  const mediaRequest = request.destination === 'image'
    || /\/(?:avatars|journal-images)\/[a-f0-9]{48}\.jpg$/i.test(url.pathname)
  if (mediaRequest) {
    event.respondWith(staleWhileRevalidate(request, MEDIA_CACHE_NAME))
    return
  }
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(async response => {
          const cache = await caches.open(CACHE_NAME)
          await cache.put('/index.html', response.clone())
          return response
        })
        .catch(async () => (await caches.match(request)) || (await caches.match('/index.html')) || Response.error()),
    )
    return
  }

  if (/\.(?:js|css|png|svg|jpe?g|webmanifest|mp3)$/i.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request, CACHE_NAME))
  }
})

async function staleWhileRevalidate(request: Request, cacheName: string) {
  const cached = await caches.match(request)
  const network = fetch(request).then(async response => {
    if (response.ok || response.type === 'opaque') {
      const cache = await caches.open(cacheName)
      await cache.put(request, response.clone())
    }
    return response
  }).catch(() => undefined)
  return cached || await network || Response.error()
}

self.addEventListener('sync', (event: Event) => {
  const syncEvent = event as Event & { tag?: string; waitUntil(promise: Promise<unknown>): void }
  if (syncEvent.tag === 'backontrack-sync') syncEvent.waitUntil(runBackgroundSync())
})

self.addEventListener('push', event => {
  let payload: Record<string, unknown> = {}
  try {
    payload = event.data?.json() as Record<string, unknown> || {}
  } catch {
    payload = {}
  }
  const title = typeof payload.title === 'string' ? payload.title : 'Task reminder'
  const body = typeof payload.body === 'string' ? payload.body : 'You have a task due.'
  const url = typeof payload.url === 'string' && payload.url.startsWith('/')
    ? payload.url
    : '/tasks'
  const tag = typeof payload.tag === 'string' ? payload.tag : 'backontrack-task-reminder'
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: '/brand/backontrack-mark.png',
    badge: '/brand/backontrack-mark.png',
    tag,
    data: { url },
  }))
})

async function runBackgroundSync() {
  const database = new Dexie('backontrack-offline')
  database.version(1).stores({
    outbox: '&operationId,[accountId+status],accountId,status,sequence,nextAttemptAt,[accountId+resource+recordId]',
    metadata: '&accountId,clientId',
  })
  await database.open()
  const metadataTable = database.table<SyncMetadata>('metadata')
  const outboxTable = database.table<SyncOperation>('outbox')
  const metadataRows = await metadataTable.toArray()
  for (const metadata of metadataRows) {
    if (!metadata.bootstrapped || !metadata.authToken) continue
    const operations = (await outboxTable
      .where('[accountId+status]')
      .equals([metadata.accountId, 'pending'])
      .sortBy('sequence'))
      .slice(0, 100)
    if (!operations.length) continue
    if (!metadata.syncUrl) continue
    const dispatchedAt = new Date().toISOString()
    await outboxTable.where('operationId').anyOf(operations.map(operation => operation.operationId))
      .modify(operation => {
        operation.dispatchedAt ||= dispatchedAt
      })
    await fetch(metadata.syncUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${metadata.authToken}`,
      },
      body: JSON.stringify({
        clientId: metadata.clientId,
        cursor: metadata.cursor,
        confirmedReceiptSequence: metadata.confirmedReceiptSequence,
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
      }),
    })
  }
  database.close()
}

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const route = typeof event.notification.data?.url === 'string'
    && event.notification.data.url.startsWith('/')
    ? event.notification.data.url
    : '/intervals'
  const targetUrl = new URL(route, self.location.origin).href
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const existing = clients.find(client => 'focus' in client)
      if (existing && 'navigate' in existing) {
        return existing.navigate(targetUrl).then(client => client?.focus())
      }
      return self.clients.openWindow(targetUrl)
    }),
  )
})
