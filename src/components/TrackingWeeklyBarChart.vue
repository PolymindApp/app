<script setup lang="ts">
import { computed, ref } from 'vue'
import { addDays, format } from 'date-fns'
import { useResponsiveChartWidth } from '@/services/responsiveChart'
import { formatNumber, formatTrackingValue, trackingDailyValuesForRange } from '@/services/tracking'
import { readInactiveTrackingChartTrackerIds, storeInactiveTrackingChartTrackerIds } from '@/services/trackingChartPreferences'
import type { TrackingEntry, TrackingTracker } from '@/types/domain'

const props = defineProps<{
  trackers: TrackingTracker[]
  entries: TrackingEntry[]
  screenTimeValues?: Record<string, number>
  weekStart: Date
  selectedDate: Date
  loading?: boolean
}>()

const screenTimeTracker: TrackingTracker = {
  id: 'health_connect:screen_time',
  name: 'Screen time',
  description: '',
  role: 'factor',
  kind: 'duration',
  category: 'other',
  unit: '',
  scaleMin: 0,
  scaleMax: 0,
  favorableDirection: 'neutral',
  dailyAggregation: 'sum',
  active: true,
  sortOrder: Number.MAX_SAFE_INTEGER,
  color: 'rgb(var(--v-theme-info))',
  icon: 'mdi-cellphone-clock',
}

const selectedDayIndex = ref<number>()
const inactiveTrackerIds = ref(new Set(readInactiveTrackingChartTrackerIds()))
const { chartRoot, chartWidth } = useResponsiveChartWidth()
const chartHeight = 125
const plotLeft = 0
const plotRight = 0
const plotTop = 14
const plotBottom = 42
const todayKey = format(new Date(), 'yyyy-MM-dd')
const plotWidth = computed(() => Math.max(1, chartWidth.value - plotLeft - plotRight))
const plotHeight = chartHeight - plotTop - plotBottom
const groupWidth = computed(() => plotWidth.value / 7)

const days = computed(() => Array.from({ length: 7 }, (_, index) => {
  const date = addDays(props.weekStart, index)
  return {
    date,
    key: format(date, 'yyyy-MM-dd'),
    label: format(date, 'EEE'),
  }
}))

const weekEntries = computed(() => {
  const start = days.value[0]?.key || ''
  const end = days.value.at(-1)?.key || ''
  return props.entries.filter((entry) => entry.localDate >= start && entry.localDate <= end)
})

const trackerSeries = computed(() => props.trackers
  .map((tracker) => {
    const start = days.value[0]?.key || ''
    const end = days.value.at(-1)?.key || ''
    const daily = trackingDailyValuesForRange(tracker, weekEntries.value, start, end)
    const valueByDate = new Map(daily.map((item) => [item.date, item.value]))
    const values = days.value.map((day) => valueByDate.get(day.key) ?? null)
    const observed = values.filter((value): value is number => value !== null)
    const configuredMax = tracker.kind === 'yes_no'
      ? 1
      : tracker.kind === 'rating' && tracker.scaleMax > 0
        ? tracker.scaleMax
        : 0
    return {
      tracker,
      values,
      max: Math.max(configuredMax, ...observed.map((value) => Math.abs(value)), 1),
      hasValues: observed.length > 0,
    }
  }))
const screenTimeSeries = computed(() => {
  if (!props.screenTimeValues) return []
  const values = days.value.map((day) => {
    const minutes = props.screenTimeValues?.[day.key]
    return minutes === undefined ? null : minutes * 60
  })
  const observed = values.filter((value): value is number => value !== null)
  return [{
    tracker: screenTimeTracker,
    values,
    max: Math.max(...observed, 1),
    hasValues: observed.length > 0,
  }]
})
const availableSeries = computed(() => [...trackerSeries.value, ...screenTimeSeries.value]
  .sort((a, b) => a.tracker.sortOrder - b.tracker.sortOrder || a.tracker.name.localeCompare(b.tracker.name)))
const series = computed(() => availableSeries.value.filter(item => item.hasValues))
const activeSeries = computed(() => series.value.filter(item => !inactiveTrackerIds.value.has(item.tracker.id)))
const lastSelectableDayIndex = computed(() => {
  let index = -1
  for (const [dayIndex, day] of days.value.entries()) {
    if (day.key <= todayKey) index = dayIndex
  }
  return index
})

const fallbackDayIndex = computed(() => {
  const selectedKey = format(props.selectedDate, 'yyyy-MM-dd')
  const index = days.value.findIndex(day => day.key === selectedKey)
  return index >= 0 ? index : 0
})
const readoutDayIndex = computed(() => {
  if (lastSelectableDayIndex.value < 0) return undefined
  return Math.min(
    selectedDayIndex.value ?? fallbackDayIndex.value,
    lastSelectableDayIndex.value,
  )
})
const readoutDay = computed(() => readoutDayIndex.value === undefined
  ? undefined
  : days.value[readoutDayIndex.value])
