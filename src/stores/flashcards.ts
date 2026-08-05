import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { ApiError, api } from '@/lib/api'
import { cardMatchesTags } from '@/services/flashcards'
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
  FlashcardTag,
} from '@/types/domain'

function mapTag(record: Record<string, any>): FlashcardTag {
  return { id: record.id, name: record.name }
}

function mapCard(record: Record<string, any>): Flashcard {
  return {
    id: record.id,
    front: record.front,
    back: record.back,
    tags: Array.isArray(record.tags) ? record.tags : [],
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
    mode: record.mode,
    frontSeconds: Number(record.front_seconds || 5),
    backSeconds: Number(record.back_seconds || 5),
    speechEnabled: Boolean(record.speech_enabled),
    frontLanguage: record.front_language || '',
    backLanguage: record.back_language || '',
    sortMode: record.sort_mode,
    sortOrder: Number(record.sort_order || 0),
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
    sortMode: record.sort_snapshot,
    tags: Array.isArray(record.tags_snapshot) ? record.tags_snapshot : [],
    frontSeconds: Number(record.front_seconds_snapshot || 5),
    backSeconds: Number(record.back_seconds_snapshot || 5),
    speechEnabled: Boolean(record.speech_enabled_snapshot),
    frontLanguage: record.front_language_snapshot || '',
    backLanguage: record.back_language_snapshot || '',
    queue: Array.isArray(record.queue_state) ? record.queue_state : [],
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
        api.collection('flashcard_review_sets').getFullList({ sort: 'sort_order,name' }),
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

  async function saveCard(draft: FlashcardDraft) {
    const payload = {
      owner: api.authStore.record!.id,
      front: draft.front,
      back: draft.back,
      tags: draft.tags,
    }
    const record = draft.id
      ? await api.collection('flashcards').update(draft.id, payload)
      : await api.collection('flashcards').create(payload)
    const card = mapCard(record)
    const index = cards.value.findIndex(item => item.id === card.id)
    if (index >= 0) cards.value.splice(index, 1, card)
    else cards.value.unshift(card)
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
      front_seconds: draft.frontSeconds,
      back_seconds: draft.backSeconds,
      speech_enabled: draft.speechEnabled,
      front_language: draft.frontLanguage,
      back_language: draft.backLanguage,
      sort_mode: draft.sortMode,
      sort_order: draft.sortOrder,
    }
    const record = draft.id
      ? await api.collection('flashcard_review_sets').update(draft.id, payload)
      : await api.collection('flashcard_review_sets').create(payload)
    const reviewSet = mapReviewSet(record)
    const index = reviewSets.value.findIndex(item => item.id === reviewSet.id)
    if (index >= 0) reviewSets.value.splice(index, 1, reviewSet)
    else reviewSets.value.push(reviewSet)
    reviewSets.value.sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name))
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
    if (activeSession.value) return activeSession.value
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

  return {
    tags,
    cards,
    reviewSets,
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
    deleteReviewSet,
    matchingCards,
    startReview,
    act,
  }
})
