import { createPinia, setActivePinia } from 'pinia'
import type { FlashcardReviewSession } from '@/types/domain'

const mocks = vi.hoisted(() => ({
  createEvent: vi.fn(),
  deleteEvent: vi.fn(),
  listEvents: vi.fn(),
  updateSession: vi.fn(),
}))

vi.mock('@/lib/localDatabase', () => ({
  hasLocalBootstrap: vi.fn().mockResolvedValue(true),
}))

vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {
    details = {}
  },
  apiAssetUrl: (value: string) => value,
  api: {
    authStore: { record: { id: 'user-1', name: 'BackOnTrack User', avatar: '' } },
    collection: (name: string) => {
      if (name === 'flashcard_review_sessions') return { update: mocks.updateSession }
      if (name === 'flashcard_review_events') {
        return { create: mocks.createEvent, delete: mocks.deleteEvent, getFullList: mocks.listEvents }
      }
      throw new Error(`Unexpected collection: ${name}`)
    },
  },
}))

import { useFlashcardStore } from '@/stores/flashcards'

function sessionRecord(updates: Record<string, unknown> = {}) {
  return {
    id: 'session-1',
    review_set: 'set-1',
    status: 'paused',
    snapshot_name: 'Vocabulary',
    mode_snapshot: 'manual',
    card_sides_snapshot: 'both',
    indefinite_snapshot: false,
    max_cards_snapshot: 2,
    sort_snapshot: 'recently_added',
    tags_snapshot: ['tag-1'],
    front_seconds_snapshot: 5,
    back_seconds_snapshot: 5,
    back_speech_repeat_count_snapshot: 1,
    note_before_back_snapshot: false,
    speech_enabled_snapshot: false,
    front_language_snapshot: '',
    back_language_snapshot: '',
    queue_state: [],
    started_at: '2026-08-10T12:00:00Z',
    ended_at: '',
    updated_at: '2026-08-10T12:00:42Z',
    elapsed_seconds: 42,
    total_cards: 2,
    viewed_count: 1,
    success_count: 1,
    error_count: 0,
    ejected_count: 0,
    task: '',
    program_step: '',
    task_date: '',
    ...updates,
  }
}

