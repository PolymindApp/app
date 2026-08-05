<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { addDays, format, isToday, parseISO, startOfWeek } from 'date-fns'
import { useRoute, useRouter } from 'vue-router'
import { Ripple } from 'vuetify/directives'
import ActionBottomSheet from '@/components/ActionBottomSheet.vue'
import DateTimePickerField from '@/components/DateTimePickerField.vue'
import LabeledSlider from '@/components/LabeledSlider.vue'
import TrackingTrackerCard from '@/components/TrackingTrackerCard.vue'
import TrackingWeeklyBarChart from '@/components/TrackingWeeklyBarChart.vue'
import WeekDateNavigator from '@/components/WeekDateNavigator.vue'
import { TRACKING_PRESETS, trackerDraftFromPreset } from '@/services/tracking'
import { reconcileTrackingReminders } from '@/services/trackingReminders'
import { useTrackingStore } from '@/stores/tracking'
import type { TrackingEntry, TrackingTracker } from '@/types/domain'

const route = useRoute()
const router = useRouter()
const store = useTrackingStore()
const selectedDate = ref(new Date())
const visibleWeekStart = ref(startOfWeek(selectedDate.value, { weekStartsOn: 1 }))
const trackerActionsOpen = ref(false)
const actionTracker = ref<TrackingTracker>()
const sheetOpen = ref(false)
const sheetTracker = ref<TrackingTracker>()
const editingEntry = ref<TrackingEntry>()
const value = ref(1)
const occurredLocal = ref('')
const note = ref('')
const saving = ref(false)
const addingPreset = ref('')
const error = ref('')
const weeklyChartLoading = ref(false)
const weeklyChartError = ref('')
let weeklyLoadRequest = 0
const vRipple = Ripple

const dateKey = computed(() => format(selectedDate.value, 'yyyy-MM-dd'))
const visibleWeekLabel = computed(() =>
  `${format(visibleWeekStart.value, 'MMM d')}–${format(addDays(visibleWeekStart.value, 6), 'MMM d')}`,
)
const dayEntries = computed(() => store.entries
  .filter((entry) => entry.localDate === dateKey.value)
  .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)))
const trackingDateMarkers = computed(() => [...new Set(store.entries.map((entry) => entry.localDate))]
  .map((date) => ({ date, color: 'error', label: 'Has tracking entries' })))
const outcomes = computed(() => store.activeTrackers.filter((tracker) => tracker.role === 'outcome'))
const factors = computed(() => store.activeTrackers.filter((tracker) => tracker.role === 'factor'))
const archivedTrackers = computed(() => store.trackers.filter((tracker) => !tracker.active))
const dayEntriesByTracker = computed(() => {
  const grouped = new Map<string, TrackingEntry[]>()
  for (const entry of dayEntries.value) {
    const trackerEntries = grouped.get(entry.tracker) || []
    trackerEntries.push(entry)
    grouped.set(entry.tracker, trackerEntries)
  }
  return grouped
})

function entriesForTracker(trackerId: string) {
  return dayEntriesByTracker.value.get(trackerId) || []
}

function openTrackerActions(tracker: TrackingTracker) {
  actionTracker.value = tracker
  trackerActionsOpen.value = true
}

async function logActionTracker() {
  const tracker = actionTracker.value
  if (!tracker) return
  trackerActionsOpen.value = false
  await nextTick()
  startLog(tracker)
}

function editActionTracker() {
  const tracker = actionTracker.value
  if (!tracker) return
  trackerActionsOpen.value = false
  void router.push(`/tracking/${tracker.id}/edit`)
}

async function writeTrackerReflection() {
  const tracker = actionTracker.value
  if (!tracker) return
  trackerActionsOpen.value = false
  await nextTick()
  await router.push({
    name: 'journal-new',
    query: { tracker: tracker.id, date: dateKey.value },
  })
}

async function viewTrackerReflections() {
  const tracker = actionTracker.value
  if (!tracker) return
  trackerActionsOpen.value = false
  await nextTick()
  await router.push({
    name: 'journal',
    query: { tracker: tracker.id, date: dateKey.value },
  })
}

function startLog(tracker: TrackingTracker, entry?: TrackingEntry) {
  sheetTracker.value = tracker
  editingEntry.value = entry
  value.value = entry
    ? tracker.kind === 'duration' ? entry.value / 60 : entry.value
    : tracker.kind === 'rating' ? tracker.scaleMin : 1
  const when = entry ? new Date(entry.occurredAt) : selectedLogTime()
  occurredLocal.value = format(when, "yyyy-MM-dd'T'HH:mm")
  note.value = entry?.note || ''
  sheetOpen.value = true
}

