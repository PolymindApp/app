import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { ApiError, api, apiAssetUrl } from '@/lib/api'
import {
  cardMatchesTags,
  DEFAULT_FLASHCARD_BACK_SPEECH_REPEATS,
  DEFAULT_FLASHCARD_REVIEW_CARD_SIDES,
  DEFAULT_FLASHCARD_SESSION_CARDS,
} from '@/services/flashcards'
import { useSnackbarStore } from '@/stores/snackbar'
import { useTaskStore } from '@/stores/tasks'
import type {
  Flashcard,
  FlashcardBulkAction,
  FlashcardDraft,
  FlashcardImportRow,
  FlashcardReviewAction,
  FlashcardReviewEvent,
  FlashcardReviewSession,
  FlashcardReviewSet,
  FlashcardReviewSetDraft,
  FlashcardReviewSetShare,
  FlashcardReviewSettings,
  FlashcardTag,
  SquareImageSourceValue,
} from '@/types/domain'

function mapTag(record: Record<string, any>): FlashcardTag {
  return { id: record.id, name: record.name }
}

function mapCard(record: Record<string, any>): Flashcard {
  const imageFile = typeof record.image_file === 'string' ? record.image_file : ''
  const imageUrl = typeof record.image_url === 'string' ? record.image_url : ''
  return {
    id: record.id,
    front: record.front,
    back: record.back,
    note: record.note || '',
    image: imageFile ? apiAssetUrl(`/flashcard-images/${imageFile}`) : imageUrl,
    imageSource: imageFile ? 'upload' : imageUrl ? 'url' : 'none',
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
    shareId: record.share_id || undefined,
    matchingCardCount: Number(record.matching_card_count || 0),
    mode: record.mode,
    cardSides: record.card_sides || DEFAULT_FLASHCARD_REVIEW_CARD_SIDES,
    indefinite: Boolean(record.indefinite),
    maxCards: Number(record.max_cards || DEFAULT_FLASHCARD_SESSION_CARDS),
    frontSeconds: Number(record.front_seconds || 5),
    backSeconds: Number(record.back_seconds || 5),
    backSpeechRepeatCount: Number(
      record.back_speech_repeat_count || DEFAULT_FLASHCARD_BACK_SPEECH_REPEATS,
    ),
    speechEnabled: Boolean(record.speech_enabled),
    frontLanguage: record.front_language || '',
    backLanguage: record.back_language || '',
    sortMode: record.sort_mode,
    sortOrder: Number(record.sort_order || 0),
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  }
}

