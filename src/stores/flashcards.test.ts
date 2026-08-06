import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({
  act: vi.fn(),
  bulkUpdateCards: vi.fn(),
  createTag: vi.fn(),
  importCards: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {
    details = {}
  },
  api: {
    authStore: { record: { id: 'user-1' } },
    actOnFlashcardReviewSession: apiMocks.act,
    bulkUpdateFlashcards: apiMocks.bulkUpdateCards,
    importFlashcards: apiMocks.importCards,
    collection: (name: string) => {
      if (name === 'flashcard_tags') return { create: apiMocks.createTag }
      throw new Error(`Unexpected collection: ${name}`)
    },
  },
}))

import { useFlashcardStore } from '@/stores/flashcards'
import { useTaskStore } from '@/stores/tasks'

describe('flashcard store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    apiMocks.act.mockReset()
    apiMocks.bulkUpdateCards.mockReset()
    apiMocks.createTag.mockReset()
    apiMocks.importCards.mockReset()
  })

  it('reuses an existing tag regardless of letter casing', async () => {
    const store = useFlashcardStore()
    store.tags = [{ id: 'tag-1', name: 'Algebra' }]

    const tag = await store.createTag(' algebra ')

    expect(tag.id).toBe('tag-1')
    expect(apiMocks.createTag).not.toHaveBeenCalled()
  })

  it('updates card aggregates and task progress from an atomic review action', async () => {
    const store = useFlashcardStore()
    store.cards = [{
      id: 'card-1',
      front: 'Question',
      back: 'Answer',
      note: 'Explanation',
      tags: [],
      createdAt: '2026-08-05T10:00:00Z',
      updatedAt: '2026-08-05T10:00:00Z',
      passiveViews: 0,
      successCount: 0,
      errorCount: 0,
    }]
    store.sessions = [{
      id: 'session-1',
      reviewSet: 'set-1',
      status: 'running',
      name: 'Daily review',
      mode: 'manual',
      indefinite: false,
      sortMode: 'difficult',
      tags: [],
      frontSeconds: 5,
      backSeconds: 5,
      queue: [{ id: 'card-1', front: 'Question', back: 'Answer', note: 'Explanation', tags: [] }],
      startedAt: '2026-08-05T10:00:00Z',
      updatedAt: '2026-08-05T10:00:00Z',
      elapsedSeconds: 0,
      totalCards: 1,
      viewedCount: 0,
      successCount: 0,
      errorCount: 0,
      ejectedCount: 0,
      task: 'task-1',
      taskDate: '2026-08-05',
    }]
    apiMocks.act.mockResolvedValue({
      session: {
        id: 'session-1', review_set: 'set-1', status: 'completed',
        snapshot_name: 'Daily review', mode_snapshot: 'manual', sort_snapshot: 'difficult',
        indefinite_snapshot: false,
        tags_snapshot: [], front_seconds_snapshot: 5, back_seconds_snapshot: 5,
        queue_state: [], started_at: '2026-08-05T10:00:00Z',
        ended_at: '2026-08-05T10:00:07Z', updated_at: '2026-08-05T10:00:07Z',
        elapsed_seconds: 7, total_cards: 1, viewed_count: 1,
        success_count: 1, error_count: 0, ejected_count: 0,
        task: 'task-1', program_step: '', task_date: '2026-08-05',
      },
      occurrence: {
        id: 'occurrence-1', task: 'task-1', program_step: '', scheduled_date: '2026-08-05',
        status: 'completed', sealed: false, completed_at: '2026-08-05T10:00:07Z',
        snapshot_name: 'Review cards', snapshot_target: 1, snapshot_unit: '',
      },
    })

    const completed = await store.act('session-1', 'success', 7)

    expect(completed.status).toBe('completed')
    expect(store.cards[0].successCount).toBe(1)
    expect(store.cards[0].lastReviewedAt).toBeTruthy()
    expect(useTaskStore().occurrences).toEqual([
      expect.objectContaining({ id: 'occurrence-1', status: 'completed' }),
    ])
  })

  it('merges atomically imported cards and newly created tags', async () => {
    const store = useFlashcardStore()
    store.tags = [{ id: 'tag-existing', name: 'Existing' }]
    apiMocks.importCards.mockResolvedValue({
      tags: [{ id: 'tag-new', name: 'Woodworking' }],
      cards: [{
        id: 'card-imported', front: 'chisel', back: 'formón', note: 'A carving tool', tags: ['tag-new'],
        created_at: '2026-08-05T10:00:00Z', updated_at: '2026-08-05T10:00:00Z',
        last_reviewed_at: '', passive_views: 0, success_count: 0, error_count: 0,
      }],
    })

    const imported = await store.importCards([
      { front: 'chisel', back: 'formón', note: 'A carving tool', tags: ['Woodworking'] },
    ])

    expect(apiMocks.importCards).toHaveBeenCalledWith([
      { front: 'chisel', back: 'formón', note: 'A carving tool', tags: ['Woodworking'] },
    ])
    expect(imported).toHaveLength(1)
    expect(store.cards[0]).toEqual(expect.objectContaining({ id: 'card-imported', front: 'chisel' }))
    expect(store.tags.map(tag => tag.name)).toEqual(['Existing', 'Woodworking'])
  })

  it('applies bulk card updates and removes deleted cards from local state', async () => {
    const store = useFlashcardStore()
    store.cards = [{
      id: 'card-1',
      front: 'Question',
      back: 'Answer',
      note: '',
      tags: ['tag-old'],
      createdAt: '2026-08-05T10:00:00Z',
      updatedAt: '2026-08-05T10:00:00Z',
      passiveViews: 0,
      successCount: 0,
      errorCount: 0,
    }, {
      id: 'card-2',
      front: 'Keep',
      back: 'This card',
      note: '',
      tags: [],
      createdAt: '2026-08-05T10:00:00Z',
      updatedAt: '2026-08-05T10:00:00Z',
      passiveViews: 0,
      successCount: 0,
      errorCount: 0,
    }]
    apiMocks.bulkUpdateCards.mockResolvedValueOnce({
      cards: [{
        id: 'card-1', front: 'Question', back: 'Answer', note: '', tags: ['tag-new'],
        created_at: '2026-08-05T10:00:00Z', updated_at: '2026-08-05T10:05:00Z',
        last_reviewed_at: '', passive_views: 0, success_count: 0, error_count: 0,
      }],
      deleted_ids: [],
    })

    await store.bulkUpdateCards('set_tags', ['card-1', 'card-1'], ['tag-new'])

    expect(apiMocks.bulkUpdateCards).toHaveBeenNthCalledWith(
      1,
      'set_tags',
      ['card-1'],
      ['tag-new'],
    )
    expect(store.cards[0].tags).toEqual(['tag-new'])
    expect(store.cards[1].id).toBe('card-2')

    apiMocks.bulkUpdateCards.mockResolvedValueOnce({ cards: [], deleted_ids: ['card-1'] })
    await store.bulkUpdateCards('delete', ['card-1'])

    expect(store.cards.map(card => card.id)).toEqual(['card-2'])
  })
})
