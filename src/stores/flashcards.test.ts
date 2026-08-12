import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({
  act: vi.fn(),
  bulkUpdateCards: vi.fn(),
  createTag: vi.fn(),
  createCard: vi.fn(),
  copyReviewSet: vi.fn(),
  getReviewSetCards: vi.fn(),
  importCards: vi.fn(),
  importReviewSetCards: vi.fn(),
  bulkUpdateReviewSetCards: vi.fn(),
  setCardLibraryImage: vi.fn(),
  setReviewSetCardLibraryImage: vi.fn(),
  startReview: vi.fn(),
  updateReviewSet: vi.fn(),
  updateCardImage: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {
    details = {}
  },
  apiAssetUrl: (value: string) => `/api${value}`,
  api: {
    authStore: { record: { id: 'user-1' } },
    actOnFlashcardReviewSession: apiMocks.act,
    bulkUpdateFlashcards: apiMocks.bulkUpdateCards,
    copyFlashcardReviewSet: apiMocks.copyReviewSet,
    getFlashcardReviewSetCards: apiMocks.getReviewSetCards,
    importFlashcards: apiMocks.importCards,
    importFlashcardReviewSetCards: apiMocks.importReviewSetCards,
    bulkUpdateFlashcardReviewSetCards: apiMocks.bulkUpdateReviewSetCards,
    setFlashcardLibraryImage: apiMocks.setCardLibraryImage,
    setFlashcardReviewSetCardLibraryImage: apiMocks.setReviewSetCardLibraryImage,
    startFlashcardReviewSession: apiMocks.startReview,
    updateFlashcardImage: apiMocks.updateCardImage,
    collection: (name: string) => {
      if (name === 'flashcard_tags') return { create: apiMocks.createTag }
      if (name === 'flashcards') return { create: apiMocks.createCard }
      if (name === 'flashcard_review_sets') return { update: apiMocks.updateReviewSet }
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
    apiMocks.createCard.mockReset()
    apiMocks.copyReviewSet.mockReset()
    apiMocks.getReviewSetCards.mockReset()
    apiMocks.importCards.mockReset()
    apiMocks.importReviewSetCards.mockReset()
    apiMocks.bulkUpdateReviewSetCards.mockReset()
    apiMocks.setCardLibraryImage.mockReset()
    apiMocks.setReviewSetCardLibraryImage.mockReset()
    apiMocks.startReview.mockReset()
    apiMocks.updateReviewSet.mockReset()
    apiMocks.updateReviewSet.mockResolvedValue({})
    apiMocks.updateCardImage.mockReset()
  })

  it('persists owned Review set drag order without moving shared sets', async () => {
    const store = useFlashcardStore()
    const reviewSet = (id: string, sortOrder: number, accessRole: 'owner' | 'readonly') => ({
      id,
      name: id,
      tags: [],
      tagDetails: [],
      owner: accessRole === 'owner' ? 'user-1' : 'user-2',
      ownerName: '',
      ownerAvatar: '',
      accessRole,
      excludedCards: [],
      matchingCardCount: 0,
      mode: 'manual' as const,
      cardSides: 'both' as const,
      indefinite: false,
      maxCards: 20,
      frontSeconds: 5,
      backSeconds: 5,
      backSpeechRepeatCount: 1,
      noteBeforeBack: false,
      speechEnabled: false,
      frontLanguage: '',
      backLanguage: '',
      sortMode: 'difficult' as const,
      sortOrder,
      createdAt: '',
      updatedAt: '',
    })
    const first = reviewSet('first', 0, 'owner')
    const second = reviewSet('second', 1, 'owner')
    const shared = reviewSet('shared', 8, 'readonly')
    store.reviewSets = [first, second, shared]

    await store.reorderReviewSets([second, first])

    expect(store.reviewSets.map(item => item.id)).toEqual(['second', 'first', 'shared'])
    expect(store.reviewSets.map(item => item.sortOrder)).toEqual([0, 1, 8])
    expect(apiMocks.updateReviewSet.mock.calls).toEqual([
      ['second', { sort_order: 0 }],
      ['first', { sort_order: 1 }],
    ])
  })

  it('restores Review set order when drag persistence fails', async () => {
    const store = useFlashcardStore()
    const base = {
      name: '', tags: [], tagDetails: [], owner: 'user-1', ownerName: '', ownerAvatar: '',
      accessRole: 'owner' as const, excludedCards: [], matchingCardCount: 0,
      mode: 'manual' as const, cardSides: 'both' as const, indefinite: false, maxCards: 20,
      frontSeconds: 5, backSeconds: 5, backSpeechRepeatCount: 1, noteBeforeBack: false,
      speechEnabled: false, frontLanguage: '', backLanguage: '', sortMode: 'difficult' as const,
      createdAt: '', updatedAt: '',
    }
    const first = { ...base, id: 'first', sortOrder: 0 }
    const second = { ...base, id: 'second', sortOrder: 1 }
    store.reviewSets = [first, second]
    apiMocks.updateReviewSet.mockRejectedValueOnce(new Error('The API is offline.'))

    await expect(store.reorderReviewSets([second, first]))
      .rejects.toThrow('The API is offline.')

    expect(store.reviewSets.map(item => item.id)).toEqual(['first', 'second'])
    expect(store.reviewSets.map(item => item.sortOrder)).toEqual([0, 1])
    expect(store.error).toBe('The API is offline.')
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
      cardSides: 'both',
      indefinite: false,
      maxCards: 20,
      sortMode: 'difficult',
      tags: [],
      frontSeconds: 5,
      backSeconds: 5,
      backSpeechRepeatCount: 1,
      noteBeforeBack: false,
      speechEnabled: false,
      frontLanguage: '',
      backLanguage: '',
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
        card_sides_snapshot: 'both',
        indefinite_snapshot: false,
        max_cards_snapshot: 20,
        tags_snapshot: [], front_seconds_snapshot: 5, back_seconds_snapshot: 5,
        back_speech_repeat_count_snapshot: 1,
        note_before_back_snapshot: true,
        speech_enabled_snapshot: false, front_language_snapshot: '', back_language_snapshot: '',
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
      entries: [{
        id: 'entry-1', task: 'task-1', occurrence: 'occurrence-1', program_step: '',
        entry_date: '2026-08-05', created_at: '2026-08-05T10:00:07Z', value: 7,
        kind: 'duration', unit: 'seconds', note: '', source_type: 'flashcards',
        source_session: 'session-1',
      }],
    })

    const completed = await store.act('session-1', 'success', 7)

    expect(completed.status).toBe('completed')
    expect(completed.noteBeforeBack).toBe(true)
    expect(store.cards[0].successCount).toBe(1)
    expect(store.cards[0].lastReviewedAt).toBeTruthy()
    expect(useTaskStore().occurrences).toEqual([
      expect.objectContaining({ id: 'occurrence-1', status: 'completed' }),
    ])
    expect(useTaskStore().entries).toEqual([
      expect.objectContaining({
        id: 'entry-1',
        value: 7,
        sourceType: 'flashcards',
        sourceSession: 'session-1',
      }),
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

  it('imports, updates images, and bulk deletes cards within a Review set cache', async () => {
    const store = useFlashcardStore()
    const sharedRecord = {
      id: 'shared-1', front: 'Shared front', back: 'Shared back', note: '', tags: ['tag-set'],
      tag_details: [{ id: 'tag-set', name: 'Set tag' }], image_url: '', image_file: '',
      created_at: '2026-08-08T10:00:00Z', updated_at: '2026-08-08T10:00:00Z',
      last_reviewed_at: '', passive_views: 0, success_count: 0, error_count: 0,
    }
    apiMocks.importReviewSetCards.mockResolvedValue({ cards: [sharedRecord], tags: [] })

    await store.importReviewSetCards('set-1', [
      { front: 'Shared front', back: 'Shared back', note: '', tags: ['ignored'] },
    ])

    expect(apiMocks.importReviewSetCards).toHaveBeenCalledWith('set-1', [
      { front: 'Shared front', back: 'Shared back', note: '', tags: ['ignored'] },
    ])
    expect(store.reviewSetCards['set-1']?.[0]).toMatchObject({ id: 'shared-1' })

    apiMocks.setReviewSetCardLibraryImage.mockResolvedValue({
      ...sharedRecord,
      image_file: 'd'.repeat(48) + '.jpg',
      library_image_id: 91,
      image_metadata: { alt: 'Shared image' },
    })
    await store.assignReviewSetLibraryImage('set-1', 'shared-1', 91)
    expect(apiMocks.setReviewSetCardLibraryImage).toHaveBeenCalledWith('set-1', 'shared-1', 91)
    expect(store.reviewSetCards['set-1']?.[0]?.libraryImage?.id).toBe(91)

    apiMocks.bulkUpdateReviewSetCards.mockResolvedValue({ cards: [], deleted_ids: ['shared-1'] })
    await store.bulkUpdateReviewSetCards('set-1', 'delete', ['shared-1', 'shared-1'])
    expect(apiMocks.bulkUpdateReviewSetCards).toHaveBeenCalledWith('set-1', ['shared-1'])
    expect(store.reviewSetCards['set-1']).toEqual([])
  })

  it('uploads a prepared square image after creating its flashcard', async () => {
    const store = useFlashcardStore()
    const created = {
      id: 'card-image', front: 'Joint', back: 'Assemblage', note: '', tags: [],
      image_url: '', image_file: '',
      created_at: '2026-08-07T10:00:00Z', updated_at: '2026-08-07T10:00:00Z',
      last_reviewed_at: '', passive_views: 0, success_count: 0, error_count: 0,
    }
    apiMocks.createCard.mockResolvedValue(created)
    apiMocks.updateCardImage.mockResolvedValue({
      ...created,
      image_file: 'a'.repeat(48) + '.jpg',
    })
    const upload = new Blob(['jpeg'], { type: 'image/jpeg' })

    const card = await store.saveCard(
      { front: 'Joint', back: 'Assemblage', note: '', tags: [] },
      {
        source: 'upload',
        url: '',
        existingUrl: '',
        existingSource: 'none',
        upload,
      },
    )

    expect(apiMocks.createCard).toHaveBeenCalledWith(expect.objectContaining({
      front: 'Joint',
      back: 'Assemblage',
    }))
    expect(apiMocks.updateCardImage).toHaveBeenCalledWith('card-image', upload)
    expect(card).toMatchObject({
      imageSource: 'upload',
      image: `/api/flashcard-images/${'a'.repeat(48)}.jpg`,
    })
  })

  it('attaches a cached library image and maps its attribution', async () => {
    const store = useFlashcardStore()
    const created = {
      id: 'card-library', front: 'Bicycle', back: 'Vélo', note: '', tags: [],
      image_url: '', image_file: '', library_image_id: 0, image_metadata: {},
      created_at: '2026-08-07T10:00:00Z', updated_at: '2026-08-07T10:00:00Z',
      last_reviewed_at: '', passive_views: 0, success_count: 0, error_count: 0,
    }
    apiMocks.createCard.mockResolvedValue(created)
    apiMocks.setCardLibraryImage.mockResolvedValue({
      ...created,
      image_file: 'b'.repeat(48) + '.jpg',
      library_image_id: 42,
      image_metadata: {
        alt: 'A bicycle by a wall',
        photographer: 'Alex Example',
        photographer_url: 'https://www.pexels.com/@alex-example',
        source_url: 'https://www.pexels.com/photo/42/',
        license_name: 'Pexels License',
        license_url: 'https://www.pexels.com/license/',
      },
    })

    const card = await store.saveCard(
      { front: 'Bicycle', back: 'Vélo', note: '', tags: [] },
      {
        source: 'library',
        url: '',
        existingUrl: '',
        existingSource: 'none',
        libraryImage: {
          id: 42,
          imageUrl: '/api/flashcard-images/cached.jpg',
          alt: 'A bicycle by a wall',
          photographer: 'Alex Example',
          photographerUrl: 'https://www.pexels.com/@alex-example',
          sourceUrl: 'https://www.pexels.com/photo/42/',
          licenseName: 'Pexels License',
          licenseUrl: 'https://www.pexels.com/license/',
        },
      },
    )

    expect(apiMocks.setCardLibraryImage).toHaveBeenCalledWith('card-library', 42)
    expect(card).toMatchObject({
      imageSource: 'library',
      image: `/api/flashcard-images/${'b'.repeat(48)}.jpg`,
      libraryImage: {
        id: 42,
        photographer: 'Alex Example',
        alt: 'A bicycle by a wall',
      },
    })
  })

  it('assigns a library image directly and refreshes an active review queue', async () => {
    const store = useFlashcardStore()
    store.cards = [{
      id: 'card-bulk',
      front: 'Hammer',
      back: 'Marteau',
      note: '',
      image: '',
      imageSource: 'none',
      tags: [],
      createdAt: '2026-08-07T10:00:00Z',
      updatedAt: '2026-08-07T10:00:00Z',
      passiveViews: 0,
      successCount: 0,
      errorCount: 0,
    }]
    store.sessions = [{
      id: 'session-bulk', reviewSet: 'set-1', status: 'paused', name: 'Review',
      mode: 'manual', cardSides: 'both', indefinite: false, maxCards: 20,
      sortMode: 'difficult', tags: [], frontSeconds: 5, backSeconds: 5,
      backSpeechRepeatCount: 1, noteBeforeBack: false,
      speechEnabled: false, frontLanguage: '', backLanguage: '',
      queue: [{ id: 'card-bulk', front: 'Hammer', back: 'Marteau', note: '', image: '', tags: [] }],
      startedAt: '2026-08-07T10:00:00Z', updatedAt: '2026-08-07T10:00:00Z',
      elapsedSeconds: 0, totalCards: 1, viewedCount: 0, successCount: 0,
      errorCount: 0, ejectedCount: 0,
    }]
    apiMocks.setCardLibraryImage.mockResolvedValue({
      id: 'card-bulk', front: 'Hammer', back: 'Marteau', note: '', tags: [],
      image_url: '', image_file: 'c'.repeat(48) + '.jpg', library_image_id: 84,
      image_metadata: {
        alt: 'A hammer', photographer: 'Pexels Maker',
        photographer_url: 'https://www.pexels.com/@maker',
        source_url: 'https://www.pexels.com/photo/84/',
        license_name: 'Pexels License', license_url: 'https://www.pexels.com/license/',
      },
      created_at: '2026-08-07T10:00:00Z', updated_at: '2026-08-07T10:05:00Z',
      last_reviewed_at: '', passive_views: 0, success_count: 0, error_count: 0,
    })

    const card = await store.assignLibraryImage('card-bulk', 84)

    expect(apiMocks.setCardLibraryImage).toHaveBeenCalledWith('card-bulk', 84)
    expect(card).toMatchObject({ imageSource: 'library', libraryImage: { id: 84 } })
    expect(store.cards[0].image).toContain('/flashcard-images/')
    expect(store.sessions[0].queue[0].image).toBe(store.cards[0].image)
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

    apiMocks.bulkUpdateCards.mockResolvedValueOnce({
      cards: [{
        id: 'card-1', front: 'Answer', back: 'Question', note: '', tags: ['tag-new'],
        created_at: '2026-08-05T10:00:00Z', updated_at: '2026-08-05T10:06:00Z',
        last_reviewed_at: '', passive_views: 0, success_count: 0, error_count: 0,
      }],
      deleted_ids: [],
    })
    await store.bulkUpdateCards('swap_front_back', ['card-1'])

    expect(apiMocks.bulkUpdateCards).toHaveBeenNthCalledWith(
      2,
      'swap_front_back',
      ['card-1'],
      [],
    )
    expect(store.cards[0]).toMatchObject({ front: 'Answer', back: 'Question' })

    apiMocks.bulkUpdateCards.mockResolvedValueOnce({ cards: [], deleted_ids: ['card-1'] })
    await store.bulkUpdateCards('delete', ['card-1'])

    expect(store.cards.map(card => card.id)).toEqual(['card-2'])
  })

  it('does not reuse a looping session for a different task launch', async () => {
    const store = useFlashcardStore()
    const active = {
      id: 'session-1',
      reviewSet: 'set-1',
      status: 'paused' as const,
      name: 'Ongoing review',
      mode: 'passive' as const,
      cardSides: 'both' as const,
      indefinite: true,
      maxCards: 20,
      sortMode: 'difficult' as const,
      tags: [],
      frontSeconds: 5,
      backSeconds: 5,
      backSpeechRepeatCount: 1,
      noteBeforeBack: false,
      speechEnabled: false,
      frontLanguage: '',
      backLanguage: '',
      queue: [{
        id: 'card-1',
        front: 'Question',
        back: 'Answer',
        note: '',
        image: '',
        tags: [],
      }],
      startedAt: '2026-08-07T10:00:00Z',
      updatedAt: '2026-08-07T10:01:00Z',
      elapsedSeconds: 60,
      totalCards: 1,
      viewedCount: 12,
      successCount: 0,
      errorCount: 0,
      ejectedCount: 0,
      task: 'task-1',
      taskDate: '2026-08-07',
    }
    store.sessions = [active]

    await expect(store.startReview('set-1', {
      task: 'task-1',
      taskDate: '2026-08-08',
    })).rejects.toThrow('Ongoing review is already in progress')

    await expect(store.startReview('set-2', {
      task: 'task-2',
      taskDate: '2026-08-07',
    })).rejects.toThrow('Ongoing review is already in progress')
    expect(apiMocks.startReview).not.toHaveBeenCalled()

    await expect(store.startReview('set-1', {
      task: 'task-1',
      taskDate: '2026-08-07',
    })).resolves.toMatchObject({ id: active.id, task: active.task, taskDate: active.taskDate })
    expect(apiMocks.startReview).not.toHaveBeenCalled()
  })

  it('maps an independent shared-set copy and hydrates its copied cards and tags', async () => {
    const store = useFlashcardStore()
    apiMocks.copyReviewSet.mockResolvedValue({
      id: 'set-copy', owner: 'user-1', owner_name: 'Current user', owner_avatar: '',
      access_role: 'owner', share_id: '', matching_card_count: 1,
      name: 'Shared vocabulary copy', tags: ['tag-copy'],
      tag_details: [{ id: 'tag-copy', name: 'Shared vocabulary copy' }],
      mode: 'manual', card_sides: 'front', indefinite: false, max_cards: 7,
      front_seconds: 9, back_seconds: 11, back_speech_repeat_count: 2,
      note_before_back: true,
      speech_enabled: false, front_language: '', back_language: '',
      sort_mode: 'least_recent', sort_order: 2,
      created_at: '2026-08-07T10:00:00Z', updated_at: '2026-08-07T10:00:00Z',
    })
    apiMocks.getReviewSetCards.mockResolvedValue([{
      id: 'card-copy', front: 'Question', back: 'Answer', note: '', tags: ['tag-copy'],
      tag_details: [{ id: 'tag-copy', name: 'Shared vocabulary copy' }],
      created_at: '2026-08-07T10:00:00Z', updated_at: '2026-08-07T10:00:00Z',
      last_reviewed_at: '', passive_views: 0, success_count: 0, error_count: 0,
    }])

    const copied = await store.copyReviewSet('set-shared')

    expect(apiMocks.copyReviewSet).toHaveBeenCalledWith('set-shared')
    expect(apiMocks.getReviewSetCards).toHaveBeenCalledWith('set-copy')
    expect(copied).toMatchObject({
      id: 'set-copy', accessRole: 'owner', matchingCardCount: 1, maxCards: 7,
      noteBeforeBack: true,
    })
    expect(store.reviewSetCards['set-copy']?.[0]?.id).toBe('card-copy')
    expect(store.cards[0]?.id).toBe('card-copy')
    expect(store.tags).toEqual([{ id: 'tag-copy', name: 'Shared vocabulary copy' }])
  })
})
