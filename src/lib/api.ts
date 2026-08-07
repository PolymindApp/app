import type {
  FlashcardBulkAction,
  FlashcardImportRow,
  FlashcardReviewAction,
  FlashcardReviewSetAccessRole,
  FlashcardReviewSettings,
} from '@/types/domain'

type RecordModel = Record<string, any> & { id: string }
type AuthRecord = RecordModel & { email: string; name?: string; avatar?: string }
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

interface CompleteIntervalSessionResponse {
  session: RecordModel
  occurrence: RecordModel | null
}

interface FlashcardReviewActionResponse {
  session: RecordModel
  occurrence: RecordModel | null
}

interface FlashcardImportResponse {
  cards: RecordModel[]
  tags: RecordModel[]
}

interface FlashcardBulkActionResponse {
  cards: RecordModel[]
  deleted_ids: string[]
}

const AUTH_STORAGE_KEY = 'mom-api-auth'
const baseUrl = (import.meta.env.VITE_API_URL || '/api').replace(/\/+$/, '')

export function apiAssetUrl(value: string) {
  if (!value || /^(?:https?:|blob:|data:)/i.test(value)) return value
  return value.startsWith('/') ? `${baseUrl}${value}` : value
}

function flashcardReviewSettingsBody(settings: FlashcardReviewSettings) {
  return {
    mode: settings.mode,
    card_sides: settings.cardSides,
    indefinite: settings.mode === 'passive' && settings.indefinite,
    max_cards: settings.maxCards,
    front_seconds: settings.frontSeconds,
    back_seconds: settings.backSeconds,
    back_speech_repeat_count: settings.backSpeechRepeatCount,
    speech_enabled: settings.speechEnabled,
    front_language: settings.frontLanguage,
    back_language: settings.backLanguage,
    sort_mode: settings.sortMode,
  }
}

