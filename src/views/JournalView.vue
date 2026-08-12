<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { endOfMonth, format, isValid, parseISO, startOfMonth } from 'date-fns'
import { useRoute, useRouter } from 'vue-router'
import { Ripple } from 'vuetify/directives'
import WeekNavigator from '@/components/WeekNavigator.vue'
import {
  filterJournalEntries,
  groupJournalEntries,
  journalEntryHeading,
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
const dateDirection = ref<'forward' | 'back'>('forward')
const vRipple = Ripple

const taskId = computed(() => typeof route.query.task === 'string' ? route.query.task : '')
const trackerId = computed(() => typeof route.query.tracker === 'string' ? route.query.tracker : '')
const selectedMonthKey = computed(() => format(selectedDate.value, 'yyyy-MM'))
const selectedMonthRange = computed(() => monthRange(selectedDate.value))
const hasLoadedSelectedRange = computed(() => journalStore.loadedRange
  === `${selectedMonthRange.value.start}:${selectedMonthRange.value.end}`)
const filteredMonthEntries = computed(() => filterJournalEntries(
  journalStore.entries,
  'all',
  taskId.value,
  trackerId.value,
))
const groups = computed(() => groupJournalEntries(filteredMonthEntries.value))
const showInitialLoading = computed(() => journalStore.loading && !hasLoadedSelectedRange.value)
const showEmptyState = computed(() => hasLoadedSelectedRange.value && groups.value.length === 0)
const filteredTask = computed(() => taskStore.tasks.find((task) => task.id === taskId.value))
const filteredTracker = computed(() => trackingStore.trackers.find((tracker) => tracker.id === trackerId.value))

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

function monthRange(date: Date) {
  return {
    start: format(startOfMonth(date), 'yyyy-MM-dd'),
    end: format(endOfMonth(date), 'yyyy-MM-dd'),
  }
}

function clearSourceFilter(source: 'task' | 'tracker') {
  const query = { ...route.query }
  delete query[source]
  void router.replace({ name: 'journal', query })
}

watch(selectedDate, async (date, previousDate) => {
  if (previousDate && date.getTime() !== previousDate.getTime()) {
    dateDirection.value = date > previousDate ? 'forward' : 'back'
  }
  const range = monthRange(date)
  await journalStore.loadRange(range.start, range.end).catch(() => undefined)
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
    <WeekNavigator
      v-model="selectedDate"
      type="month"
      class="mb-3"
    />

    <div class="journal-action-bar page-action-area">
      <div class="journal-action-bar__inner">
        <v-btn
          block
          size="large"
          class="new-reflection-action"
          color="secondary"
          prepend-icon="mdi-notebook-plus-outline"
          :to="{ name: 'journal-new', query: newEntryQuery() }"
        >
          New reflection
        </v-btn>
      </div>
    </div>

    <div class="journal-date-stage">
      <transition :name="`page-level-${dateDirection}`">
        <div :key="selectedMonthKey" class="journal-date-content">
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
                @click="journalStore.loadRange(monthRange(selectedDate).start, monthRange(selectedDate).end)"
              >
                Retry
              </v-btn>
            </template>
          </v-alert>

          <div v-if="showInitialLoading" class="journal-loading py-12">
            <v-progress-circular indeterminate color="secondary" size="34" />
            <span class="text-body-2 muted">Loading reflections…</span>
          </div>

          <div v-else-if="hasLoadedSelectedRange && groups.length" class="journal-groups">
            <section v-for="group in groups" :key="group.date">
              <div class="section-heading">
                <h2>{{ format(parseISO(group.date), 'EEEE, MMMM d') }}</h2>
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
                  <div class="journal-entry__layout">
                    <div class="min-width-0">
                      <div class="min-width-0">
                        <h3 class="text-body-1 font-weight-black journal-entry__title">
                          {{ journalEntryHeading(entry) }}
                        </h3>
                        <span class="d-block text-caption muted mt-1">
                          {{ format(new Date(entry.occurredAt), 'h:mm a') }}
                        </span>
                        <p v-if="entry.title" class="journal-entry__body mt-2">{{ entry.body }}</p>
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
                    </div>
                    <v-img
                      v-if="entry.image"
                      class="journal-entry__image"
                      :src="entry.image"
                      :alt="`${journalEntryHeading(entry)} image`"
                      width="88"
                      aspect-ratio="1"
                      cover
                    />
                  </div>
                </v-card>
              </div>
            </section>
          </div>

          <v-card v-else-if="showEmptyState" class="surface-card pa-8 mt-5 text-center">
            <v-icon icon="mdi-notebook-outline" size="42" color="secondary" class="mb-3" />
            <h2 class="text-h6 font-weight-black">No reflections for this month</h2>
            <p class="text-body-2 muted mt-2">
              {{ taskId || trackerId
                ? 'Choose another month or clear the filter.'
                : 'Capture what happened, what you noticed, or what you want to remember.' }}
            </p>
          </v-card>
        </div>
      </transition>
    </div>
  </main>
</template>

<style scoped>
.journal-page { padding-bottom: calc(7rem + var(--page-safe-area-bottom)); }
.journal-action-bar { position: fixed; z-index: 20; right: 0; bottom: calc(4.5rem + env(safe-area-inset-bottom)); left: 0; padding: .75rem 1rem; border-top: .0625rem solid rgba(var(--v-theme-on-surface), .08); background: rgba(var(--v-theme-background), .52); -webkit-backdrop-filter: blur(1rem); backdrop-filter: blur(1rem); }
.journal-action-bar__inner { width: 100%; max-width: 45.5rem; margin: 0 auto; }
.journal-date-stage { display: grid; min-width: 0; overflow-x: clip; }
.journal-date-content { min-width: 0; grid-area: 1 / 1; align-self: start; }
.journal-loading { display: flex; align-items: center; justify-content: center; gap: .75rem; }
.journal-groups,
.journal-entry-list { display: grid; gap: .75rem; }
.journal-groups { gap: 1.25rem; }
.journal-entry { overflow: hidden; cursor: pointer; }
.journal-entry__layout { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: start; gap: .875rem; }
.journal-entry__image { overflow: hidden; border: .0625rem solid rgba(var(--v-theme-on-surface), .08); border-radius: .75rem; background: rgba(var(--v-theme-on-surface), .04); }
.journal-entry:focus-visible { outline: .125rem solid rgba(var(--v-theme-secondary), .72); outline-offset: .1875rem; }
.journal-entry__title,
.journal-entry__body { overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; }
.journal-entry__title { -webkit-line-clamp: 2; }
.journal-entry__body { color: rgb(var(--v-theme-on-surface) / .66); font-size: .8rem; line-height: 1.55; white-space: pre-line; -webkit-line-clamp: 3; }
.min-width-0 { min-width: 0; }
@media (min-width: 60rem) {
  .journal-action-bar { bottom: 0; left: 14rem; }
}
</style>
