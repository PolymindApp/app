import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { format, subDays } from 'date-fns'
import { api } from '@/lib/api'
import { createLocalRecordId } from '@/lib/localDatabase'
import { aggregateTrackingEntries } from '@/services/tracking'
import { useSnackbarStore } from '@/stores/snackbar'
import { useTaskStore } from '@/stores/tasks'
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
  const insightFactorId = ref('')
  const insightOutcomeId = ref('')

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
      await useTaskStore().syncTaskReminders()
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
    await useTaskStore().syncTaskReminders()
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
    }
    const index = draft.id ? trackers.value.findIndex(item => item.id === draft.id) : -1
    const previous = index >= 0 ? trackers.value[index] : undefined
    const tracker = mapTrackingTracker({ id: draft.id || createLocalRecordId(), ...payload })
    if (index >= 0) trackers.value.splice(index, 1, tracker)
    else trackers.value.push(tracker)
    try {
      const record = draft.id
        ? await api.collection('tracking_trackers').update(draft.id, payload)
        : await api.collection('tracking_trackers').create(payload)
      Object.assign(tracker, mapTrackingTracker(record))
      return tracker
    } catch (cause) {
      const optimisticIndex = trackers.value.indexOf(tracker)
      if (previous && optimisticIndex >= 0) trackers.value.splice(optimisticIndex, 1, previous)
      else if (optimisticIndex >= 0) trackers.value.splice(optimisticIndex, 1)
      throw cause
    }
  }

  async function addEntry(draft: TrackingEntryDraft) {
    const payload = {
      owner: api.authStore.record!.id,
      tracker: draft.tracker,
      occurred_at: draft.occurredAt,
      local_date: draft.localDate,
      timezone_offset: draft.timezoneOffset,
      value: draft.value,
      note: draft.note,
    }
    const entry = mapTrackingEntry({ id: createLocalRecordId(), ...payload })
    entries.value.unshift(entry)
    void useTaskStore().syncTaskReminders()
    try {
      const record = await api.collection('tracking_entries').create(payload)
      Object.assign(entry, mapTrackingEntry(record))
      return entry
    } catch (cause) {
      entries.value = entries.value.filter(item => item !== entry)
      void useTaskStore().syncTaskReminders()
      throw cause
    }
  }

  async function updateEntry(draft: TrackingEntryDraft & { id: string }) {
    const payload = {
      tracker: draft.tracker,
      occurred_at: draft.occurredAt,
      local_date: draft.localDate,
      timezone_offset: draft.timezoneOffset,
      value: draft.value,
      note: draft.note,
    }
    const index = entries.value.findIndex(item => item.id === draft.id)
    const previous = index >= 0 ? entries.value[index] : undefined
    const entry = mapTrackingEntry({ id: draft.id, ...payload })
    if (index >= 0) entries.value.splice(index, 1, entry)
    else entries.value.unshift(entry)
    void useTaskStore().syncTaskReminders()
    try {
      const record = await api.collection('tracking_entries').update(draft.id, payload)
      Object.assign(entry, mapTrackingEntry(record))
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
      await api.collection('tracking_entries').delete(id)
    } catch (cause) {
      if (entry && !entries.value.includes(entry)) entries.value.splice(index, 0, entry)
      void useTaskStore().syncTaskReminders()
      throw cause
    }
    useSnackbarStore().showDeletion('Log')
  }

  async function archiveTracker(id: string) {
    const index = trackers.value.findIndex((item) => item.id === id)
    if (index < 0) {
      await api.collection('tracking_trackers').update(id, { active: false })
      return
    }
    const tracker = trackers.value[index]!
    const previous = { ...tracker }
    tracker.active = false
    try {
      const record = await api.collection('tracking_trackers').update(id, { active: false })
      Object.assign(tracker, mapTrackingTracker(record))
    } catch (cause) {
      Object.assign(tracker, previous)
      throw cause
    }
  }

  async function deleteTracker(id: string) {
    const previousTrackers = trackers.value
    const previousEntries = entries.value
    trackers.value = trackers.value.filter(tracker => tracker.id !== id)
    entries.value = entries.value.filter(entry => entry.tracker !== id)
    void useTaskStore().syncTaskReminders()
    try {
      await api.collection('tracking_trackers').delete(id)
    } catch (cause) {
      trackers.value = previousTrackers
      entries.value = previousEntries
      void useTaskStore().syncTaskReminders()
      throw cause
    }
    useSnackbarStore().showDeletion('Tracker')
  }

  return {
    trackers,
    entries,
    activeTrackers,
    loading,
    loaded,
    error,
    insightFactorId,
    insightOutcomeId,
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