function normalizeAuthRecord(record: AuthRecord): AuthRecord {
  const avatar = typeof record.avatar === 'string' ? record.avatar : ''
  if (
    !avatar
    || /^https?:\/\//i.test(avatar)
    || avatar.startsWith(`${baseUrl}/`)
  ) {
    return { ...record, avatar }
  }
  return {
    ...record,
    avatar: avatar.startsWith('/avatars/') ? apiAssetUrl(avatar) : avatar,
  }
}

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
    const normalized = normalizeAuthRecord(record)
    this.token = token
    this.record = normalized
    try {
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ token, record: normalized }))
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
        this.record = normalizeAuthRecord(saved.record)
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

  removePasskeys() {
    return request<{ registered: false; removed: number }>(
      '/auth/passkeys',
      { method: 'DELETE' },
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

  async updateAvatar(image: Blob) {
    if (image.type !== 'image/jpeg') {
      throw new ApiError(422, 'The avatar must be compressed as a JPEG.')
    }
    const record = await request<AuthRecord>(
      '/auth/avatar',
      { method: 'POST', body: { image: await blobDataUrl(image) } },
      this.authStore,
    )
    this.authStore.save(this.authStore.token, record)
    return record
  }

  async removeAvatar() {
    const record = await request<AuthRecord>(
      '/auth/avatar',
      { method: 'DELETE' },
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

  completeIntervalSession(
    sessionId: string,
    input: {
      runtimeState: unknown
      elapsedSeconds: number
      endedAt: string
    },
  ) {
    return request<CompleteIntervalSessionResponse>(
      `/interval-sessions/${encodeURIComponent(sessionId)}/complete`,
      {
        method: 'POST',
        body: {
          runtime_state: input.runtimeState,
          elapsed_seconds: input.elapsedSeconds,
          ended_at: input.endedAt,
        },
      },
      this.authStore,
    )
  }

  startFlashcardReviewSession(
    reviewSetId: string,
    input: { task?: string; programStep?: string; taskDate?: string } = {},
  ) {
    return request<RecordModel>(
      `/flashcard-review-sets/${encodeURIComponent(reviewSetId)}/sessions`,
      {
        method: 'POST',
        body: {
          task: input.task || '',
          program_step: input.programStep || '',
          task_date: input.taskDate || '',
        },
      },
      this.authStore,
    )
  }

  importFlashcards(rows: FlashcardImportRow[]) {
    return request<FlashcardImportResponse>(
      '/flashcards/import',
      { method: 'POST', body: { rows } },
      this.authStore,
    )
  }

  bulkUpdateFlashcards(action: FlashcardBulkAction, cardIds: string[], tagIds: string[] = []) {
    return request<FlashcardBulkActionResponse>(
      '/flashcards/bulk',
      {
        method: 'POST',
        body: { action, card_ids: cardIds, tag_ids: tagIds },
      },
      this.authStore,
    )
  }

  getAccessibleFlashcardReviewSets() {
    return request<RecordModel[]>('/flashcard-review-sets', {}, this.authStore)
  }

  updateFlashcardReviewSetPreferences(reviewSetId: string, settings: FlashcardReviewSettings) {
    return request<RecordModel>(
      `/flashcard-review-sets/${encodeURIComponent(reviewSetId)}/preferences`,
      { method: 'PATCH', body: flashcardReviewSettingsBody(settings) },
      this.authStore,
    )
  }

  getFlashcardReviewSetShares(reviewSetId: string) {
    return request<RecordModel[]>(
      `/flashcard-review-sets/${encodeURIComponent(reviewSetId)}/shares`,
      {},
      this.authStore,
    )
  }

  createFlashcardReviewSetShare(
    reviewSetId: string,
    email: string,
    role: Exclude<FlashcardReviewSetAccessRole, 'owner'>,
  ) {
    return request<RecordModel>(
      `/flashcard-review-sets/${encodeURIComponent(reviewSetId)}/shares`,
      { method: 'POST', body: { email, role } },
      this.authStore,
    )
  }

  updateFlashcardReviewSetShare(
    shareId: string,
    role: Exclude<FlashcardReviewSetAccessRole, 'owner'>,
  ) {
    return request<RecordModel>(
      `/flashcard-review-set-shares/${encodeURIComponent(shareId)}`,
      { method: 'PATCH', body: { role } },
      this.authStore,
    )
  }

  removeFlashcardReviewSetShare(shareId: string) {
    return request<void>(
      `/flashcard-review-set-shares/${encodeURIComponent(shareId)}`,
      { method: 'DELETE' },
      this.authStore,
    )
  }

  copyFlashcardReviewSet(reviewSetId: string) {
    return request<RecordModel>(
      `/flashcard-review-sets/${encodeURIComponent(reviewSetId)}/copies`,
      { method: 'POST' },
      this.authStore,
    )
  }

  getFlashcardReviewSetCards(reviewSetId: string) {
    return request<RecordModel[]>(
      `/flashcard-review-sets/${encodeURIComponent(reviewSetId)}/cards`,
      {},
      this.authStore,
    )
  }

  createFlashcardReviewSetCard(reviewSetId: string, body: Record<string, unknown>) {
    return request<RecordModel>(
      `/flashcard-review-sets/${encodeURIComponent(reviewSetId)}/cards`,
      { method: 'POST', body },
      this.authStore,
    )
  }

  updateFlashcardReviewSetCard(
    reviewSetId: string,
    cardId: string,
    body: Record<string, unknown>,
  ) {
    return request<RecordModel>(
      `/flashcard-review-sets/${encodeURIComponent(reviewSetId)}/cards/${encodeURIComponent(cardId)}`,
      { method: 'PATCH', body },
      this.authStore,
    )
  }

  deleteFlashcardReviewSetCard(reviewSetId: string, cardId: string) {
    return request<void>(
      `/flashcard-review-sets/${encodeURIComponent(reviewSetId)}/cards/${encodeURIComponent(cardId)}`,
      { method: 'DELETE' },
      this.authStore,
    )
  }

  async updateFlashcardReviewSetCardImage(reviewSetId: string, cardId: string, image: Blob) {
    if (image.type !== 'image/jpeg') {
      throw new ApiError(422, 'The card image must be compressed as a JPEG.')
    }
    return request<RecordModel>(
      `/flashcard-review-sets/${encodeURIComponent(reviewSetId)}/cards/${encodeURIComponent(cardId)}/image`,
      { method: 'POST', body: { image: await blobDataUrl(image) } },
      this.authStore,
    )
  }

  removeFlashcardReviewSetCardImage(reviewSetId: string, cardId: string) {
    return request<RecordModel>(
      `/flashcard-review-sets/${encodeURIComponent(reviewSetId)}/cards/${encodeURIComponent(cardId)}/image`,
      { method: 'DELETE' },
      this.authStore,
    )
  }

  async updateFlashcardImage(cardId: string, image: Blob) {
    if (image.type !== 'image/jpeg') {
      throw new ApiError(422, 'The card image must be compressed as a JPEG.')
    }
    return request<RecordModel>(
      `/flashcards/${encodeURIComponent(cardId)}/image`,
      { method: 'POST', body: { image: await blobDataUrl(image) } },
      this.authStore,
    )
  }

  removeFlashcardImage(cardId: string) {
    return request<RecordModel>(
      `/flashcards/${encodeURIComponent(cardId)}/image`,
      { method: 'DELETE' },
      this.authStore,
    )
  }

  actOnFlashcardReviewSession(
    sessionId: string,
    action: FlashcardReviewAction,
    elapsedSeconds: number,
  ) {
    return request<FlashcardReviewActionResponse>(
      `/flashcard-review-sessions/${encodeURIComponent(sessionId)}/actions`,
      {
        method: 'POST',
        body: {
          action,
          elapsed_seconds: Math.max(0, Math.round(elapsedSeconds)),
        },
      },
      this.authStore,
    )
  }

  updateFlashcardReviewSessionSettings(
    sessionId: string,
    settings: FlashcardReviewSettings,
  ) {
    return request<RecordModel>(
      `/flashcard-review-sessions/${encodeURIComponent(sessionId)}/settings`,
      {
        method: 'PATCH',
        body: flashcardReviewSettingsBody(settings),
      },
      this.authStore,
    )
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

function blobDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result)
      : reject(new Error('The compressed avatar could not be read.'))
    reader.onerror = () => reject(new Error('The compressed avatar could not be read.'))
    reader.readAsDataURL(blob)
  })
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
