<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { addDays, format, isValid, parseISO, startOfWeek } from 'date-fns'
import { useRoute, useRouter } from 'vue-router'
import ActionBottomSheet from '@/components/ActionBottomSheet.vue'
import TrackingLogBottomSheet from '@/components/TrackingLogBottomSheet.vue'
import TrackingTrackerCard from '@/components/TrackingTrackerCard.vue'
import TrackingWeeklyBarChart from '@/components/TrackingWeeklyBarChart.vue'
import WeekDateNavigator from '@/components/WeekDateNavigator.vue'
import { TRACKING_PRESETS, trackerDraftFromPreset } from '@/services/tracking'
import { reconcileTrackingReminders } from '@/services/trackingReminders'
import { useTrackingStore } from '@/stores/tracking'
import { useTaskStore } from '@/stores/tasks'
import type { TrackingEntry, TrackingTracker } from '@/types/domain'

const route = useRoute()
const router = useRouter()
const store = useTrackingStore()
const taskStore = useTaskStore()
const selectedDate = ref(new Date())
const visibleWeekStart = ref(startOfWeek(selectedDate.value, { weekStartsOn: 1 }))
const trackerActionsOpen = ref(false)
const actionTracker = ref<TrackingTracker>()
const sheetOpen = ref(false)
const sheetTracker = ref<TrackingTracker>()
const editingEntry = ref<TrackingEntry>()
const addingPreset = ref('')
const error = ref('')
const weeklyChartLoading = ref(false)
const weeklyChartError = ref('')
let weeklyLoadRequest = 0

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
const requestedTask = computed(() => {
  const id = typeof route.query.task === 'string' ? route.query.task : ''
  return taskStore.tasks.find(task => task.id === id && task.type === 'tracking')
})
const requestedTaskTrackerIds = computed(() => [...new Set(requestedTask.value?.trackingTrackers ?? [])])
const requestedTaskTracker = computed(() => {
  const id = typeof route.query.tracker === 'string' ? route.query.tracker : ''
  if (!requestedTaskTrackerIds.value.includes(id)) return undefined
  return store.trackers.find(tracker => tracker.id === id)
})
const requestedTaskProgress = computed(() => {
  const currentTrackerIndex = requestedTaskTrackerIds.value.indexOf(sheetTracker.value?.id || '')
  if (!requestedTask.value || currentTrackerIndex < 0) return ''
  return `${requestedTask.value.name} · Tracker ${currentTrackerIndex + 1} of ${requestedTaskTrackerIds.value.length}`
})
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
  sheetOpen.value = true
}

async function handleLogSaved() {
  if (requestedTask.value && requestedTaskTracker.value) {
    sheetOpen.value = false
    await router.replace({ name: 'tasks' })
    return
  }
  if (!requestedTask.value) return
  const nextTracker = nextRequestedTaskTracker()
  if (nextTracker) startLog(nextTracker)
  else {
    sheetOpen.value = false
    await router.replace({ name: 'tasks' })
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

function applyRequestedDate() {
  const requestedDate = typeof route.query.date === 'string' ? route.query.date : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) return
  const parsed = parseISO(requestedDate)
  if (!isValid(parsed)) return
  selectedDate.value = parsed
  visibleWeekStart.value = startOfWeek(parsed, { weekStartsOn: 1 })
}

function nextRequestedTaskTracker() {
  const trackerId = requestedTaskTrackerIds.value.find(id =>
    !store.entries.some(entry => entry.tracker === id && entry.localDate === dateKey.value))
  return trackerId ? store.trackers.find(tracker => tracker.id === trackerId) : undefined
}

function openRequestedTracker() {
  applyRequestedDate()
  if (requestedTask.value) {
    if (typeof route.query.tracker === 'string') {
      if (requestedTaskTracker.value) startLog(requestedTaskTracker.value)
      else void router.replace({ name: 'tasks' })
      return
    }
    const tracker = nextRequestedTaskTracker()
    if (tracker) startLog(tracker)
    else void router.replace({ name: 'tasks' })
    return
  }
  const id = typeof route.query.log === 'string' ? route.query.log : ''
  if (!id) return
  const tracker = store.activeTrackers.find((item) => item.id === id)
  if (!tracker) return
  startLog(tracker)
  void router.replace({ path: '/tracking' })
}

watch(() => [route.query.log, route.query.task, route.query.tracker, route.query.date], () => nextTick(openRequestedTracker))
watch(visibleWeekStart, () => {
  if (store.loaded) void loadVisibleWeekEntries()
})

onMounted(async () => {
  applyRequestedDate()
  await Promise.all([
    store.load().catch(() => undefined),
    taskStore.tasks.length ? Promise.resolve() : taskStore.load().catch(() => undefined),
  ])
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

    <v-card v-if="store.trackers.length" class="weekly-chart-card surface-card pa-5 mb-5">
      <v-progress-linear
        v-if="weeklyChartLoading"
        indeterminate
        color="secondary"
        class="mb-4"
        aria-label="Loading weekly tracking entries"
      />
      <v-alert v-if="weeklyChartError" type="error" variant="tonal" class="mb-4">
        {{ weeklyChartError }}
      </v-alert>
      <TrackingWeeklyBarChart
        :trackers="store.trackers"
        :entries="store.entries"
        :week-start="visibleWeekStart"
        :selected-date="selectedDate"
      />
      <div class="weekly-hint mt-4">
        <v-icon icon="mdi-calendar-week-outline" size="18" />
        <span><strong>{{ visibleWeekLabel }}</strong> · This chart shows the full visible week, not only the selected day.</span>
      </div>
    </v-card>

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

      <v-card
        class="insight-card surface-card pa-4 mt-6"
        to="/tracking/insights/compare"
        aria-label="Open tracking insights"
      >
        <div class="insight-card__content">
          <div class="insight-card__icon"><v-icon icon="mdi-chart-box-outline" /></div>
          <div class="min-width-0">
            <strong>Explore your patterns</strong>
            <p>Compare trackers over time and see how they relate.</p>
          </div>
          <span class="insight-card__chevron" aria-hidden="true">
            <v-icon icon="mdi-chevron-right" />
          </span>
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

    <TrackingLogBottomSheet
      v-model="sheetOpen"
      :tracker="sheetTracker"
      :entry="editingEntry"
      :date="dateKey"
      :context="requestedTaskProgress"
      :keep-open-on-save="Boolean(requestedTask && !requestedTaskTracker)"
      @saved="handleLogSaved"
    />
  </main>
</template>

<style scoped>
.insight-card { background: linear-gradient(135deg, rgb(var(--v-theme-surface)), rgba(var(--v-theme-secondary), .08)); color: inherit; text-decoration: none; }
.insight-card:focus-visible { outline: .125rem solid rgba(var(--v-theme-secondary), .72); outline-offset: .1875rem; }
.insight-card__content { display: grid; grid-template-columns: 2.75rem minmax(0, 1fr) 2.75rem; align-items: center; gap: 1rem; }
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
.min-width-0 { min-width: 0; }
</style>
