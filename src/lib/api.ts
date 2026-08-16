import type {
  FlashcardBulkRecordAction,
  FlashcardImportRow,
  FlashcardReviewAction,
  FlashcardReviewSetAccessRole,
  FlashcardReviewSettings,
} from '@/types/domain'
import type { AuthActionResponse } from '@/types/auth'
import {
  createLocalRecordId,
  getLocalRecord,
  hasLocalBootstrap,
  listLocalRecords,
  putLocalCreate,
  putLocalCommand,
  putLocalDelete,
  putLocalPatch,
  putLocalProjectionCreate,
  putLocalProjectionDelete,
  putLocalProjectionPatch,
  putLocalSharedCardCreate,
  putLocalSharedCardDelete,
  putLocalSharedCardPatch,
} from '@/lib/localDatabase'

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
  occurrences?: RecordModel[]
  entries?: RecordModel[]
  local?: boolean
}

interface SessionTaskProgressResponse {
  occurrences: RecordModel[]
  entries: RecordModel[]
}

interface FlashcardReviewActionResponse {
  session: RecordModel
  occurrence: RecordModel | null
  occurrences?: RecordModel[]
  entries?: RecordModel[]
}

interface FlashcardImportResponse {
  cards: RecordModel[]
  tags: RecordModel[]
}

interface FlashcardBulkActionResponse {
  cards: RecordModel[]
  deleted_ids: string[]
}

const AUTH_STORAGE_KEY = 'backontrack-api-auth'
const baseUrl = (import.meta.env.VITE_API_URL || '/api').replace(/\/+$/, '')

export function apiAssetUrl(value: string) {
  if (
    !value
    || /^(?:https?:|blob:|data:)/i.test(value)
    || value === baseUrl
    || value.startsWith(`${baseUrl}/`)
  ) return value
  return value.startsWith('/') ? `${baseUrl}${value}` : value
}

