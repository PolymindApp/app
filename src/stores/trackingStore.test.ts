import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const apiMocks = vi.hoisted(() => ({
  create: vi.fn(),
}))
const taskMocks = vi.hoisted(() => ({
  syncTaskReminders: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  api: {
    authStore: { record: { id: 'user-1' } },
    collection: (name: string) => {
      if (name !== 'tracking_entries') throw new Error(`Unexpected collection: ${name}`)
      return { create: apiMocks.create }
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
})
