import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { IntervalTemplate } from '@/types/domain'

const apiMocks = vi.hoisted(() => ({
  updateTemplate: vi.fn(),
  completeIntervalSession: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  api: {
    authStore: { record: { id: 'user-1' } },
    completeIntervalSession: apiMocks.completeIntervalSession,
    collection: (name: string) => {
      if (name === 'interval_templates') return { update: apiMocks.updateTemplate }
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
    apiMocks.completeIntervalSession.mockReset()
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
})
