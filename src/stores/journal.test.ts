import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const apiMocks = vi.hoisted(() => ({
  getFullList: vi.fn(),
  getOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  updateJournalImage: vi.fn(),
  removeJournalImage: vi.fn(),
}))
const taskMocks = vi.hoisted(() => ({
  syncTaskReminders: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  api: {
    collection: (name: string) => {
      if (name !== 'journal_entries') throw new Error(`Unexpected collection: ${name}`)
      return apiMocks
    },
    updateJournalImage: apiMocks.updateJournalImage,
    removeJournalImage: apiMocks.removeJournalImage,
  },
  apiAssetUrl: (value: string) => value.startsWith('/') ? `/api${value}` : value,
}))
vi.mock('@/stores/tasks', () => ({
  useTaskStore: () => taskMocks,
}))

import { useJournalStore } from './journal'
import { useSnackbarStore } from './snackbar'

function record(id: string, date = '2026-08-02') {
  return {
    id,
    title: 'A reflection',
    body: 'What I noticed.',
    color: '#D4A5FF',
    image_url: '',
    image_file: 'a'.repeat(48) + '.jpg',
    occurred_at: `${date}T16:00:00.000Z`,
    local_date: date,
    timezone_offset: 240,
    task: 'task-1',
    tracker: ['tracker-1', 'tracker-2'],
    task_snapshot: 'Train',
    tracker_snapshot: { 'tracker-1': 'Mood', 'tracker-2': 'Energy' },
    created_at: `${date}T16:00:00.000Z`,
    updated_at: `${date}T16:00:00.000Z`,
  }
}

describe('journal store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    Object.values(apiMocks).forEach(mock => mock.mockReset())
    taskMocks.syncTaskReminders.mockReset().mockResolvedValue(undefined)
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
      trackers: ['tracker-1', 'tracker-2'],
      taskSnapshot: 'Train',
      color: '#D4A5FF',
      trackerSnapshots: { 'tracker-1': 'Mood', 'tracker-2': 'Energy' },
      image: `/api/journal-images/${'a'.repeat(48)}.jpg`,
    })
    expect(store.loadedRange).toBe('2026-07-27:2026-08-02')
  })

  it('persists a plain copied context with a reflection', async () => {
    apiMocks.create.mockResolvedValue(record('journal-2'))
    const store = useJournalStore()

    await store.saveEntry({
      title: ' A reflection ',
      body: ' What I noticed. ',
      color: '#D4A5FF',
      occurredAt: '2026-08-02T16:00:00.000Z',
      localDate: '2026-08-02',
      timezoneOffset: 240,
      task: 'task-1',
      trackers: ['tracker-1', 'tracker-2'],
    })

    expect(apiMocks.create).toHaveBeenCalledWith({
      title: 'A reflection',
      body: 'What I noticed.',
      color: '#D4A5FF',
      occurred_at: '2026-08-02T16:00:00.000Z',
      local_date: '2026-08-02',
      timezone_offset: 240,
      task: 'task-1',
      tracker: ['tracker-1', 'tracker-2'],
    })
    expect(store.entries[0]?.id).toBe('journal-2')
  })

  it('attaches a compressed upload to the local reflection record', async () => {
    apiMocks.create.mockResolvedValue(record('journal-2'))
    apiMocks.updateJournalImage.mockResolvedValue({
      ...record('journal-2'),
      image_file: '',
      image_url: 'data:image/jpeg;base64,reflection',
    })
    const store = useJournalStore()
    const upload = new Blob(['reflection'], { type: 'image/jpeg' })

    const saved = await store.saveEntry({
      title: '',
      body: 'Offline reflection',
      color: '#C7F464',
      occurredAt: '2026-08-02T16:00:00.000Z',
      localDate: '2026-08-02',
      timezoneOffset: 240,
      trackers: [],
    }, {
      source: 'upload',
      url: '',
      existingUrl: '',
      existingSource: 'none',
      upload,
    })

    expect(apiMocks.updateJournalImage).toHaveBeenCalledWith('journal-2', upload)
    expect(saved.image).toBe('data:image/jpeg;base64,reflection')
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
    expect(store.loadedRange).toBe('2026-08-03:2026-08-09')
  })

  it('does not keep the local list loading while reminders reconcile', async () => {
    taskMocks.syncTaskReminders.mockReturnValue(new Promise(() => undefined))
    apiMocks.getFullList.mockResolvedValue([record('journal-1')])
    const store = useJournalStore()

    await store.loadRange('2026-08-01', '2026-08-31')

    expect(store.loading).toBe(false)
    expect(store.entries.map(entry => entry.id)).toEqual(['journal-1'])
  })

  it('shows a confirmation only after a reflection is successfully deleted', async () => {
    apiMocks.delete.mockResolvedValue(true)
    const store = useJournalStore()
    const snackbar = useSnackbarStore()
    store.entries = [{
      id: 'journal-1',
      title: 'A reflection',
      body: 'What I noticed.',
      color: '#D4A5FF',
      image: '',
      occurredAt: '2026-08-02T16:00:00.000Z',
      localDate: '2026-08-02',
      timezoneOffset: 240,
      trackers: [],
      taskSnapshot: '',
      trackerSnapshots: {},
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
