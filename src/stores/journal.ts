import { ref } from 'vue'
import { defineStore } from 'pinia'
import { api, apiAssetUrl } from '@/lib/api'
import { createLocalRecordId } from '@/lib/localDatabase'
import { useSnackbarStore } from '@/stores/snackbar'
import { useTaskStore } from '@/stores/tasks'
import type { JournalEntry, JournalEntryDraft, SquareImageSourceValue } from '@/types/domain'

export function mapJournalEntry(record: Record<string, any>): JournalEntry {
  const trackers = stringList(decodedJsonValue(record.tracker))
  return {
    id: record.id,
    title: record.title || '',
    body: record.body || '',
    color: record.color || '#C7F464',
    image: record.image_file
      ? apiAssetUrl(`/journal-images/${record.image_file}`)
      : apiAssetUrl(record.image_url || ''),
    occurredAt: record.occurred_at,
    localDate: record.local_date,
    timezoneOffset: Number(record.timezone_offset || 0),
    task: record.task || undefined,
    trackers,
    taskSnapshot: record.task_snapshot || '',
    trackerSnapshots: trackerSnapshotMap(record.tracker_snapshot, trackers),
    createdAt: record.created_at || '',
    updatedAt: record.updated_at || '',
  }
}

function stringList(value: unknown) {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string' && Boolean(item))
  return typeof value === 'string' && value ? [value] : []
}

function decodedJsonValue(value: unknown) {
  if (typeof value !== 'string' || !value) return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function trackerSnapshotMap(value: unknown, trackers: string[]) {
  value = decodedJsonValue(value)
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(Object.entries(value)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && Boolean(entry[1])))
  }

  return stringList(value).reduce<Record<string, string>>((snapshots, name, index) => {
    snapshots[trackers[index] || `detached:${index}`] = name
    return snapshots
  }, {})
}

export const useJournalStore = defineStore('journal', () => {
  const entries = ref<JournalEntry[]>([])
  const loading = ref(false)
  const loaded = ref(false)
  const loadedRange = ref('')
  const error = ref('')
  let rangeRequest = 0
  let lastRange: [string, string] | undefined

  async function loadRange(start: string, end: string) {
    lastRange = [start, end]
    const request = ++rangeRequest
    loading.value = true
    error.value = ''
    try {
      const records = await api.collection('journal_entries').getFullList({
        filter: `local_date >= "${start}" && local_date <= "${end}"`,
        sort: '-occurred_at',
      })
      if (request !== rangeRequest) return false
      entries.value = records.map(mapJournalEntry)
      loaded.value = true
      loadedRange.value = `${start}:${end}`
      void useTaskStore().syncTaskReminders()
      return true
    } catch (cause) {
      if (request === rangeRequest) {
        error.value = cause instanceof Error ? cause.message : 'Could not load your journal.'
      }
      throw cause
    } finally {
      if (request === rangeRequest) loading.value = false
    }
  }

  function reloadCurrentRange() {
    return lastRange ? loadRange(...lastRange) : Promise.resolve(false)
  }

  async function getEntry(id: string) {
    const existing = entries.value.find((entry) => entry.id === id)
    if (existing) return existing
    return mapJournalEntry(await api.collection('journal_entries').getOne(id))
  }

  async function saveEntry(draft: JournalEntryDraft, image?: SquareImageSourceValue) {
    const payload = {
      title: draft.title.trim(),
      body: draft.body.trim(),
      color: draft.color,
      occurred_at: draft.occurredAt,
      local_date: draft.localDate,
      timezone_offset: draft.timezoneOffset,
      task: draft.task || '',
      tracker: draft.trackers,
    }
    const index = draft.id ? entries.value.findIndex(item => item.id === draft.id) : -1
    const previous = index >= 0 ? entries.value[index] : undefined
    const entry: JournalEntry = {
      id: draft.id || createLocalRecordId(),
      title: payload.title,
      body: payload.body,
      color: payload.color,
      image: image?.source === 'none'
        ? ''
        : image?.source === 'url'
          ? image.url.trim()
          : previous?.image || '',
      occurredAt: payload.occurred_at,
      localDate: payload.local_date,
      timezoneOffset: payload.timezone_offset,
      task: draft.task,
      trackers: [...draft.trackers],
      taskSnapshot: previous?.taskSnapshot || '',
      trackerSnapshots: { ...(previous?.trackerSnapshots || {}) },
      createdAt: previous?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    if (index >= 0) entries.value.splice(index, 1, entry)
    else entries.value.unshift(entry)
    void useTaskStore().syncTaskReminders()
    try {
      let record = draft.id
        ? await api.collection('journal_entries').update(draft.id, payload)
        : await api.collection('journal_entries').create(payload)
      if (image?.upload) {
        record = await api.updateJournalImage(record.id, image.upload)
      } else if (draft.id && image?.source === 'none' && image.existingSource !== 'none') {
        record = await api.removeJournalImage(record.id)
      }
      Object.assign(entry, mapJournalEntry(record))
      return entry
    } catch (cause) {
      const optimisticIndex = entries.value.indexOf(entry)
      if (previous && optimisticIndex >= 0) entries.value.splice(optimisticIndex, 1, previous)
      else if (optimisticIndex >= 0) entries.value.splice(optimisticIndex, 1)
      void useTaskStore().syncTaskReminders()
      throw cause
    }
  }

  async function deleteEntry(id: string) {
    const index = entries.value.findIndex(entry => entry.id === id)
    const entry = index >= 0 ? entries.value[index] : undefined
    if (index >= 0) entries.value.splice(index, 1)
    void useTaskStore().syncTaskReminders()
    try {
      await api.collection('journal_entries').delete(id)
    } catch (cause) {
      if (entry && !entries.value.includes(entry)) entries.value.splice(index, 0, entry)
      void useTaskStore().syncTaskReminders()
      throw cause
    }
    useSnackbarStore().showDeletion('Reflection')
  }

  return {
    entries,
    loading,
    loaded,
    loadedRange,
    error,
    loadRange,
    reloadCurrentRange,
    getEntry,
    saveEntry,
    deleteEntry,
  }
})