const readoutValues = computed(() => availableSeries.value.map(item => ({
  tracker: item.tracker,
  value: readoutDayIndex.value === undefined ? null : item.values[readoutDayIndex.value] ?? null,
})))
const selectedTrackerIds = computed<string[]>({
  get: () => availableSeries.value
    .filter(item => !inactiveTrackerIds.value.has(item.tracker.id))
    .map(item => item.tracker.id),
  set: (ids) => {
    const availableIds = new Set(availableSeries.value.map(item => item.tracker.id))
    const selectedIds = new Set(ids)
    const next = new Set([...inactiveTrackerIds.value].filter(id => !availableIds.has(id)))
    availableIds.forEach((id) => {
      if (!selectedIds.has(id)) next.add(id)
    })
    inactiveTrackerIds.value = next
    storeInactiveTrackingChartTrackerIds([...next])
  },
})
const legendOptions = computed(() => readoutValues.value.map(({ tracker, value }) => {
  const valueLabel = legendHasNoValue(tracker, value) ? '' : legendValue(tracker, value as number)
  return {
    value: tracker.id,
    title: tracker.name,
    selectionTitle: valueLabel ? `${tracker.name} (${valueLabel})` : tracker.name,
    valueLabel,
    color: tracker.color,
  }
}))
const ariaLabel = computed(() => {
  const start = days.value[0]?.date
  const end = days.value.at(-1)?.date
  return start && end
    ? `Grouped tracking bars for the week of ${format(start, 'MMMM d')} to ${format(end, 'MMMM d, yyyy')}. Each tracker uses its own scale. Use left and right arrow keys to inspect a day.`
    : 'Grouped tracking bars for the visible week.'
})

function barWidth() {
  if (!activeSeries.value.length) return 0
  return Math.max(4, Math.min(18, (groupWidth.value - 16) / activeSeries.value.length - 2))
}

function barsWidth() {
  return activeSeries.value.length * barWidth() + Math.max(0, activeSeries.value.length - 1) * 2
}

function barX(dayIndex: number, seriesIndex: number) {
  return plotLeft + dayIndex * groupWidth.value + (groupWidth.value - barsWidth()) / 2 + seriesIndex * (barWidth() + 2)
}

function normalizedBarHeight(value: number | null, max: number) {
  if (value === null) return 0
  if (value === 0) return 3
  return Math.max(5, Math.min(plotHeight, Math.abs(value) / max * plotHeight))
}

function barY(value: number | null, max: number) {
  return plotTop + plotHeight - normalizedBarHeight(value, max)
}

function legendValue(tracker: TrackingTracker, value: number) {
  if (tracker.kind === 'rating') return `${formatNumber(value)}/${formatNumber(Math.max(1, tracker.scaleMax))}`
  return formatTrackingValue(tracker, value)
}

function legendHasNoValue(tracker: TrackingTracker, value: number | null) {
  return value === null || (tracker.kind === 'event' && value === 0)
}

function selectFromPointer(event: PointerEvent) {
  if (props.loading) return
  const rect = (event.currentTarget as SVGElement).getBoundingClientRect()
  if (!rect.width) return
  const x = (event.clientX - rect.left) / rect.width * chartWidth.value
  const dayIndex = Math.max(0, Math.min(6, Math.floor((x - plotLeft) / groupWidth.value)))
  if (dayIndex > lastSelectableDayIndex.value) return
  selectedDayIndex.value = dayIndex
}

function clearPointerSelection(event: PointerEvent) {
  if (event.pointerType === 'mouse') selectedDayIndex.value = undefined
}

function onKeydown(event: KeyboardEvent) {
  if (props.loading) return
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  if (lastSelectableDayIndex.value < 0 || readoutDayIndex.value === undefined) return
  if (event.key === 'Home') selectedDayIndex.value = 0
  else if (event.key === 'End') selectedDayIndex.value = lastSelectableDayIndex.value
  else if (event.key === 'ArrowLeft') selectedDayIndex.value = Math.max(0, readoutDayIndex.value - 1)
  else selectedDayIndex.value = Math.min(lastSelectableDayIndex.value, readoutDayIndex.value + 1)
}
</script>

