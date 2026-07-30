type RecordModel = Record<string, any> & { id: string }
type AuthRecord = RecordModel & { email: string; name?: string }
type AuthListener = (token: string, record: AuthRecord | null) => void

interface ListOptions {
  filter?: string
  sort?: string
}

interface ListResult<T> {
  page: number
  perPage: number
  totalItems: number
  totalPages: number
  items: T[]
}

interface AuthResponse {
  token: string
  record: AuthRecord
}

interface PasskeyOptionsResponse {
  ceremonyId: string
  requestJson: string
}

interface UserSettingsResponse {
  settings: Record<string, unknown>
  updated?: string
}

const AUTH_STORAGE_KEY = 'mom-api-auth'
const baseUrl = (import.meta.env.VITE_API_URL || '/api').replace(/\/+$/, '')

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

class AuthStore {
  token = ''
  record: AuthRecord | null = null
  private listeners = new Set<AuthListener>()

  constructor() {
    this.restore()
  }

  get isValid() {
    if (!this.token || !this.record) return false
    const expiration = tokenExpiration(this.token)
    return expiration !== undefined && expiration > Date.now() / 1000
  }

  save(token: string, record: AuthRecord) {
    this.token = token
    this.record = record
    try {
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ token, record }))
    } catch {
      // Authentication remains available for the current page session.
    }
    this.notify()
  }

  clear() {
    this.token = ''
    this.record = null
    try {
      localStorage.removeItem(AUTH_STORAGE_KEY)
    } catch {
      // Storage may be unavailable in privacy-restricted contexts.
    }
    this.notify()
  }

  onChange(listener: AuthListener, fireImmediately = false) {
    this.listeners.add(listener)
    if (fireImmediately) listener(this.token, this.record)
    return () => this.listeners.delete(listener)
  }

  private restore() {
    try {
      const saved = JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) || '')
      if (saved?.token && saved?.record) {
        this.token = saved.token
        this.record = saved.record
      }
      if (!this.isValid) {
        this.token = ''
        this.record = null
        localStorage.removeItem(AUTH_STORAGE_KEY)
      }
    } catch {
      this.token = ''
      this.record = null
    }
  }

  private notify() {
    for (const listener of this.listeners) {
      listener(this.token, this.record)
    }
  }
}

class CollectionClient<T extends RecordModel = RecordModel> {
  constructor(
    private readonly name: string,
    private readonly authStore: AuthStore,
  ) {}

