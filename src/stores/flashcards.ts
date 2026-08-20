import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { ApiError, api, apiAssetUrl } from '@/lib/api'
import { createLocalRecordId, hasLocalBootstrap } from '@/lib/localDatabase'
import {
  cardMatchesTags,
  createFlashcardReviewPreviewSession,
  DEFAULT_FLASHCARD_BACK_SPEECH_REPEATS,
  DEFAULT_FLASHCARD_REVIEW_CARD_SIDES,
  DEFAULT_FLASHCARD_SESSION_CARDS,
  flashcardEjectExcludes,
  flashcardEjectLoadsNext,
  flashcardReviewQueueState,
  flashcardSwapColumnsError,
  swapFlashcardColumns,
  updateFlashcardReviewExclusions,
} from '@/services/flashcards'
import { useSnackbarStore } from '@/stores/snackbar'
import { useTaskStore } from '@/stores/tasks'
import type {
  Flashcard,
  FlashcardAudioValue,
  FlashcardBulkRecordAction,
  FlashcardBulkSwapColumn,
  FlashcardDraft,
  FlashcardImportRow,
  FlashcardReviewAction,
  FlashcardReviewEjectBehavior,
  FlashcardReviewEvent,
  FlashcardReviewSession,
  FlashcardReviewSet,
  FlashcardReviewSetDraft,
  FlashcardReviewSetShare,
  FlashcardReviewSettings,
  FlashcardTag,
} from '@/types/domain'

function mapEjectBehavior(value: unknown): FlashcardReviewEjectBehavior {
  return value === 'replace' || value === 'exclude' || value === 'replace_exclude'
    ? value
    : 'remove'
}

function mapTag(record: Record<string, any>): FlashcardTag {
  return { id: record.id, name: record.name }
}

function mapCard(record: Record<string, any>): Flashcard {
  const frontAudioFile = typeof record.front_audio_file === 'string' ? record.front_audio_file : ''
  const backAudioFile = typeof record.back_audio_file === 'string' ? record.back_audio_file : ''
  const frontAudioUrl = typeof record.front_audio_url === 'string' ? record.front_audio_url : ''
  const backAudioUrl = typeof record.back_audio_url === 'string' ? record.back_audio_url : ''
  return {
    id: record.id,
    front: record.front,
    back: record.back,
    transliteration: record.transliteration || '',
    note: record.note || '',
    frontAudio: frontAudioFile
      ? apiAssetUrl(`/flashcard-audio/${frontAudioFile}`)
      : frontAudioUrl,
    backAudio: backAudioFile
      ? apiAssetUrl(`/flashcard-audio/${backAudioFile}`)
      : backAudioUrl,
    tags: Array.isArray(record.tags) ? record.tags : [],
    tagDetails: Array.isArray(record.tag_details) ? record.tag_details.map(mapTag) : undefined,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
    lastReviewedAt: record.last_reviewed_at || undefined,
    passiveViews: Number(record.passive_views || 0),
    successCount: Number(record.success_count || 0),
    errorCount: Number(record.error_count || 0),
  }
}

function mapReviewSet(record: Record<string, any>): FlashcardReviewSet {
  return {
    id: record.id,
    name: record.name,
    tags: Array.isArray(record.tags) ? record.tags : [],
    tagDetails: Array.isArray(record.tag_details) ? record.tag_details.map(mapTag) : [],
    owner: record.owner || api.authStore.record?.id || '',
    ownerName: record.owner_name || api.authStore.record?.name || '',
    ownerAvatar: apiAssetUrl(record.owner_avatar || api.authStore.record?.avatar || ''),
    accessRole: record.access_role || 'owner',
    excludedCards: Array.isArray(record.excluded_cards) ? record.excluded_cards : [],
    shareId: record.share_id || undefined,
    matchingCardCount: Number(record.matching_card_count || 0),
    mode: record.mode,
    cardSides: record.card_sides || DEFAULT_FLASHCARD_REVIEW_CARD_SIDES,
    indefinite: Boolean(record.indefinite),
    timeLimitSeconds: record.mode === 'passive' ? Number(record.time_limit_seconds || 0) : 0,
    maxCards: Number(record.max_cards || DEFAULT_FLASHCARD_SESSION_CARDS),
    ejectBehavior: mapEjectBehavior(record.eject_behavior),
    frontSeconds: Number(record.front_seconds || 5),
    backSeconds: Number(record.back_seconds || 5),
    backSpeechRepeatCount: Number(
      record.back_speech_repeat_count || DEFAULT_FLASHCARD_BACK_SPEECH_REPEATS,
    ),
    noteBeforeBack: Boolean(record.note_before_back),
    speechEnabled: Boolean(record.speech_enabled),
    frontLanguage: record.front_language || '',
    backLanguage: record.back_language || '',
    sortMode: record.sort_mode,
    sortDirection: record.sort_direction || 'asc',
    sortOrder: Number(record.sort_order || 0),
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  }
}

function mapReviewSetShare(record: Record<string, any>): FlashcardReviewSetShare {
  return {
    id: record.id,
    reviewSet: record.review_set,
    role: record.role,
    email: record.email || '',
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  }
}

function mapSession(record: Record<string, any>): FlashcardReviewSession {
  return {
    id: record.id,
    reviewSet: record.review_set || undefined,
    status: record.status,
    name: record.snapshot_name,
    mode: record.mode_snapshot,
    cardSides: record.card_sides_snapshot || DEFAULT_FLASHCARD_REVIEW_CARD_SIDES,
    indefinite: Boolean(record.indefinite_snapshot),
    timeLimitSeconds: record.mode_snapshot === 'passive'
      ? Number(record.time_limit_seconds_snapshot || 0)
      : 0,
    maxCards: Number(record.max_cards_snapshot || DEFAULT_FLASHCARD_SESSION_CARDS),
    ejectBehavior: mapEjectBehavior(record.eject_behavior_snapshot),
    sortMode: record.sort_snapshot,
    sortDirection: record.sort_direction_snapshot || 'asc',
    tags: Array.isArray(record.tags_snapshot) ? record.tags_snapshot : [],
    excludedCards: Array.isArray(record.excluded_cards_snapshot)
      ? record.excluded_cards_snapshot
      : [],
    reserveCardIds: Array.isArray(record.reserve_card_ids)
      ? record.reserve_card_ids.filter((id: unknown): id is string => typeof id === 'string')
      : [],
    frontSeconds: Number(record.front_seconds_snapshot || 5),
    backSeconds: Number(record.back_seconds_snapshot || 5),
    backSpeechRepeatCount: Number(
      record.back_speech_repeat_count_snapshot || DEFAULT_FLASHCARD_BACK_SPEECH_REPEATS,
    ),
    noteBeforeBack: Boolean(record.note_before_back_snapshot),
    speechEnabled: Boolean(record.speech_enabled_snapshot),
    frontLanguage: record.front_language_snapshot || '',
    backLanguage: record.back_language_snapshot || '',
    queue: Array.isArray(record.queue_state)
      ? record.queue_state.map((card: Record<string, any>) => ({
          ...card,
          ...(typeof card.frontAudio === 'string' && card.frontAudio
            ? { frontAudio: apiAssetUrl(card.frontAudio) }
            : {}),
          ...(typeof card.backAudio === 'string' && card.backAudio
            ? { backAudio: apiAssetUrl(card.backAudio) }
            : {}),
        }))
      : [],
    startedAt: record.started_at,
    endedAt: record.ended_at || undefined,
    updatedAt: record.updated_at,
    elapsedSeconds: Number(record.elapsed_seconds || 0),
    totalCards: Number(record.total_cards || 0),
    viewedCount: Number(record.viewed_count || 0),
    successCount: Number(record.success_count || 0),
    errorCount: Number(record.error_count || 0),
    ejectedCount: Number(record.ejected_count || 0),
    task: record.task || undefined,
    programStep: record.program_step || undefined,
    programStepCompletion: record.program_step_completion || undefined,
    taskDate: record.task_date || undefined,
  }
}

