<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { addDays, format, isToday, isValid, isYesterday, parseISO, startOfWeek } from 'date-fns'
import { useRoute, useRouter } from 'vue-router'
import { Ripple } from 'vuetify/directives'
import WeekDateNavigator from '@/components/WeekDateNavigator.vue'
import {
  filterJournalEntries,
  groupJournalEntries,
  journalEntryHeading,
  type JournalContextFilter,
} from '@/services/journal'
import { useJournalStore } from '@/stores/journal'
import { useTaskStore } from '@/stores/tasks'
import { useTrackingStore } from '@/stores/tracking'
import type { JournalEntry } from '@/types/domain'

const route = useRoute()
const router = useRouter()
const journalStore = useJournalStore()
const taskStore = useTaskStore()
const trackingStore = useTrackingStore()
const selectedDate = ref(initialDate())
const visibleWeekStart = ref(startOfWeek(selectedDate.value, { weekStartsOn: 1 }))
const contextFilter = ref<JournalContextFilter>('all')
const vRipple = Ripple

const taskId = computed(() => typeof route.query.task === 'string' ? route.query.task : '')
const trackerId = computed(() => typeof route.query.tracker === 'string' ? route.query.tracker : '')
const filteredEntries = computed(() => filterJournalEntries(
  journalStore.entries,
  contextFilter.value,
  taskId.value,
  trackerId.value,
))
const groups = computed(() => groupJournalEntries(filteredEntries.value))
const filteredTask = computed(() => taskStore.tasks.find((task) => task.id === taskId.value))
const filteredTracker = computed(() => trackingStore.trackers.find((tracker) => tracker.id === trackerId.value))
const contextFilters: Array<{ title: string; value: JournalContextFilter; icon: string }> = [
  { title: 'All', value: 'all', icon: 'mdi-view-list-outline' },
  { title: 'Tasks', value: 'tasks', icon: 'mdi-lightning-bolt-outline' },
  { title: 'Tracking', value: 'tracking', icon: 'mdi-chart-timeline-variant' },
  { title: 'Unlinked', value: 'unlinked', icon: 'mdi-link-off' },
]

function initialDate() {
  const queryDate = typeof route.query.date === 'string' ? parseISO(route.query.date) : undefined
  return queryDate && isValid(queryDate) ? queryDate : new Date()
}

function sourceTask(entry: JournalEntry) {
  return taskStore.tasks.find((task) => task.id === entry.task)
}

function sourceTracker(entry: JournalEntry) {
  return trackingStore.trackers.find((tracker) => tracker.id === entry.tracker)
}

function taskName(entry: JournalEntry) {
  return sourceTask(entry)?.name || entry.taskSnapshot
}

function trackerName(entry: JournalEntry) {
  return sourceTracker(entry)?.name || entry.trackerSnapshot
}

function dayLabel(dateKey: string) {
  const date = parseISO(dateKey)
  if (isToday(date)) return 'Today'
  if (isYesterday(date)) return 'Yesterday'
  return format(date, 'EEEE, MMM d')
}

function newEntryQuery() {
  return {
    date: format(selectedDate.value, 'yyyy-MM-dd'),
    ...(taskId.value ? { task: taskId.value } : {}),
    ...(trackerId.value ? { tracker: trackerId.value } : {}),
  }
}

function clearSourceFilter(source: 'task' | 'tracker') {
  const query = { ...route.query }
  delete query[source]
  void router.replace({ name: 'journal', query })
}

watch(visibleWeekStart, async (weekStart) => {
  await journalStore.loadRange(
    format(weekStart, 'yyyy-MM-dd'),
    format(addDays(weekStart, 6), 'yyyy-MM-dd'),
  ).catch(() => undefined)
}, { immediate: true })

watch(() => route.query.date, (date) => {
  if (typeof date !== 'string') return
  const parsed = parseISO(date)
  if (isValid(parsed)) selectedDate.value = parsed
})

onMounted(async () => {
  await Promise.all([
    taskStore.tasks.length ? Promise.resolve() : taskStore.load(),
    trackingStore.loaded ? Promise.resolve() : trackingStore.load(),
  ]).catch(() => undefined)
})
</script>

