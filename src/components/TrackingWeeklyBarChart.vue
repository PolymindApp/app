<script setup lang="ts">
import { computed, ref } from 'vue'
import { addDays, format } from 'date-fns'
import TrackingChartSkeleton from '@/components/TrackingChartSkeleton.vue'
import { useResponsiveChartWidth } from '@/services/responsiveChart'
import { formatNumber, formatTrackingValue, trackingDailyValuesForRange } from '@/services/tracking'
import { readInactiveTrackingChartTrackerIds, storeInactiveTrackingChartTrackerIds } from '@/services/trackingChartPreferences'
import type { TrackingEntry, TrackingTracker } from '@/types/domain'

const props = defineProps<{
  trackers: TrackingTracker[]
  entries: TrackingEntry[]
  weekStart: Date
  selectedDate: Date
  loading?: boolean
}>()

const selectedDayIndex = ref<number>()
const inactiveTrackerIds = ref(new Set(readInactiveTrackingChartTrackerIds()))
const { chartRoot, chartWidth } = useResponsiveChartWidth()
const chartHeight = 125
const plotLeft = 16
const plotRight = 16
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

const series = computed(() => props.trackers
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
  })
  .filter((item) => item.hasValues)
  .sort((a, b) => a.tracker.sortOrder - b.tracker.sortOrder || a.tracker.name.localeCompare(b.tracker.name)))
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
const readoutValues = computed(() => series.value.map(item => ({
  tracker: item.tracker,
  value: readoutDayIndex.value === undefined ? null : item.values[readoutDayIndex.value] ?? null,
})))
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

function trackerIsActive(trackerId: string) {
  return !inactiveTrackerIds.value.has(trackerId)
}

function toggleTracker(trackerId: string) {
  const next = new Set(inactiveTrackerIds.value)
  if (next.has(trackerId)) next.delete(trackerId)
  else next.add(trackerId)
  inactiveTrackerIds.value = next
  storeInactiveTrackingChartTrackerIds([...next])
}

function selectFromPointer(event: PointerEvent) {
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
    <template v-if="series.length">
      <TrackingChartSkeleton v-if="loading" chart-only compact />
      <div
        v-else
        class="chart-plot"
        tabindex="0"
        role="img"
        :aria-label="ariaLabel"
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
            v-if="readoutDayIndex !== undefined"
            :x="plotLeft + readoutDayIndex * groupWidth + 3"
            :y="plotTop"
            :width="groupWidth - 6"
            :height="plotHeight"
            rx="8"
            class="selected-day"
          />

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

          <text
            v-for="(day, index) in days"
            :key="day.key"
            :x="plotLeft + index * groupWidth + groupWidth / 2"
            :y="chartHeight - 14"
            :class="['day-label', { 'day-label--future': day.key > todayKey }]"
          >{{ day.label }}</text>
        </svg>
      </div>

      <div class="chart-legend" :aria-label="readoutDay ? `Trackers shown for ${format(readoutDay.date, 'EEEE, MMMM d')}` : 'Trackers shown'" aria-live="polite">
        <v-btn
          v-for="item in readoutValues"
          :key="item.tracker.id"
          size="x-small"
          variant="text"
          :class="['chart-legend__item', { 'chart-legend__item--inactive': !trackerIsActive(item.tracker.id) }]"
          :aria-label="`${trackerIsActive(item.tracker.id) ? 'Hide' : 'Show'} ${item.tracker.name} in chart`"
          :aria-pressed="trackerIsActive(item.tracker.id)"
          @click="toggleTracker(item.tracker.id)"
        >
          <i :style="{ background: item.tracker.color }" />
          {{ item.tracker.name }}
          <strong v-if="!legendHasNoValue(item.tracker, item.value)">({{ legendValue(item.tracker, item.value) }})</strong>
        </v-btn>
      </div>
    </template>

    <TrackingChartSkeleton v-else-if="loading" chart-only compact />
    <div v-else class="weekly-chart-empty py-7 text-center" role="status">
      <v-icon icon="mdi-chart-bar-stacked" size="36" color="secondary" />
      <p class="mt-3">No entries logged in this week.</p>
    </div>
  </div>
</template>

<style scoped>
.chart-legend {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
}

.chart-legend { margin-top: .5rem; color: rgba(var(--v-theme-on-surface), .68); font-size: .72rem; font-weight: 800; }
.chart-legend__item {
  color: inherit;
  transition: opacity 180ms ease;
}
.chart-legend__item :deep(.v-btn__content) { gap: .4rem; }
.chart-legend__item--inactive { opacity: .42; text-decoration: line-through; }
.chart-legend i { width: .65rem; height: .65rem; flex: 0 0 auto; border-radius: .2rem; }
.chart-legend strong { color: rgb(var(--v-theme-on-surface) / .88); }
.chart-plot { outline: none; }
.chart-plot:focus-visible { border-radius: 1rem; outline: .125rem solid rgba(var(--v-theme-secondary), .72); outline-offset: .25rem; }
svg { display: block; width: 100%; height: auto; touch-action: pan-y; }
.grid-line { stroke: rgba(var(--v-theme-on-surface), .09); stroke-width: 1; }
.selected-day { fill: rgba(var(--v-theme-secondary), .06); }
.chart-bar { opacity: .92; transition: opacity 180ms ease; }
.day-label { fill: rgba(var(--v-theme-on-surface), .54); font-family: inherit; font-size: .6875rem; font-weight: 800; text-anchor: middle; }
.day-label--future { fill: rgba(var(--v-theme-on-surface), .24); }
.weekly-chart-empty { color: rgba(var(--v-theme-on-surface), .58); font-size: .8rem; }

@media (prefers-reduced-motion: reduce) {
  .chart-bar,
  .chart-legend__item { transition: none; }
}
</style>
