<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { format, parseISO, subDays } from 'date-fns'
import { api } from '@/lib/api'
import DatePickerField from '@/components/DatePickerField.vue'
import TrackingRelationshipChart from '@/components/TrackingRelationshipChart.vue'
import TrackingTimelineChart from '@/components/TrackingTimelineChart.vue'
import {
  buildTrackingInsight,
  dateRangeKeys,
  defaultTrackingInsightRangeDays,
  type TrackingInsightResult,
} from '@/services/tracking'
import { readHealthConnectStepsForDates } from '@/services/healthConnect'
import {
  taskInsightDailyValues,
  taskInsightDateKeys,
  taskInsightProfile,
} from '@/services/taskInsights'
import { useIntervalStore } from '@/stores/intervals'
import { useTaskStore } from '@/stores/tasks'
import { useTrackingStore } from '@/stores/tracking'
import type { TrackingAnalysisSource, TrackingDailyValue } from '@/types/domain'

type DatePreset = '7' | '14' | '30' | '60' | '90' | 'custom'

const tracking = useTrackingStore()
const tasks = useTaskStore()
const intervals = useIntervalStore()
const factorId = ref('')
const outcomeId = ref('')
const datePreset = ref<DatePreset>('7')
const rangeStart = ref(format(subDays(new Date(), 6), 'yyyy-MM-dd'))
const rangeEnd = ref(format(new Date(), 'yyyy-MM-dd'))
const insight = ref<TrackingInsightResult>()
const loading = ref(false)
const initialized = ref(false)
const error = ref('')
let analysisTimer: number | undefined
let analysisRequest = 0

const datePresets: Array<{ title: string; value: DatePreset }> = [
  { title: '1 week', value: '7' },
  { title: '2 weeks', value: '14' },
  { title: '30 days', value: '30' },
  { title: '60 days', value: '60' },
  { title: '90 days', value: '90' },
  { title: 'Custom', value: 'custom' },
]

const factorSources = computed<TrackingAnalysisSource[]>(() => [
  ...tracking.activeTrackers.filter((tracker) => tracker.role === 'factor').map((tracker) => ({
    id: `tracker:${tracker.id}`,
    source: 'tracker' as const,
    name: tracker.name,
    role: 'factor' as const,
    favorableDirection: 'neutral' as const,
    unit: tracker.unit,
    color: tracker.color,
    factorMode: ['number', 'duration', 'rating'].includes(tracker.kind) ? 'quantity' as const : 'presence' as const,
    scaleMin: tracker.scaleMax > tracker.scaleMin ? tracker.scaleMin : undefined,
    scaleMax: tracker.scaleMax > tracker.scaleMin ? tracker.scaleMax : undefined,
  })),
  ...tasks.activeTasks.map((task) => ({
    id: `task:${task.id}`,
    source: 'task' as const,
    name: `Task · ${task.name}`,
    role: 'factor' as const,
    favorableDirection: 'neutral' as const,
    color: task.color || 'rgb(var(--v-theme-info))',
    ...taskInsightProfile(task),
  })),
  ...intervals.templates.map((template) => ({
    id: `interval:${template.id}`,
    source: 'interval' as const,
    name: `Interval · ${template.name}`,
    role: 'factor' as const,
    favorableDirection: 'neutral' as const,
    unit: 'runs',
    color: template.color,
    factorMode: 'presence' as const,
    scaleMin: 0,
  })),
])

const outcomeSources = computed<TrackingAnalysisSource[]>(() =>
  tracking.activeTrackers.filter((tracker) => tracker.role === 'outcome').map((tracker) => ({
    id: tracker.id,
    source: 'tracker',
    name: tracker.name,
    role: tracker.role,
    favorableDirection: tracker.favorableDirection,
    unit: tracker.unit,
    color: tracker.color,
    factorMode: 'quantity',
    scaleMin: tracker.scaleMax > tracker.scaleMin ? tracker.scaleMin : undefined,
    scaleMax: tracker.scaleMax > tracker.scaleMin ? tracker.scaleMax : undefined,
  })),
)