describe('flashcard Review set restart', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mocks.createEvent.mockReset().mockResolvedValue({})
    mocks.deleteEvent.mockReset().mockResolvedValue(true)
    mocks.listEvents.mockReset()
    mocks.updateSession.mockReset().mockImplementation(async (_id, updates) => (
      sessionRecord(updates)
    ))
  })

  it('rebuilds the queue and resets progress while preserving the paused state', async () => {
    const store = useFlashcardStore()
    store.reviewSets = [{
      id: 'set-1',
      name: 'Vocabulary',
      tags: ['tag-1'],
      tagDetails: [],
      owner: 'user-1',
      ownerName: 'BackOnTrack User',
      ownerAvatar: '',
      accessRole: 'owner',
      matchingCardCount: 2,
      mode: 'manual',
      cardSides: 'both',
      indefinite: false,
      maxCards: 2,
      frontSeconds: 5,
      backSeconds: 5,
      backSpeechRepeatCount: 1,
      noteBeforeBack: false,
      speechEnabled: false,
      frontLanguage: '',
      backLanguage: '',
      sortMode: 'recently_added',
      sortOrder: 0,
      createdAt: '2026-08-10T12:00:00Z',
      updatedAt: '2026-08-10T12:00:00Z',
    }]
    store.cards = [
      {
        id: 'card-1', front: 'One', back: 'Un', note: '', tags: ['tag-1'],
        createdAt: '2026-08-10T12:00:00Z', updatedAt: '2026-08-10T12:00:00Z',
        passiveViews: 0, successCount: 1, errorCount: 0,
      },
      {
        id: 'card-2', front: 'Two', back: 'Deux', note: '', tags: ['tag-1'],
        createdAt: '2026-08-09T12:00:00Z', updatedAt: '2026-08-09T12:00:00Z',
        passiveViews: 0, successCount: 0, errorCount: 0,
      },
    ]
    store.sessions = [{
      id: 'session-1',
      reviewSet: 'set-1',
      status: 'paused',
      name: 'Vocabulary',
      mode: 'manual',
      cardSides: 'both',
      indefinite: false,
      maxCards: 2,
      sortMode: 'recently_added',
      tags: ['tag-1'],
      frontSeconds: 5,
      backSeconds: 5,
      backSpeechRepeatCount: 1,
      noteBeforeBack: false,
      speechEnabled: false,
      frontLanguage: '',
      backLanguage: '',
      queue: [{ id: 'card-2', front: 'Two', back: 'Deux', note: '', tags: ['tag-1'] }],
      startedAt: '2026-08-10T12:00:00Z',
      updatedAt: '2026-08-10T12:00:42Z',
      elapsedSeconds: 42,
      totalCards: 2,
      viewedCount: 1,
      successCount: 1,
      errorCount: 0,
      ejectedCount: 0,
    } satisfies FlashcardReviewSession]

    const restarted = await store.act('session-1', 'restart', 42)

    expect(mocks.updateSession).toHaveBeenCalledWith('session-1', expect.objectContaining({
      status: 'paused',
      elapsed_seconds: 0,
      viewed_count: 0,
      success_count: 0,
      error_count: 0,
      ejected_count: 0,
      total_cards: 2,
    }))
    expect(mocks.updateSession.mock.calls[0]?.[1].queue_state.map((card: { id: string }) => card.id))
      .toEqual(['card-1', 'card-2'])
    expect(restarted).toMatchObject({
      status: 'paused',
      elapsedSeconds: 0,
      viewedCount: 0,
      successCount: 0,
      totalCards: 2,
    })
  })

  it('restores the most recently ejected card in a local review session', async () => {
    const store = useFlashcardStore()
    store.reviewSets = [{
      id: 'set-1', name: 'Vocabulary', tags: [], tagDetails: [], owner: 'user-1',
      ownerName: 'BackOnTrack User', ownerAvatar: '', accessRole: 'owner', matchingCardCount: 2,
      mode: 'manual', cardSides: 'both', indefinite: false, maxCards: 2,
      frontSeconds: 5, backSeconds: 5, backSpeechRepeatCount: 1, noteBeforeBack: false,
      speechEnabled: false, frontLanguage: '', backLanguage: '', sortMode: 'recently_added',
      sortOrder: 0, createdAt: '2026-08-10T12:00:00Z', updatedAt: '2026-08-10T12:00:00Z',
    }]
    store.cards = [{
      id: 'card-1', front: 'One', back: 'Un', note: 'First',
      tags: ['tag-1'], createdAt: '2026-08-10T12:00:00Z',
      updatedAt: '2026-08-10T12:00:00Z', passiveViews: 0, successCount: 0, errorCount: 0,
    }]
    store.sessions = [{
      id: 'session-1', reviewSet: 'set-1', status: 'running', name: 'Vocabulary',
      mode: 'manual', cardSides: 'both', indefinite: false, maxCards: 2,
      sortMode: 'recently_added', tags: [], frontSeconds: 5, backSeconds: 5,
      backSpeechRepeatCount: 1, noteBeforeBack: false, speechEnabled: false,
      frontLanguage: '', backLanguage: '', queue: [{
        id: 'card-2', front: 'Two', back: 'Deux', note: '', tags: [],
      }], startedAt: '2026-08-10T12:00:00Z', updatedAt: '2026-08-10T12:00:42Z',
      elapsedSeconds: 42, totalCards: 2, viewedCount: 0, successCount: 0,
      errorCount: 0, ejectedCount: 1,
    }]
    mocks.listEvents.mockResolvedValue([{
      id: 'event-eject-1', session: 'session-1', card: 'card-1', outcome: 'eject',
      reviewed_at: '2026-08-10T12:00:40Z',
    }])

    const restored = await store.act('session-1', 'undo_eject', 42)

    expect(mocks.listEvents).toHaveBeenCalledWith({
      filter: 'session = "session-1"',
      sort: '-reviewed_at,-id',
    })
    expect(mocks.deleteEvent).toHaveBeenCalledWith('event-eject-1')
    expect(mocks.updateSession).toHaveBeenCalledWith('session-1', expect.objectContaining({
      ejected_count: 0,
      queue_state: [
        expect.objectContaining({ id: 'card-1', note: 'First', tags: ['tag-1'] }),
        expect.objectContaining({ id: 'card-2' }),
      ],
    }))
    expect(restored).toMatchObject({ ejectedCount: 0 })
    expect(restored.queue.map(card => card.id)).toEqual(['card-1', 'card-2'])
  })

  it('records new local ejections with the canonical outcome', async () => {
    const store = useFlashcardStore()
    store.sessions = [{
      id: 'session-1', reviewSet: 'set-1', status: 'running', name: 'Vocabulary',
      mode: 'manual', cardSides: 'both', indefinite: false, maxCards: 2,
      sortMode: 'recently_added', tags: [], frontSeconds: 5, backSeconds: 5,
      backSpeechRepeatCount: 1, noteBeforeBack: false, speechEnabled: false,
      frontLanguage: '', backLanguage: '', queue: [{
        id: 'card-1', front: 'One', back: 'Un', note: '', tags: [],
      }, {
        id: 'card-2', front: 'Two', back: 'Deux', note: '', tags: [],
      }], startedAt: '2026-08-10T12:00:00Z', updatedAt: '2026-08-10T12:00:42Z',
      elapsedSeconds: 42, totalCards: 2, viewedCount: 0, successCount: 0,
      errorCount: 0, ejectedCount: 0,
    }]

    await store.act('session-1', 'eject', 42)

    expect(mocks.createEvent).toHaveBeenCalledWith(expect.objectContaining({
      session: 'session-1',
      card: 'card-1',
      outcome: 'ejected',
    }))
  })

  it('stores a background passive catch-up as one counted event per card', async () => {
    const store = useFlashcardStore()
    store.sessions = [{
      id: 'session-1', reviewSet: 'set-1', status: 'running', name: 'Vocabulary',
      mode: 'passive', cardSides: 'both', indefinite: true, maxCards: 3,
      sortMode: 'recently_added', tags: [], frontSeconds: 4, backSeconds: 5,
      backSpeechRepeatCount: 2, noteBeforeBack: false, speechEnabled: true,
      frontLanguage: 'en-CA', backLanguage: 'fr-CA', queue: [{
        id: 'card-1', front: 'One', back: 'Un', note: '', tags: [],
      }, {
        id: 'card-2', front: 'Two', back: 'Deux', note: '', tags: [],
      }, {
        id: 'card-3', front: 'Three', back: 'Trois', note: '', tags: [],
      }], startedAt: '2026-08-16T21:44:15Z', updatedAt: '2026-08-16T21:44:15Z',
      elapsedSeconds: 0, totalCards: 3, viewedCount: 0, successCount: 0,
      errorCount: 0, ejectedCount: 0,
    } satisfies FlashcardReviewSession]
    mocks.updateSession.mockImplementationOnce(async (_id, updates) => sessionRecord({
      mode_snapshot: 'passive',
      indefinite_snapshot: true,
      ...updates,
    }))

    const updated = await store.act('session-1', 'view', 112, 8)

    expect(mocks.createEvent).toHaveBeenCalledTimes(3)
    expect(mocks.createEvent.mock.calls.map(([event]) => ({
      card: event.card,
      viewCount: event.view_count,
    })).sort((left, right) => left.card.localeCompare(right.card))).toEqual([
      { card: 'card-1', viewCount: 3 },
      { card: 'card-2', viewCount: 3 },
      { card: 'card-3', viewCount: 2 },
    ])
    expect(mocks.updateSession).toHaveBeenCalledWith('session-1', expect.objectContaining({
      viewed_count: 8,
      queue_state: [
        expect.objectContaining({ id: 'card-3' }),
        expect.objectContaining({ id: 'card-1' }),
        expect.objectContaining({ id: 'card-2' }),
      ],
    }))
    expect(updated).toMatchObject({ viewedCount: 8, elapsedSeconds: 112 })
  })
})
