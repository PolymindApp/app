import { ref } from 'vue'
import { defineStore } from 'pinia'
import { api } from '@/lib/api'
import type { JournalEntry, JournalEntryDraft } from '@/types/domain'

export function mapJournalEntry(record: Record<string, any>): JournalEntry {
  return {
    id: record.id,
    title: record.title || '',
    body: record.body || '',
    occurredAt: record.occurred_at,
    localDate: record.local_date,
    timezoneOffset: Number(record.timezone_offset || 0),
    task: record.task || undefined,
    tracker: record.tracker || undefined,
    taskSnapshot: record.task_snapshot || '',
    trackerSnapshot: record.tracker_snapshot || '',
    createdAt: record.created_at || '',
    updatedAt: record.updated_at || '',
  }
}

export const useJournalStore = defineStore('journal', () => {
  const entries = ref<JournalEntry[]>([])
  const loading = ref(false)
  const loaded = ref(false)
  const error = ref('')
  let rangeRequest = 0

  async function loadRange(start: string, end: string) {
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
      tracker: draft.tracker || '',
    }
    const record = draft.id
      ? await api.collection('journal_entries').update(draft.id, payload)
      : await api.collection('journal_entries').create(payload)
    const entry = mapJournalEntry(record)
    const index = entries.value.findIndex((item) => item.id === entry.id)
    if (index >= 0) entries.value.splice(index, 1, entry)
    else entries.value.unshift(entry)
    return entry
  }

  async function deleteEntry(id: string) {
    await api.collection('journal_entries').delete(id)
    entries.value = entries.value.filter((entry) => entry.id !== id)
  }

  return {
    entries,
    loading,
    loaded,
    error,
    loadRange,
    getEntry,
    saveEntry,
    deleteEntry,
  }
})