function flashcardReviewSettingsBody(
  settings: FlashcardReviewSettings & { excludedCards?: string[] },
  includeExclusions = false,
) {
  return {
    mode: settings.mode,
    card_sides: settings.cardSides,
    indefinite: settings.mode === 'passive' && settings.indefinite,
    max_cards: settings.maxCards,
    front_seconds: settings.frontSeconds,
    back_seconds: settings.backSeconds,
    back_speech_repeat_count: settings.backSpeechRepeatCount,
    note_before_back: settings.noteBeforeBack,
    speech_enabled: settings.speechEnabled,
    front_language: settings.frontLanguage,
    back_language: settings.backLanguage,
    sort_mode: settings.sortMode,
    sort_direction: settings.sortDirection,
    ...(includeExclusions ? { excluded_cards: settings.excludedCards || [] } : {}),
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

function localCreateDefaults(resource: string, body: Record<string, unknown>) {
  const now = new Date().toISOString()
  if (resource === 'flashcards') {
    return {
      note: '', image_url: '', image_file: '',
      front_audio_url: '', front_audio_file: '', back_audio_url: '', back_audio_file: '',
      tags: [], created_at: now, updated_at: now, last_reviewed_at: '',
      passive_views: 0, success_count: 0, error_count: 0,
      ...body,
    }
  }
  if (resource === 'flashcard_review_sets') return { created_at: now, updated_at: now, ...body }
  if (resource === 'journal_entries') {
    return {
      color: '#C7F464', image_url: '', image_file: '', task_snapshot: '', tracker_snapshot: {},
      created_at: now, updated_at: now, ...body,
    }
  }
  if (resource === 'entries') return { created_at: now, ...body }
  return body
}

function remoteCreateBody(resource: string, body: Record<string, unknown>) {
  if (resource !== 'interval_sessions' || !('flashcard_snapshot' in body)) return body
  const remoteBody = { ...body }
  delete remoteBody.flashcard_snapshot
  return remoteBody
}

async function mirrorOwnedReviewSetProjection(
  accountId: string,
  record: RecordModel,
  authRecord: AuthRecord | null,
) {
  const tagIds = Array.isArray(record.tags) ? record.tags : []
  const [tags, cards] = await Promise.all([
    listLocalRecords(accountId, 'flashcard_tags'),
    listLocalRecords(accountId, 'flashcards'),
  ])
  const tagSet = new Set(tagIds)
  const data = {
    ...record,
    access_role: 'owner',
    share_id: '',
    owner_name: authRecord?.name || '',
    owner_avatar: authRecord?.avatar || '',
    tag_details: tags.filter(tag => tagSet.has(tag.id)).map(tag => ({ id: tag.id, name: tag.name })),
    matching_card_count: cards.filter(card => !tagIds.length
      || (Array.isArray(card.tags) && card.tags.some((tag: string) => tagSet.has(tag)))).length,
  }
  const existing = await getLocalRecord(accountId, 'accessible_flashcard_review_sets', record.id)
  return existing
    ? putLocalProjectionPatch(accountId, 'accessible_flashcard_review_sets', record.id, data)
    : putLocalProjectionCreate(accountId, 'accessible_flashcard_review_sets', data)
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

function localFlashcardSwapPatch(
  record: RecordModel,
  action: Extract<FlashcardBulkRecordAction, 'swap_front_back' | 'swap_note_back'>,
) {
  const front = String(record.front || '').trim()
  const back = String(record.back || '').trim()
  const note = String(record.note || '').trim()
  if (action === 'swap_note_back') {
    if (!note) throw new ApiError(422, 'Every selected card needs a note before swapping note and back.')
    if ([...back].length > 2000) {
      throw new ApiError(422, 'A selected back is too long to become a note.')
    }
    return { back: note, note: back }
  }
  return { front: back, back: front }
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

  get hasLocalSession() {
    return Boolean(this.record)
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

  expireToken() {
    this.token = ''
    if (this.record) {
      try {
        localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ token: '', record: this.record }))
      } catch {
        // The cached account remains available in memory.
      }
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
      if (saved?.record) {
        this.token = typeof saved.token === 'string' ? saved.token : ''
        this.record = normalizeAuthRecord(saved.record)
      }
      if (this.token && !this.isValid) this.token = ''
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

  async getList(page = 1, perPage = 30, options: ListOptions = {}) {
    const accountId = this.authStore.record?.id || ''
    if (accountId && await hasLocalBootstrap(accountId)) {
      const records = await listLocalRecords(accountId, this.name, options) as T[]
      const offset = (page - 1) * perPage
      const totalItems = records.length
      return {
        page,
        perPage,
        totalItems,
        totalPages: Math.max(1, Math.ceil(totalItems / perPage)),
        items: records.slice(offset, offset + perPage),
      }
    }
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

  async getOne(id: string) {
    const accountId = this.authStore.record?.id || ''
    if (accountId && await hasLocalBootstrap(accountId)) {
      const record = await getLocalRecord(accountId, this.name, id)
      if (!record) throw new ApiError(404, 'Record not found.')
      return record as T
    }
    return request<T>(
      `/collections/${encodeURIComponent(this.name)}/records/${encodeURIComponent(id)}`,
      {},
      this.authStore,
    )
  }

  async create(body: Record<string, unknown>) {
    if (this.name === 'users') {
      return request<T>('/auth/register', { method: 'POST', body }, this.authStore)
    }
    const accountId = this.authStore.record?.id || ''
    if (accountId && await hasLocalBootstrap(accountId)) {
      const record = await putLocalCreate(accountId, this.name, {
        ...localCreateDefaults(this.name, body),
        id: typeof body.id === 'string' && body.id ? body.id : createLocalRecordId(),
        owner: accountId,
      }) as T
      if (this.name === 'flashcard_review_sets') {
        await mirrorOwnedReviewSetProjection(accountId, record, this.authStore.record)
      }
      return record
    }
    return request<T>(
      `/collections/${encodeURIComponent(this.name)}/records`,
      { method: 'POST', body: remoteCreateBody(this.name, body) },
      this.authStore,
    )
  }

  async update(id: string, body: Record<string, unknown>) {
    const accountId = this.authStore.record?.id || ''
    if (accountId && await hasLocalBootstrap(accountId)) {
      const record = await putLocalPatch(accountId, this.name, id, body) as T
      if (this.name === 'flashcard_review_sets') {
        await mirrorOwnedReviewSetProjection(accountId, record, this.authStore.record)
      }
      return record
    }
    return request<T>(
      `/collections/${encodeURIComponent(this.name)}/records/${encodeURIComponent(id)}`,
      { method: 'PATCH', body },
      this.authStore,
    )
  }

  async delete(id: string) {
    const accountId = this.authStore.record?.id || ''
    if (accountId && await hasLocalBootstrap(accountId)) {
      await putLocalDelete(accountId, this.name, id)
      if (this.name === 'flashcard_review_sets') {
        await putLocalProjectionDelete(accountId, 'accessible_flashcard_review_sets', id)
      }
      return true
    }
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

  registerAccount(name: string, email: string, password: string, timezone: string) {
    return request<AuthActionResponse>(
      '/auth/register',
      {
        method: 'POST',
        body: { name, email, password, passwordConfirm: password, timezone },
      },
      this.authStore,
    )
  }

  verifyEmail(token: string) {
    return request<AuthActionResponse>(
      '/auth/email-verification',
      { method: 'POST', body: { token } },
      this.authStore,
    )
  }

  resendEmailVerification(email: string) {
    return request<AuthActionResponse>(
      '/auth/email-verification/resend',
      { method: 'POST', body: { email } },
      this.authStore,
    )
  }

  requestPasswordReset(email: string) {
    return request<AuthActionResponse>(
      '/auth/password/forgot',
      { method: 'POST', body: { email } },
      this.authStore,
    )
  }

  async resetPassword(token: string, password: string) {
    const response = await request<AuthActionResponse>(
      '/auth/password/reset',
      { method: 'POST', body: { token, password, passwordConfirm: password } },
      this.authStore,
    )
    this.authStore.clear()
    return response
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
    const accountId = this.authStore.record?.id || ''
    if (accountId && await hasLocalBootstrap(accountId)) {
      const record = await putLocalPatch(accountId, 'users', accountId, { name: name.trim() }) as AuthRecord
      this.authStore.save(this.authStore.token, record)
      return record
    }
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
    const accountId = this.authStore.record?.id || ''
    if (accountId && await hasLocalBootstrap(accountId)) {
      const encoded = await blobDataUrl(image)
      const record = await putLocalProjectionPatch(accountId, 'users', accountId, {
        avatar: encoded,
      }) as AuthRecord
      await putLocalCommand(accountId, 'avatar.set', { image: encoded })
      this.authStore.save(this.authStore.token, record)
      return record
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
    const accountId = this.authStore.record?.id || ''
    if (accountId && await hasLocalBootstrap(accountId)) {
      const record = await putLocalProjectionPatch(accountId, 'users', accountId, {
        avatar: '',
      }) as AuthRecord
      await putLocalCommand(accountId, 'avatar.remove', {})
      this.authStore.save(this.authStore.token, record)
      return record
    }
    const record = await request<AuthRecord>(
      '/auth/avatar',
      { method: 'DELETE' },
      this.authStore,
    )
    this.authStore.save(this.authStore.token, record)
    return record
  }

  async getUserSettings() {
    const accountId = this.authStore.record?.id || ''
    if (accountId && await hasLocalBootstrap(accountId)) {
      const record = await getLocalRecord(accountId, 'users', accountId)
      return record?.settings && typeof record.settings === 'object' ? record.settings : {}
    }
    const response = await request<UserSettingsResponse>(
      '/auth/settings',
      {},
      this.authStore,
    )
    this.saveUserSettings(response)
    return response.settings
  }

  async updateUserSettings(settings: Record<string, unknown>) {
    const accountId = this.authStore.record?.id || ''
    if (accountId && await hasLocalBootstrap(accountId)) {
      const current = await getLocalRecord(accountId, 'users', accountId)
      const merged = {
        ...(current?.settings && typeof current.settings === 'object' ? current.settings : {}),
        ...settings,
      }
      const record = await putLocalProjectionPatch(accountId, 'users', accountId, { settings: merged }) as AuthRecord
      await putLocalCommand(accountId, 'settings.patch', settings)
      this.authStore.save(this.authStore.token, record)
      return merged
    }
    const response = await request<UserSettingsResponse>(
      '/auth/settings',
      { method: 'PATCH', body: settings },
      this.authStore,
    )
    this.saveUserSettings(response)
    return response.settings
  }

  async completeIntervalSession(
    sessionId: string,
    input: {
      runtimeState: unknown
      elapsedSeconds: number
      endedAt: string
    },
  ) {
    const accountId = this.authStore.record?.id || ''
    if (accountId && await hasLocalBootstrap(accountId)) {
      const session = await putLocalPatch(accountId, 'interval_sessions', sessionId, {
        status: 'completed',
        runtime_state: input.runtimeState,
        elapsed_seconds: Math.max(0, Math.round(input.elapsedSeconds)),
        ended_at: input.endedAt,
      })
      return { session, occurrence: null, occurrences: [], entries: [], local: true }
    }
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

  async endIntervalSession(
    sessionId: string,
    input: {
      runtimeState: unknown
      elapsedSeconds: number
      endedAt: string
    },
  ) {
    const accountId = this.authStore.record?.id || ''
    if (accountId && await hasLocalBootstrap(accountId)) {
      const session = await putLocalPatch(accountId, 'interval_sessions', sessionId, {
        status: 'ended',
        runtime_state: input.runtimeState,
        elapsed_seconds: Math.max(0, Math.round(input.elapsedSeconds)),
        ended_at: input.endedAt,
      })
      return { session, occurrence: null, occurrences: [], entries: [], local: true }
    }
    return request<CompleteIntervalSessionResponse>(
      `/interval-sessions/${encodeURIComponent(sessionId)}/end`,
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

  async reconcileSessionTaskProgress(since: string): Promise<SessionTaskProgressResponse> {
    const accountId = this.authStore.record?.id || ''
    if (accountId && await hasLocalBootstrap(accountId)) {
      return { occurrences: [], entries: [] }
    }
    return request<SessionTaskProgressResponse>(
      '/task-session-progress/reconcile',
      { method: 'POST', body: { since } },
      this.authStore,
    )
  }

  async updateIntervalSessionFlashcards(sessionId: string, flashcardSnapshot: unknown) {
    const accountId = this.authStore.record?.id || ''
    if (accountId && await hasLocalBootstrap(accountId)) {
      return putLocalPatch(accountId, 'interval_sessions', sessionId, {
        flashcard_snapshot: flashcardSnapshot,
      })
    }
    return request<RecordModel>(
      `/interval-sessions/${encodeURIComponent(sessionId)}/flashcards`,
      {
        method: 'PATCH',
        body: { flashcard_snapshot: flashcardSnapshot },
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

  async importFlashcards(rows: FlashcardImportRow[]) {
    const accountId = this.authStore.record?.id || ''
    if (accountId && await hasLocalBootstrap(accountId)) {
      const existing = await listLocalRecords(accountId, 'flashcard_tags', { sort: 'name' })
      const tagsByName = new Map(existing.map(tag => [String(tag.name).toLocaleLowerCase(), tag]))
      const createdTags: RecordModel[] = []
      const cards: RecordModel[] = []
      for (const row of rows) {
        const tagIds: string[] = []
        for (const rawName of row.tags) {
          const name = rawName.trim()
          const key = name.toLocaleLowerCase()
          let tag = tagsByName.get(key)
          if (!tag) {
            tag = await putLocalCreate(accountId, 'flashcard_tags', { name })
            tagsByName.set(key, tag)
            createdTags.push(tag as RecordModel)
          }
          tagIds.push(tag.id)
        }
        cards.push(await putLocalCreate(accountId, 'flashcards', localCreateDefaults('flashcards', {
          front: row.front,
          back: row.back,
          note: row.note,
          tags: [...new Set(tagIds)],
        })) as RecordModel)
      }
      return { cards, tags: createdTags }
    }
    return request<FlashcardImportResponse>(
      '/flashcards/import',
      { method: 'POST', body: { rows } },
      this.authStore,
    )
  }

  async bulkUpdateFlashcards(action: FlashcardBulkRecordAction, cardIds: string[], tagIds: string[] = []) {
    const accountId = this.authStore.record?.id || ''
    if (accountId && await hasLocalBootstrap(accountId)) {
      if (action === 'delete') {
        await Promise.all(cardIds.map(id => putLocalDelete(accountId, 'flashcards', id)))
        return { cards: [], deleted_ids: cardIds }
      }
      const cards: RecordModel[] = []
      for (const id of cardIds) {
        const current = await getLocalRecord(accountId, 'flashcards', id)
        if (!current) continue
        if (action === 'swap_front_back' || action === 'swap_note_back') {
          cards.push(await putLocalPatch(accountId, 'flashcards', id, {
            ...localFlashcardSwapPatch(current as RecordModel, action),
            updated_at: new Date().toISOString(),
          }) as RecordModel)
          continue
        }
        const currentTags = Array.isArray(current.tags) ? current.tags : []
        const tags = action === 'add_tags'
          ? [...new Set([...currentTags, ...tagIds])]
          : action === 'set_tags'
            ? [...new Set(tagIds)]
            : action === 'remove_tags'
              ? currentTags.filter((tag: string) => !tagIds.includes(tag))
              : []
        cards.push(await putLocalPatch(accountId, 'flashcards', id, { tags }) as RecordModel)
      }
      return { cards, deleted_ids: [] }
    }
    return request<FlashcardBulkActionResponse>(
      '/flashcards/bulk',
      {
        method: 'POST',
        body: { action, card_ids: cardIds, tag_ids: tagIds },
      },
      this.authStore,
    )
  }

  async getAccessibleFlashcardReviewSets() {
    const accountId = this.authStore.record?.id || ''
    if (accountId && await hasLocalBootstrap(accountId)) {
      return listLocalRecords(accountId, 'accessible_flashcard_review_sets', {
        sort: 'sort_order,name',
      })
    }
    return request<RecordModel[]>('/flashcard-review-sets', {}, this.authStore)
  }

  async updateFlashcardReviewSetPreferences(
    reviewSetId: string,
    settings: FlashcardReviewSettings & { excludedCards?: string[] },
  ) {
    const accountId = this.authStore.record?.id || ''
    const body = flashcardReviewSettingsBody(settings, true)
    if (accountId && await hasLocalBootstrap(accountId)) {
      const record = await putLocalProjectionPatch(
        accountId,
        'accessible_flashcard_review_sets',
        reviewSetId,
        body,
      )
      await putLocalCommand(accountId, 'review_set_preferences.patch', {
        review_set_id: reviewSetId,
        ...body,
      })
      return record
    }
    return request<RecordModel>(
      `/flashcard-review-sets/${encodeURIComponent(reviewSetId)}/preferences`,
      { method: 'PATCH', body },
      this.authStore,
    )
  }

  async getFlashcardReviewSetShares(reviewSetId: string) {
    const accountId = this.authStore.record?.id || ''
    if (accountId && await hasLocalBootstrap(accountId)) {
      return listLocalRecords(accountId, 'flashcard_review_set_shares', {
        filter: `review_set = "${reviewSetId}"`,
        sort: 'email',
      })
    }
    return request<RecordModel[]>(
      `/flashcard-review-sets/${encodeURIComponent(reviewSetId)}/shares`,
      {},
      this.authStore,
    )
  }

  async createFlashcardReviewSetShare(
    reviewSetId: string,
    email: string,
    role: Exclude<FlashcardReviewSetAccessRole, 'owner'>,
  ) {
    const accountId = this.authStore.record?.id || ''
    if (accountId && await hasLocalBootstrap(accountId)) {
      const now = new Date().toISOString()
      const share = await putLocalProjectionCreate(accountId, 'flashcard_review_set_shares', {
        id: createLocalRecordId(),
        review_set: reviewSetId,
        email: email.trim().toLocaleLowerCase(),
        role,
        created_at: now,
        updated_at: now,
      })
      await putLocalCommand(accountId, 'review_set_share.create', share)
      return share
    }
    return request<RecordModel>(
      `/flashcard-review-sets/${encodeURIComponent(reviewSetId)}/shares`,
      { method: 'POST', body: { email, role } },
      this.authStore,
    )
  }

  async updateFlashcardReviewSetShare(
    shareId: string,
    role: Exclude<FlashcardReviewSetAccessRole, 'owner'>,
  ) {
    const accountId = this.authStore.record?.id || ''
    if (accountId && await hasLocalBootstrap(accountId)) {
      const share = await putLocalProjectionPatch(accountId, 'flashcard_review_set_shares', shareId, {
        role,
        updated_at: new Date().toISOString(),
      })
      await putLocalCommand(accountId, 'review_set_share.patch', { id: shareId, role })
      return share
    }
    return request<RecordModel>(
      `/flashcard-review-set-shares/${encodeURIComponent(shareId)}`,
      { method: 'PATCH', body: { role } },
      this.authStore,
    )
  }

  async removeFlashcardReviewSetShare(shareId: string) {
    const accountId = this.authStore.record?.id || ''
    if (accountId && await hasLocalBootstrap(accountId)) {
      await putLocalProjectionDelete(accountId, 'flashcard_review_set_shares', shareId)
      await putLocalCommand(accountId, 'review_set_share.delete', { id: shareId })
      return
    }
    return request<void>(
      `/flashcard-review-set-shares/${encodeURIComponent(shareId)}`,
      { method: 'DELETE' },
      this.authStore,
    )
  }

  async copyFlashcardReviewSet(reviewSetId: string) {
    const accountId = this.authStore.record?.id || ''
    if (accountId && await hasLocalBootstrap(accountId)) {
      const source = await getLocalRecord(accountId, 'accessible_flashcard_review_sets', reviewSetId)
      if (!source) throw new ApiError(404, 'Review set not found.')
      const sourceCards = await listLocalRecords(accountId, 'review_set_cards', {
        filter: `review_set_id = "${reviewSetId}"`,
      })
      if (!sourceCards.length) throw new ApiError(409, 'No flashcards match this Review set.')
      const existingTags = await listLocalRecords(accountId, 'flashcard_tags')
      const baseName = `${String(source.name || 'Review set').trim()} copy`.slice(0, 160)
      const tagNames = new Set(existingTags.map(tag => String(tag.name).toLocaleLowerCase()))
      let scopeName = baseName.slice(0, 50)
      for (let suffix = 2; tagNames.has(scopeName.toLocaleLowerCase()); suffix += 1) {
        const ending = ` ${suffix}`
        scopeName = `${baseName.slice(0, 50 - ending.length)}${ending}`
      }
      const scopeTag = await putLocalCreate(accountId, 'flashcard_tags', { name: scopeName })
      const now = new Date().toISOString()
      const reviewSet = await putLocalCreate(accountId, 'flashcard_review_sets', {
        name: baseName,
        tags: [scopeTag.id],
        mode: source.mode,
        card_sides: source.card_sides,
        indefinite: Boolean(source.indefinite),
        max_cards: Number(source.max_cards || 20),
        front_seconds: Number(source.front_seconds || 5),
        back_seconds: Number(source.back_seconds || 5),
        back_speech_repeat_count: Number(source.back_speech_repeat_count || 1),
        note_before_back: Boolean(source.note_before_back),
        speech_enabled: Boolean(source.speech_enabled),
        front_language: String(source.front_language || ''),
        back_language: String(source.back_language || ''),
        sort_mode: source.sort_mode,
        sort_direction: source.sort_direction || 'asc',
        sort_order: Number(source.sort_order || 0),
        created_at: now,
        updated_at: now,
      })
      const projection = await putLocalProjectionCreate(accountId, 'accessible_flashcard_review_sets', {
        ...reviewSet,
        access_role: 'owner',
        owner_name: this.authStore.record?.name || '',
        owner_avatar: this.authStore.record?.avatar || '',
        share_id: '',
        tag_details: [{ id: scopeTag.id, name: scopeName }],
        matching_card_count: sourceCards.length,
      })
      for (const sourceCard of sourceCards) {
        const card = await putLocalCreate(accountId, 'flashcards', localCreateDefaults('flashcards', {
          front: sourceCard.front,
          back: sourceCard.back,
          note: sourceCard.note || '',
          image_url: sourceCard.image_url || '',
          image_file: sourceCard.image_file || '',
          tags: [scopeTag.id],
        }))
        await putLocalProjectionCreate(accountId, 'review_set_cards', {
          ...card,
          review_set_id: reviewSet.id,
        }, `${reviewSet.id}:${card.id}`)
      }
      return projection
    }
    return request<RecordModel>(
      `/flashcard-review-sets/${encodeURIComponent(reviewSetId)}/copies`,
      { method: 'POST' },
      this.authStore,
    )
  }

  async getFlashcardReviewSetCards(reviewSetId: string) {
    const accountId = this.authStore.record?.id || ''
    if (accountId && await hasLocalBootstrap(accountId)) {
      const reviewSet = await getLocalRecord(accountId, 'accessible_flashcard_review_sets', reviewSetId)
      if (reviewSet?.owner === accountId) {
        const tagIds = Array.isArray(reviewSet.tags) ? reviewSet.tags : []
        return (await listLocalRecords(accountId, 'flashcards', { sort: '-created_at' }))
          .filter(card => !tagIds.length || (Array.isArray(card.tags)
            && card.tags.some((tag: string) => tagIds.includes(tag))))
      }
      return listLocalRecords(accountId, 'review_set_cards', {
        filter: `review_set_id = "${reviewSetId}"`,
        sort: '-created_at',
      })
    }
    return request<RecordModel[]>(
      `/flashcard-review-sets/${encodeURIComponent(reviewSetId)}/cards`,
      {},
      this.authStore,
    )
  }

  async createFlashcardReviewSetCard(reviewSetId: string, body: Record<string, unknown>) {
    const accountId = this.authStore.record?.id || ''
    if (accountId && await hasLocalBootstrap(accountId)) {
      const reviewSet = await getLocalRecord(accountId, 'accessible_flashcard_review_sets', reviewSetId)
      const now = new Date().toISOString()
      if (reviewSet?.owner === accountId) {
        return this.collection('flashcards').create({
          ...body,
          tags: Array.isArray(reviewSet.tags) ? reviewSet.tags : [],
        })
      }
      return putLocalSharedCardCreate(accountId, reviewSetId, {
        ...body,
        tags: Array.isArray(reviewSet?.tags) ? reviewSet.tags : [],
        note: typeof body.note === 'string' ? body.note : '',
        image_url: typeof body.image_url === 'string' ? body.image_url : '',
        image_file: '',
        created_at: now,
        updated_at: now,
        last_reviewed_at: '',
        passive_views: 0,
        success_count: 0,
        error_count: 0,
      })
    }
    return request<RecordModel>(
      `/flashcard-review-sets/${encodeURIComponent(reviewSetId)}/cards`,
      { method: 'POST', body },
      this.authStore,
    )
  }

  async importFlashcardReviewSetCards(reviewSetId: string, rows: FlashcardImportRow[]) {
    const accountId = this.authStore.record?.id || ''
    if (accountId && await hasLocalBootstrap(accountId)) {
      const cards: RecordModel[] = []
      for (const row of rows) {
        cards.push(await this.createFlashcardReviewSetCard(reviewSetId, {
          front: row.front,
          back: row.back,
          note: row.note,
        }))
      }
      return { cards, tags: [] }
    }
    return request<FlashcardImportResponse>(
      `/flashcard-review-sets/${encodeURIComponent(reviewSetId)}/cards/import`,
      { method: 'POST', body: { rows } },
      this.authStore,
    )
  }

  async bulkUpdateFlashcardReviewSetCards(reviewSetId: string, cardIds: string[]) {
    const accountId = this.authStore.record?.id || ''
    if (accountId && await hasLocalBootstrap(accountId)) {
      const reviewSet = await getLocalRecord(accountId, 'accessible_flashcard_review_sets', reviewSetId)
      await Promise.all(cardIds.map(cardId => reviewSet?.owner === accountId
        ? this.collection('flashcards').delete(cardId)
        : putLocalSharedCardDelete(accountId, reviewSetId, cardId)))
      return { cards: [], deleted_ids: cardIds }
    }
    return request<FlashcardBulkActionResponse>(
      `/flashcard-review-sets/${encodeURIComponent(reviewSetId)}/cards/bulk`,
      { method: 'POST', body: { action: 'delete', card_ids: cardIds } },
      this.authStore,
    )
  }

  async updateFlashcardReviewSetCard(
    reviewSetId: string,
    cardId: string,
    body: Record<string, unknown>,
  ) {
    const accountId = this.authStore.record?.id || ''
    if (accountId && await hasLocalBootstrap(accountId)) {
      const reviewSet = await getLocalRecord(accountId, 'accessible_flashcard_review_sets', reviewSetId)
      if (reviewSet?.owner === accountId) {
        return this.collection('flashcards').update(cardId, {
          ...body,
          updated_at: new Date().toISOString(),
        })
      }
      return putLocalSharedCardPatch(accountId, reviewSetId, cardId, {
        ...body,
        updated_at: new Date().toISOString(),
      })
    }
    return request<RecordModel>(
      `/flashcard-review-sets/${encodeURIComponent(reviewSetId)}/cards/${encodeURIComponent(cardId)}`,
      { method: 'PATCH', body },
      this.authStore,
    )
  }

  async deleteFlashcardReviewSetCard(reviewSetId: string, cardId: string) {
    const accountId = this.authStore.record?.id || ''
    if (accountId && await hasLocalBootstrap(accountId)) {
      const reviewSet = await getLocalRecord(accountId, 'accessible_flashcard_review_sets', reviewSetId)
      if (reviewSet?.owner === accountId) await this.collection('flashcards').delete(cardId)
      else await putLocalSharedCardDelete(accountId, reviewSetId, cardId)
      return
    }
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
    const accountId = this.authStore.record?.id || ''
    if (accountId && await hasLocalBootstrap(accountId)) {
      const reviewSet = await getLocalRecord(accountId, 'accessible_flashcard_review_sets', reviewSetId)
      if (reviewSet?.owner === accountId) return this.updateFlashcardImage(cardId, image)
      return putLocalSharedCardPatch(accountId, reviewSetId, cardId, {
        image_url: await blobDataUrl(image),
        image_file: '',
        updated_at: new Date().toISOString(),
      })
    }
    return request<RecordModel>(
      `/flashcard-review-sets/${encodeURIComponent(reviewSetId)}/cards/${encodeURIComponent(cardId)}/image`,
      { method: 'POST', body: { image: await blobDataUrl(image) } },
      this.authStore,
    )
  }

  async removeFlashcardReviewSetCardImage(reviewSetId: string, cardId: string) {
    const accountId = this.authStore.record?.id || ''
    if (accountId && await hasLocalBootstrap(accountId)) {
      const reviewSet = await getLocalRecord(accountId, 'accessible_flashcard_review_sets', reviewSetId)
      if (reviewSet?.owner === accountId) return this.removeFlashcardImage(cardId)
      return putLocalSharedCardPatch(accountId, reviewSetId, cardId, {
        image_url: '',
        image_file: '',
        updated_at: new Date().toISOString(),
      })
    }
    return request<RecordModel>(
      `/flashcard-review-sets/${encodeURIComponent(reviewSetId)}/cards/${encodeURIComponent(cardId)}/image`,
      { method: 'DELETE' },
      this.authStore,
    )
  }

  async updateFlashcardReviewSetCardAudio(
    reviewSetId: string,
    cardId: string,
    side: 'front' | 'back',
    audio: Blob,
  ) {
    assertFlashcardAudio(audio)
    const accountId = this.authStore.record?.id || ''
    if (accountId && await hasLocalBootstrap(accountId)) {
      const reviewSet = await getLocalRecord(accountId, 'accessible_flashcard_review_sets', reviewSetId)
      if (reviewSet?.owner === accountId) return this.updateFlashcardAudio(cardId, side, audio)
      return putLocalSharedCardPatch(accountId, reviewSetId, cardId, {
        [`${side}_audio_url`]: await blobDataUrl(audio),
        [`${side}_audio_file`]: '',
        updated_at: new Date().toISOString(),
      })
    }
    return request<RecordModel>(
      `/flashcard-review-sets/${encodeURIComponent(reviewSetId)}/cards/${encodeURIComponent(cardId)}/audio/${side}`,
      { method: 'POST', body: { audio: await blobDataUrl(audio) } },
      this.authStore,
    )
  }

  async removeFlashcardReviewSetCardAudio(
    reviewSetId: string,
    cardId: string,
    side: 'front' | 'back',
  ) {
    const accountId = this.authStore.record?.id || ''
    if (accountId && await hasLocalBootstrap(accountId)) {
      const reviewSet = await getLocalRecord(accountId, 'accessible_flashcard_review_sets', reviewSetId)
      if (reviewSet?.owner === accountId) return this.removeFlashcardAudio(cardId, side)
      return putLocalSharedCardPatch(accountId, reviewSetId, cardId, {
        [`${side}_audio_url`]: '',
        [`${side}_audio_file`]: '',
        updated_at: new Date().toISOString(),
      })
    }
    return request<RecordModel>(
      `/flashcard-review-sets/${encodeURIComponent(reviewSetId)}/cards/${encodeURIComponent(cardId)}/audio/${side}`,
      { method: 'DELETE' },
      this.authStore,
    )
  }

  async updateFlashcardImage(cardId: string, image: Blob) {
    if (image.type !== 'image/jpeg') {
      throw new ApiError(422, 'The card image must be compressed as a JPEG.')
    }
    const accountId = this.authStore.record?.id || ''
    if (accountId && await hasLocalBootstrap(accountId)) {
      return putLocalPatch(accountId, 'flashcards', cardId, {
        image_url: await blobDataUrl(image),
        image_file: '',
        updated_at: new Date().toISOString(),
      })
    }
    return request<RecordModel>(
      `/flashcards/${encodeURIComponent(cardId)}/image`,
      { method: 'POST', body: { image: await blobDataUrl(image) } },
      this.authStore,
    )
  }

  async removeFlashcardImage(cardId: string) {
    const accountId = this.authStore.record?.id || ''
    if (accountId && await hasLocalBootstrap(accountId)) {
      return putLocalPatch(accountId, 'flashcards', cardId, {
        image_url: '',
        image_file: '',
        updated_at: new Date().toISOString(),
      })
    }
    return request<RecordModel>(
      `/flashcards/${encodeURIComponent(cardId)}/image`,
      { method: 'DELETE' },
      this.authStore,
    )
  }

  async updateFlashcardAudio(cardId: string, side: 'front' | 'back', audio: Blob) {
    assertFlashcardAudio(audio)
    const accountId = this.authStore.record?.id || ''
    if (accountId && await hasLocalBootstrap(accountId)) {
      return putLocalPatch(accountId, 'flashcards', cardId, {
        [`${side}_audio_url`]: await blobDataUrl(audio),
        [`${side}_audio_file`]: '',
        updated_at: new Date().toISOString(),
      })
    }
    return request<RecordModel>(
      `/flashcards/${encodeURIComponent(cardId)}/audio/${side}`,
      { method: 'POST', body: { audio: await blobDataUrl(audio) } },
      this.authStore,
    )
  }

  async removeFlashcardAudio(cardId: string, side: 'front' | 'back') {
    const accountId = this.authStore.record?.id || ''
    if (accountId && await hasLocalBootstrap(accountId)) {
      return putLocalPatch(accountId, 'flashcards', cardId, {
        [`${side}_audio_url`]: '',
        [`${side}_audio_file`]: '',
        updated_at: new Date().toISOString(),
      })
    }
    return request<RecordModel>(
      `/flashcards/${encodeURIComponent(cardId)}/audio/${side}`,
      { method: 'DELETE' },
      this.authStore,
    )
  }

  async updateJournalImage(entryId: string, image: Blob) {
    if (image.type !== 'image/jpeg') {
      throw new ApiError(422, 'The reflection image must be compressed as a JPEG.')
    }
    const accountId = this.authStore.record?.id || ''
    if (accountId && await hasLocalBootstrap(accountId)) {
      return putLocalPatch(accountId, 'journal_entries', entryId, {
        image_url: await blobDataUrl(image),
        image_file: '',
        updated_at: new Date().toISOString(),
      })
    }
    return request<RecordModel>(
      `/journal-entries/${encodeURIComponent(entryId)}/image`,
      { method: 'POST', body: { image: await blobDataUrl(image) } },
      this.authStore,
    )
  }

  async removeJournalImage(entryId: string) {
    const accountId = this.authStore.record?.id || ''
    if (accountId && await hasLocalBootstrap(accountId)) {
      return putLocalPatch(accountId, 'journal_entries', entryId, {
        image_url: '',
        image_file: '',
        updated_at: new Date().toISOString(),
      })
    }
    return request<RecordModel>(
      `/journal-entries/${encodeURIComponent(entryId)}/image`,
      { method: 'DELETE' },
      this.authStore,
    )
  }

  actOnFlashcardReviewSession(
    sessionId: string,
    action: FlashcardReviewAction,
    elapsedSeconds: number,
    viewCount = 1,
  ) {
    return request<FlashcardReviewActionResponse>(
      `/flashcard-review-sessions/${encodeURIComponent(sessionId)}/actions`,
      {
        method: 'POST',
        body: {
          action,
          elapsed_seconds: Math.max(0, Math.round(elapsedSeconds)),
          ...(action === 'view' && viewCount > 1
            ? { view_count: Math.max(1, Math.round(viewCount)) }
            : {}),
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

function assertFlashcardAudio(audio: Blob) {
  const mimeType = audio.type.split(';')[0]?.toLocaleLowerCase() || ''
  if (!['audio/webm', 'audio/mp4'].includes(mimeType)) {
    throw new ApiError(422, 'Record audio in WebM or MP4 format.')
  }
  if (!audio.size || audio.size > 1_500_000) {
    throw new ApiError(422, 'The card recording must be no larger than 1.5 MB.')
  }
}

function blobDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result)
      : reject(new Error('The compressed image could not be read.'))
    reader.onerror = () => reject(new Error('The compressed image could not be read.'))
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
    if (response.status === 401) authStore.expireToken()
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