function mapReviewSetShare(record: Record<string, any>): FlashcardReviewSetShare {
  return {
    id: record.id,
    reviewSet: record.review_set,
    recipient: record.recipient,
    role: record.role,
    name: record.name || '',
    email: record.email || '',
    avatar: apiAssetUrl(record.avatar || ''),
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
    maxCards: Number(record.max_cards_snapshot || DEFAULT_FLASHCARD_SESSION_CARDS),
    sortMode: record.sort_snapshot,
    tags: Array.isArray(record.tags_snapshot) ? record.tags_snapshot : [],
    frontSeconds: Number(record.front_seconds_snapshot || 5),
    backSeconds: Number(record.back_seconds_snapshot || 5),
    backSpeechRepeatCount: Number(
      record.back_speech_repeat_count_snapshot || DEFAULT_FLASHCARD_BACK_SPEECH_REPEATS,
    ),
    speechEnabled: Boolean(record.speech_enabled_snapshot),
    frontLanguage: record.front_language_snapshot || '',
    backLanguage: record.back_language_snapshot || '',
    queue: Array.isArray(record.queue_state)
      ? record.queue_state.map((card: Record<string, any>) => ({
          ...card,
          image: apiAssetUrl(typeof card.image === 'string' ? card.image : ''),
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
    taskDate: record.task_date || undefined,
  }
}

function mapEvent(record: Record<string, any>): FlashcardReviewEvent {
  return {
    id: record.id,
    session: record.session,
    card: record.card || undefined,
    outcome: record.outcome,
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
    const record = await api.collection('flashcard_tags').create({
      owner: api.authStore.record!.id,
      name: normalized,
    })
    const tag = mapTag(record)
    tags.value.push(tag)
    tags.value.sort((left, right) => left.name.localeCompare(right.name))
    return tag
  }

  async function renameTag(id: string, name: string) {
    const record = await api.collection('flashcard_tags').update(id, { name: name.trim() })
    const tag = mapTag(record)
    const index = tags.value.findIndex(item => item.id === id)
    if (index >= 0) tags.value.splice(index, 1, tag)
    tags.value.sort((left, right) => left.name.localeCompare(right.name))
    return tag
  }

  async function deleteTag(id: string) {
    await api.collection('flashcard_tags').delete(id)
    tags.value = tags.value.filter(tag => tag.id !== id)
    cards.value.forEach(card => { card.tags = card.tags.filter(tag => tag !== id) })
    reviewSets.value.forEach(set => { set.tags = set.tags.filter(tag => tag !== id) })
    useSnackbarStore().showDeletion('Tag')
  }

  async function saveCard(draft: FlashcardDraft, image?: SquareImageSourceValue) {
    const imageChanged = Boolean(image && (
      image.upload
      || image.source !== image.existingSource
      || (image.source === 'url' && image.url.trim() !== image.existingUrl)
    ))
    const payload: Record<string, unknown> = {
      owner: api.authStore.record!.id,
      front: draft.front,
      back: draft.back,
      note: draft.note,
      tags: draft.tags,
    }
    if (imageChanged && image?.source === 'url') payload.image_url = image.url.trim()

    let record = draft.id
      ? await api.collection('flashcards').update(draft.id, payload)
      : await api.collection('flashcards').create(payload)
    if (imageChanged && image) {
      if (image.source === 'upload' && image.upload) {
        record = await api.updateFlashcardImage(record.id, image.upload)
      } else if (image.source === 'none' && draft.id) {
        record = await api.removeFlashcardImage(record.id)
      }
    }
    const card = mapCard(record)
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
          image: card.image,
          tags: [...card.tags],
        }
        if (queueIndex >= 0) {
          session.queue.splice(queueIndex, 1, snapshot)
        } else if (
          !draft.id
          && cardMatchesTags(card, session.tags)
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

  async function deleteCard(id: string) {
    await api.collection('flashcards').delete(id)
    cards.value = cards.value.filter(card => card.id !== id)
    useSnackbarStore().showDeletion('Card')
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
    action: FlashcardBulkAction,
    cardIds: string[],
    tagIds: string[] = [],
  ) {
    const uniqueCardIds = [...new Set(cardIds)]
    if (!uniqueCardIds.length) return []
    const response = await api.bulkUpdateFlashcards(action, uniqueCardIds, [...new Set(tagIds)])
    if (action === 'delete') {
      const deleted = new Set(response.deleted_ids)
      cards.value = cards.value.filter(card => !deleted.has(card.id))
      useSnackbarStore().showDeletion(deleted.size === 1 ? 'Card' : `${deleted.size} cards`)
      return []
    }

    const updatedCards = response.cards.map(mapCard)
    const updates = new Map(updatedCards.map(card => [card.id, card]))
    cards.value = cards.value.map(card => updates.get(card.id) || card)
    return updatedCards
  }

  async function saveReviewSet(draft: FlashcardReviewSetDraft) {
    const payload = {
      owner: api.authStore.record!.id,
      name: draft.name,
      tags: draft.tags,
      mode: draft.mode,
      card_sides: draft.cardSides,
      indefinite: draft.mode === 'passive' && draft.indefinite,
      max_cards: draft.maxCards,
      front_seconds: draft.frontSeconds,
      back_seconds: draft.backSeconds,
      back_speech_repeat_count: draft.backSpeechRepeatCount,
      speech_enabled: draft.speechEnabled,
      front_language: draft.frontLanguage,
      back_language: draft.backLanguage,
      sort_mode: draft.sortMode,
      sort_order: draft.sortOrder,
    }
    const record = draft.id
      ? await api.collection('flashcard_review_sets').update(draft.id, payload)
      : await api.collection('flashcard_review_sets').create(payload)
    const accessibleRecords = await api.getAccessibleFlashcardReviewSets()
    reviewSets.value = accessibleRecords.map(mapReviewSet)
    const reviewSet = reviewSets.value.find(item => item.id === record.id) || mapReviewSet(record)
    return reviewSet
  }

  async function saveReviewSetPreferences(id: string, settings: FlashcardReviewSettings) {
    const record = await api.updateFlashcardReviewSetPreferences(id, settings)
    const reviewSet = mapReviewSet(record)
    const index = reviewSets.value.findIndex(item => item.id === id)
    if (index >= 0) reviewSets.value.splice(index, 1, reviewSet)
    else reviewSets.value.push(reviewSet)
    return reviewSet
  }

  async function loadReviewSetCards(id: string) {
    const records = await api.getFlashcardReviewSetCards(id)
    const mapped = records.map(mapCard)
    reviewSetCards.value = { ...reviewSetCards.value, [id]: mapped }
    const reviewSet = reviewSets.value.find(item => item.id === id)
    if (reviewSet) reviewSet.matchingCardCount = mapped.length
    return mapped
  }

  async function saveReviewSetCard(
    reviewSetId: string,
    draft: FlashcardDraft,
    image?: SquareImageSourceValue,
  ) {
    const imageChanged = Boolean(image && (
      image.upload
      || image.source !== image.existingSource
      || (image.source === 'url' && image.url.trim() !== image.existingUrl)
    ))
    const payload: Record<string, unknown> = {
      front: draft.front,
      back: draft.back,
      note: draft.note,
    }
    if (imageChanged && image?.source === 'url') payload.image_url = image.url.trim()
    let record = draft.id
      ? await api.updateFlashcardReviewSetCard(reviewSetId, draft.id, payload)
      : await api.createFlashcardReviewSetCard(reviewSetId, payload)
    if (imageChanged && image) {
      if (image.source === 'upload' && image.upload) {
        record = await api.updateFlashcardReviewSetCardImage(reviewSetId, record.id, image.upload)
      } else if (image.source === 'none' && draft.id) {
        record = await api.removeFlashcardReviewSetCardImage(reviewSetId, record.id)
      }
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
  }

  async function deleteReviewSetCard(reviewSetId: string, cardId: string) {
    await api.deleteFlashcardReviewSetCard(reviewSetId, cardId)
    const next = (reviewSetCards.value[reviewSetId] || []).filter(card => card.id !== cardId)
    reviewSetCards.value = { ...reviewSetCards.value, [reviewSetId]: next }
    cards.value = cards.value.filter(card => card.id !== cardId)
    const reviewSet = reviewSets.value.find(item => item.id === reviewSetId)
    if (reviewSet) reviewSet.matchingCardCount = next.length
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
    await api.removeFlashcardReviewSetShare(shareId)
    if (reviewSetId) {
      reviewSets.value = reviewSets.value.filter(set => set.id !== reviewSetId)
      delete reviewSetCards.value[reviewSetId]
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
    try {
      await api.collection('flashcard_review_sets').delete(id)
      reviewSets.value = reviewSets.value.filter(set => set.id !== id)
      sessions.value.forEach(session => {
        if (session.reviewSet === id) session.reviewSet = undefined
      })
      useSnackbarStore().showDeletion('Review set')
    } catch (cause) {
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
    attribution: { task?: string; programStep?: string; taskDate?: string } = {},
  ) {
    const active = activeSession.value
    if (active) {
      const sameLaunch = active.reviewSet === reviewSetId
        && (active.task || '') === (attribution.task || '')
        && (active.programStep || '') === (attribution.programStep || '')
        && (active.taskDate || '') === (attribution.taskDate || '')
      if (sameLaunch) return active
      throw new Error(`${active.name} is already in progress. Finish or end it before starting another review.`)
    }
    const record = await api.startFlashcardReviewSession(reviewSetId, attribution)
    const session = mapSession(record)
    sessions.value.unshift(session)
    return session
  }

  async function act(sessionId: string, action: FlashcardReviewAction, elapsedSeconds: number) {
    const current = sessions.value.find(session => session.id === sessionId)?.queue[0]
    const response = await api.actOnFlashcardReviewSession(sessionId, action, elapsedSeconds)
    const session = mapSession(response.session)
    const index = sessions.value.findIndex(item => item.id === session.id)
    if (index >= 0) sessions.value.splice(index, 1, session)
    else sessions.value.unshift(session)

    if (current && ['success', 'error', 'view'].includes(action)) {
      const card = cards.value.find(item => item.id === current.id)
      if (card) {
        card.lastReviewedAt = new Date().toISOString()
        if (action === 'success') card.successCount += 1
        else if (action === 'error') card.errorCount += 1
        else card.passiveViews += 1
      }
    }
    if (response.occurrence) useTaskStore().upsertOccurrenceRecord(response.occurrence)
    return session
  }

  async function updateSessionSettings(sessionId: string, settings: FlashcardReviewSettings) {
    const record = await api.updateFlashcardReviewSessionSettings(sessionId, settings)
    const session = mapSession(record)
    const index = sessions.value.findIndex(item => item.id === session.id)
    if (index >= 0) sessions.value.splice(index, 1, session)
    else sessions.value.unshift(session)
    return session
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
    importCards,
    bulkUpdateCards,
    saveReviewSet,
    saveReviewSetPreferences,
    deleteReviewSet,
    loadReviewSetCards,
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
