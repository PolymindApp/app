import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { ApiError, api, apiAssetUrl } from '@/lib/api'
import { hasLocalBootstrap } from '@/lib/localDatabase'
import {
  cardMatchesTags,
  createFlashcardReviewPreviewSession,
  DEFAULT_FLASHCARD_BACK_SPEECH_REPEATS,
  DEFAULT_FLASHCARD_REVIEW_CARD_SIDES,
  DEFAULT_FLASHCARD_SESSION_CARDS,
  flashcardReviewQueue,
} from '@/services/flashcards'
import { useSnackbarStore } from '@/stores/snackbar'
import { useTaskStore } from '@/stores/tasks'
import type {
  Flashcard,
  FlashcardBulkRecordAction,
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
  const libraryImageId = Number(record.library_image_id || 0)
  const imageMetadata = record.image_metadata && typeof record.image_metadata === 'object'
    && !Array.isArray(record.image_metadata)
    ? record.image_metadata
    : {}
  const resolvedImage = imageFile ? apiAssetUrl(`/flashcard-images/${imageFile}`) : imageUrl
  const libraryImage = libraryImageId > 0
    ? {
        id: libraryImageId,
        imageUrl: resolvedImage,
        alt: String(imageMetadata.alt || ''),
        photographer: String(imageMetadata.photographer || ''),
        photographerUrl: String(imageMetadata.photographer_url || ''),
        sourceUrl: String(imageMetadata.source_url || ''),
        licenseName: String(imageMetadata.license_name || ''),
        licenseUrl: String(imageMetadata.license_url || ''),
      }
    : undefined
  return {
    id: record.id,
    front: record.front,
    back: record.back,
    note: record.note || '',
    image: resolvedImage,
    imageSource: imageFile ? libraryImage ? 'library' : 'upload' : imageUrl ? 'url' : 'none',
    libraryImage,
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
    maxCards: Number(record.max_cards || DEFAULT_FLASHCARD_SESSION_CARDS),
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
    maxCards: Number(record.max_cards_snapshot || DEFAULT_FLASHCARD_SESSION_CARDS),
    sortMode: record.sort_snapshot,
    tags: Array.isArray(record.tags_snapshot) ? record.tags_snapshot : [],
    excludedCards: Array.isArray(record.excluded_cards_snapshot)
      ? record.excluded_cards_snapshot
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
    await Promise.all([
      ...cards.value
        .filter(card => card.tags.includes(id))
        .map(card => api.collection('flashcards').update(card.id, {
          tags: card.tags.filter(tag => tag !== id),
        })),
      ...reviewSets.value
        .filter(set => set.owner === api.authStore.record?.id && set.tags.includes(id))
        .map(set => api.collection('flashcard_review_sets').update(set.id, {
          tags: set.tags.filter(tag => tag !== id),
        })),
    ])
    tags.value = tags.value.filter(tag => tag.id !== id)
    cards.value.forEach(card => { card.tags = card.tags.filter(tag => tag !== id) })
    reviewSets.value.forEach(set => { set.tags = set.tags.filter(tag => tag !== id) })
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
          image: card.image,
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

  async function saveCard(draft: FlashcardDraft, image?: SquareImageSourceValue) {
    const imageChanged = Boolean(image && (
      image.upload
      || image.source !== image.existingSource
      || (image.source === 'url' && image.url.trim() !== image.existingUrl)
      || (image.source === 'library'
        && image.libraryImage?.id !== image.existingLibraryImageId)
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
      } else if (image.source === 'library' && image.libraryImage) {
        record = await api.setFlashcardLibraryImage(record.id, image.libraryImage.id)
      } else if (image.source === 'none' && draft.id) {
        record = await api.removeFlashcardImage(record.id)
      }
    }
    return cacheCard(mapCard(record), !draft.id)
  }

  async function assignLibraryImage(cardId: string, imageId: number) {
    const record = await api.setFlashcardLibraryImage(cardId, imageId)
    return cacheCard(mapCard(record))
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
    action: FlashcardBulkRecordAction,
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
    updatedCards.forEach(card => cacheCard(card))
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
      note_before_back: draft.noteBeforeBack,
      speech_enabled: draft.speechEnabled,
      front_language: draft.frontLanguage,
      back_language: draft.backLanguage,
      sort_mode: draft.sortMode,
      sort_order: draft.sortOrder,
      excluded_cards: draft.excludedCards || [],
    }
    const record = draft.id
      ? await api.collection('flashcard_review_sets').update(draft.id, payload)
      : await api.collection('flashcard_review_sets').create(payload)
    const accessibleRecords = await api.getAccessibleFlashcardReviewSets()
    reviewSets.value = accessibleRecords.map(mapReviewSet)
    const reviewSet = reviewSets.value.find(item => item.id === record.id) || mapReviewSet(record)
    return reviewSet
  }

  async function saveReviewSetPreferences(
    id: string,
    settings: FlashcardReviewSettings & { excludedCards?: string[] },
  ) {
    const record = await api.updateFlashcardReviewSetPreferences(id, settings)
    const reviewSet = mapReviewSet(record)
    const index = reviewSets.value.findIndex(item => item.id === id)
    if (index >= 0) reviewSets.value.splice(index, 1, reviewSet)
    else reviewSets.value.push(reviewSet)
    return reviewSet
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
    const response = await api.bulkUpdateFlashcardReviewSetCards(reviewSetId, uniqueCardIds)
    const deleted = new Set(response.deleted_ids)
    const next = (reviewSetCards.value[reviewSetId] || []).filter(card => !deleted.has(card.id))
    reviewSetCards.value = { ...reviewSetCards.value, [reviewSetId]: next }
    cards.value = cards.value.filter(card => !deleted.has(card.id))
    const reviewSet = reviewSets.value.find(item => item.id === reviewSetId)
    if (reviewSet) reviewSet.matchingCardCount = next.length
    useSnackbarStore().showDeletion(deleted.size === 1 ? 'Card' : `${deleted.size} cards`)
    return []
  }

  async function assignReviewSetLibraryImage(
    reviewSetId: string,
    cardId: string,
    imageId: number,
  ) {
    const record = await api.setFlashcardReviewSetCardLibraryImage(reviewSetId, cardId, imageId)
    const card = mapCard(record)
    const current = reviewSetCards.value[reviewSetId] || []
    reviewSetCards.value = {
      ...reviewSetCards.value,
      [reviewSetId]: current.map(item => item.id === card.id ? card : item),
    }
    const libraryIndex = cards.value.findIndex(item => item.id === card.id)
    if (libraryIndex >= 0) cards.value.splice(libraryIndex, 1, card)
    return card
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
      || (image.source === 'library'
        && image.libraryImage?.id !== image.existingLibraryImageId)
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
      } else if (image.source === 'library' && image.libraryImage) {
        record = await api.setFlashcardReviewSetCardLibraryImage(
          reviewSetId,
          record.id,
          image.libraryImage.id,
        )
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
        max_cards_snapshot: preview.maxCards,
        sort_snapshot: preview.sortMode,
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
        task_date: attribution.task ? attribution.taskDate || '' : '',
      })
    } else {
      record = await api.startFlashcardReviewSession(reviewSetId, attribution)
    }
    const session = mapSession(record)
    sessions.value.unshift(session)
    return session
  }

  async function act(sessionId: string, action: FlashcardReviewAction, elapsedSeconds: number) {
    const current = sessions.value.find(session => session.id === sessionId)?.queue[0]
    const accountId = api.authStore.record?.id || ''
    const usingLocalDatabase = Boolean(accountId && await hasLocalBootstrap(accountId))
    const response = usingLocalDatabase
      ? await actOnLocalSession(sessionId, action, elapsedSeconds)
      : await api.actOnFlashcardReviewSession(sessionId, action, elapsedSeconds)
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
    const accountId = api.authStore.record?.id || ''
    const record = accountId && await hasLocalBootstrap(accountId)
      ? await api.collection('flashcard_review_sessions').update(sessionId, {
          mode_snapshot: settings.mode,
          card_sides_snapshot: settings.cardSides,
          indefinite_snapshot: settings.mode === 'passive' && settings.indefinite,
          max_cards_snapshot: settings.maxCards,
          front_seconds_snapshot: settings.frontSeconds,
          back_seconds_snapshot: settings.backSeconds,
          back_speech_repeat_count_snapshot: settings.backSpeechRepeatCount,
          note_before_back_snapshot: settings.noteBeforeBack,
          speech_enabled_snapshot: settings.speechEnabled,
          front_language_snapshot: settings.frontLanguage,
          back_language_snapshot: settings.backLanguage,
          sort_snapshot: settings.sortMode,
          updated_at: new Date().toISOString(),
        })
      : await api.updateFlashcardReviewSessionSettings(sessionId, settings)
    const session = mapSession(record)
    const index = sessions.value.findIndex(item => item.id === session.id)
    if (index >= 0) sessions.value.splice(index, 1, session)
    else sessions.value.unshift(session)
    return session
  }

  async function actOnLocalSession(
    sessionId: string,
    action: FlashcardReviewAction,
    elapsedSeconds: number,
  ) {
    const current = sessions.value.find(session => session.id === sessionId)
    if (!current) throw new Error('Flashcard review not found.')
    if (['completed', 'ended'].includes(current.status)) {
      throw new Error('This flashcard review has already ended.')
    }

    let queue = current.queue.map(card => ({ ...card, tags: [...card.tags] }))
    const now = new Date().toISOString()
    let status = current.status
    let endedAt = current.endedAt || ''
    let viewedCount = current.viewedCount
    let successCount = current.successCount
    let errorCount = current.errorCount
    let ejectedCount = current.ejectedCount
    let totalCards = current.totalCards
    let event: Record<string, unknown> | undefined
    let undoneEjectEventId = ''

    if (action === 'restart') {
      const reviewSet = reviewSets.value.find(item => item.id === current.reviewSet)
      if (!reviewSet) throw new Error('The Review set for this session is no longer available.')
      let availableCards = reviewSet.accessRole === 'owner'
        ? cards.value
        : reviewSetCards.value[reviewSet.id]
      if (!availableCards) availableCards = await loadReviewSetCards(reviewSet.id)
      queue = flashcardReviewQueue({
        ...reviewSet,
        tags: [...current.tags],
        excludedCards: [...(current.excludedCards || [])],
        sortMode: current.sortMode,
        maxCards: current.maxCards,
      }, availableCards)
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
      status = current.indefinite && viewedCount + ejectedCount > 0 ? 'completed' : 'ended'
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
          image: card.image,
          tags: [...card.tags],
        })
        ejectedCount -= 1
        undoneEjectEventId = lastEject.id
      } else if (!queue.length) {
        throw new Error('This flashcard review has no remaining cards.')
      } else if (action === 'previous') {
        if (queue.length > 1) queue.unshift(queue.pop()!)
      } else if (action === 'next' || action === 'push') {
        if (queue.length > 1) queue.push(queue.shift()!)
      } else {
        const card = queue.shift()!
        const outcome = action === 'view' ? 'passive' : action === 'eject' ? 'ejected' : action
        if (action === 'eject') ejectedCount += 1
        else {
          viewedCount += 1
          if (action === 'success') successCount += 1
          if (action === 'error') errorCount += 1
          if (action === 'view' && current.indefinite) queue.push(card)
        }
        event = {
          session: sessionId,
          card: card.id,
          outcome,
          reviewed_at: now,
          front_snapshot: card.front,
          back_snapshot: card.back,
          tags_snapshot: card.tags,
        }
        if (!queue.length) {
          status = 'completed'
          endedAt = now
        }
      }
    }
    if (current.indefinite) totalCards = queue.length

    if (event) await api.collection('flashcard_review_events').create(event)
    if (undoneEjectEventId) {
      await api.collection('flashcard_review_events').delete(undoneEjectEventId)
    }
    const session = await api.collection('flashcard_review_sessions').update(sessionId, {
      status,
      queue_state: queue,
      updated_at: now,
      ended_at: endedAt,
      elapsed_seconds: action === 'restart'
        ? 0
        : Math.max(current.elapsedSeconds, Math.round(elapsedSeconds)),
      viewed_count: viewedCount,
      success_count: successCount,
      error_count: errorCount,
      ejected_count: ejectedCount,
      total_cards: totalCards,
    })
    return { session, occurrence: null, occurrences: [], entries: [] }
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
    assignLibraryImage,
    deleteCard,
    importCards,
    bulkUpdateCards,
    saveReviewSet,
    saveReviewSetPreferences,
    reorderReviewSets,
    deleteReviewSet,
    loadReviewSetCards,
    importReviewSetCards,
    bulkUpdateReviewSetCards,
    assignReviewSetLibraryImage,
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
