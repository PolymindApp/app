<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { format, subDays } from 'date-fns'
import { api } from '@/lib/api'
import DatePickerField from '@/components/DatePickerField.vue'
import {
  compareDateRanges,
  comparePresentAbsent,
  dateRangeKeys,
  formatNumber,
  type TrackingComparisonResult,
} from '@/services/tracking'
import { isTaskScheduled } from '@/services/schedule'
import { useIntervalStore } from '@/stores/intervals'
import { useTaskStore } from '@/stores/tasks'
import { useTrackingStore } from '@/stores/tracking'
import type { TrackingAnalysisSource, TrackingDailyValue } from '@/types/domain'

const tracking = useTrackingStore()
const tasks = useTaskStore()
const intervals = useIntervalStore()
const mode = ref<'present_absent' | 'ranges'>('present_absent')
const factorId = ref('')
const outcomeId = ref('')
const rangeStart = ref(format(subDays(new Date(), 59), 'yyyy-MM-dd'))
const rangeEnd = ref(format(new Date(), 'yyyy-MM-dd'))
const firstStart = ref(format(subDays(new Date(), 27), 'yyyy-MM-dd'))
const firstEnd = ref(format(subDays(new Date(), 14), 'yyyy-MM-dd'))
const secondStart = ref(format(subDays(new Date(), 13), 'yyyy-MM-dd'))
const secondEnd = ref(format(new Date(), 'yyyy-MM-dd'))
const result = ref<TrackingComparisonResult>()
const loading = ref(false)
const error = ref('')

