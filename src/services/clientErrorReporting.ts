import packageMetadata from '../../package.json'

type ClientErrorType = 'javascript' | 'network'

interface QueuedClientError {
  key: string
  type: ClientErrorType
  message: string
  source: string
  method: string
  status: number | null
  stack: string
  count: number
  firstOccurredAt: string
  lastOccurredAt: string
}

interface ErrorReportingOptions {
  getAuthToken: () => string
  platform: string
}

const STORAGE_KEY = 'backontrack-client-errors'
const FLUSH_INTERVAL_MS = 15 * 60 * 1000
const MAX_QUEUED_ERRORS = 250
const MAX_BATCH_SIZE = 25
const MAX_KEEPALIVE_BYTES = 55_000
const apiBaseUrl = (import.meta.env.VITE_API_URL || '/api').replace(/\/+$/, '')
const reportUrl = `${apiBaseUrl}/client-errors`

let installed = false
let flushPromise: Promise<void> | null = null
let nativeFetch: typeof window.fetch | null = null
let options: ErrorReportingOptions | null = null
const queue = new Map<string, QueuedClientError>()

function truncate(value: string, maximum: number) {
  return value.length <= maximum ? value : value.slice(0, maximum)
}

function sanitizeText(value: string, maximum: number) {
  return truncate(value.replace(/(https?:\/\/[^\s?#]+)(?:\?[^\s#]*)?(?:#[^\s]*)?/gi, '$1'), maximum)
}

function sanitizeUrl(value: string) {
  try {
    const url = new URL(value, window.location.href)
    if (!['http:', 'https:'].includes(url.protocol)) return truncate(url.protocol, 32)
    return truncate(url.origin === window.location.origin ? url.pathname : `${url.origin}${url.pathname}`, 1000)
  } catch {
    return sanitizeText(value.split(/[?#]/, 1)[0] || '', 1000)
  }
}

function errorMessage(value: unknown) {
  if (value instanceof Error) return value.message || value.name
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function errorStack(value: unknown) {
  return value instanceof Error && typeof value.stack === 'string'
    ? sanitizeText(value.stack, 4000)
    : ''
}

function persistQueue() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...queue.values()]))
  } catch {
    // Error reporting remains available in memory when persistent storage is unavailable.
  }
}

function restoreQueue() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    if (!Array.isArray(stored)) return
    for (const candidate of stored.slice(-MAX_QUEUED_ERRORS)) {
      if (
        !candidate
        || typeof candidate.key !== 'string'
        || !['javascript', 'network'].includes(candidate.type)
        || typeof candidate.message !== 'string'
        || typeof candidate.count !== 'number'
      ) continue
      queue.set(candidate.key, candidate as QueuedClientError)
    }
  } catch {
    // Ignore corrupted or inaccessible diagnostics from an older session.
  }
}

function recordError(error: Omit<QueuedClientError, 'key' | 'count' | 'firstOccurredAt' | 'lastOccurredAt'>) {
  const normalized = {
    ...error,
    message: sanitizeText(error.message || 'Unknown error', 1000),
    source: sanitizeText(error.source, 1000),
    method: truncate(error.method.toUpperCase(), 12),
    stack: sanitizeText(error.stack, 4000),
  }
  const key = JSON.stringify([
    normalized.type,
    normalized.message,
    normalized.source,
    normalized.method,
    normalized.status,
  ])
  const now = new Date().toISOString()
  const existing = queue.get(key)
  if (existing) {
    existing.count += 1
    existing.lastOccurredAt = now
  } else {
    if (queue.size >= MAX_QUEUED_ERRORS) {
      const oldest = queue.keys().next().value
      if (typeof oldest === 'string') queue.delete(oldest)
    }
    queue.set(key, {
      key,
      ...normalized,
      count: 1,
      firstOccurredAt: now,
      lastOccurredAt: now,
    })
  }
  persistQueue()
}

function requestDetails(input: RequestInfo | URL, init?: RequestInit) {
  const request = input instanceof Request ? input : null
  const rawUrl = request?.url || String(input)
  return {
    rawUrl,
    source: sanitizeUrl(rawUrl),
    method: init?.method || request?.method || 'GET',
  }
}

function isReportRequest(rawUrl: string) {
  try {
    return new URL(rawUrl, window.location.href).href === new URL(reportUrl, window.location.href).href
  } catch {
    return false
  }
}

function installFetchObserver() {
  nativeFetch = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = requestDetails(input, init)
    if (isReportRequest(request.rawUrl)) return nativeFetch!(input, init)
    try {
      const response = await nativeFetch!(input, init)
      if (!response.ok && response.type !== 'opaque') {
        const status = response.status || null
        recordError({
          type: 'network',
          message: status === null
            ? 'Network request returned an error response.'
            : `HTTP request failed (${status}).`,
          source: request.source,
          method: request.method,
          status,
          stack: '',
        })
      }
      return response
    } catch (cause) {
      recordError({
        type: 'network',
        message: `Network request failed: ${errorMessage(cause)}`,
        source: request.source,
        method: request.method,
        status: null,
        stack: errorStack(cause),
      })
      throw cause
    }
  }
}