function mapEvent(record: Record<string, any>): FlashcardReviewEvent {
  return {
    id: record.id,
    session: record.session,
    card: record.card || undefined,
    outcome: record.outcome,
    viewCount: Math.max(1, Number(record.view_count || 1)),
    reviewedAt: record.reviewed_at,
    front: record.front_snapshot,
    back: record.back_snapshot,
    tags: Array.isArray(record.tags_snapshot) ? record.tags_snapshot : [],
  }
}

export const useFlashcardStore = defineStore('flashcards', () => {
  const tags = ref<FlashcardTag[]>([])
  const cards = ref<Flashcard[]>([])
  const reviewSets = ref<FlashcardReviewSet[]>([])
  const reviewSetCards = ref<Record<string, Flashcard[]>>({})
  const sessions = ref<FlashcardReviewSession[]>([])
  const events = ref<FlashcardReviewEvent[]>([])
  const loading = ref(false)
  const loaded = ref(false)
  const error = ref('')

  const activeSession = computed(() =>
    sessions.value.find(session => session.status === 'running' || session.status === 'paused'),
  )
  const recentSessions = computed(() => sessions.value
    .filter(session => session.status === 'completed' || session.status === 'ended')
    .slice(0, 30))

  async function load() {
    if (!api.authStore.record) return
    loading.value = true
    error.value = ''
    try {
      const [tagRecords, cardRecords, setRecords, sessionRecords] = await Promise.all([
        api.collection('flashcard_tags').getFullList({ sort: 'name' }),
        api.collection('flashcards').getFullList({ sort: '-created_at' }),
        api.getAccessibleFlashcardReviewSets(),
        api.collection('flashcard_review_sessions').getList(1, 100, { sort: '-started_at' }),
      ])
      tags.value = tagRecords.map(mapTag)
      cards.value = cardRecords.map(mapCard)
      reviewSets.value = setRecords.map(mapReviewSet)
      sessions.value = sessionRecords.items.map(mapSession)
      loaded.value = true
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Could not load flashcards.'
      throw cause
    } finally {
      loading.value = false
    }
  }

  async function loadSession(id: string) {
    const existing = sessions.value.find(session => session.id === id)
    if (existing) return existing
    const record = await api.collection('flashcard_review_sessions').getOne(id)
    const session = mapSession(record)
    sessions.value.unshift(session)
    return session
  }

  async function loadEvents(sessionId: string) {
    const records = await api.collection('flashcard_review_events').getFullList({
      filter: `session = "${sessionId}"`,
      sort: 'reviewed_at',
    })
    const mapped = records.map(mapEvent)
    events.value = [
      ...events.value.filter(event => event.session !== sessionId),
      ...mapped,
    ]
    return mapped
  }

  async function createTag(name: string) {
    const normalized = name.trim()
    if (!normalized) throw new Error('Tag name is required.')
    const existing = tags.value.find(tag => tag.name.localeCompare(normalized, undefined, { sensitivity: 'accent' }) === 0)
    if (existing) return existing
    const tag: FlashcardTag = { id: createLocalRecordId(), name: normalized }
    tags.value.push(tag)
    tags.value.sort((left, right) => left.name.localeCompare(right.name))
    try {
      const record = await api.collection('flashcard_tags').create({
        owner: api.authStore.record!.id,
        name: normalized,
      })
      Object.assign(tag, mapTag(record))
      return tag
    } catch (cause) {
      tags.value = tags.value.filter(item => item !== tag)
      throw cause
    }
  }

  async function renameTag(id: string, name: string) {
    const index = tags.value.findIndex(item => item.id === id)
    if (index < 0) throw new Error('Tag not found.')
    const tag = tags.value[index]!
    const previousName = tag.name
    tag.name = name.trim()
    tags.value.sort((left, right) => left.name.localeCompare(right.name))
    try {
      const record = await api.collection('flashcard_tags').update(id, { name: tag.name })
      Object.assign(tag, mapTag(record))
      tags.value.sort((left, right) => left.name.localeCompare(right.name))
      return tag
    } catch (cause) {
      tag.name = previousName
      tags.value.sort((left, right) => left.name.localeCompare(right.name))
      throw cause
    }
  }

  async function deleteTag(id: string) {
    const previousTags = tags.value
    const cardTags = new Map(cards.value.map(card => [card.id, [...card.tags]]))
    const reviewSetTags = new Map(reviewSets.value.map(set => [set.id, [...set.tags]]))
    tags.value = tags.value.filter(tag => tag.id !== id)
    cards.value.forEach(card => { card.tags = card.tags.filter(tag => tag !== id) })
    reviewSets.value.forEach(set => { set.tags = set.tags.filter(tag => tag !== id) })
    try {
      await api.collection('flashcard_tags').delete(id)
      await Promise.all([
        ...cards.value
          .filter(card => cardTags.get(card.id)?.includes(id))
          .map(card => api.collection('flashcards').update(card.id, { tags: card.tags })),
        ...reviewSets.value
          .filter(set => (
            set.owner === api.authStore.record?.id
            && reviewSetTags.get(set.id)?.includes(id)
          ))
          .map(set => api.collection('flashcard_review_sets').update(set.id, { tags: set.tags })),
      ])
    } catch (cause) {
      tags.value = previousTags
      cards.value.forEach((card) => { card.tags = cardTags.get(card.id) || card.tags })
      reviewSets.value.forEach((set) => { set.tags = reviewSetTags.get(set.id) || set.tags })
      throw cause
    }
    useSnackbarStore().showDeletion('Tag')
  }

  function cacheCard(card: Flashcard, includeInActiveSessions = false) {
    const index = cards.value.findIndex(item => item.id === card.id)
    if (index >= 0) cards.value.splice(index, 1, card)
    else cards.value.unshift(card)
    sessions.value
      .filter(session => session.status === 'running' || session.status === 'paused')
      .forEach(session => {
        const queueIndex = session.queue.findIndex(item => item.id === card.id)
        const snapshot = {
          id: card.id,
          front: card.front,
          back: card.back,
          note: card.note,
          frontAudio: card.frontAudio,
          backAudio: card.backAudio,
          tags: [...card.tags],
        }
        if (queueIndex >= 0) {
          session.queue.splice(queueIndex, 1, snapshot)
        } else if (
          includeInActiveSessions
          && cardMatchesTags(card, session.tags)
          && !(session.excludedCards || []).includes(card.id)
          && session.totalCards < session.maxCards
        ) {
          session.queue.push(snapshot)
          session.totalCards = session.indefinite
            ? session.queue.length
            : session.viewedCount + session.ejectedCount + session.queue.length
        }
      })
    return card
  }

  async function saveCard(
    draft: FlashcardDraft,
    audio?: { front: FlashcardAudioValue; back: FlashcardAudioValue },
  ) {
    const payload: Record<string, unknown> = {
      owner: api.authStore.record!.id,
      front: draft.front,
      back: draft.back,
      transliteration: draft.transliteration || '',
      note: draft.note,
      tags: draft.tags,
    }
    const existing = draft.id ? cards.value.find(card => card.id === draft.id) : undefined
    const sessionSnapshots = sessions.value.map(session => ({
      session,
      queue: session.queue.map(card => ({ ...card, tags: [...card.tags] })),
      totalCards: session.totalCards,
    }))
    const now = new Date().toISOString()
    const optimisticCard: Flashcard = {
      id: draft.id || createLocalRecordId(),
      front: draft.front,
      back: draft.back,
      transliteration: draft.transliteration || '',
      note: draft.note,
      frontAudio: audio?.front.recording
        ? existing?.frontAudio
        : audio?.front.url ?? existing?.frontAudio,
      backAudio: audio?.back.recording
        ? existing?.backAudio
        : audio?.back.url ?? existing?.backAudio,
      tags: [...draft.tags],
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      lastReviewedAt: existing?.lastReviewedAt,
      passiveViews: existing?.passiveViews || 0,
      successCount: existing?.successCount || 0,
      errorCount: existing?.errorCount || 0,
    }
    cacheCard(optimisticCard, !draft.id)

    try {
      let record = draft.id
        ? await api.collection('flashcards').update(draft.id, payload)
        : await api.collection('flashcards').create(payload)
      for (const side of ['front', 'back'] as const) {
        const value = audio?.[side]
        if (!value || (!value.recording && value.url === value.existingUrl)) continue
        record = value.recording
          ? await api.updateFlashcardAudio(record.id, side, value.recording)
          : await api.removeFlashcardAudio(record.id, side)
      }
      return cacheCard(mapCard(record), !draft.id)
    } catch (cause) {
      cards.value = cards.value.filter(card => card !== optimisticCard)
      if (existing) cacheCard(existing)
      sessionSnapshots.forEach(({ session, queue, totalCards }) => {
        session.queue = queue
        session.totalCards = totalCards
      })
      throw cause
    }
  }

  async function deleteCard(id: string) {
    const index = cards.value.findIndex(card => card.id === id)
    const card = index >= 0 ? cards.value[index] : undefined
    if (index >= 0) cards.value.splice(index, 1)
    try {
      await api.collection('flashcards').delete(id)
    } catch (cause) {
      if (card && !cards.value.includes(card)) cards.value.splice(index, 0, card)
      throw cause
    }
    useSnackbarStore().showDeletion('Card')
  }

  async function deleteSession(sessionId: string) {
    error.value = ''
    const index = sessions.value.findIndex(session => session.id === sessionId)
    if (index < 0) throw new Error('Review session not found.')
    const session = sessions.value[index]!
    const previousEvents = events.value
    sessions.value.splice(index, 1)
    events.value = events.value.filter(event => event.session !== sessionId)
    try {
      await api.collection('flashcard_review_sessions').delete(sessionId)
      useSnackbarStore().showDeletion('Review')
    } catch (cause) {
      if (!sessions.value.includes(session)) sessions.value.splice(index, 0, session)
      events.value = previousEvents
      error.value = cause instanceof Error ? cause.message : 'Could not delete this review.'
      throw cause
    }
  }

  async function importCards(rows: FlashcardImportRow[]) {
    const response = await api.importFlashcards(rows)
    const importedTags = response.tags.map(mapTag)
    const importedCards = response.cards.map(mapCard)
    for (const tag of importedTags) {
      const index = tags.value.findIndex(item => item.id === tag.id)
      if (index >= 0) tags.value.splice(index, 1, tag)
      else tags.value.push(tag)
    }
    tags.value.sort((left, right) => left.name.localeCompare(right.name))
    cards.value.unshift(...importedCards)
    return importedCards
  }

  async function bulkUpdateCards(
    action: FlashcardBulkRecordAction,
    cardIds: string[],
    values: string[] = [],
  ) {
    const uniqueCardIds = [...new Set(cardIds)]
    if (!uniqueCardIds.length) return []
    const uniqueValues = [...new Set(values)]
    const swapColumns = action === 'swap_columns'
      ? uniqueValues as FlashcardBulkSwapColumn[]
      : action === 'swap_front_back'
        ? ['front', 'back'] as FlashcardBulkSwapColumn[]
        : action === 'swap_note_back'
          ? ['note', 'back'] as FlashcardBulkSwapColumn[]
          : []
    const allowedSwapColumns: FlashcardBulkSwapColumn[] = [
      'front', 'back', 'transliteration', 'note',
    ]
    if (
      action === 'swap_columns'
      && (
        swapColumns.length !== 2
        || swapColumns[0] === swapColumns[1]
        || swapColumns.some(column => !allowedSwapColumns.includes(column))
      )
    ) {
      throw new ApiError(422, 'Choose two different flashcard columns.')
    }
    const selectedIds = new Set(uniqueCardIds)
    const previousCards = cards.value.map(card => ({ ...card, tags: [...card.tags] }))
    const sessionSnapshots = sessions.value.map(session => ({
      session,
      queue: session.queue.map(card => ({ ...card, tags: [...card.tags] })),
      totalCards: session.totalCards,
    }))
    if (swapColumns.length) {
      const swapError = flashcardSwapColumnsError(
        cards.value.filter(card => selectedIds.has(card.id)),
        swapColumns,
      )
      if (swapError) throw new ApiError(422, swapError)
    }
    if (action === 'delete') {
      cards.value = cards.value.filter(card => !selectedIds.has(card.id))
    } else {
      cards.value.filter(card => selectedIds.has(card.id)).forEach((card) => {
        if (action === 'set_tags') card.tags = [...uniqueValues]
        if (action === 'add_tags') card.tags = [...new Set([...card.tags, ...uniqueValues])]
        if (action === 'remove_tags') card.tags = card.tags.filter(tag => !uniqueValues.includes(tag))
        if (action === 'clear_tags') card.tags = []
        if (swapColumns.length === 2) {
          swapFlashcardColumns(card, swapColumns as [FlashcardBulkSwapColumn, FlashcardBulkSwapColumn])
        }
        cacheCard(card)
      })
    }
    try {
      const response = await api.bulkUpdateFlashcards(action, uniqueCardIds, uniqueValues)
      if (action === 'delete') {
        const deleted = new Set(response.deleted_ids)
        cards.value = previousCards.filter(card => !deleted.has(card.id))
        useSnackbarStore().showDeletion(deleted.size === 1 ? 'Card' : `${deleted.size} cards`)
        return []
      }

      const updatedCards = response.cards.map(mapCard)
      updatedCards.forEach(card => cacheCard(card))
      return updatedCards
    } catch (cause) {
      cards.value = previousCards
      sessionSnapshots.forEach(({ session, queue, totalCards }) => {
        session.queue = queue
        session.totalCards = totalCards
      })
      throw cause
    }
  }

  async function saveReviewSet(draft: FlashcardReviewSetDraft) {
    const payload = {
      owner: api.authStore.record!.id,
      name: draft.name,
      tags: draft.tags,
      mode: draft.mode,
      card_sides: draft.cardSides,
      indefinite: draft.mode === 'passive' && draft.indefinite,
      time_limit_seconds: draft.mode === 'passive' ? draft.timeLimitSeconds || 0 : 0,
      max_cards: draft.maxCards,
      eject_behavior: draft.ejectBehavior,
      front_seconds: draft.frontSeconds,
      back_seconds: draft.backSeconds,
      back_speech_repeat_count: draft.backSpeechRepeatCount,
      note_before_back: draft.noteBeforeBack,
      speech_enabled: draft.speechEnabled,
      front_language: draft.frontLanguage,
      back_language: draft.backLanguage,
      sort_mode: draft.sortMode,
      sort_direction: draft.sortDirection,
      sort_order: draft.sortOrder,
      excluded_cards: draft.excludedCards || [],
    }
    const index = draft.id ? reviewSets.value.findIndex(item => item.id === draft.id) : -1
    const previous = index >= 0 ? reviewSets.value[index] : undefined
    const reviewSet = mapReviewSet({
      id: draft.id || createLocalRecordId(),
      access_role: 'owner',
      owner: api.authStore.record!.id,
      matching_card_count: previous?.matchingCardCount || 0,
      created_at: previous?.createdAt || new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...payload,
    })
    if (index >= 0) reviewSets.value.splice(index, 1, reviewSet)
    else reviewSets.value.push(reviewSet)
    try {
      const record = draft.id
        ? await api.collection('flashcard_review_sets').update(draft.id, payload)
        : await api.collection('flashcard_review_sets').create(payload)
      const accessibleRecords = await api.getAccessibleFlashcardReviewSets()
      reviewSets.value = accessibleRecords.map(mapReviewSet)
      return reviewSets.value.find(item => item.id === record.id) || mapReviewSet(record)
    } catch (cause) {
      const optimisticIndex = reviewSets.value.indexOf(reviewSet)
      if (previous && optimisticIndex >= 0) reviewSets.value.splice(optimisticIndex, 1, previous)
      else if (optimisticIndex >= 0) reviewSets.value.splice(optimisticIndex, 1)
      throw cause
    }
  }

  async function saveReviewSetPreferences(
    id: string,
    settings: FlashcardReviewSettings & { excludedCards?: string[] },
  ) {
    const index = reviewSets.value.findIndex(item => item.id === id)
    if (index < 0) throw new Error('Review set not found.')
    const reviewSet = reviewSets.value[index]!
    const previous = { ...reviewSet, excludedCards: [...(reviewSet.excludedCards || [])] }
    Object.assign(reviewSet, {
      ...settings,
      indefinite: settings.mode === 'passive' && settings.indefinite,
      timeLimitSeconds: settings.mode === 'passive' ? settings.timeLimitSeconds || 0 : 0,
      excludedCards: [...(settings.excludedCards || [])],
    })
    try {
      const record = await api.updateFlashcardReviewSetPreferences(id, settings)
      Object.assign(reviewSet, mapReviewSet(record))
      return reviewSet
    } catch (cause) {
      Object.assign(reviewSet, previous)
      throw cause
    }
  }

  async function reorderReviewSets(ordered: FlashcardReviewSet[]) {
    const previousReviewSets = reviewSets.value.map((reviewSet) => ({ ...reviewSet }))
    const previousSortOrders = new Map(
      previousReviewSets.map((reviewSet) => [reviewSet.id, reviewSet.sortOrder]),
    )
    const sharedReviewSets = previousReviewSets.filter(reviewSet => reviewSet.accessRole !== 'owner')
    reviewSets.value = [...ordered, ...sharedReviewSets]
    ordered.forEach((reviewSet, index) => {
      reviewSet.sortOrder = index
    })
    const changedReviewSets = ordered.filter(
      (reviewSet) => previousSortOrders.get(reviewSet.id) !== reviewSet.sortOrder,
    )
    if (!changedReviewSets.length) return

    error.value = ''
    try {
      await Promise.all(
        changedReviewSets.map((reviewSet) =>
          api.collection('flashcard_review_sets').update(reviewSet.id, {
            sort_order: reviewSet.sortOrder,
          }),
        ),
      )
    } catch (cause) {
      reviewSets.value = previousReviewSets
      await Promise.allSettled(
        changedReviewSets.map((reviewSet) =>
          api.collection('flashcard_review_sets').update(reviewSet.id, {
            sort_order: previousSortOrders.get(reviewSet.id),
          }),
        ),
      )
      error.value = cause instanceof Error
        ? cause.message
        : 'Could not save the Review set order.'
      throw cause
    }
  }

  async function loadReviewSetCards(id: string) {
    const records = await api.getFlashcardReviewSetCards(id)
    const mapped = records.map(mapCard)
    reviewSetCards.value = { ...reviewSetCards.value, [id]: mapped }
    const reviewSet = reviewSets.value.find(item => item.id === id)
    if (reviewSet) reviewSet.matchingCardCount = mapped.length
    return mapped
  }

  async function importReviewSetCards(reviewSetId: string, rows: FlashcardImportRow[]) {
    const response = await api.importFlashcardReviewSetCards(reviewSetId, rows)
    const importedCards = response.cards.map(mapCard)
    const current = reviewSetCards.value[reviewSetId] || []
    reviewSetCards.value = {
      ...reviewSetCards.value,
      [reviewSetId]: [...importedCards, ...current],
    }
    const reviewSet = reviewSets.value.find(item => item.id === reviewSetId)
    if (reviewSet) reviewSet.matchingCardCount = current.length + importedCards.length
    if (reviewSet?.owner === api.authStore.record?.id) cards.value.unshift(...importedCards)
    return importedCards
  }

  async function bulkUpdateReviewSetCards(
    reviewSetId: string,
    action: FlashcardBulkRecordAction,
    cardIds: string[],
  ) {
    if (action !== 'delete') throw new Error('This bulk action is not available for Review set cards.')
    const uniqueCardIds = [...new Set(cardIds)]
    if (!uniqueCardIds.length) return []
    const deleted = new Set(uniqueCardIds)
    const previousReviewSetCards = reviewSetCards.value[reviewSetId] || []
    const previousCards = cards.value
    const reviewSet = reviewSets.value.find(item => item.id === reviewSetId)
    const previousCount = reviewSet?.matchingCardCount
    const next = previousReviewSetCards.filter(card => !deleted.has(card.id))
    reviewSetCards.value = { ...reviewSetCards.value, [reviewSetId]: next }
    cards.value = cards.value.filter(card => !deleted.has(card.id))
    if (reviewSet) reviewSet.matchingCardCount = next.length
    try {
      const response = await api.bulkUpdateFlashcardReviewSetCards(reviewSetId, uniqueCardIds)
      const persistedDeleted = new Set(response.deleted_ids)
      const persistedNext = previousReviewSetCards.filter(card => !persistedDeleted.has(card.id))
      reviewSetCards.value = { ...reviewSetCards.value, [reviewSetId]: persistedNext }
      cards.value = previousCards.filter(card => !persistedDeleted.has(card.id))
      if (reviewSet) reviewSet.matchingCardCount = persistedNext.length
      useSnackbarStore().showDeletion(
        persistedDeleted.size === 1 ? 'Card' : `${persistedDeleted.size} cards`,
      )
      return []
    } catch (cause) {
      reviewSetCards.value = { ...reviewSetCards.value, [reviewSetId]: previousReviewSetCards }
      cards.value = previousCards
      if (reviewSet && previousCount !== undefined) reviewSet.matchingCardCount = previousCount
      throw cause
    }
  }

  async function saveReviewSetCard(
    reviewSetId: string,
    draft: FlashcardDraft,
    audio?: { front: FlashcardAudioValue; back: FlashcardAudioValue },
  ) {
    const payload: Record<string, unknown> = {
      front: draft.front,
      back: draft.back,
      transliteration: draft.transliteration || '',
      note: draft.note,
    }
    const previousReviewSetCards = reviewSetCards.value[reviewSetId] || []
    const previousCards = cards.value
    const sessionSnapshots = sessions.value.map(session => ({
      session,
      queue: session.queue.map(card => ({ ...card, tags: [...card.tags] })),
      totalCards: session.totalCards,
    }))
    const existing = draft.id
      ? previousReviewSetCards.find(card => card.id === draft.id)
        || cards.value.find(card => card.id === draft.id)
      : undefined
    if (existing) {
      const optimisticCard: Flashcard = {
        ...existing,
        front: draft.front,
        back: draft.back,
        transliteration: draft.transliteration || '',
        note: draft.note,
        frontAudio: audio?.front.recording
          ? existing.frontAudio
          : audio?.front.url ?? existing.frontAudio,
        backAudio: audio?.back.recording
          ? existing.backAudio
          : audio?.back.url ?? existing.backAudio,
        updatedAt: new Date().toISOString(),
      }
      reviewSetCards.value = {
        ...reviewSetCards.value,
        [reviewSetId]: previousReviewSetCards.map(card => (
          card.id === optimisticCard.id ? optimisticCard : card
        )),
      }
      const ownedIndex = cards.value.findIndex(card => card.id === optimisticCard.id)
      if (ownedIndex >= 0) cards.value.splice(ownedIndex, 1, optimisticCard)
      sessions.value.forEach((session) => {
        const queueIndex = session.queue.findIndex(card => card.id === optimisticCard.id)
        if (queueIndex >= 0) {
          session.queue.splice(queueIndex, 1, {
            id: optimisticCard.id,
            front: optimisticCard.front,
            back: optimisticCard.back,
            note: optimisticCard.note,
            frontAudio: optimisticCard.frontAudio,
            backAudio: optimisticCard.backAudio,
            tags: [...optimisticCard.tags],
          })
        }
      })
    }
    try {
      let record = draft.id
        ? await api.updateFlashcardReviewSetCard(reviewSetId, draft.id, payload)
        : await api.createFlashcardReviewSetCard(reviewSetId, payload)
      for (const side of ['front', 'back'] as const) {
        const value = audio?.[side]
        if (!value || (!value.recording && value.url === value.existingUrl)) continue
        record = value.recording
          ? await api.updateFlashcardReviewSetCardAudio(
              reviewSetId,
              record.id,
              side,
              value.recording,
            )
          : await api.removeFlashcardReviewSetCardAudio(reviewSetId, record.id, side)
      }
      const card = mapCard(record)
      const current = reviewSetCards.value[reviewSetId] || []
      const index = current.findIndex(item => item.id === card.id)
      const next = [...current]
      if (index >= 0) next.splice(index, 1, card)
      else next.unshift(card)
      reviewSetCards.value = { ...reviewSetCards.value, [reviewSetId]: next }
      const reviewSet = reviewSets.value.find(item => item.id === reviewSetId)
      if (reviewSet) reviewSet.matchingCardCount = next.length
      if (reviewSet?.owner === api.authStore.record?.id) {
        const cardIndex = cards.value.findIndex(item => item.id === card.id)
        if (cardIndex >= 0) cards.value.splice(cardIndex, 1, card)
        else cards.value.unshift(card)
      }
      return card
    } catch (cause) {
      reviewSetCards.value = { ...reviewSetCards.value, [reviewSetId]: previousReviewSetCards }
      cards.value = previousCards
      sessionSnapshots.forEach(({ session, queue, totalCards }) => {
        session.queue = queue
        session.totalCards = totalCards
      })
      throw cause
    }
  }

  async function deleteReviewSetCard(reviewSetId: string, cardId: string) {
    const previousReviewSetCards = reviewSetCards.value[reviewSetId] || []
    const previousCards = cards.value
    const reviewSet = reviewSets.value.find(item => item.id === reviewSetId)
    const previousCount = reviewSet?.matchingCardCount
    const next = (reviewSetCards.value[reviewSetId] || []).filter(card => card.id !== cardId)
    reviewSetCards.value = { ...reviewSetCards.value, [reviewSetId]: next }
    cards.value = cards.value.filter(card => card.id !== cardId)
    if (reviewSet) reviewSet.matchingCardCount = next.length
    try {
      await api.deleteFlashcardReviewSetCard(reviewSetId, cardId)
    } catch (cause) {
      reviewSetCards.value = { ...reviewSetCards.value, [reviewSetId]: previousReviewSetCards }
      cards.value = previousCards
      if (reviewSet && previousCount !== undefined) reviewSet.matchingCardCount = previousCount
      throw cause
    }
    useSnackbarStore().showDeletion('Card')
  }

  async function loadReviewSetShares(id: string) {
    return (await api.getFlashcardReviewSetShares(id)).map(mapReviewSetShare)
  }

  async function createReviewSetShare(
    id: string,
    email: string,
    role: FlashcardReviewSetShare['role'],
  ) {
    return mapReviewSetShare(await api.createFlashcardReviewSetShare(id, email, role))
  }

  async function updateReviewSetShare(shareId: string, role: FlashcardReviewSetShare['role']) {
    return mapReviewSetShare(await api.updateFlashcardReviewSetShare(shareId, role))
  }

  async function removeReviewSetShare(shareId: string, reviewSetId?: string) {
    const previousReviewSets = reviewSets.value
    const previousCards = reviewSetId ? reviewSetCards.value[reviewSetId] : undefined
    if (reviewSetId) {
      reviewSets.value = reviewSets.value.filter(set => set.id !== reviewSetId)
      delete reviewSetCards.value[reviewSetId]
    }
    try {
      await api.removeFlashcardReviewSetShare(shareId)
    } catch (cause) {
      reviewSets.value = previousReviewSets
      if (reviewSetId && previousCards) {
        reviewSetCards.value = { ...reviewSetCards.value, [reviewSetId]: previousCards }
      }
      throw cause
    }
  }

  async function copyReviewSet(id: string) {
    const reviewSet = mapReviewSet(await api.copyFlashcardReviewSet(id))
    reviewSets.value.push(reviewSet)
    reviewSets.value.sort((left, right) => (
      Number(left.accessRole !== 'owner') - Number(right.accessRole !== 'owner')
      || left.sortOrder - right.sortOrder
      || left.name.localeCompare(right.name)
    ))
    try {
      const copiedCards = (await api.getFlashcardReviewSetCards(reviewSet.id)).map(mapCard)
      reviewSetCards.value = { ...reviewSetCards.value, [reviewSet.id]: copiedCards }
      for (const card of copiedCards) {
        const cardIndex = cards.value.findIndex(item => item.id === card.id)
        if (cardIndex >= 0) cards.value.splice(cardIndex, 1, card)
        else cards.value.unshift(card)
        for (const tag of card.tagDetails || []) {
          if (!tags.value.some(item => item.id === tag.id)) tags.value.push(tag)
        }
      }
      tags.value.sort((left, right) => left.name.localeCompare(right.name))
    } catch {
      loaded.value = false
    }
    return reviewSet
  }

  async function deleteReviewSet(id: string) {
    error.value = ''
    const previousReviewSets = reviewSets.value
    const previousSessionSets = new Map(sessions.value.map(session => [session.id, session.reviewSet]))
    reviewSets.value = reviewSets.value.filter(set => set.id !== id)
    sessions.value.forEach((session) => {
      if (session.reviewSet === id) session.reviewSet = undefined
    })
    try {
      await api.collection('flashcard_review_sets').delete(id)
      useSnackbarStore().showDeletion('Review set')
    } catch (cause) {
      reviewSets.value = previousReviewSets
      sessions.value.forEach((session) => {
        session.reviewSet = previousSessionSets.get(session.id)
      })
      const tasks = cause instanceof ApiError && Array.isArray(cause.details.tasks)
        ? cause.details.tasks.map(item => typeof item === 'object' && item && 'name' in item ? String(item.name) : '').filter(Boolean)
        : []
      const intervals = cause instanceof ApiError && Array.isArray(cause.details.intervals)
        ? cause.details.intervals.map(item => typeof item === 'object' && item && 'name' in item ? String(item.name) : '').filter(Boolean)
        : []
      error.value = cause instanceof Error
        ? `${cause.message}${tasks.length ? ` Attached tasks: ${tasks.join(', ')}.` : ''}${intervals.length ? ` Attached intervals: ${intervals.join(', ')}.` : ''}`
        : 'Could not delete this Review set.'
      throw cause
    }
  }

  function matchingCards(tagIds: string[]) {
    return cards.value.filter(card => cardMatchesTags(card, tagIds))
  }

  async function startReview(
    reviewSetId: string,
    attribution: {
      task?: string
      programStep?: string
      programStepCompletion?: string
      taskDate?: string
    } = {},
  ) {
    const active = activeSession.value
    if (active) {
      const sameLaunch = active.reviewSet === reviewSetId
        && (active.task || '') === (attribution.task || '')
        && (active.programStep || '') === (attribution.programStep || '')
        && (active.programStepCompletion || '') === (attribution.programStepCompletion || '')
        && (active.taskDate || '') === (attribution.taskDate || '')
      if (sameLaunch) return active
      throw new Error(`${active.name} is already in progress. Finish or end it before starting another review.`)
    }
    const accountId = api.authStore.record?.id || ''
    let record: Record<string, any>
    if (accountId && await hasLocalBootstrap(accountId)) {
      const reviewSet = reviewSets.value.find(item => item.id === reviewSetId)
      if (!reviewSet) throw new Error('Review set not found.')
      let availableCards = reviewSet.accessRole === 'owner'
        ? cards.value
        : reviewSetCards.value[reviewSetId]
      if (!availableCards) availableCards = await loadReviewSetCards(reviewSetId)
      const preview = createFlashcardReviewPreviewSession(reviewSet, availableCards)
      if (!preview) throw new Error('No cards match this Review set.')
      const now = new Date().toISOString()
      record = await api.collection('flashcard_review_sessions').create({
        source_owner: reviewSet.owner,
        review_set: reviewSetId,
        status: 'running',
        snapshot_name: preview.name,
        mode_snapshot: preview.mode,
        card_sides_snapshot: preview.cardSides,
        indefinite_snapshot: preview.indefinite,
        time_limit_seconds_snapshot: preview.timeLimitSeconds || 0,
        max_cards_snapshot: preview.maxCards,
        eject_behavior_snapshot: preview.ejectBehavior,
        sort_snapshot: preview.sortMode,
        sort_direction_snapshot: preview.sortDirection,
        tags_snapshot: preview.tags,
        excluded_cards_snapshot: preview.excludedCards || [],
        front_seconds_snapshot: preview.frontSeconds,
        back_seconds_snapshot: preview.backSeconds,
        back_speech_repeat_count_snapshot: preview.backSpeechRepeatCount,
        note_before_back_snapshot: preview.noteBeforeBack,
        speech_enabled_snapshot: preview.speechEnabled,
        front_language_snapshot: preview.frontLanguage,
        back_language_snapshot: preview.backLanguage,
        queue_state: preview.queue,
        reserve_card_ids: preview.reserveCardIds,
        started_at: now,
        ended_at: '',
        updated_at: now,
        elapsed_seconds: 0,
        total_cards: preview.queue.length,
        viewed_count: 0,
        success_count: 0,
        error_count: 0,
        ejected_count: 0,
        task: attribution.task || '',
        program_step: attribution.programStep || '',
        program_step_completion: attribution.programStepCompletion || '',
        task_date: attribution.task ? attribution.taskDate || '' : '',
      })
    } else {
      record = await api.startFlashcardReviewSession(reviewSetId, attribution)
    }
    const session = mapSession(record)
    sessions.value.unshift(session)
    return session
  }

  async function act(
    sessionId: string,
    action: FlashcardReviewAction,
    elapsedSeconds: number,
    viewCount = 1,
  ) {
    const currentSession = sessions.value.find(session => session.id === sessionId)
    const normalizedViewCount = action === 'view' ? Math.max(1, Math.round(viewCount)) : 1
    const reviewedCards = currentSession?.queue.length
      ? Array.from(
          {
            length: action === 'view' && currentSession.indefinite
              ? normalizedViewCount
              : Math.min(normalizedViewCount, currentSession.queue.length),
          },
          (_, index) => currentSession.queue[index % currentSession.queue.length]!,
        )
      : []
    const accountId = api.authStore.record?.id || ''
    const usingLocalDatabase = Boolean(accountId && await hasLocalBootstrap(accountId))
    const response = usingLocalDatabase
      ? await actOnLocalSession(sessionId, action, elapsedSeconds, normalizedViewCount)
      : await api.actOnFlashcardReviewSession(sessionId, action, elapsedSeconds, normalizedViewCount)
    const session = mapSession(response.session)
    const index = sessions.value.findIndex(item => item.id === session.id)
    if (index >= 0) sessions.value.splice(index, 1, session)
    else sessions.value.unshift(session)

    if (
      flashcardEjectExcludes(session.ejectBehavior)
      && (action === 'eject' || action === 'undo_eject')
      && session.reviewSet
    ) {
      const reviewSet = reviewSets.value.find(item => item.id === session.reviewSet)
      if (reviewSet) {
        if (usingLocalDatabase) {
          await saveReviewSetPreferences(reviewSet.id, {
            ...reviewSet,
            excludedCards: [...(session.excludedCards || [])],
          })
        } else {
          reviewSet.excludedCards = [...(session.excludedCards || [])]
        }
      }
    }

    if (['success', 'error', 'view'].includes(action)) {
      reviewedCards.forEach((reviewedCard) => {
        const card = cards.value.find(item => item.id === reviewedCard.id)
        if (!card) return
        card.lastReviewedAt = new Date().toISOString()
        if (action === 'success') card.successCount += 1
        else if (action === 'error') card.errorCount += 1
        else card.passiveViews += 1
      })
    }
    const taskStore = useTaskStore()
    const progressOccurrences = response.occurrences || []
    progressOccurrences.forEach(record => taskStore.upsertOccurrenceRecord(record))
    if (response.occurrence && !progressOccurrences.some(record => record.id === response.occurrence?.id)) {
      taskStore.upsertOccurrenceRecord(response.occurrence)
    }
    const progressEntries = response.entries || []
    progressEntries.forEach(record => taskStore.upsertEntryRecord(record))
    if (usingLocalDatabase && ['completed', 'ended'].includes(session.status)) {
      await taskStore.applyLocalSessionProgress({
        id: session.id,
        sourceType: 'flashcards',
        sourceId: session.reviewSet,
        taskId: session.task,
        programStepId: session.programStep,
        programStepCompletionId: session.programStepCompletion,
        taskDate: session.taskDate,
        startedAt: session.startedAt,
        status: session.status === 'completed' ? 'completed' : 'ended',
        elapsedSeconds: session.elapsedSeconds,
        completedAt: session.endedAt || new Date().toISOString(),
      })
    }
    return session
  }

  async function updateSessionSettings(sessionId: string, settings: FlashcardReviewSettings) {
    const current = sessions.value.find(item => item.id === sessionId)
    const previous = current
      ? { ...current, reserveCardIds: [...(current.reserveCardIds || [])] }
      : undefined
    try {
      const accountId = api.authStore.record?.id || ''
      const usingLocalDatabase = Boolean(accountId && await hasLocalBootstrap(accountId))
      let reserveCardIds = [...(current?.reserveCardIds || [])]
      if (current && !flashcardEjectLoadsNext(settings.ejectBehavior)) {
        reserveCardIds = []
      } else if (
        current
        && usingLocalDatabase
        && flashcardEjectLoadsNext(settings.ejectBehavior)
        && !flashcardEjectLoadsNext(current.ejectBehavior)
      ) {
        const reviewSet = reviewSets.value.find(item => item.id === current.reviewSet)
        if (!reviewSet) throw new Error('The Review set for this session is no longer available.')
        let availableCards = reviewSet.accessRole === 'owner'
          ? cards.value
          : reviewSetCards.value[reviewSet.id]
        if (!availableCards) availableCards = await loadReviewSetCards(reviewSet.id)
        const queueState = flashcardReviewQueueState({
          ...reviewSet,
          ...settings,
          ejectBehavior: settings.ejectBehavior,
          tags: [...current.tags],
          excludedCards: [...(current.excludedCards || [])],
        }, availableCards)
        const events = await api.collection('flashcard_review_events').getFullList({
          filter: `session = "${sessionId}"`,
        })
        const unavailableIds = new Set(current.queue.map(card => card.id))
        events.forEach((event) => {
          if (!settings.indefinite || event.outcome === 'ejected' || event.outcome === 'eject') {
            unavailableIds.add(event.card)
          }
        })
        reserveCardIds = [
          ...queueState.queue.map(card => card.id),
          ...queueState.reserveCardIds,
        ].filter(id => !unavailableIds.has(id))
      }
      if (current) {
        Object.assign(current, {
          ...settings,
          indefinite: settings.mode === 'passive' && settings.indefinite,
          reserveCardIds,
        })
      }
      const record = usingLocalDatabase
        ? await api.collection('flashcard_review_sessions').update(sessionId, {
          mode_snapshot: settings.mode,
          card_sides_snapshot: settings.cardSides,
          indefinite_snapshot: settings.mode === 'passive' && settings.indefinite,
          time_limit_seconds_snapshot: settings.timeLimitSeconds || 0,
          max_cards_snapshot: settings.maxCards,
          eject_behavior_snapshot: settings.ejectBehavior,
          front_seconds_snapshot: settings.frontSeconds,
          back_seconds_snapshot: settings.backSeconds,
          back_speech_repeat_count_snapshot: settings.backSpeechRepeatCount,
          note_before_back_snapshot: settings.noteBeforeBack,
          speech_enabled_snapshot: settings.speechEnabled,
          front_language_snapshot: settings.frontLanguage,
          back_language_snapshot: settings.backLanguage,
          sort_snapshot: settings.sortMode,
          sort_direction_snapshot: settings.sortDirection,
          reserve_card_ids: reserveCardIds,
          updated_at: new Date().toISOString(),
          })
        : await api.updateFlashcardReviewSessionSettings(sessionId, settings)
      const session = mapSession(record)
      const index = sessions.value.findIndex(item => item.id === session.id)
      if (index >= 0) sessions.value.splice(index, 1, session)
      else sessions.value.unshift(session)
      return session
    } catch (cause) {
      if (current && previous) Object.assign(current, previous)
      throw cause
    }
  }

  async function actOnLocalSession(
    sessionId: string,
    action: FlashcardReviewAction,
    elapsedSeconds: number,
    viewCount = 1,
  ) {
    const current = sessions.value.find(session => session.id === sessionId)
    if (!current) throw new Error('Flashcard review not found.')
    if (['completed', 'ended'].includes(current.status)) {
      throw new Error('This flashcard review has already ended.')
    }

    let queue = current.queue.map(card => ({ ...card, tags: [...card.tags] }))
    let reserveCardIds = [...(current.reserveCardIds || [])]
    let excludedCards = [...(current.excludedCards || [])]
    const now = new Date().toISOString()
    let status = current.status
    let endedAt = current.endedAt || ''
    let viewedCount = current.viewedCount
    let successCount = current.successCount
    let errorCount = current.errorCount
    let ejectedCount = current.ejectedCount
    let totalCards = current.totalCards
    const events = new Map<string, Record<string, unknown>>()
    let undoneEjectEventId = ''

    if (action === 'restart') {
      const reviewSet = reviewSets.value.find(item => item.id === current.reviewSet)
      if (!reviewSet) throw new Error('The Review set for this session is no longer available.')
      let availableCards = reviewSet.accessRole === 'owner'
        ? cards.value
        : reviewSetCards.value[reviewSet.id]
      if (!availableCards) availableCards = await loadReviewSetCards(reviewSet.id)
      const queueState = flashcardReviewQueueState({
        ...reviewSet,
        tags: [...current.tags],
        excludedCards: [...(current.excludedCards || [])],
        sortMode: current.sortMode,
        sortDirection: current.sortDirection,
        maxCards: current.maxCards,
        ejectBehavior: current.ejectBehavior,
      }, availableCards)
      queue = queueState.queue
      reserveCardIds = queueState.reserveCardIds
      if (!queue.length) throw new Error('No flashcards match this Review set.')
      endedAt = ''
      viewedCount = 0
      successCount = 0
      errorCount = 0
      ejectedCount = 0
      totalCards = queue.length
    } else if (action === 'pause') {
      status = 'paused'
    } else if (action === 'resume') {
      status = 'running'
    } else if (action === 'end') {
      const reachedTimeLimit = Boolean(
        current.timeLimitSeconds
        && elapsedSeconds >= current.timeLimitSeconds,
      )
      status = reachedTimeLimit || (current.indefinite && viewedCount + ejectedCount > 0)
        ? 'completed'
        : 'ended'
      endedAt = now
    } else {
      if (status !== 'running') throw new Error('Resume this flashcard review before continuing.')
      if (action === 'undo_eject') {
        if (ejectedCount <= 0) throw new Error('There is no ejected flashcard to restore.')
        const ejectedEvents = await api.collection('flashcard_review_events').getFullList({
          filter: `session = "${sessionId}"`,
          sort: '-reviewed_at,-id',
        })
        const lastEject = ejectedEvents.find(event => (
          event.outcome === 'ejected' || event.outcome === 'eject'
        ))
        if (!lastEject) throw new Error('There is no ejected flashcard to restore.')
        const reviewSet = reviewSets.value.find(item => item.id === current.reviewSet)
        if (!reviewSet) throw new Error('The Review set for this session is no longer available.')
        let availableCards = reviewSet.accessRole === 'owner'
          ? cards.value
          : reviewSetCards.value[reviewSet.id]
        if (!availableCards) availableCards = await loadReviewSetCards(reviewSet.id)
        const card = availableCards.find(item => item.id === lastEject.card)
        if (!card) throw new Error('The last ejected flashcard is no longer available.')
        queue.unshift({
          id: card.id,
          front: card.front,
          back: card.back,
          note: card.note,
          frontAudio: card.frontAudio,
          backAudio: card.backAudio,
          tags: [...card.tags],
        })
        ejectedCount -= 1
        if (flashcardEjectExcludes(current.ejectBehavior)) {
          excludedCards = updateFlashcardReviewExclusions(excludedCards, 'include', [card.id])
        }
        undoneEjectEventId = lastEject.id
      } else if (!queue.length) {
        throw new Error('This flashcard review has no remaining cards.')
      } else if (action === 'previous') {
        if (queue.length > 1) queue.unshift(queue.pop()!)
      } else if (action === 'next' || action === 'push') {
        if (queue.length > 1) queue.push(queue.shift()!)
      } else {
        const iterations = action === 'view' ? Math.max(1, Math.round(viewCount)) : 1
        for (let index = 0; index < iterations && queue.length; index += 1) {
          const card = queue.shift()!
          const outcome = action === 'view' ? 'passive' : action === 'eject' ? 'ejected' : action
          if (action === 'eject') {
            ejectedCount += 1
            if (flashcardEjectExcludes(current.ejectBehavior)) {
              excludedCards = updateFlashcardReviewExclusions(excludedCards, 'exclude', [card.id])
            }
            if (flashcardEjectLoadsNext(current.ejectBehavior) && reserveCardIds.length) {
              const reviewSet = reviewSets.value.find(item => item.id === current.reviewSet)
              if (!reviewSet) {
                throw new Error('The Review set for this session is no longer available.')
              }
              let availableCards = reviewSet.accessRole === 'owner'
                ? cards.value
                : reviewSetCards.value[reviewSet.id]
              if (!availableCards) availableCards = await loadReviewSetCards(reviewSet.id)
              while (reserveCardIds.length && queue.length < current.maxCards) {
                const replacementId = reserveCardIds.shift()!
                const replacement = availableCards.find(item => item.id === replacementId)
                if (!replacement) continue
                queue.push({
                  id: replacement.id,
                  front: replacement.front,
                  back: replacement.back,
                  note: replacement.note,
                  frontAudio: replacement.frontAudio,
                  backAudio: replacement.backAudio,
                  tags: [...replacement.tags],
                })
                totalCards += 1
              }
            }
          }
          else {
            viewedCount += 1
            if (action === 'success') successCount += 1
            if (action === 'error') errorCount += 1
            if (action === 'view' && current.indefinite) queue.push(card)
          }
          const eventKey = outcome === 'passive'
            ? card.id
            : `${outcome}:${card.id}:${events.size}`
          const existingEvent = events.get(eventKey)
          if (existingEvent && outcome === 'passive') {
            existingEvent.view_count = Number(existingEvent.view_count || 1) + 1
          } else {
            events.set(eventKey, {
              session: sessionId,
              card: card.id,
              outcome,
              view_count: 1,
              reviewed_at: now,
              front_snapshot: card.front,
              back_snapshot: card.back,
              tags_snapshot: card.tags,
            })
          }
          if (!queue.length) {
            status = 'completed'
            endedAt = now
          }
        }
      }
    }
    if (current.indefinite && !flashcardEjectLoadsNext(current.ejectBehavior)) {
      totalCards = queue.length
    }

    const previous = {
      ...current,
      queue: current.queue.map(card => ({ ...card, tags: [...card.tags] })),
      reserveCardIds: [...(current.reserveCardIds || [])],
      excludedCards: [...(current.excludedCards || [])],
    }
    const nextElapsedSeconds = action === 'restart'
        ? 0
        : Math.max(
            current.elapsedSeconds,
            Math.min(
              current.timeLimitSeconds || Number.POSITIVE_INFINITY,
              Math.round(elapsedSeconds),
            ),
          )
    Object.assign(current, {
      status,
      queue,
      reserveCardIds,
      excludedCards,
      updatedAt: now,
      endedAt: endedAt || undefined,
      elapsedSeconds: nextElapsedSeconds,
      viewedCount,
      successCount,
      errorCount,
      ejectedCount,
      totalCards,
    })
    try {
      await Promise.all(Array.from(events.values())
        .map(event => api.collection('flashcard_review_events').create(event)))
      if (undoneEjectEventId) {
        await api.collection('flashcard_review_events').delete(undoneEjectEventId)
      }
      const session = await api.collection('flashcard_review_sessions').update(sessionId, {
        status,
        queue_state: queue,
        reserve_card_ids: reserveCardIds,
        excluded_cards_snapshot: excludedCards,
        updated_at: now,
        ended_at: endedAt,
        elapsed_seconds: nextElapsedSeconds,
        viewed_count: viewedCount,
        success_count: successCount,
        error_count: errorCount,
        ejected_count: ejectedCount,
        total_cards: totalCards,
      })
      return { session, occurrence: null, occurrences: [], entries: [] }
    } catch (cause) {
      Object.assign(current, previous)
      throw cause
    }
  }

  return {
    tags,
    cards,
    reviewSets,
    reviewSetCards,
    sessions,
    events,
    loading,
    loaded,
    error,
    activeSession,
    recentSessions,
    load,
    loadSession,
    loadEvents,
    createTag,
    renameTag,
    deleteTag,
    saveCard,
    deleteCard,
    deleteSession,
    importCards,
    bulkUpdateCards,
    saveReviewSet,
    saveReviewSetPreferences,
    reorderReviewSets,
    deleteReviewSet,
    loadReviewSetCards,
    importReviewSetCards,
    bulkUpdateReviewSetCards,
    saveReviewSetCard,
    deleteReviewSetCard,
    loadReviewSetShares,
    createReviewSetShare,
    updateReviewSetShare,
    removeReviewSetShare,
    copyReviewSet,
    matchingCards,
    startReview,
    act,
    updateSessionSettings,
  }
})