const factorItems = computed(() => [
  { title: 'Trackers', source: 'tracker' as const },
  { title: 'Tasks', source: 'task' as const },
  { title: 'Intervals', source: 'interval' as const },
].flatMap((group) => {
  const items = factorSources.value
    .filter((source) => source.source === group.source)
    .map((source) => ({ title: source.name, value: source.id }))

  return items.length
    ? [{ type: 'subheader' as const, title: group.title }, ...items]
    : []
}))
const outcomeItems = computed(() => outcomeSources.value.map((source) => ({ title: source.name, value: source.id })))
const selectedFactor = computed(() => factorSources.value.find((source) => source.id === factorId.value))
const selectedOutcome = computed(() => outcomeSources.value.find((source) => source.id === outcomeId.value))
const dateRangeValid = computed(() => Boolean(rangeStart.value && rangeEnd.value && rangeStart.value <= rangeEnd.value))
const rangeLabel = computed(() => dateRangeValid.value
  ? `${format(parseISO(rangeStart.value), 'MMM d, yyyy')} – ${format(parseISO(rangeEnd.value), 'MMM d, yyyy')}`
  : 'Choose a valid date range')
const hasTimelineData = computed(() => insight.value?.points.some((point) =>
  point.factorValue !== null || point.outcomeValue !== null,
) || false)
const relationshipLabel = computed(() => selectedFactor.value?.factorMode === 'quantity'
  ? 'Amount compared with outcome'
  : 'Present compared with absent')

onMounted(async () => {
  await Promise.all([
    tracking.loaded ? Promise.resolve() : tracking.load(),
    tasks.tasks.length ? Promise.resolve() : tasks.load(),
    intervals.loaded ? Promise.resolve() : intervals.load(),
  ]).catch((cause) => {
    error.value = cause instanceof Error ? cause.message : 'Could not load insight sources.'
  })
  factorId.value ||= factorSources.value[0]?.id || ''
  outcomeId.value ||= outcomeSources.value[0]?.id || ''
  setDefaultDateRange()
  initialized.value = true
  if (factorId.value && outcomeId.value) await analyze()
})

watch(datePreset, (preset) => {
  if (preset === 'custom') return
  setPresetDateRange(preset)
})

watch([factorId, outcomeId, rangeStart, rangeEnd], () => {
  if (!initialized.value) return
  scheduleAnalysis()
})

onBeforeUnmount(() => {
  if (analysisTimer !== undefined) window.clearTimeout(analysisTimer)
  analysisRequest += 1
})

function scheduleAnalysis() {
  analysisRequest += 1
  if (analysisTimer !== undefined) window.clearTimeout(analysisTimer)
  analysisTimer = window.setTimeout(() => {
    analysisTimer = undefined
    void analyze()
  }, 120)
}

function setDefaultDateRange() {
  const today = new Date()
  const end = format(today, 'yyyy-MM-dd')
  const start = format(subDays(today, 89), 'yyyy-MM-dd')
  const dataPointCount = outcomeId.value
    ? trackerDailyValues(outcomeId.value, start, end).length
    : 0
  const preset = String(defaultTrackingInsightRangeDays(dataPointCount)) as DatePreset
  datePreset.value = preset
  setPresetDateRange(preset, today)
}

function setPresetDateRange(preset: Exclude<DatePreset, 'custom'>, today = new Date()) {
  const days = Number(preset)
  rangeEnd.value = format(today, 'yyyy-MM-dd')
  rangeStart.value = format(subDays(today, days - 1), 'yyyy-MM-dd')
}

async function analyze() {
  const factor = selectedFactor.value
  const outcome = selectedOutcome.value
  const request = ++analysisRequest
  error.value = ''
  if (!factor || !outcome) {
    insight.value = undefined
    loading.value = false
    return
  }
  if (!dateRangeValid.value) {
    insight.value = undefined
    error.value = 'The start date must be on or before the end date.'
    loading.value = false
    return
  }

  loading.value = true
  try {
    await tracking.loadRange(rangeStart.value, rangeEnd.value)
    const factorValues = await factorDailyValues(factor.id, rangeStart.value, rangeEnd.value)
    const outcomeValues = trackerDailyValues(outcome.id, rangeStart.value, rangeEnd.value)
    const result = buildTrackingInsight(
      factorValues,
      outcomeValues,
      { start: rangeStart.value, end: rangeEnd.value },
      factor.factorMode,
      outcome.favorableDirection,
      { factor: factor.name, outcome: outcome.name },
    )
    if (request === analysisRequest) insight.value = result
  } catch (cause) {
    if (request !== analysisRequest) return
    insight.value = undefined
    error.value = cause instanceof Error ? cause.message : 'Could not build these insights.'
  } finally {
    if (request === analysisRequest) loading.value = false
  }
}

