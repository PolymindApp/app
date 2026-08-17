<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { endOfMonth, format, isValid, parseISO } from 'date-fns'
import { useRoute, useRouter } from 'vue-router'
import { Intersect, Ripple } from 'vuetify/directives'
import ActionBottomSheet from '@/components/ActionBottomSheet.vue'
import ColorSwatchPicker from '@/components/ColorSwatchPicker.vue'
import {
  filterJournalEntries,
  groupJournalEntriesByMonth,
  journalEntryColors,
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
const timelineDate = ref(initialDate())
const timelinePage = ref(0)
const timelineReady = ref(false)
const loadingTimelinePage = ref(false)
const hasMoreEntries = ref(true)
const searchQuery = ref('')
const selectedColor = ref('')
const colorFilterOpen = ref(false)
const timelineEnd = format(endOfMonth(timelineDate.value), 'yyyy-MM-dd')
const infiniteScrollOptions = { rootMargin: '0px 0px 256px 0px' }
const vIntersect = Intersect
const vRipple = Ripple

const taskId = computed(() => typeof route.query.task === 'string' ? route.query.task : '')
const trackerId = computed(() => typeof route.query.tracker === 'string' ? route.query.tracker : '')
const availableColors = computed(() => journalEntryColors(timelineReady.value ? journalStore.entries : []))
const allColorsGradient = computed(() => availableColors.value.length > 1
  ? `conic-gradient(${[...availableColors.value, availableColors.value[0]].join(', ')})`
  : 'conic-gradient(rgb(var(--v-theme-secondary)), rgb(var(--v-theme-info)), rgb(var(--v-theme-error)), rgb(var(--v-theme-secondary)))')
const filteredTimelineEntries = computed(() => filterJournalEntries(
  timelineReady.value ? journalStore.entries : [],
  'all',
  taskId.value,
  trackerId.value,
  searchQuery.value,
  selectedColor.value,
  entrySearchTags,
))
const groups = computed(() => groupJournalEntriesByMonth(filteredTimelineEntries.value))
const showInitialLoading = computed(() => loadingTimelinePage.value && !timelineReady.value)
const showEmptyState = computed(() => timelineReady.value
  && !loadingTimelinePage.value
  && !hasMoreEntries.value
  && groups.value.length === 0)
const filteredTask = computed(() => taskStore.tasks.find((task) => task.id === taskId.value))
const filteredTracker = computed(() => trackingStore.trackers.find((tracker) => tracker.id === trackerId.value))
const hasActiveFilter = computed(() => Boolean(
  taskId.value || trackerId.value || searchQuery.value.trim() || selectedColor.value,
))

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

function entrySearchTags(entry: JournalEntry) {
  const task = taskName(entry)
  return [
    ...(task ? [task] : []),
    ...trackerContexts(entry).map(context => context.name),
  ]
}

function newEntryQuery() {
  return {
    date: format(timelineDate.value, 'yyyy-MM-dd'),
    ...(taskId.value ? { task: taskId.value } : {}),
    ...(trackerId.value ? { tracker: trackerId.value } : {}),
  }
}

function clearSourceFilter(source: 'task' | 'tracker') {
  const query = { ...route.query }
  delete query[source]
  void router.replace({ name: 'journal', query })
}

function chooseColor(color: string) {
  selectedColor.value = color
  colorFilterOpen.value = false
}

async function loadMoreEntries(intersecting = true) {
  if (!intersecting || loadingTimelinePage.value || !hasMoreEntries.value) return
  loadingTimelinePage.value = true
  const nextPage = timelinePage.value + 1
  try {
    hasMoreEntries.value = await journalStore.loadTimelinePage(nextPage, timelineEnd)
    timelinePage.value = nextPage
    timelineReady.value = true
  } catch {
    // The store exposes the error beside the retained timeline.
  } finally {
    loadingTimelinePage.value = false
  }
}

onMounted(async () => {
  await Promise.allSettled([
    loadMoreEntries(),
    taskStore.tasks.length ? Promise.resolve() : taskStore.load(),
    trackingStore.loaded ? Promise.resolve() : trackingStore.load(),
  ])
})
</script>

<template>
  <main class="app-page journal-page">
    <div class="journal-action-bar page-action-area page-action-area--route-slide">
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

    <div class="journal-date-content">
      <v-text-field
        v-model="searchQuery"
        class="journal-search mb-4"
        label="Search journal"
        type="search"
        autocomplete="off"
        clearable
      >
        <template #prepend-inner>
          <v-btn
            icon
            variant="text"
            class="journal-color-filter"
            :class="{ 'journal-color-filter--active': selectedColor }"
            :style="selectedColor
              ? { '--journal-filter-color': selectedColor }
              : { '--journal-filter-colors': allColorsGradient }"
            :disabled="!availableColors.length"
            :aria-label="selectedColor ? `Filter color ${selectedColor}` : 'Filter journal by color'"
            :aria-pressed="Boolean(selectedColor)"
            @pointerdown.stop
            @touchend.stop
            @click.stop="colorFilterOpen = true"
          >
            <span
              class="journal-color-filter__swatch"
              :class="{ 'journal-color-filter__swatch--active': selectedColor }"
              aria-hidden="true"
            />
          </v-btn>
        </template>
      </v-text-field>

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
            :loading="loadingTimelinePage"
            @click="loadMoreEntries()"
          >
            Retry
          </v-btn>
        </template>
      </v-alert>

      <div v-if="showInitialLoading" class="journal-loading py-12">
        <v-progress-circular indeterminate color="secondary" size="34" />
        <span class="text-body-2 muted">Loading reflections…</span>
      </div>

      <div v-else-if="groups.length" class="journal-groups">
        <section v-for="group in groups" :key="group.month">
          <div class="section-heading">
            <h2>{{ format(parseISO(`${group.month}-01`), 'MMMM yyyy') }}</h2>
          </div>
          <div class="journal-entry-list">
            <v-card
              v-for="entry in group.entries"
              :key="entry.id"
              v-ripple
              class="journal-entry surface-card pa-4"
              :style="{ '--journal-entry-color': entry.color }"
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
                    <p v-if="entry.title" class="journal-entry__body mt-2">{{ entry.body }}</p>
                  </div>
                  <div class="d-flex align-center ga-2 mt-3">
                    <span class="journal-entry__color-badge" aria-hidden="true" />
                    <span class="text-caption muted">
                      {{ format(parseISO(entry.localDate), 'MMM d') }} · {{ format(new Date(entry.occurredAt), 'h:mm a') }}
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

      <div
        v-if="timelineReady && (hasMoreEntries || loadingTimelinePage)"
        :key="timelinePage"
        v-intersect="{ handler: loadMoreEntries, options: infiniteScrollOptions }"
        class="journal-load-more mt-5 py-5"
        role="status"
        aria-live="polite"
      >
        <v-progress-circular
          v-if="loadingTimelinePage"
          indeterminate
          color="secondary"
          size="22"
          width="2"
        />
        <span class="text-body-2 muted">
          {{ loadingTimelinePage ? 'Loading older reflections…' : 'Scroll for older reflections' }}
        </span>
      </div>

      <v-card v-else-if="showEmptyState" class="surface-card pa-8 mt-5 text-center">
        <v-icon icon="mdi-notebook-outline" size="42" color="secondary" class="mb-3" />
        <h2 class="text-h6 font-weight-black">
          {{ hasActiveFilter ? 'No matching reflections' : 'No reflections yet' }}
        </h2>
        <p class="text-body-2 muted mt-2">
          {{ hasActiveFilter
            ? 'Clear or change the filters to see more of your journal.'
            : 'Capture what happened, what you noticed, or what you want to remember.' }}
        </p>
      </v-card>
    </div>

    <ActionBottomSheet
      v-model="colorFilterOpen"
      title="Filter by color"
      aria-label="Journal color filter"
    >
      <template #content>
        <ColorSwatchPicker
          :model-value="selectedColor"
          :colors="availableColors"
          :allow-custom="false"
          allow-empty
          @update:model-value="chooseColor"
        />
      </template>
    </ActionBottomSheet>
  </main>
</template>

<style scoped>
.journal-page { padding-bottom: calc(5rem + var(--page-safe-area-bottom)); }
.journal-action-bar { position: fixed; z-index: 20; right: 0; bottom: calc(4.5rem + env(safe-area-inset-bottom)); left: 0; padding: .75rem 1rem; border-top: .0625rem solid rgba(var(--v-theme-on-surface), .08); background: rgb(var(--v-theme-background)); }
.journal-action-bar__inner { width: 100%; max-width: 868px; margin: 0 auto; }
.journal-date-content { min-width: 0; }
.journal-color-filter { width: 2.75rem; min-width: 2.75rem; height: 2.75rem; margin-inline-start: -.5rem; }
.journal-color-filter__swatch { position: relative; display: block; box-sizing: border-box; width: 1.5rem; height: 1.5rem; flex: 0 0 1.5rem; border-radius: 50%; background: var(--journal-filter-colors); }
.journal-color-filter__swatch::after { position: absolute; inset: .1875rem; border-radius: 50%; background: rgb(var(--v-theme-background)); content: ""; }
.journal-color-filter__swatch--active { background: var(--journal-filter-color); box-shadow: 0 0 0 .0625rem rgb(var(--v-theme-on-surface) / .24); }
.journal-color-filter__swatch--active::after { display: none; }
.journal-color-filter--active { background: rgb(var(--v-theme-on-surface) / .06); }
.journal-loading { display: flex; align-items: center; justify-content: center; gap: .75rem; }
.journal-load-more { display: flex; min-height: 4rem; align-items: center; justify-content: center; gap: .625rem; }
.journal-groups,
.journal-entry-list { display: grid; gap: .75rem; }
.journal-groups { gap: 1.25rem; }
.journal-entry { overflow: hidden; cursor: pointer; }
.journal-entry__layout { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: start; gap: .875rem; }
.journal-entry__color-badge { display: block; width: 1.75rem; height: .625rem; border: .0625rem solid rgba(var(--v-theme-on-surface), .18); border-radius: 999rem; background: var(--journal-entry-color); box-shadow: 0 .125rem .375rem rgba(0, 0, 0, .24); }
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
