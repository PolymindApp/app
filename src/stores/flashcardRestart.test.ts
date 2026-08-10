import { createPinia, setActivePinia } from 'pinia'
import type { FlashcardReviewSession } from '@/types/domain'

const mocks = vi.hoisted(() => ({
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
    authStore: { record: { id: 'user-1', name: 'Mom User', avatar: '' } },
    collection: (name: string) => {
      if (name === 'flashcard_review_sessions') return { update: mocks.updateSession }
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
      ownerName: 'Mom User',
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
})