async function factorDailyValues(sourceId: string, start: string, end: string): Promise<TrackingDailyValue[]> {
  const [source, id] = sourceId.split(':', 2)
  if (source === 'tracker') {
    return trackerDailyValues(id || '', start, end)
  }
  const dates = dateRangeKeys(start, end)
  if (source === 'task') {
    const task = tasks.tasks.find((item) => item.id === id)
    if (!task) return []
    await tasks.loadProgressRange(start, end)
    const stepCounts = task.type === 'step_counter'
      ? await readHealthConnectStepsForDates(taskInsightDateKeys(task, start, end))
      : undefined
    return taskInsightDailyValues(
      task,
      tasks.entries,
      tasks.occurrences,
      start,
      end,
      stepCounts,
    )
  }
  if (source === 'interval') {
    const records = await api.collection('interval_sessions').getFullList({
      filter: `template = "${id}" && status = "completed" && task_date >= "${start}" && task_date <= "${end}"`,
      sort: 'task_date',
    })
    const counts = new Map<string, number>()
    records.forEach((record) => {
      const date = String(record.task_date)
      counts.set(date, (counts.get(date) || 0) + 1)
    })
    return dates.map((date) => ({ date, value: counts.get(date) || 0 }))
  }
  return []
}

function trackerDailyValues(trackerId: string, start: string, end: string) {
  const tracker = tracking.trackers.find((item) => item.id === trackerId)
  return tracking.dailyValues(trackerId)
    .filter((item) => item.date >= start && item.date <= end)
    .map((item) => tracker?.kind === 'duration' ? { ...item, value: item.value / 60 } : item)
}
</script>

