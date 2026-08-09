import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { IntervalFlashcardReviewSnapshot, IntervalTemplate } from '@/types/domain'

const apiMocks = vi.hoisted(() => ({
  createIntervalSession: vi.fn(),
  getIntervalSessions: vi.fn(),
  updateTemplate: vi.fn(),
  updateIntervalSession: vi.fn(),
  updateIntervalSessionFlashcards: vi.fn(),
  completeIntervalSession: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  apiAssetUrl: (value: string) => value,
  api: {
    authStore: { record: { id: 'user-1' } },
    completeIntervalSession: apiMocks.completeIntervalSession,
    updateIntervalSessionFlashcards: apiMocks.updateIntervalSessionFlashcards,
    collection: (name: string) => {
      if (name === 'interval_templates') return { update: apiMocks.updateTemplate }
      if (name === 'interval_sessions') return {
        create: apiMocks.createIntervalSession,
        getList: apiMocks.getIntervalSessions,
        update: apiMocks.updateIntervalSession,
      }
      throw new Error(`Unexpected collection: ${name}`)
    },
  },
}))

import { useIntervalStore } from './intervals'

function template(id: string, sortOrder: number): IntervalTemplate {
  return {
    id,
    name: id,
    description: '',
    color: '#C7F464',
    definition: { version: 1, children: [] },
    cues: { soundEnabled: true, vibrationEnabled: true },
    sortOrder,
  }
}

describe('interval template ordering', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    apiMocks.updateTemplate.mockReset()
    apiMocks.updateTemplate.mockResolvedValue({})
  })

  it('persists every changed interval position', async () => {
    const store = useIntervalStore()
    const first = template('first', 0)
    const second = template('second', 1)
    const third = template('third', 2)
    store.templates = [first, second, third]

    await store.reorderTemplates([third, first, second])

    expect(store.templates.map((item) => item.id)).toEqual(['third', 'first', 'second'])
    expect(store.templates.map((item) => item.sortOrder)).toEqual([0, 1, 2])
    expect(apiMocks.updateTemplate.mock.calls).toEqual([
      ['third', { sort_order: 0 }],
      ['first', { sort_order: 1 }],
      ['second', { sort_order: 2 }],
    ])
  })

  it('restores the previous order when persistence fails', async () => {
    const store = useIntervalStore()
    const first = template('first', 0)
    const second = template('second', 1)
    store.templates = [first, second]
    apiMocks.updateTemplate.mockRejectedValueOnce(new Error('The API is offline.'))

    await expect(store.reorderTemplates([second, first]))
      .rejects.toThrow('The API is offline.')

    expect(store.templates.map((item) => item.id)).toEqual(['first', 'second'])
    expect(store.templates.map((item) => item.sortOrder)).toEqual([0, 1])
    expect(store.error).toBe('The API is offline.')
  })
})

