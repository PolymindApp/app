<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { addDays, format, isValid, parseISO, startOfWeek } from 'date-fns'
import { useRoute, useRouter } from 'vue-router'
import { Ripple } from 'vuetify/directives'
import WeekDateNavigator from '@/components/WeekDateNavigator.vue'
import {
  filterJournalEntries,
  groupJournalEntriesByContext,
  journalEntryHeading,
  type JournalContextGroup,
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
const dateDirection = ref<'forward' | 'back'>('forward')
const vRipple = Ripple

const taskId = computed(() => typeof route.query.task === 'string' ? route.query.task : '')
const trackerId = computed(() => typeof route.query.tracker === 'string' ? route.query.tracker : '')
const selectedDateKey = computed(() => format(selectedDate.value, 'yyyy-MM-dd'))
const filteredWeekEntries = computed(() => filterJournalEntries(
  journalStore.entries,
  'all',
  taskId.value,
  trackerId.value,
))
const dateMarkers = computed(() => [...new Set(filteredWeekEntries.value.map((entry) => entry.localDate))]
  .map((date) => ({ date, color: 'error', label: 'Has journal entries' })))
const selectedEntries = computed(() => filteredWeekEntries.value.filter((entry) => entry.localDate === selectedDateKey.value))
const groups = computed(() => groupJournalEntriesByContext(selectedEntries.value))
const showEmptyState = computed(() => journalStore.loaded && !journalStore.loading && groups.value.length === 0)
const filteredTask = computed(() => taskStore.tasks.find((task) => task.id === taskId.value))
const filteredTracker = computed(() => trackingStore.trackers.find((tracker) => tracker.id === trackerId.value))
const groupTitles: Record<JournalContextGroup, string> = {
  tasks: 'Task reflections',
  tracking: 'Tracking reflections',
  connected: 'Task & tracking reflections',
  general: 'General reflections',
}

function initialDate() {
  const queryDate = typeof route.query.date === 'string' ? parseISO(route.query.date) : undefined
  return queryDate && isValid(queryDate) ? queryDate : new Date()
}

function sourceTask(entry: JournalEntry) {
  return taskStore.tasks.find((task) => task.id === entry.task)
}

function taskName(entry: JournalEntry) {
  return sourceTask(entry)?.name || entry.taskSnapshot
}

function trackerContexts(entry: JournalEntry) {
  const attached = new Set(entry.trackers)
  const snapshots = new Map(Object.entries(entry.trackerSnapshots))
  entry.trackers.forEach((trackerId) => {
    if (!snapshots.has(trackerId)) snapshots.set(trackerId, '')
  })

  return [...snapshots].flatMap(([trackerId, snapshot]) => {
    const tracker = attached.has(trackerId)
      ? trackingStore.trackers.find((item) => item.id === trackerId)
      : undefined
    const name = tracker?.name || snapshot
    return name ? [{
      id: trackerId,
      name,
      color: tracker?.color,
      icon: tracker?.icon || 'mdi-chart-timeline-variant',
    }] : []
  })
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

watch(selectedDate, (date, previousDate) => {
  if (date.getTime() === previousDate.getTime()) return
  dateDirection.value = date > previousDate ? 'forward' : 'back'
})

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
      :markers="dateMarkers"
      class="mb-5"
    />

    <div class="journal-date-stage">
      <transition :name="`page-level-${dateDirection}`">
        <div :key="selectedDateKey" class="journal-date-content">
          <div v-if="taskId || trackerId" class="d-flex flex-wrap ga-2">
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
            <section v-for="group in groups" :key="group.context">
              <div class="section-heading">
                <h2>{{ groupTitles[group.context] }}</h2>
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
                    <span class="text-caption muted flex-shrink-0">
                      {{ format(new Date(entry.occurredAt), 'h:mm a') }}
                    </span>
                  </div>
                  <div v-if="taskName(entry) || trackerContexts(entry).length" class="d-flex flex-wrap ga-2 mt-3">
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
                      v-for="context in trackerContexts(entry)"
                      :key="context.id"
                      size="small"
                      variant="tonal"
                      :color="context.color"
                      :prepend-icon="context.icon"
                    >
                      {{ context.name }}
                    </v-chip>
                  </div>
                </v-card>
              </div>
            </section>
          </div>

          <v-card v-else-if="showEmptyState" class="surface-card pa-8 mt-5 text-center">
            <v-icon icon="mdi-notebook-outline" size="42" color="secondary" class="mb-3" />
            <h2 class="text-h6 font-weight-black">No reflections for this day</h2>
            <p class="text-body-2 muted mt-2 mb-5">
              {{ taskId || trackerId
                ? 'Choose another day or clear the filter.'
                : 'Capture what happened, what you noticed, or what you want to remember.' }}
            </p>
            <v-btn color="secondary" :to="{ name: 'journal-new', query: newEntryQuery() }">
              Write a reflection
            </v-btn>
          </v-card>

          <v-btn
            v-if="!journalStore.loading && groups.length"
            block
            size="large"
            class="mt-5"
            color="secondary"
            prepend-icon="mdi-notebook-plus-outline"
            :to="{ name: 'journal-new', query: newEntryQuery() }"
          >
            New reflection
          </v-btn>
        </div>
      </transition>
    </div>
  </main>
</template>

<style scoped>
.journal-page { padding-bottom: 2rem; }
.journal-date-stage { display: grid; min-width: 0; overflow-x: clip; }
.journal-date-content { min-width: 0; grid-area: 1 / 1; align-self: start; }
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
</style>