function selectedLogTime() {
  const now = new Date()
  if (isToday(selectedDate.value)) return now
  const selected = new Date(selectedDate.value)
  selected.setHours(12, 0, 0, 0)
  return selected
}

async function saveLog(explicitValue?: number) {
  const tracker = sheetTracker.value
  if (!tracker || !occurredLocal.value) return
  saving.value = true
  error.value = ''
  try {
    const localDate = new Date(occurredLocal.value)
    const storedValue = explicitValue ?? value.value
    const draft = {
      id: editingEntry.value?.id,
      tracker: tracker.id,
      occurredAt: localDate.toISOString(),
      localDate: format(localDate, 'yyyy-MM-dd'),
      timezoneOffset: localDate.getTimezoneOffset(),
      value: tracker.kind === 'duration' ? storedValue * 60 : storedValue,
      note: note.value.trim(),
    }
    if (draft.id) await store.updateEntry({ ...draft, id: draft.id })
    else await store.addEntry(draft)
    sheetOpen.value = false
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not save this log.'
  } finally {
    saving.value = false
  }
}

async function removeEntry() {
  if (!editingEntry.value) return
  saving.value = true
  try {
    await store.deleteEntry(editingEntry.value.id)
    sheetOpen.value = false
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not delete this log.'
  } finally {
    saving.value = false
  }
}

async function addPreset(presetId: string) {
  const preset = TRACKING_PRESETS.find((item) => item.id === presetId)
  if (!preset) return
  addingPreset.value = presetId
  error.value = ''
  try {
    await store.saveTracker(trackerDraftFromPreset(preset, store.trackers.length))
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not add this tracker.'
  } finally {
    addingPreset.value = ''
  }
}

function openRequestedTracker() {
  const id = typeof route.query.log === 'string' ? route.query.log : ''
  if (!id) return
  const tracker = store.activeTrackers.find((item) => item.id === id)
  if (!tracker) return
  startLog(tracker)
  void router.replace({ path: '/tracking' })
}

watch(() => route.query.log, () => nextTick(openRequestedTracker))
watch(visibleWeekStart, () => {
  if (store.loaded) void loadVisibleWeekEntries()
})

onMounted(async () => {
  await store.load().catch(() => undefined)
  if (store.loaded) await loadVisibleWeekEntries()
  await reconcileTrackingReminders(store.trackers).catch(() => undefined)
  openRequestedTracker()
})

async function loadVisibleWeekEntries() {
  const request = ++weeklyLoadRequest
  weeklyChartLoading.value = true
  weeklyChartError.value = ''
  try {
    await store.loadRange(
      format(visibleWeekStart.value, 'yyyy-MM-dd'),
      format(addDays(visibleWeekStart.value, 6), 'yyyy-MM-dd'),
    )
  } catch (cause) {
    if (request === weeklyLoadRequest) {
      weeklyChartError.value = cause instanceof Error ? cause.message : 'Could not load this week’s entries.'
    }
  } finally {
    if (request === weeklyLoadRequest) weeklyChartLoading.value = false
  }
}
</script>

