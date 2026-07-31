import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { IntervalTemplate } from '@/types/domain'

const apiMocks = vi.hoisted(() => ({
  updateTemplate: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  api: {
    authStore: { record: { id: 'user-1' } },
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