<template>
  <div ref="chartRoot" class="weekly-chart" :aria-busy="loading">
    <div
      v-if="loading || series.length"
      class="chart-plot"
      :tabindex="loading ? -1 : 0"
      role="img"
      :aria-label="loading ? 'Loading tracking values for the visible week.' : ariaLabel"
      @keydown="onKeydown"
    >
      <svg
        :viewBox="`0 0 ${chartWidth} ${chartHeight}`"
        aria-hidden="true"
        @pointerdown="selectFromPointer"
        @pointermove="selectFromPointer"
        @pointerleave="clearPointerSelection"
      >
        <line
          v-for="step in [0, .25, .5, .75, 1]"
          :key="step"
          :x1="plotLeft"
          :x2="chartWidth - plotRight"
          :y1="plotTop + plotHeight * step"
          :y2="plotTop + plotHeight * step"
          class="grid-line"
        />

        <rect
          v-if="!loading && readoutDayIndex !== undefined"
          :x="plotLeft + readoutDayIndex * groupWidth + 3"
          :y="plotTop"
          :width="groupWidth - 6"
          :height="plotHeight"
          rx="8"
          class="selected-day"
        />

        <template v-if="!loading">
          <template v-for="(item, seriesIndex) in activeSeries" :key="item.tracker.id">
            <rect
              v-for="(value, dayIndex) in item.values"
              v-show="value !== null"
              :key="`${item.tracker.id}-${days[dayIndex]?.key}`"
              :x="barX(dayIndex, seriesIndex)"
              :y="barY(value, item.max)"
              :width="barWidth()"
              :height="normalizedBarHeight(value, item.max)"
              :fill="item.tracker.color"
              rx="2"
              class="chart-bar"
            >
              <title>{{ days[dayIndex]?.label }} · {{ item.tracker.name }}: {{ value === null ? 'Not logged' : formatTrackingValue(item.tracker, value) }}</title>
            </rect>
          </template>
        </template>

        <text
          v-for="(day, index) in days"
          :key="day.key"
          :x="plotLeft + index * groupWidth + groupWidth / 2"
          :y="chartHeight - 14"
          :class="['day-label', { 'day-label--future': day.key > todayKey }]"
        >{{ day.label }}</text>
      </svg>
    </div>

    <div class="chart-series-select">
      <v-select
        v-model="selectedTrackerIds"
        :items="legendOptions"
        item-title="title"
        item-value="value"
        autocomplete="off"
        multiple
        density="compact"
        variant="plain"
        hide-details="auto"
        :list-props="{ density: 'compact' }"
        :no-data-text="loading ? 'Loading chart series' : 'No chart series available'"
        :aria-label="readoutDay ? `Chart series shown for ${format(readoutDay.date, 'EEEE, MMMM d')}` : 'Chart series shown'"
      >
        <template #item="{ props: itemProps, item }">
          <v-list-item
            v-bind="itemProps"
            :title="item.raw.title"
            :subtitle="item.raw.valueLabel || undefined"
          >
            <template #prepend>
              <span class="chart-series-color mr-3" :style="{ background: item.raw.color }" />
            </template>
            <template #append>
              <v-icon
                v-if="selectedTrackerIds.includes(item.raw.value)"
                icon="mdi-check-circle"
                color="secondary"
                size="1.125rem"
              />
            </template>
          </v-list-item>
        </template>
        <template #selection="{ item, index }">
          <v-chip
            v-if="index < 4"
            :color="item.raw.color"
            size="x-small"
            variant="tonal"
            class="chart-series-chip"
          >
            <span class="chart-series-color" :style="{ background: item.raw.color }" />
            <span class="text-truncate">{{ item.raw.selectionTitle }}</span>
          </v-chip>
          <span v-else-if="index === 4" class="chart-series-overflow text-disabled">
            +{{ selectedTrackerIds.length - 4 }} {{ selectedTrackerIds.length === 3 ? 'other' : 'others' }}
          </span>
        </template>
      </v-select>
    </div>

    <div v-if="!loading && !series.length" class="weekly-chart-empty py-7 text-center" role="status">
      <v-icon icon="mdi-chart-bar-stacked" size="36" color="secondary" />
      <p class="mt-3">No entries logged in this week.</p>
    </div>
  </div>
</template>

<style scoped>
.chart-series-select {
  min-height: 0;
}
.chart-series-color { display: block; width: .75rem; height: .75rem; flex: 0 0 auto; border: .0625rem solid rgb(var(--v-theme-on-surface) / .22); border-radius: .25rem; }
.chart-series-chip { max-width: 9rem; }
.chart-series-chip :deep(.v-chip__content) { min-width: 0; gap: .375rem; }
.chart-series-overflow { flex: 0 0 auto; color: rgb(var(--v-theme-on-surface) / .68); font-size: .75rem; font-weight: 800; }
.chart-plot { outline: none; }
.chart-plot:focus-visible { border-radius: 1rem; outline: .125rem solid rgba(var(--v-theme-secondary), .72); outline-offset: .25rem; }
svg { display: block; width: 100%; height: auto; touch-action: pan-y; }
.grid-line { stroke: rgba(var(--v-theme-on-surface), .09); stroke-width: 1; }
.selected-day { fill: rgba(var(--v-theme-secondary), .06); }
.chart-bar {
  opacity: .92;
  transform-box: fill-box;
  transform-origin: center bottom;
  animation: chart-bar-enter 220ms cubic-bezier(.22, 1, .36, 1) both;
  transition:
    y 220ms cubic-bezier(.22, 1, .36, 1),
    height 220ms cubic-bezier(.22, 1, .36, 1),
    opacity 180ms ease;
}
.day-label { fill: rgba(var(--v-theme-on-surface), .54); font-family: inherit; font-size: .6875rem; font-weight: 800; text-anchor: middle; }
.day-label--future { fill: rgba(var(--v-theme-on-surface), .24); }
.weekly-chart-empty { color: rgba(var(--v-theme-on-surface), .58); font-size: .8rem; }

@keyframes chart-bar-enter {
  from {
    opacity: 0;
    transform: scaleY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .chart-bar {
    animation: none;
    transition: none;
  }
}
</style>