<template>
  <main class="app-page tracking-page">
    <v-alert v-if="error || store.error" type="error" variant="tonal" class="mb-4">
      {{ error || store.error }}
    </v-alert>

    <WeekDateNavigator
      v-model="selectedDate"
      v-model:week-start="visibleWeekStart"
      :markers="trackingDateMarkers"
      class="mb-5"
    />

    <div v-if="store.loading && !store.loaded" class="d-flex justify-center py-12">
      <v-progress-circular indeterminate color="secondary" />
    </div>

    <template v-else-if="store.trackers.length">
      <section v-if="factors.length">
        <div class="section-heading"><h2>Things you did</h2><span class="muted text-caption">{{ factors.length }}</span></div>
        <div class="tracker-grid">
          <TrackingTrackerCard
            v-for="tracker in factors"
            :key="tracker.id"
            :tracker="tracker"
            :entries="entriesForTracker(tracker.id)"
            @actions="openTrackerActions"
            @entry="startLog(tracker, $event)"
          />
        </div>
      </section>

      <section v-if="outcomes.length">
        <div class="section-heading"><h2>How you felt</h2><span class="muted text-caption">{{ outcomes.length }}</span></div>
        <div class="tracker-grid">
          <TrackingTrackerCard
            v-for="tracker in outcomes"
            :key="tracker.id"
            :tracker="tracker"
            :entries="entriesForTracker(tracker.id)"
            @actions="openTrackerActions"
            @entry="startLog(tracker, $event)"
          />
        </div>
      </section>

      <v-btn
        block
        size="large"
        class="mt-6"
        color="secondary"
        prepend-icon="mdi-plus"
        to="/tracking/new"
      >
        New tracker
      </v-btn>

      <v-card class="insight-card surface-card pa-5 mt-6">
        <router-link
          v-ripple
          class="insight-card__header"
          to="/tracking/insights/compare"
          aria-label="Open tracking insights"
        >
          <div class="insight-card__icon"><v-icon icon="mdi-chart-box-outline" /></div>
          <div class="min-width-0">
            <strong>Explore your patterns</strong>
            <p>See how every tracker changed across the week.</p>
          </div>
          <span class="insight-card__chevron" aria-hidden="true">
            <v-icon icon="mdi-chevron-right" />
          </span>
        </router-link>

        <v-progress-linear
          v-if="weeklyChartLoading"
          indeterminate
          color="secondary"
          class="mt-4"
          aria-label="Loading weekly tracking entries"
        />
        <v-alert v-if="weeklyChartError" type="error" variant="tonal" class="mt-4">
          {{ weeklyChartError }}
        </v-alert>
        <TrackingWeeklyBarChart
          :trackers="store.trackers"
          :entries="store.entries"
          :week-start="visibleWeekStart"
          class="mt-4"
        />
        <div class="weekly-hint mt-4">
          <v-icon icon="mdi-calendar-week-outline" size="18" />
          <span><strong>{{ visibleWeekLabel }}</strong> · This chart shows the full visible week, not only the selected day.</span>
        </div>
      </v-card>

      <section v-if="archivedTrackers.length">
        <div class="section-heading"><h2>Archived</h2><span class="muted text-caption">{{ archivedTrackers.length }}</span></div>
        <v-card class="surface-card pa-2">
          <v-list bg-color="transparent">
            <v-list-item
              v-for="tracker in archivedTrackers"
              :key="tracker.id"
              :title="tracker.name"
              subtitle="History retained"
              :prepend-icon="tracker.icon"
              append-icon="mdi-chevron-right"
              :to="`/tracking/${tracker.id}/edit`"
            />
          </v-list>
        </v-card>
      </section>
    </template>

    <template v-else-if="store.loaded">
      <div class="section-heading"><h2>Start with a tracker</h2></div>
      <div class="preset-grid">
        <v-card v-for="preset in TRACKING_PRESETS" :key="preset.id" class="preset-card surface-card pa-4">
          <div class="preset-card__content">
            <div class="preset-card__icon" :style="{ color: preset.color }">
              <v-icon :icon="preset.icon" size="26" />
            </div>
            <div class="min-width-0">
              <strong class="d-block">{{ preset.name }}</strong>
              <span>{{ preset.description }}</span>
            </div>
          </div>
          <v-btn block size="large" variant="tonal" :loading="addingPreset === preset.id" @click="addPreset(preset.id)">Add</v-btn>
        </v-card>
      </div>
      <v-btn block size="large" class="mt-4" color="secondary" prepend-icon="mdi-tune-variant" to="/tracking/new">Create a custom tracker</v-btn>
    </template>

    <ActionBottomSheet
      v-model="trackerActionsOpen"
      :title="actionTracker?.name || 'Tracker actions'"
      hide-title
      :aria-label="actionTracker ? `${actionTracker.name} log, journal, or edit actions` : 'Tracker actions'"
    >
      <template v-if="actionTracker">
        <v-list-item
          prepend-icon="mdi-plus-circle-outline"
          title="Log"
          rounded="lg"
          @click="logActionTracker"
        />
        <v-list-item
          prepend-icon="mdi-pencil-outline"
          title="Edit"
          rounded="lg"
          @click="editActionTracker"
        />
        <v-list-item
          prepend-icon="mdi-notebook-plus-outline"
          title="Write reflection"
          rounded="lg"
          @click="writeTrackerReflection"
        />
        <v-list-item
          prepend-icon="mdi-notebook-outline"
          title="View reflections"
          rounded="lg"
          @click="viewTrackerReflections"
        />
      </template>
    </ActionBottomSheet>

    <ActionBottomSheet
      v-model="sheetOpen"
      :title="editingEntry ? `Edit ${sheetTracker?.name || 'log'}` : `Log ${sheetTracker?.name || ''}`"
      :description="sheetTracker?.description"
    >
      <template #content>
        <div v-if="sheetTracker" class="d-flex flex-column ga-4">
          <LabeledSlider
            v-if="sheetTracker.kind === 'rating'"
            v-model="value"
            title="Rating"
            :value-label="`${value}${sheetTracker.unit ? ` ${sheetTracker.unit}` : ''}`"
            :min="sheetTracker.scaleMin"
            :max="sheetTracker.scaleMax"
            :step="1"
            :aria-label="`${sheetTracker.name} rating`"
          />
          <v-number-input v-else-if="sheetTracker.kind === 'number'" v-model="value" :label="sheetTracker.unit ? `Value (${sheetTracker.unit})` : 'Value'" variant="outlined" hide-details />
          <v-number-input v-else-if="sheetTracker.kind === 'duration'" v-model="value" label="Minutes" :min="0" variant="outlined" hide-details />
          <v-textarea v-model="note" label="Note (optional)" rows="2" auto-grow variant="outlined" hide-details />
          <DateTimePickerField v-model="occurredLocal" label="When" />
          <div v-if="sheetTracker.kind === 'yes_no'" class="sheet-buttons">
            <v-btn color="secondary" :loading="saving" @click="saveLog(1)">Yes</v-btn>
            <v-btn variant="tonal" :disabled="saving" @click="saveLog(0)">No</v-btn>
          </div>
          <div v-else-if="sheetTracker.kind === 'event'" class="sheet-buttons">
            <v-btn color="secondary" :loading="saving" @click="saveLog(1)">Log occurrence</v-btn>
            <v-btn variant="tonal" :disabled="saving" @click="saveLog(0)">None today</v-btn>
          </div>
          <v-btn v-else block color="secondary" :loading="saving" @click="saveLog()">Save log</v-btn>
          <v-btn v-if="editingEntry" block color="error" variant="text" :disabled="saving" @click="removeEntry">Delete log</v-btn>
        </div>
      </template>
    </ActionBottomSheet>
  </main>