<template>
  <main class="app-page insights-page">
    <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>

    <v-card class="filter-card surface-card pa-5 mb-4">
      <div>
        <h2>Choose what to compare</h2>
        <p>Select one factor and one outcome. Graphs update automatically.</p>
      </div>

      <v-row>
        <v-col cols="12" sm="6">
          <v-select
            v-model="factorId"
            label="Factor"
            :items="factorItems"
            no-data-text="Create a factor, task, or interval first"
          />
        </v-col>
        <v-col cols="12" sm="6">
          <v-select
            v-model="outcomeId"
            label="Outcome"
            :items="outcomeItems"
            no-data-text="Create an outcome tracker first"
          />
        </v-col>
      </v-row>

      <div>
        <strong class="filter-label">Date range</strong>
        <v-btn-toggle v-model="datePreset" mandatory color="secondary" size="default" class="date-presets mt-2 ga-1">
          <v-btn
            v-for="preset in datePresets"
            :key="preset.value"
            :value="preset.value"
            variant="tonal"
          >
            {{ preset.title }}
          </v-btn>
        </v-btn-toggle>
      </div>

      <v-row v-if="datePreset === 'custom'">
        <v-col cols="12" sm="6">
          <DatePickerField v-model="rangeStart" label="From" :max="rangeEnd" />
        </v-col>
        <v-col cols="12" sm="6">
          <DatePickerField v-model="rangeEnd" label="To" :min="rangeStart" :max="format(new Date(), 'yyyy-MM-dd')" />
        </v-col>
      </v-row>

      <div class="range-note">
        <v-icon icon="mdi-calendar-range-outline" size="18" />
        <span>{{ rangeLabel }}</span>
        <span>Daily values are matched on the same date.</span>
      </div>
    </v-card>

    <v-card v-if="initialized && (!factorSources.length || !outcomeSources.length)" class="surface-card empty-state pa-7 text-center">
      <v-icon icon="mdi-chart-timeline-variant-shimmer" size="42" color="secondary" />
      <h2 class="mt-3">More tracking data is needed</h2>
      <p v-if="!outcomeSources.length">Create an outcome tracker, such as Mood or Energy, before exploring insights.</p>
      <p v-else>Create a factor tracker, task, or interval to compare with an outcome.</p>
      <v-btn class="mt-4" color="secondary" to="/tracking/new" prepend-icon="mdi-plus">Create tracker</v-btn>
    </v-card>

    <div v-else-if="!initialized" class="d-flex justify-center py-12" role="status">
      <v-progress-circular indeterminate color="secondary" />
      <span class="ml-3 muted">Loading insights…</span>
    </div>

    <section v-else-if="insight && selectedFactor && selectedOutcome" :class="['insight-results', { 'insight-results--loading': loading }]" :aria-busy="loading">
      <v-progress-linear v-if="loading" indeterminate color="secondary" class="results-progress" />

      <v-card class="chart-card surface-card pa-5 mb-4">
        <div class="chart-heading">
          <div><h2>Over time</h2><p>Both lines share one date plot, with independent scales on the left and right.</p></div>
          <v-icon icon="mdi-chart-timeline-variant" color="secondary" />
        </div>
        <TrackingTimelineChart
          v-if="hasTimelineData"
          class="mt-4"
          :points="insight.points"
          :factor-name="selectedFactor.name"
          :factor-unit="selectedFactor.unit"
          :factor-color="selectedFactor.color"
          :factor-scale-min="selectedFactor.scaleMin"
          :factor-scale-max="selectedFactor.scaleMax"
          :outcome-name="selectedOutcome.name"
          :outcome-unit="selectedOutcome.unit"
          :outcome-color="selectedOutcome.color"
          :outcome-scale-min="selectedOutcome.scaleMin"
          :outcome-scale-max="selectedOutcome.scaleMax"
        />
        <div v-else class="chart-empty py-8 text-center">
          <v-icon icon="mdi-chart-line-variant" size="36" />
          <p>No factor or outcome values were logged in this range.</p>
        </div>
      </v-card>

      <v-card class="summary-card surface-card pa-5 mb-4">
        <div class="summary-heading">
          <div :class="['summary-icon', `summary-icon--${insight.ready ? insight.direction : 'waiting'}`]">
            <v-icon :icon="insight.ready ? 'mdi-chart-line' : 'mdi-chart-timeline-variant-shimmer'" />
          </div>
          <div>
            <h2>What your logs show</h2>
            <p>{{ insight.summary }}</p>
          </div>
        </div>

        <div class="summary-metrics mt-4">
          <div><strong>{{ insight.matched.length }}</strong><span>paired days</span></div>
          <div><strong>{{ dateRangeKeys(rangeStart, rangeEnd).length }}</strong><span>days in range</span></div>
          <div><strong>{{ relationshipLabel }}</strong><span>relationship view</span></div>
        </div>

        <v-alert v-if="insight.earlySignal" type="warning" variant="tonal" density="compact" class="mt-4">
          Early signal: fewer than 14 observations support at least part of this pattern.
        </v-alert>
        <p class="caution mt-4"><v-icon icon="mdi-information-outline" size="18" />{{ insight.caution }}</p>
      </v-card>

      <v-card class="chart-card surface-card pa-5">
        <div class="chart-heading">
          <div><h2>Relationship</h2><p>{{ relationshipLabel }} across dates containing both values.</p></div>
          <v-icon icon="mdi-scatter-plot" color="secondary" />
        </div>
        <TrackingRelationshipChart
          v-if="insight.matched.length >= 2"
          class="mt-4"
          :insight="insight"
          :factor-name="selectedFactor.name"
          :factor-unit="selectedFactor.unit"
          :factor-color="selectedFactor.color"
          :factor-scale-min="selectedFactor.scaleMin"
          :factor-scale-max="selectedFactor.scaleMax"
          :outcome-name="selectedOutcome.name"
          :outcome-unit="selectedOutcome.unit"
          :outcome-color="selectedOutcome.color"
          :outcome-scale-min="selectedOutcome.scaleMin"
          :outcome-scale-max="selectedOutcome.scaleMax"
        />
        <div v-else class="chart-empty py-8 text-center">
          <v-icon icon="mdi-link-variant-off" size="36" />
          <p>At least two dates need both {{ selectedFactor.name }} and {{ selectedOutcome.name }} values.</p>
          <span>Log both on the same day or choose a wider range.</span>
        </div>
      </v-card>
    </section>

    <v-card v-else-if="!loading && factorSources.length && outcomeSources.length" class="surface-card chart-empty pa-8 text-center">
      <v-icon icon="mdi-chart-box-outline" size="40" />
      <p>Select a factor, outcome, and valid date range to see insights.</p>
    </v-card>
  </main>