  async authWithPassword(email: string, password: string) {
    if (this.name !== 'users') throw new ApiError(400, 'This collection does not support authentication.')
    const response = await request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: { email, password },
    }, this.authStore)
    this.authStore.save(response.token, response.record)
    return response
  }

  async getFullList(options: ListOptions = {}) {
    const records: T[] = []
    let page = 1
    let totalPages = 1
    do {
      const result = await this.getList(page, 200, options)
      records.push(...result.items)
      totalPages = result.totalPages
      page += 1
    } while (page <= totalPages)
    return records
  }

  getList(page = 1, perPage = 30, options: ListOptions = {}) {
    const query = new URLSearchParams({
      page: String(page),
      perPage: String(perPage),
    })
    if (options.filter) query.set('filter', options.filter)
    if (options.sort) query.set('sort', options.sort)
    return request<ListResult<T>>(
      `/collections/${encodeURIComponent(this.name)}/records?${query}`,
      {},
      this.authStore,
    )
  }

  getOne(id: string) {
    return request<T>(
      `/collections/${encodeURIComponent(this.name)}/records/${encodeURIComponent(id)}`,
      {},
      this.authStore,
    )
  }

  create(body: Record<string, unknown>) {
    if (this.name === 'users') {
      return request<T>('/auth/register', { method: 'POST', body }, this.authStore)
    }
    return request<T>(
      `/collections/${encodeURIComponent(this.name)}/records`,
      { method: 'POST', body },
      this.authStore,
    )
  }

  update(id: string, body: Record<string, unknown>) {
    return request<T>(
      `/collections/${encodeURIComponent(this.name)}/records/${encodeURIComponent(id)}`,
      { method: 'PATCH', body },
      this.authStore,
    )
  }

  async delete(id: string) {
    await request<void>(
      `/collections/${encodeURIComponent(this.name)}/records/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
      this.authStore,
    )
    return true
  }
}

class ApiClient {
  readonly authStore = new AuthStore()

  collection<T extends RecordModel = RecordModel>(name: string) {
    return new CollectionClient<T>(name, this.authStore)
  }

  autoCancellation(_enabled: boolean) {
    // Kept as a no-op so existing store initialization remains compatible.
  }

  beginPasskeyRegistration() {
    return request<PasskeyOptionsResponse>(
      '/auth/passkeys/register/options',
      { method: 'POST', body: {} },
      this.authStore,
    )
  }

  finishPasskeyRegistration(ceremonyId: string, credential: Record<string, unknown>) {
    return request<{ registered: true; credentialId: string }>(
      '/auth/passkeys/register/verify',
      { method: 'POST', body: { ceremonyId, credential } },
      this.authStore,
    )
  }

  getPasskeyStatus() {
    return request<{ registered: boolean }>(
      '/auth/passkeys/status',
      {},
      this.authStore,
    )
  }

  beginPasskeyLogin() {
    return request<PasskeyOptionsResponse>(
      '/auth/passkeys/login/options',
      { method: 'POST', body: {} },
      this.authStore,
    )
  }

  async finishPasskeyLogin(ceremonyId: string, credential: Record<string, unknown>) {
    const response = await request<AuthResponse>(
      '/auth/passkeys/login/verify',
      { method: 'POST', body: { ceremonyId, credential } },
      this.authStore,
    )
    this.authStore.save(response.token, response.record)
    return response
  }

  async updateAccount(name: string) {
    const record = await request<AuthRecord>(
      '/auth/account',
      { method: 'PATCH', body: { name } },
      this.authStore,
    )
    this.authStore.save(this.authStore.token, record)
    return record
  }

  async getUserSettings() {
    const response = await request<UserSettingsResponse>(
      '/auth/settings',
      {},
      this.authStore,
    )
    this.saveUserSettings(response)
    return response.settings
  }

  async updateUserSettings(settings: Record<string, unknown>) {
    const response = await request<UserSettingsResponse>(
      '/auth/settings',
      { method: 'PATCH', body: settings },
      this.authStore,
    )
    this.saveUserSettings(response)
    return response.settings
  }

  private saveUserSettings(response: UserSettingsResponse) {
    const record = this.authStore.record
    if (!record) return
    this.authStore.save(this.authStore.token, {
      ...record,
      settings: response.settings,
      updated: response.updated || record.updated,
    })
  }
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown },
  authStore: AuthStore,
): Promise<T> {
  const headers = new Headers({ Accept: 'application/json' })
  if (options.body !== undefined) headers.set('Content-Type', 'application/json')
  if (authStore.token) headers.set('Authorization', `Bearer ${authStore.token}`)

  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  if (response.status === 204) return undefined as T

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    if (response.status === 401) authStore.clear()
    throw new ApiError(
      response.status,
      typeof payload.message === 'string' ? payload.message : `API request failed (${response.status}).`,
      payload.details && typeof payload.details === 'object' ? payload.details : {},
    )
  }
  return payload as T
}

function tokenExpiration(token: string) {
  try {
    const encoded = token.split('.')[1]
    if (!encoded) return undefined
    const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/')
    const padding = '='.repeat((4 - normalized.length % 4) % 4)
    const payload = JSON.parse(atob(normalized + padding))
    return typeof payload.exp === 'number' ? payload.exp : undefined
  } catch {
    return undefined
  }
}

export const api = new ApiClient()
api.autoCancellation(false)