</template>

<style scoped>
.insight-card { background: linear-gradient(135deg, rgb(var(--v-theme-surface)), rgba(var(--v-theme-secondary), .08)); }
.insight-card__header { position: relative; display: grid; grid-template-columns: 2.75rem minmax(0, 1fr) 2.75rem; align-items: center; gap: 1rem; overflow: hidden; border-radius: .75rem; color: inherit; outline: none; text-decoration: none; }
.insight-card__header:focus-visible { outline: .125rem solid rgba(var(--v-theme-secondary), .72); outline-offset: .1875rem; }
.insight-card__icon { display: grid; width: 2.75rem; height: 2.75rem; place-items: center; border-radius: .875rem; background: rgb(var(--v-theme-secondary)); color: rgb(var(--v-theme-on-secondary)); }
.insight-card__chevron { display: grid; width: 2.75rem; height: 2.75rem; place-items: center; }
.insight-card p { margin-top: .2rem; color: rgb(var(--v-theme-on-surface) / .58); font-size: .75rem; }
.weekly-hint { display: flex; align-items: flex-start; gap: .5rem; padding: .75rem; border-radius: .75rem; background: rgba(var(--v-theme-secondary), .08); color: rgba(var(--v-theme-on-surface), .66); font-size: .72rem; line-height: 1.45; }
.weekly-hint .v-icon { flex: 0 0 auto; color: rgb(var(--v-theme-secondary)); }
.weekly-hint strong { color: rgb(var(--v-theme-on-surface)); }
.tracker-grid { display: grid; gap: .75rem; grid-template-columns: repeat(auto-fit, minmax(min(100%, 270px), 1fr)); }
.preset-grid { display: grid; gap: .75rem; grid-template-columns: repeat(auto-fit, minmax(min(100%, 210px), 1fr)); }
.preset-card { display: grid; min-height: 150px; grid-template-rows: 1fr auto; align-items: start; gap: 1rem; }
.preset-card__content { display: flex; align-items: flex-start; gap: .8rem; }
.preset-card__icon { display: grid; width: 38px; height: 38px; flex: 0 0 38px; place-items: center; border-radius: 12px; background: currentColor; }
.preset-card__icon :deep(.v-icon) { color: rgb(var(--v-theme-background)); }
.preset-card span { display: block; margin-top: .25rem; color: rgb(var(--v-theme-on-surface) / .58); font-size: .72rem; line-height: 1.45; }
.sheet-buttons { display: grid; grid-template-columns: 1fr 1fr; gap: .75rem; }
.min-width-0 { min-width: 0; }
</style>
