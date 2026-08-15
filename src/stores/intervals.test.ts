import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { IntervalDefinition, IntervalFlashcardReviewSnapshot, IntervalTemplate } from '@/types/domain'

const apiMocks = vi.hoisted(() => ({
  authRecord: { id: 'user-1', settings: {} as Record<string, unknown> },
  createIntervalSession: vi.fn(),
  getIntervalTemplates: vi.fn(),
  getIntervalSessions: vi.fn(),
  updateTemplate: vi.fn(),
  updateIntervalSession: vi.fn(),
  updateIntervalSessionFlashcards: vi.fn(),
  completeIntervalSession: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  apiAssetUrl: (value: string) => value,
  api: {
    authStore: { record: apiMocks.authRecord },
    completeIntervalSession: apiMocks.completeIntervalSession,
    updateIntervalSessionFlashcards: apiMocks.updateIntervalSessionFlashcards,
    collection: (name: string) => {
      if (name === 'interval_templates') return {
        getFullList: apiMocks.getIntervalTemplates,
        update: apiMocks.updateTemplate,
      }
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
    apiMocks.getIntervalTemplates.mockReset()
    apiMocks.getIntervalSessions.mockReset()
    apiMocks.updateIntervalSession.mockReset()
    apiMocks.updateIntervalSessionFlashcards.mockReset()
    apiMocks.completeIntervalSession.mockReset()
    apiMocks.authRecord.settings = {}
    apiMocks.getIntervalTemplates.mockResolvedValue([])
    apiMocks.getIntervalSessions.mockResolvedValue({ items: [] })
  })

  it('does not persist active timer drift during a local data refresh', async () => {
    const startedAt = new Date(Date.now() - 1_000).toISOString()
    const record = {
      id: 'session-1',
      source: 'template',
      status: 'running',
      snapshot_name: 'Active interval',
      definition_snapshot: {
        version: 1,
        children: [{
          id: 'step-1',
          type: 'step',
          name: 'Work',
          kind: 'work',
          durationSeconds: 60,
        }],
      },
      cue_snapshot: { soundEnabled: true, vibrationEnabled: true },
      started_at: startedAt,
      planned_seconds: 60,
      elapsed_seconds: 0,
      runtime_state: {
        stepIndex: 0,
        remainingMs: 60_000,
        accumulatedMs: 0,
        stepStartedAt: startedAt,
        updatedAt: startedAt,
      },
    }
    apiMocks.getIntervalSessions.mockResolvedValue({ items: [record] })

    await useIntervalStore().load({ reconcileActiveSession: false })

    expect(apiMocks.updateIntervalSession).not.toHaveBeenCalled()
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

  it('snapshots the current interval type sounds when starting a session', async () => {
    apiMocks.authRecord.settings = {
      intervalTypeSounds: {
        train: 'cine-hit',
        work: 'cash',
        rest: 'harp',
        prepare: 'go',
        meditation: 'gong',
        confirmation: 'confirm',
        custom: 'go',
      },
    }
    apiMocks.createIntervalSession.mockImplementation(async payload => ({
      id: 'session-1',
      ...payload,
      updated: payload.started_at,
    }))

    const session = await useIntervalStore().startSession({
      name: 'Custom sounds',
      source: 'template',
      definition: { version: 1, children: [] },
      cues: { soundEnabled: true, vibrationEnabled: false },
    })

    expect(apiMocks.createIntervalSession).toHaveBeenCalledWith(expect.objectContaining({
      cue_snapshot: expect.objectContaining({
        typeSounds: expect.objectContaining({ work: 'cash', rest: 'harp', meditation: 'gong' }),
      }),
    }))
    expect(session.cues.typeSounds).toMatchObject({ work: 'cash', rest: 'harp', meditation: 'gong' })
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

  it('immediately credits Review-enabled interval time to linked Review-set tasks offline', async () => {
    const definition = {
      version: 1 as const,
      children: [
        {
          id: 'review-step',
          type: 'step' as const,
          name: 'Review',
          kind: 'work' as const,
          durationSeconds: 60,
        },
        {
          id: 'silent-step',
          type: 'step' as const,
          name: 'Silent',
          kind: 'rest' as const,
          durationSeconds: 60,
          flashcardReviewEnabled: false,
        },
      ],
    }
    const runtime = {
      stepIndex: 2,
      remainingMs: 0,
      accumulatedMs: 120_000,
      updatedAt: '2026-08-10T16:02:00.000Z',
    }
    apiMocks.completeIntervalSession.mockResolvedValue({
      local: true,
      session: {
        id: 'session-1',
        template: 'template-1',
        source: 'template',
        status: 'completed',
        snapshot_name: 'Study interval',
        definition_snapshot: definition,
        cue_snapshot: { soundEnabled: true, vibrationEnabled: true },
        flashcard_snapshot: {
          reviewSet: 'set-1',
          name: 'Vocabulary',
          cards: [{ id: 'card-1', front: 'One', back: 'Un', note: '', image: '', tags: [] }],
        },
        started_at: '2026-08-10T16:00:00.000Z',
        ended_at: '2026-08-10T16:02:00.000Z',
        task_date: '2026-08-10',
        planned_seconds: 120,
        elapsed_seconds: 120,
        runtime_state: runtime,
      },
      occurrence: null,
      occurrences: [],
      entries: [],
    })
    const { useTaskStore } = await import('./tasks')
    const taskStore = useTaskStore()
    const applyProgress = vi.spyOn(taskStore, 'applyLocalSessionProgress').mockResolvedValue(undefined)

    await useIntervalStore().completeSession('session-1', {
      runtime,
      elapsedSeconds: 120,
      endedAt: '2026-08-10T16:02:00.000Z',
    })

    expect(applyProgress).toHaveBeenCalledTimes(2)
    expect(applyProgress.mock.calls[0]?.[0]).toMatchObject({
      id: 'session-1',
      sourceType: 'interval',
      sourceId: 'template-1',
      elapsedSeconds: 120,
    })
    expect(applyProgress.mock.calls[0]?.[1]).toBe(false)
    expect(applyProgress.mock.calls[1]?.[0]).toMatchObject({
      id: 'session-1',
      sourceType: 'flashcards',
      sourceId: 'set-1',
      elapsedSeconds: 52,
    })
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

  it('changes active session state before persistence finishes', async () => {
    const sessionRecord = {
      id: 'session-optimistic',
      source: 'template',
      status: 'running',
      snapshot_name: 'Immediate interval',
      definition_snapshot: { version: 1, children: [] },
      cue_snapshot: { soundEnabled: true, vibrationEnabled: true },
      started_at: '2026-08-01T14:00:00.000Z',
      planned_seconds: 600,
      elapsed_seconds: 10,
      runtime_state: {
        stepIndex: 0,
        remainingMs: 590000,
        accumulatedMs: 10000,
        updatedAt: '2026-08-01T14:00:10.000Z',
      },
    }
    let resolveUpdate!: (value: Record<string, unknown>) => void
    apiMocks.getIntervalSessions.mockResolvedValue({ items: [sessionRecord] })
    apiMocks.updateIntervalSession.mockReturnValue(new Promise((resolve) => {
      resolveUpdate = resolve
    }))
    const store = useIntervalStore()
    await store.load({ reconcileActiveSession: false })

    const update = store.updateSession('session-optimistic', { status: 'paused' })

    expect(store.activeSession?.status).toBe('paused')

    resolveUpdate({ ...sessionRecord, status: 'paused' })
    await update

    expect(store.sessions[0]?.status).toBe('paused')
  })

  it('optimistically updates an active session definition and cue settings', async () => {
    const sessionRecord = {
      id: 'session-settings',
      source: 'template',
      status: 'paused',
      snapshot_name: 'Editable interval',
      definition_snapshot: {
        version: 1,
        children: [{
          id: 'work',
          type: 'step',
          name: 'Work',
          kind: 'work',
          durationSeconds: 60,
        }],
      },
      cue_snapshot: { soundEnabled: true, vibrationEnabled: true },
      started_at: '2026-08-15T14:00:00.000Z',
      planned_seconds: 60,
      elapsed_seconds: 10,
      runtime_state: {
        stepIndex: 0,
        remainingMs: 50_000,
        accumulatedMs: 10_000,
        updatedAt: '2026-08-15T14:00:10.000Z',
      },
    }
    const definition: IntervalDefinition = {
      version: 1,
      children: [{
        id: 'work',
        type: 'step',
        name: 'Work',
        kind: 'work',
        durationSeconds: 90,
      }],
    }
    const cues = { soundEnabled: false, vibrationEnabled: true }
    const runtime = { ...sessionRecord.runtime_state, remainingMs: 80_000 }
    let resolveUpdate!: (value: Record<string, unknown>) => void
    apiMocks.getIntervalSessions.mockResolvedValue({ items: [sessionRecord] })
    apiMocks.updateIntervalSession.mockReturnValue(new Promise((resolve) => {
      resolveUpdate = resolve
    }))
    const store = useIntervalStore()
    await store.load({ reconcileActiveSession: false })

    const update = store.updateSession('session-settings', {
      definition,
      cues,
      runtime,
      plannedSeconds: 90,
    })

    expect(store.sessions[0]).toMatchObject({ definition, cues, runtime, plannedSeconds: 90 })
    expect(apiMocks.updateIntervalSession).toHaveBeenCalledWith('session-settings', {
      definition_snapshot: definition,
      cue_snapshot: cues,
      runtime_state: runtime,
      planned_seconds: 90,
    })

    resolveUpdate({
      ...sessionRecord,
      definition_snapshot: definition,
      cue_snapshot: cues,
      runtime_state: runtime,
      planned_seconds: 90,
    })
    await update

    expect(store.sessions[0]?.plannedSeconds).toBe(90)
  })

  it.each([true, false])(
    'keeps the current session TTS pause state through runtime updates (%s)',
    async (speechPaused) => {
      const flashcardSnapshot = {
        reviewSet: 'set-1',
        name: 'Spanish',
        tags: [],
        sortMode: 'difficult',
        cardSides: 'both',
        frontSeconds: 5,
        backSeconds: 5,
        backSpeechRepeatCount: 1,
        noteBeforeBack: false,
        speechEnabled: true,
        frontLanguage: 'es',
        backLanguage: 'en',
        cards: [{ id: 'card-1', front: 'Hola', back: 'Hello', note: '', image: '', tags: [] }],
      }
      const sessionRecord = {
        id: 'session-tts',
        source: 'template',
        status: 'running',
        snapshot_name: 'Study',
        definition_snapshot: { version: 1, children: [] },
        cue_snapshot: { soundEnabled: true, vibrationEnabled: true },
        flashcard_snapshot: {
          ...flashcardSnapshot,
          speechPaused,
          ...(speechPaused ? { speechPausedElapsedMs: 2_500 } : {}),
        },
        started_at: '2026-08-15T14:00:00.000Z',
        planned_seconds: 60,
        elapsed_seconds: 5,
        runtime_state: {
          stepIndex: 0,
          remainingMs: 55_000,
          accumulatedMs: 5_000,
          updatedAt: '2026-08-15T14:00:05.000Z',
        },
      }
      apiMocks.getIntervalSessions.mockResolvedValue({ items: [sessionRecord] })
      apiMocks.updateIntervalSession.mockResolvedValue({
        ...sessionRecord,
        flashcard_snapshot: {
          ...flashcardSnapshot,
          speechPaused: !speechPaused,
          speechPausedElapsedMs: 9_000,
        },
      })
      const store = useIntervalStore()
      await store.load({ reconcileActiveSession: false })

      await store.updateSession('session-tts', { elapsedSeconds: 6 })

      expect(store.sessions[0]?.flashcardReview?.speechPaused).toBe(speechPaused)
      expect(store.sessions[0]?.flashcardReview?.speechPausedElapsedMs)
        .toBe(speechPaused ? 2_500 : undefined)
    },
  )

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
      speechPaused: true,
      speechPausedElapsedMs: 2_500,
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
      flashcard_snapshot: {
        ...flashcardReview,
        speechPaused: false,
        speechPausedElapsedMs: 9_000,
      },
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
    expect(updated.flashcardReview?.speechPaused).toBe(true)
    expect(updated.flashcardReview?.speechPausedElapsedMs).toBe(2_500)
  })
})