<template>
  <main class="app-page journal-page">
    <WeekDateNavigator
      v-model="selectedDate"
      v-model:week-start="visibleWeekStart"
      class="mb-5"
    />

    <v-btn
      block
      size="large"
      color="secondary"
      prepend-icon="mdi-notebook-plus-outline"
      :to="{ name: 'journal-new', query: newEntryQuery() }"
    >
      New reflection
    </v-btn>

    <section class="mt-5">
      <div class="journal-filters">
        <v-btn-toggle
          v-model="contextFilter"
          mandatory
          color="secondary"
          class="journal-filter-toggle"
        >
          <v-btn
            v-for="filter in contextFilters"
            :key="filter.value"
            :value="filter.value"
            :prepend-icon="filter.icon"
            variant="tonal"
          >
            {{ filter.title }}
          </v-btn>
        </v-btn-toggle>
      </div>

      <div v-if="taskId || trackerId" class="d-flex flex-wrap ga-2 mt-3">
        <v-chip
          v-if="taskId"
          closable
          color="secondary"
          variant="tonal"
          prepend-icon="mdi-lightning-bolt-outline"
          @click:close="clearSourceFilter('task')"
        >
          {{ filteredTask?.name || 'Task reflections' }}
        </v-chip>
        <v-chip
          v-if="trackerId"
          closable
          :color="filteredTracker?.color || 'secondary'"
          variant="tonal"
          :prepend-icon="filteredTracker?.icon || 'mdi-chart-timeline-variant'"
          @click:close="clearSourceFilter('tracker')"
        >
          {{ filteredTracker?.name || 'Tracker reflections' }}
        </v-chip>
      </div>
    </section>

    <v-alert v-if="journalStore.error" type="error" variant="tonal" class="mt-5">
      {{ journalStore.error }}
      <template #append>
        <v-btn
          size="small"
          variant="text"
          @click="journalStore.loadRange(format(visibleWeekStart, 'yyyy-MM-dd'), format(addDays(visibleWeekStart, 6), 'yyyy-MM-dd'))"
        >
          Retry
        </v-btn>
      </template>
    </v-alert>

    <div v-if="journalStore.loading" class="journal-loading py-12">
      <v-progress-circular indeterminate color="secondary" size="34" />
      <span class="text-body-2 muted">Loading reflections…</span>
    </div>

    <div v-else-if="groups.length" class="journal-groups mt-5">
      <section v-for="group in groups" :key="group.date">
        <div class="section-heading">
          <h2>{{ dayLabel(group.date) }}</h2>
          <span class="muted text-caption">{{ group.entries.length }}</span>
        </div>
        <div class="journal-entry-list">
          <v-card
            v-for="entry in group.entries"
            :key="entry.id"
            v-ripple
            class="journal-entry surface-card pa-4"
            role="link"
            tabindex="0"
            :aria-label="`Edit ${journalEntryHeading(entry)}`"
            @click="router.push({ name: 'journal-edit', params: { id: entry.id } })"
            @keydown.enter="router.push({ name: 'journal-edit', params: { id: entry.id } })"
            @keydown.space.prevent="router.push({ name: 'journal-edit', params: { id: entry.id } })"
          >
            <div class="d-flex align-start justify-space-between ga-3">
              <div class="min-width-0">
                <h3 class="text-body-1 font-weight-black journal-entry__title">
                  {{ journalEntryHeading(entry) }}
                </h3>
                <p v-if="entry.title" class="journal-entry__body mt-2">{{ entry.body }}</p>
              </div>
              <span class="text-caption muted flex-shrink-0">{{ format(new Date(entry.occurredAt), 'h:mm a') }}</span>
            </div>
            <div v-if="taskName(entry) || trackerName(entry)" class="d-flex flex-wrap ga-2 mt-3">
              <v-chip
                v-if="taskName(entry)"
                size="small"
                variant="tonal"
                :color="sourceTask(entry)?.color || undefined"
                prepend-icon="mdi-lightning-bolt-outline"
              >
                {{ taskName(entry) }}
              </v-chip>
              <v-chip
                v-if="trackerName(entry)"
                size="small"
                variant="tonal"
                :color="sourceTracker(entry)?.color || undefined"
                :prepend-icon="sourceTracker(entry)?.icon || 'mdi-chart-timeline-variant'"
              >
                {{ trackerName(entry) }}
              </v-chip>
            </div>
          </v-card>
        </div>
      </section>
    </div>

    <v-card v-else-if="journalStore.loaded" class="surface-card pa-8 mt-5 text-center">
      <v-icon icon="mdi-notebook-outline" size="42" color="secondary" class="mb-3" />
      <h2 class="text-h6 font-weight-black">No reflections this week</h2>
      <p class="text-body-2 muted mt-2 mb-5">
        {{ taskId || trackerId || contextFilter !== 'all'
          ? 'Try another week or clear a filter.'
          : 'Capture what happened, what you noticed, or what you want to remember.' }}
      </p>
      <v-btn color="secondary" :to="{ name: 'journal-new', query: newEntryQuery() }">
        Write a reflection
      </v-btn>
    </v-card>
  </main>
</template>

<style scoped>
.journal-page { padding-bottom: 2rem; }
.journal-filters { width: 100%; overflow: hidden; }
.journal-filter-toggle { display: flex; width: 100%; flex-wrap: wrap; gap: .4rem; height: auto; }
.journal-filter-toggle :deep(.v-btn) { min-width: 0; min-height: 2.75rem; flex: 1 1 calc(50% - .4rem); border: 0; }
.journal-loading { display: flex; align-items: center; justify-content: center; gap: .75rem; }
.journal-groups,
.journal-entry-list { display: grid; gap: .75rem; }
.journal-groups { gap: 1.25rem; }
.journal-entry { overflow: hidden; cursor: pointer; }
.journal-entry:focus-visible { outline: .125rem solid rgba(var(--v-theme-secondary), .72); outline-offset: .1875rem; }
.journal-entry__title,
.journal-entry__body { overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; }
.journal-entry__title { -webkit-line-clamp: 2; }
.journal-entry__body { color: rgb(var(--v-theme-on-surface) / .66); font-size: .8rem; line-height: 1.55; white-space: pre-line; -webkit-line-clamp: 3; }
.min-width-0 { min-width: 0; }
@media (min-width: 40rem) {
  .journal-filter-toggle { flex-wrap: nowrap; }
  .journal-filter-toggle :deep(.v-btn) { flex-basis: 0; }
}
</style>