const factorSources = computed<TrackingAnalysisSource[]>(() => [
  ...tracking.activeTrackers.filter((tracker) => tracker.role === 'factor').map((tracker) => ({
    id: `tracker:${tracker.id}`,
    source: 'tracker' as const,
    name: tracker.name,
    role: 'factor' as const,
    favorableDirection: 'neutral' as const,
    unit: tracker.unit,
  })),
  ...tasks.activeTasks.map((task) => ({
    id: `task:${task.id}`,
    source: 'task' as const,
    name: `Task · ${task.name}`,
    role: 'factor' as const,
    favorableDirection: 'neutral' as const,
    unit: '',
  })),
  ...intervals.templates.map((template) => ({
    id: `interval:${template.id}`,
    source: 'interval' as const,
    name: `Interval · ${template.name}`,
    role: 'factor' as const,
    favorableDirection: 'neutral' as const,
    unit: 'runs',
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
  })),
)

const selectedOutcome = computed(() => outcomeSources.value.find((source) => source.id === outcomeId.value))

onMounted(async () => {
  await Promise.all([
    tracking.loaded ? Promise.resolve() : tracking.load(),
    tasks.tasks.length ? Promise.resolve() : tasks.load(),
    intervals.loaded ? Promise.resolve() : intervals.load(),
  ]).catch((cause) => {
    error.value = cause instanceof Error ? cause.message : 'Could not load comparison sources.'
  })
  factorId.value ||= factorSources.value[0]?.id || ''
  outcomeId.value ||= outcomeSources.value[0]?.id || ''
})

async function analyze() {
  result.value = undefined
  error.value = ''
  if (!outcomeId.value) {
    error.value = 'Create and select an outcome tracker first.'
    return
  }
  loading.value = true
  try {
    const start = mode.value === 'present_absent'
      ? rangeStart.value
      : [firstStart.value, secondStart.value].sort()[0] || firstStart.value
    const end = mode.value === 'present_absent'
      ? rangeEnd.value
      : [firstEnd.value, secondEnd.value].sort().at(-1) || secondEnd.value
    if (!start || !end || start > end) throw new Error('Choose valid date ranges.')
    await tracking.loadRange(start, end)
    const outcomeValues = tracking.dailyValues(outcomeId.value)
    const direction = selectedOutcome.value?.favorableDirection || 'neutral'
    if (mode.value === 'ranges') {
      if (firstStart.value > firstEnd.value || secondStart.value > secondEnd.value) {
        throw new Error('Each range must start before it ends.')
      }
      result.value = compareDateRanges(
        outcomeValues,
        { start: firstStart.value, end: firstEnd.value },
        { start: secondStart.value, end: secondEnd.value },
        direction,
      )
      return
    }
    if (!factorId.value) throw new Error('Select a factor to compare.')
    const factorValues = await factorDailyValues(factorId.value, rangeStart.value, rangeEnd.value)
    result.value = comparePresentAbsent(factorValues, outcomeValues, direction)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not calculate this comparison.'
  } finally {
    loading.value = false
  }
}

async function factorDailyValues(sourceId: string, start: string, end: string): Promise<TrackingDailyValue[]> {
  const [source, id] = sourceId.split(':', 2)
  if (source === 'tracker') {
    return tracking.dailyValues(id || '').filter((item) => item.date >= start && item.date <= end)
  }
  const dates = dateRangeKeys(start, end)
  if (source === 'task') {
    const task = tasks.tasks.find((item) => item.id === id)
    if (!task) return []
    const records = await api.collection('occurrences').getFullList({
      filter: `task = "${id}" && scheduled_date >= "${start}" && scheduled_date <= "${end}"`,
      sort: 'scheduled_date',
    })
    const completedDates = new Set(records
      .filter((record) => record.status === 'completed')
      .map((record) => String(record.scheduled_date)))
    return dates
      .filter((date) => isTaskScheduled(task, new Date(`${date}T12:00:00`)))
      .map((date) => ({ date, value: completedDates.has(date) ? 1 : 0 }))
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
</script>

<template>
  <main class="app-page insights-page">
    <v-alert type="info" variant="tonal" class="mb-4">
      Comparisons run only when you ask. They describe associations in your logs—not causes, diagnoses, or treatment advice.
    </v-alert>
    <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>

    <v-card class="surface-card pa-5 mb-4">
      <h2 class="section-title">Comparison</h2>
      <v-btn-toggle v-model="mode" mandatory color="secondary" class="mode-toggle mt-4" @update:model-value="result = undefined">
        <v-btn value="present_absent">Present vs absent</v-btn>
        <v-btn value="ranges">Before vs after</v-btn>
      </v-btn-toggle>

      <template v-if="mode === 'present_absent'">
        <v-select
          v-model="factorId"
          label="Factor"
          :items="factorSources.map(source => ({ title: source.name, value: source.id }))"
          variant="outlined"
          class="mt-5"
          no-data-text="Create a factor, task, or interval first"
        />
        <div class="date-grid">
          <DatePickerField v-model="rangeStart" label="From" />
          <DatePickerField v-model="rangeEnd" label="To" />
        </div>
        <p class="field-help mt-1">For custom factors, only explicit logs count; missing days are not treated as “No.” Scheduled Tasks and saved Intervals use completion history.</p>
      </template>

      <template v-else>
        <h3 class="range-title mt-5">First range</h3>
        <div class="date-grid mt-2">
          <DatePickerField v-model="firstStart" label="From" />
          <DatePickerField v-model="firstEnd" label="To" />
        </div>
        <h3 class="range-title mt-2">Second range</h3>
        <div class="date-grid mt-2">
          <DatePickerField v-model="secondStart" label="From" />
          <DatePickerField v-model="secondEnd" label="To" />
        </div>
      </template>

      <v-select
        v-model="outcomeId"
        label="Outcome"
        :items="outcomeSources.map(source => ({ title: source.name, value: source.id }))"
        variant="outlined"
        class="mt-4"
        no-data-text="Create an outcome tracker first"
      />
      <v-btn block color="secondary" size="large" prepend-icon="mdi-chart-box-outline" :loading="loading" @click="analyze">Analyze my logs</v-btn>
    </v-card>

    <v-card v-if="result" class="result-card surface-card pa-5">
      <div class="result-heading">
        <div class="result-icon" :class="`result-icon--${result.ready ? result.direction : 'waiting'}`">
          <v-icon :icon="result.ready ? 'mdi-chart-line' : 'mdi-chart-timeline-variant-shimmer'" />
        </div>
        <div><h2>Comparison result</h2><p>{{ result.summary }}</p></div>
      </div>

      <v-alert v-if="result.earlySignal" type="warning" variant="tonal" density="compact" class="mt-4">Early signal: at least one group has fewer than 14 observations.</v-alert>

      <div class="cohort-grid mt-5">
        <div class="cohort">
          <span>{{ result.first.label }}</span>
          <strong>{{ result.first.count }}</strong>
          <small>observations</small>
          <dl><dt>Mean</dt><dd>{{ formatNumber(result.first.mean) }}</dd><dt>Median</dt><dd>{{ formatNumber(result.first.median) }}</dd></dl>
        </div>
        <div class="cohort">
          <span>{{ result.second.label }}</span>
          <strong>{{ result.second.count }}</strong>
          <small>observations</small>
          <dl><dt>Mean</dt><dd>{{ formatNumber(result.second.mean) }}</dd><dt>Median</dt><dd>{{ formatNumber(result.second.median) }}</dd></dl>
        </div>
      </div>

      <div v-if="result.ready" class="difference mt-4">
        <span>Absolute mean difference</span><strong>{{ formatNumber(result.absoluteDifference) }}</strong>
      </div>
      <p class="caution mt-4"><v-icon icon="mdi-information-outline" size="18" />{{ result.caution }}</p>
    </v-card>
  </main>
</template>

<style scoped>
.section-title { font-size: .78rem; font-weight: 900; letter-spacing: .09em; text-transform: uppercase; }
.mode-toggle { display: grid; width: 100%; grid-template-columns: 1fr 1fr; }
.mode-toggle :deep(.v-btn) { min-width: 0; }
.date-grid { display: grid; grid-template-columns: 1fr 1fr; gap: .75rem; }
.range-title { font-size: .78rem; font-weight: 850; }
.field-help { color: rgb(var(--v-theme-on-surface) / .58); font-size: .72rem; line-height: 1.5; }
.result-heading { display: grid; grid-template-columns: 48px 1fr; align-items: center; gap: 1rem; }
.result-heading h2 { font-size: 1.05rem; font-weight: 900; }
.result-heading p { margin-top: .2rem; color: rgb(var(--v-theme-on-surface) / .62); font-size: .78rem; line-height: 1.45; }
.result-icon { display: grid; width: 48px; height: 48px; place-items: center; border-radius: 15px; background: rgb(var(--v-theme-secondary) / .14); color: rgb(var(--v-theme-secondary)); }
.result-icon--worse { background: rgb(var(--v-theme-warning) / .14); color: rgb(var(--v-theme-warning)); }
.result-icon--waiting { background: rgb(var(--v-theme-on-surface) / .08); color: rgb(var(--v-theme-on-surface) / .6); }
.cohort-grid { display: grid; grid-template-columns: 1fr 1fr; gap: .75rem; }
.cohort { padding: 1rem; border: 1px solid rgb(var(--v-theme-on-surface) / .08); border-radius: 16px; background: rgb(var(--v-theme-background) / .42); }
.cohort > span { display: block; min-height: 2.4em; color: rgb(var(--v-theme-on-surface) / .62); font-size: .7rem; font-weight: 800; }
.cohort > strong { display: block; font-size: 1.8rem; }
.cohort > small { color: rgb(var(--v-theme-on-surface) / .48); }
.cohort dl { display: grid; margin-top: .8rem; grid-template-columns: 1fr auto; gap: .25rem; font-size: .72rem; }
.cohort dt { color: rgb(var(--v-theme-on-surface) / .54); }.cohort dd { margin: 0; font-weight: 800; }
.difference { display: flex; align-items: center; justify-content: space-between; padding: .9rem 1rem; border-radius: 14px; background: rgb(var(--v-theme-secondary) / .1); }
.difference span { font-size: .75rem; }.difference strong { font-size: 1.2rem; }
.caution { display: flex; align-items: flex-start; gap: .5rem; color: rgb(var(--v-theme-on-surface) / .58); font-size: .72rem; line-height: 1.5; }
@media (max-width: 480px) { .date-grid { grid-template-columns: 1fr; gap: 0; } }
</style>
