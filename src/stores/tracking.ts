import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { format, subDays } from 'date-fns'
import { api } from '@/lib/api'
import { aggregateTrackingEntries } from '@/services/tracking'
import type {
  TrackingEntry,
  TrackingEntryDraft,
  TrackingTracker,
  TrackingTrackerDraft,
} from '@/types/domain'

export function mapTrackingTracker(record: Record<string, any>): TrackingTracker {
  return {
    id: record.id,
    name: record.name,
    description: record.description || '',
    role: record.role,
    kind: record.kind,
    category: record.category,
    unit: record.unit || '',
    scaleMin: Number(record.scale_min || 0),
    scaleMax: Number(record.scale_max || 0),
    favorableDirection: record.favorable_direction,
    dailyAggregation: record.daily_aggregation,
    active: record.active !== false,
    sortOrder: Number(record.sort_order || 0),
    color: record.color || '#C7F464',
    icon: record.icon || 'mdi-checkbox-marked-circle-outline',
    reminderEnabled: record.reminder_enabled === true,
    reminderTime: record.reminder_time || '20:00',
    reminderShowName: record.reminder_show_name === true,
  }
}

export function mapTrackingEntry(record: Record<string, any>): TrackingEntry {
  return {
    id: record.id,
    tracker: record.tracker,
    occurredAt: record.occurred_at,
    localDate: record.local_date,
    timezoneOffset: Number(record.timezone_offset || 0),
    value: Number(record.value || 0),
    note: record.note || '',
  }
}

export const useTrackingStore = defineStore('tracking', () => {
  const trackers = ref<TrackingTracker[]>([])
  const entries = ref<TrackingEntry[]>([])
  const loading = ref(false)
  const loaded = ref(false)
  const error = ref('')

  const activeTrackers = computed(() => trackers.value
    .filter((tracker) => tracker.active)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)))

  async function load() {
    if (!api.authStore.record) return
    loading.value = true
    error.value = ''
    try {
      const since = format(subDays(new Date(), 120), 'yyyy-MM-dd')
      const [trackerRecords, entryRecords] = await Promise.all([
        api.collection('tracking_trackers').getFullList({ sort: 'sort_order,name' }),
        api.collection('tracking_entries').getFullList({
          filter: `local_date >= "${since}"`,
          sort: '-occurred_at',
        }),
      ])
      trackers.value = trackerRecords.map(mapTrackingTracker)
      entries.value = entryRecords.map(mapTrackingEntry)
      loaded.value = true
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Could not load tracking.'
      throw cause
    } finally {
      loading.value = false
    }
  }

  async function loadRange(start: string, end: string) {
    const records = await api.collection('tracking_entries').getFullList({
      filter: `local_date >= "${start}" && local_date <= "${end}"`,
      sort: 'occurred_at',
    })
    const merged = new Map(entries.value.map((entry) => [entry.id, entry]))
    records.map(mapTrackingEntry).forEach((entry) => merged.set(entry.id, entry))
    entries.value = [...merged.values()].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
  }

  function entriesFor(trackerId: string, date?: string) {
    return entries.value
      .filter((entry) => entry.tracker === trackerId && (!date || entry.localDate === date))
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
  }

  function dailyValues(trackerId: string) {
    const tracker = trackers.value.find((item) => item.id === trackerId)
    return tracker ? aggregateTrackingEntries(tracker, entries.value) : []
  }

  async function saveTracker(draft: TrackingTrackerDraft) {
    const payload = {
      owner: api.authStore.record!.id,
      name: draft.name,
      description: draft.description,
      role: draft.role,
      kind: draft.kind,
      category: draft.category,
      unit: draft.unit,
      scale_min: draft.scaleMin,
      scale_max: draft.scaleMax,
      favorable_direction: draft.favorableDirection,
      daily_aggregation: draft.dailyAggregation,
      active: draft.active,
      sort_order: draft.sortOrder,
      color: draft.color,
      icon: draft.icon,
      reminder_enabled: draft.reminderEnabled,
      reminder_time: draft.reminderTime,
      reminder_show_name: draft.reminderShowName,
    }
    const record = draft.id
      ? await api.collection('tracking_trackers').update(draft.id, payload)
      : await api.collection('tracking_trackers').create(payload)
    const tracker = mapTrackingTracker(record)
    const index = trackers.value.findIndex((item) => item.id === tracker.id)
    if (index >= 0) trackers.value.splice(index, 1, tracker)
    else trackers.value.push(tracker)
    return tracker
  }

  async function addEntry(draft: TrackingEntryDraft) {
    const record = await api.collection('tracking_entries').create({
      owner: api.authStore.record!.id,
      tracker: draft.tracker,
      occurred_at: draft.occurredAt,
      local_date: draft.localDate,
      timezone_offset: draft.timezoneOffset,
      value: draft.value,
      note: draft.note,
    })
    const entry = mapTrackingEntry(record)
    entries.value.unshift(entry)
    return entry
  }

  async function updateEntry(draft: TrackingEntryDraft & { id: string }) {
    const record = await api.collection('tracking_entries').update(draft.id, {
      tracker: draft.tracker,
      occurred_at: draft.occurredAt,
      local_date: draft.localDate,
      timezone_offset: draft.timezoneOffset,
      value: draft.value,
      note: draft.note,
    })
    const entry = mapTrackingEntry(record)
    const index = entries.value.findIndex((item) => item.id === entry.id)
    if (index >= 0) entries.value.splice(index, 1, entry)
    return entry
  }

  async function deleteEntry(id: string) {
    await api.collection('tracking_entries').delete(id)
    entries.value = entries.value.filter((entry) => entry.id !== id)
  }

  async function archiveTracker(id: string) {
    const record = await api.collection('tracking_trackers').update(id, { active: false })
    const tracker = mapTrackingTracker(record)
    const index = trackers.value.findIndex((item) => item.id === id)
    if (index >= 0) trackers.value.splice(index, 1, tracker)
  }

  async function deleteTracker(id: string) {
    await api.collection('tracking_trackers').delete(id)
    trackers.value = trackers.value.filter((tracker) => tracker.id !== id)
    entries.value = entries.value.filter((entry) => entry.tracker !== id)
  }

  return {
    trackers,
    entries,
    activeTrackers,
    loading,
    loaded,
    error,
    load,
    loadRange,
    entriesFor,
    dailyValues,
    saveTracker,
    addEntry,
    updateEntry,
    deleteEntry,
    archiveTracker,
    deleteTracker,
  }
})