describe('interval task attribution', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    apiMocks.createIntervalSession.mockReset()
    apiMocks.getIntervalSessions.mockReset()
    apiMocks.updateIntervalSession.mockReset()
    apiMocks.updateIntervalSessionFlashcards.mockReset()
    apiMocks.completeIntervalSession.mockReset()
    apiMocks.getIntervalSessions.mockResolvedValue({ items: [] })
  })

  it('keeps the task date selected by the task view when starting a session', async () => {
    apiMocks.createIntervalSession.mockImplementation(async payload => ({
      id: 'session-1',
      ...payload,
      updated: payload.started_at,
    }))
    const store = useIntervalStore()

    const session = await store.startSession({
      name: 'Attached interval',
      source: 'template',
      definition: { version: 1, children: [] },
      cues: { soundEnabled: true, vibrationEnabled: true },
      template: 'template-1',
      task: 'task-1',
      taskDate: '2026-08-05',
    })

    expect(apiMocks.createIntervalSession).toHaveBeenCalledWith(expect.objectContaining({
      task: 'task-1',
      task_date: '2026-08-05',
    }))
    expect(session.taskDate).toBe('2026-08-05')
  })

  it('keeps an attached Review set snapshot when starting a local interval session', async () => {
    const flashcardReview: IntervalFlashcardReviewSnapshot = {
      reviewSet: 'set-1',
      name: 'Spanish',
      tags: ['tag-1'],
      sortMode: 'difficult',
      cardSides: 'both',
      frontSeconds: 5,
      backSeconds: 5,
      backSpeechRepeatCount: 1,
      noteBeforeBack: false,
      speechEnabled: false,
      frontLanguage: '',
      backLanguage: '',
      cards: [{
        id: 'card-1',
        front: 'Casa',
        back: 'House',
        note: '',
        image: '/api/flashcard-images/card-1.jpg',
        tags: ['tag-1'],
      }],
    }
    apiMocks.createIntervalSession.mockImplementation(async payload => ({
      id: 'session-1',
      ...payload,
      updated: payload.started_at,
    }))

    const session = await useIntervalStore().startSession({
      name: 'Attached interval',
      source: 'template',
      definition: { version: 1, children: [] },
      cues: { soundEnabled: true, vibrationEnabled: true },
      template: 'template-1',
      flashcardReview,
    })

    expect(apiMocks.createIntervalSession).toHaveBeenCalledWith(expect.objectContaining({
      flashcard_snapshot: flashcardReview,
    }))
    expect(session.flashcardReview).toEqual(flashcardReview)
    expect(session.flashcardReview?.cards[0]?.image).toBe('/api/flashcard-images/card-1.jpg')
  })

  it('merges the occurrence returned by atomic session completion', async () => {
    apiMocks.completeIntervalSession.mockResolvedValue({
      session: {
        id: 'session-1',
        template: 'template-1',
        task: 'task-1',
        program_step: 'step-1',
        task_date: '2026-07-31',
        source: 'template',
        status: 'completed',
        snapshot_name: 'Attached interval',
        definition_snapshot: { version: 1, children: [] },
        cue_snapshot: { soundEnabled: true, vibrationEnabled: true },
        started_at: '2026-07-31T14:00:00.000Z',
        ended_at: '2026-07-31T14:00:01.000Z',
        planned_seconds: 1,
        elapsed_seconds: 1,
        runtime_state: {
          stepIndex: 1,
          remainingMs: 0,
          accumulatedMs: 1000,
          updatedAt: '2026-07-31T14:00:01.000Z',
        },
      },
      occurrence: {
        id: 'occurrence-1',
        task: 'task-1',
        program_step: 'step-1',
        scheduled_date: '2026-07-31',
        status: 'completed',
        sealed: false,
        completed_at: '2026-07-31T14:00:01.000Z',
        snapshot_name: 'Task',
        snapshot_target: 1,
        snapshot_unit: '',
      },
    })

    const store = useIntervalStore()
    const runtime = {
      stepIndex: 1,
      remainingMs: 0,
      accumulatedMs: 1000,
      updatedAt: '2026-07-31T14:00:01.000Z',
    }
    const completed = await store.completeSession('session-1', {
      runtime,
      elapsedSeconds: 1,
      endedAt: '2026-07-31T14:00:01.000Z',
    })

    expect(completed).toMatchObject({
      id: 'session-1',
      task: 'task-1',
      programStep: 'step-1',
      taskDate: '2026-07-31',
      status: 'completed',
    })
    const { useTaskStore } = await import('./tasks')
    expect(useTaskStore().occurrences).toEqual([
      expect.objectContaining({
        id: 'occurrence-1',
        task: 'task-1',
        programStep: 'step-1',
        scheduledDate: '2026-07-31',
        status: 'completed',
      }),
    ])
  })

  it('persists a note on a finished interval session', async () => {
    apiMocks.updateIntervalSession.mockResolvedValue({
      id: 'session-1',
      template: 'template-1',
      source: 'template',
      status: 'completed',
      snapshot_name: 'Intervals',
      definition_snapshot: { version: 1, children: [] },
      cue_snapshot: { soundEnabled: true, vibrationEnabled: true },
      started_at: '2026-08-01T14:00:00.000Z',
      ended_at: '2026-08-01T14:10:00.000Z',
      note: 'Felt strong throughout.',
      planned_seconds: 600,
      elapsed_seconds: 600,
      runtime_state: {
        stepIndex: 4,
        remainingMs: 0,
        accumulatedMs: 600000,
        updatedAt: '2026-08-01T14:10:00.000Z',
      },
    })

    const store = useIntervalStore()
    const updated = await store.updateSession('session-1', { note: 'Felt strong throughout.' })

    expect(apiMocks.updateIntervalSession).toHaveBeenCalledWith('session-1', {
      note: 'Felt strong throughout.',
    })
    expect(updated.note).toBe('Felt strong throughout.')
  })

  it('persists changes to the active interval flashcard snapshot', async () => {
    const flashcardReview = {
      reviewSet: 'set-1',
      name: 'Spanish',
      tags: ['tag-1'],
      sortMode: 'difficult' as const,
      cardSides: 'both' as const,
      frontSeconds: 4,
      backSeconds: 6,
      backSpeechRepeatCount: 1,
      noteBeforeBack: true,
      speechEnabled: false,
      frontLanguage: '',
      backLanguage: '',
      cards: [{ id: 'card-1', front: 'Hola', back: 'Hello', note: '', image: '', tags: ['tag-1'] }],
    }
    apiMocks.updateIntervalSessionFlashcards.mockResolvedValue({
      id: 'session-1',
      source: 'template',
      status: 'paused',
      snapshot_name: 'Study',
      definition_snapshot: { version: 1, children: [] },
      cue_snapshot: { soundEnabled: true, vibrationEnabled: true },
      flashcard_snapshot: flashcardReview,
      started_at: '2026-08-08T14:00:00.000Z',
      planned_seconds: 60,
      elapsed_seconds: 5,
      runtime_state: {
        stepIndex: 0,
        remainingMs: 55000,
        accumulatedMs: 5000,
        updatedAt: '2026-08-08T14:00:05.000Z',
      },
    })

    const updated = await useIntervalStore().updateSessionFlashcardReview('session-1', flashcardReview)

    expect(apiMocks.updateIntervalSessionFlashcards).toHaveBeenCalledWith('session-1', flashcardReview)
    expect(updated.flashcardReview?.cards[0]?.front).toBe('Hola')
  })
})