function handleWindowError(event: ErrorEvent | Event) {
  if (event instanceof ErrorEvent) {
    const source = event.filename
      ? `${sanitizeUrl(event.filename)}:${event.lineno || 0}:${event.colno || 0}`
      : 'window.error'
    recordError({
      type: 'javascript',
      message: event.message || errorMessage(event.error),
      source,
      method: '',
      status: null,
      stack: errorStack(event.error),
    })
    return
  }

  const target = event.target
  if (!(target instanceof HTMLElement)) return
  const resourceUrl = target instanceof HTMLImageElement || target instanceof HTMLMediaElement
    ? target.currentSrc || target.src
    : target instanceof HTMLScriptElement
      ? target.src
      : target instanceof HTMLLinkElement
        ? target.href
        : ''
  if (!resourceUrl) return
  recordError({
    type: 'network',
    message: 'Resource failed to load.',
    source: sanitizeUrl(resourceUrl),
    method: 'GET',
    status: null,
    stack: '',
  })
}

function handleUnhandledRejection(event: PromiseRejectionEvent) {
  recordJavaScriptError(event.reason, 'unhandledrejection')
}

export function recordJavaScriptError(cause: unknown, source = 'javascript') {
  recordError({
    type: 'javascript',
    message: errorMessage(cause),
    source,
    method: '',
    status: null,
    stack: errorStack(cause),
  })
}

export function flushClientErrors() {
  if (flushPromise) return flushPromise
  if (!nativeFetch || !options || queue.size === 0) return Promise.resolve()
  const token = options.getAuthToken()
  if (!token) return Promise.resolve()

  const pending: QueuedClientError[] = []
  let body = ''
  for (const candidate of [...queue.values()].slice(0, MAX_BATCH_SIZE)) {
    const next = [...pending, candidate]
    const candidateBody = reportBody(next)
    if (pending.length && new TextEncoder().encode(candidateBody).byteLength > MAX_KEEPALIVE_BYTES) break
    pending.push(candidate)
    body = candidateBody
  }
  flushPromise = nativeFetch(reportUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body,
    keepalive: true,
  }).then(response => {
    if (!response.ok) return
    for (const sent of pending) {
      const current = queue.get(sent.key)
      if (!current) continue
      if (current.count <= sent.count) queue.delete(sent.key)
      else {
        current.count -= sent.count
        current.firstOccurredAt = current.lastOccurredAt
      }
    }
    persistQueue()
  }).catch(() => {
    // Keep the batch for the next interval or lifecycle flush.
  }).finally(() => {
    flushPromise = null
  })
  return flushPromise
}

function reportBody(errors: QueuedClientError[]) {
  return JSON.stringify({
    platform: options?.platform || 'unknown',
    appVersion: packageMetadata.version,
    errors: errors.map(({ key: _key, ...error }) => error),
  })
}

export function installClientErrorReporting(configuration: ErrorReportingOptions) {
  if (installed) return
  installed = true
  options = configuration
  restoreQueue()
  installFetchObserver()
  window.addEventListener('error', handleWindowError, true)
  window.addEventListener('unhandledrejection', handleUnhandledRejection)
  window.addEventListener('pagehide', () => void flushClientErrors())
  window.setInterval(() => void flushClientErrors(), FLUSH_INTERVAL_MS)
}
