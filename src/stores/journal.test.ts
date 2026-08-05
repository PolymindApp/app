import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const apiMocks = vi.hoisted(() => ({
  getFullList: vi.fn(),
  getOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  api: {
    collection: (name: string) => {
      if (name !== 'journal_entries') throw new Error(`Unexpected collection: ${name}`)
      return apiMocks
    },
  },
}))

import { useJournalStore } from './journal'
import { useSnackbarStore } from './snackbar'

function record(id: string, date = '2026-08-02') {
  return {
    id,
    title: 'A reflection',
    body: 'What I noticed.',
    occurred_at: `${date}T16:00:00.000Z`,
    local_date: date,
    timezone_offset: 240,
    task: 'task-1',
    tracker: 'tracker-1',
    task_snapshot: 'Train',
    tracker_snapshot: 'Mood',
    created_at: `${date}T16:00:00.000Z`,
    updated_at: `${date}T16:00:00.000Z`,
  }
}

describe('journal store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    Object.values(apiMocks).forEach(mock => mock.mockReset())
  })

  it('loads a week and maps source snapshots', async () => {
    apiMocks.getFullList.mockResolvedValue([record('journal-1')])
    const store = useJournalStore()

    await store.loadRange('2026-07-27', '2026-08-02')

    expect(apiMocks.getFullList).toHaveBeenCalledWith({
      filter: 'local_date >= "2026-07-27" && local_date <= "2026-08-02"',
      sort: '-occurred_at',
    })
    expect(store.entries[0]).toMatchObject({
      id: 'journal-1',
      task: 'task-1',
      tracker: 'tracker-1',
      taskSnapshot: 'Train',
      trackerSnapshot: 'Mood',
    })
  })

  it('persists a plain copied context with a reflection', async () => {
    apiMocks.create.mockResolvedValue(record('journal-2'))
    const store = useJournalStore()

    await store.saveEntry({
      title: ' A reflection ',
      body: ' What I noticed. ',
      occurredAt: '2026-08-02T16:00:00.000Z',
      localDate: '2026-08-02',
      timezoneOffset: 240,
      task: 'task-1',
      tracker: 'tracker-1',
    })

    expect(apiMocks.create).toHaveBeenCalledWith({
      title: 'A reflection',
      body: 'What I noticed.',
      occurred_at: '2026-08-02T16:00:00.000Z',
      local_date: '2026-08-02',
      timezone_offset: 240,
      task: 'task-1',
      tracker: 'tracker-1',
    })
    expect(store.entries[0]?.id).toBe('journal-2')
  })

  it('keeps the newest week when overlapping loads finish out of order', async () => {
    let resolveOlder: (value: Record<string, unknown>[]) => void = () => undefined
    const older = new Promise<Record<string, unknown>[]>((resolve) => { resolveOlder = resolve })
    apiMocks.getFullList
      .mockReturnValueOnce(older)
      .mockResolvedValueOnce([record('newer-week', '2026-08-09')])
    const store = useJournalStore()

    const olderLoad = store.loadRange('2026-07-27', '2026-08-02')
    await store.loadRange('2026-08-03', '2026-08-09')
    resolveOlder([record('older-week')])
    await olderLoad

    expect(store.entries.map(entry => entry.id)).toEqual(['newer-week'])
  })

  it('shows a confirmation only after a reflection is successfully deleted', async () => {
    apiMocks.delete.mockResolvedValue(true)
    const store = useJournalStore()
    const snackbar = useSnackbarStore()
    store.entries = [{
      id: 'journal-1',
      title: 'A reflection',
      body: 'What I noticed.',
      occurredAt: '2026-08-02T16:00:00.000Z',
      localDate: '2026-08-02',
      timezoneOffset: 240,
      taskSnapshot: '',
      trackerSnapshot: '',
      createdAt: '2026-08-02T16:00:00.000Z',
      updatedAt: '2026-08-02T16:00:00.000Z',
    }]

    await store.deleteEntry('journal-1')

    expect(store.entries).toEqual([])
    expect(snackbar.visible).toBe(true)
    expect(snackbar.message).toBe('Reflection deleted.')
  })

  it('does not confirm a reflection deletion when the request fails', async () => {
    apiMocks.delete.mockRejectedValue(new Error('Delete failed.'))
    const store = useJournalStore()
    const snackbar = useSnackbarStore()

    await expect(store.deleteEntry('journal-1')).rejects.toThrow('Delete failed.')

    expect(snackbar.visible).toBe(false)
    expect(snackbar.message).toBe('')
  })
})