</template>

<style scoped>
.insights-page { max-width: 56.25rem; }
.filter-card { display: grid; gap: 1rem; }
.filter-card h2,
.summary-card h2,
.chart-card h2,
.empty-state h2 { font-size: 1rem; font-weight: 900; }
.filter-card > div:first-child p,
.chart-heading p,
.empty-state p { margin-top: .25rem; color: rgb(var(--v-theme-on-surface) / .58); font-size: .75rem; line-height: 1.45; }
.filter-label { color: rgb(var(--v-theme-on-surface) / .72); font-size: .75rem; }
.date-presets { display: grid; width: 100%; height: auto !important; grid-template-columns: repeat(6, 1fr); }
.date-presets :deep(.v-btn) { min-width: 0; padding-inline: .5rem; }
.range-note { display: flex; align-items: center; gap: .5rem .75rem; flex-wrap: wrap; color: rgb(var(--v-theme-on-surface) / .56); font-size: .7rem; }
.range-note span:first-of-type { color: rgb(var(--v-theme-on-surface) / .78); font-weight: 800; }
.insight-results { position: relative; transition: opacity 160ms ease; }
.insight-results--loading { opacity: .58; }
.results-progress { position: sticky; z-index: 2; top: var(--v-layout-top, 0); margin-bottom: .5rem; border-radius: 999rem; }
.summary-heading { display: grid; grid-template-columns: 3rem 1fr; align-items: center; gap: 1rem; }
.summary-heading p { margin-top: .2rem; color: rgb(var(--v-theme-on-surface) / .66); font-size: .78rem; line-height: 1.5; }
.summary-icon { display: grid; width: 3rem; height: 3rem; place-items: center; border-radius: .95rem; background: rgb(var(--v-theme-secondary) / .14); color: rgb(var(--v-theme-secondary)); }
.summary-icon--worse { background: rgb(var(--v-theme-warning) / .14); color: rgb(var(--v-theme-warning)); }
.summary-icon--mixed,
.summary-icon--waiting { background: rgb(var(--v-theme-on-surface) / .08); color: rgb(var(--v-theme-on-surface) / .6); }
.summary-metrics { display: grid; grid-template-columns: .75fr .75fr 1.5fr; gap: .65rem; }
.summary-metrics > div { min-width: 0; padding: .85rem; border: .0625rem solid rgb(var(--v-theme-on-surface) / .08); border-radius: .9rem; background: rgb(var(--v-theme-background) / .4); }
.summary-metrics strong,
.summary-metrics span { display: block; }
.summary-metrics strong { overflow: hidden; font-size: 1rem; text-overflow: ellipsis; white-space: nowrap; }
.summary-metrics span { margin-top: .15rem; color: rgb(var(--v-theme-on-surface) / .5); font-size: .65rem; }
.caution { display: flex; align-items: flex-start; gap: .5rem; color: rgb(var(--v-theme-on-surface) / .58); font-size: .72rem; line-height: 1.5; }
.chart-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; }
.chart-empty { color: rgb(var(--v-theme-on-surface) / .5); }
.chart-empty p { margin-top: .75rem; color: rgb(var(--v-theme-on-surface) / .68); font-size: .78rem; font-weight: 800; }
.chart-empty span { display: block; margin-top: .25rem; font-size: .7rem; }

@media (max-width: 37.5rem) {
  .date-presets { grid-template-columns: repeat(2, 1fr); }
  .summary-metrics { grid-template-columns: 1fr 1fr; }
  .summary-metrics > div:last-child { grid-column: 1 / -1; }
}

@media (prefers-reduced-motion: reduce) {
  .insight-results { transition: none; }
}
</style>
