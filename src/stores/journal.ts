import { ref } from 'vue'
import { defineStore } from 'pinia'
import { api } from '@/lib/api'
import { useSnackbarStore } from '@/stores/snackbar'
import { useTaskStore } from '@/stores/tasks'
import type { JournalEntry, JournalEntryDraft } from '@/types/domain'

export function mapJournalEntry(record: Record<string, any>): JournalEntry {
  const trackers = stringList(record.tracker)
  return {
    id: record.id,
    title: record.title || '',
    body: record.body || '',
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

function trackerSnapshotMap(value: unknown, trackers: string[]) {
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
      await useTaskStore().syncTaskReminders()
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

  async function saveEntry(draft: JournalEntryDraft) {
    const payload = {
      title: draft.title.trim(),
      body: draft.body.trim(),
      occurred_at: draft.occurredAt,
      local_date: draft.localDate,
      timezone_offset: draft.timezoneOffset,
      task: draft.task || '',
      tracker: draft.trackers,
    }
    const record = draft.id
      ? await api.collection('journal_entries').update(draft.id, payload)
      : await api.collection('journal_entries').create(payload)
    const entry = mapJournalEntry(record)
    const index = entries.value.findIndex((item) => item.id === entry.id)
    if (index >= 0) entries.value.splice(index, 1, entry)
    else entries.value.unshift(entry)
    await useTaskStore().syncTaskReminders()
    return entry
  }

  async function deleteEntry(id: string) {
    await api.collection('journal_entries').delete(id)
    entries.value = entries.value.filter((entry) => entry.id !== id)
    await useTaskStore().syncTaskReminders()
    useSnackbarStore().showDeletion('Reflection')
  }

  return {
    entries,
    loading,
    loaded,
    error,
    loadRange,
    reloadCurrentRange,
    getEntry,
    saveEntry,
    deleteEntry,
  }
})
