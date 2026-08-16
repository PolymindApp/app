import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const apiMocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
}))
const taskMocks = vi.hoisted(() => ({
  syncTaskReminders: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  api: {
    authStore: { record: { id: 'user-1' } },
    collection: (name: string) => {
      if (name === 'tracking_entries') return { create: apiMocks.create }
      if (name === 'tracking_trackers') return { update: apiMocks.update }
      throw new Error(`Unexpected collection: ${name}`)
    },
  },
}))

vi.mock('@/stores/tasks', () => ({
  useTaskStore: () => taskMocks,
}))

import { useTrackingStore } from './tracking'

describe('tracking store optimistic updates', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    apiMocks.create.mockReset()
    apiMocks.update.mockReset()
    taskMocks.syncTaskReminders.mockReset().mockResolvedValue(undefined)
  })

  it('shows a tracking log before local persistence finishes', async () => {
    let resolveCreate!: (value: Record<string, unknown>) => void
    apiMocks.create.mockReturnValue(new Promise((resolve) => {
      resolveCreate = resolve
    }))
    const store = useTrackingStore()

    const update = store.addEntry({
      tracker: 'tracker-1',
      occurredAt: '2026-08-15T12:00:00.000Z',
      localDate: '2026-08-15',
      timezoneOffset: 240,
      value: 4,
      note: 'Immediate',
    })

    expect(store.entries[0]).toMatchObject({
      tracker: 'tracker-1',
      value: 4,
      note: 'Immediate',
    })

    resolveCreate({
      id: 'tracking-entry-persisted',
      tracker: 'tracker-1',
      occurred_at: '2026-08-15T12:00:00.000Z',
      local_date: '2026-08-15',
      timezone_offset: 240,
      value: 4,
      note: 'Immediate',
    })
    await update

    expect(store.entries[0]?.id).toBe('tracking-entry-persisted')
  })

  it('pauses a tracker before persistence finishes', async () => {
    let resolveUpdate!: (value: Record<string, unknown>) => void
    apiMocks.update.mockReturnValue(new Promise((resolve) => {
      resolveUpdate = resolve
    }))
    const store = useTrackingStore()
    store.trackers = [{
      id: 'tracker-1',
      name: 'Mood',
      description: '',
      role: 'outcome',
      kind: 'rating',
      category: 'mood',
      unit: '/ 10',
      scaleMin: 1,
      scaleMax: 10,
      favorableDirection: 'higher',
      dailyAggregation: 'last',
      active: true,
      sortOrder: 0,
      color: '#C7F464',
      icon: 'mdi-emoticon-outline',
    }]

    const update = store.setTrackerActive('tracker-1', false)

    expect(store.trackers[0]?.active).toBe(false)
    expect(apiMocks.update).toHaveBeenCalledWith('tracker-1', { active: false })

    resolveUpdate({
      id: 'tracker-1',
      name: 'Mood',
      role: 'outcome',
      kind: 'rating',
      category: 'mood',
      unit: '/ 10',
      scale_min: 1,
      scale_max: 10,
      favorable_direction: 'higher',
      daily_aggregation: 'last',
      active: false,
      sort_order: 0,
      color: '#C7F464',
      icon: 'mdi-emoticon-outline',
    })
    await update

    expect(store.trackers[0]?.active).toBe(false)
  })
})
