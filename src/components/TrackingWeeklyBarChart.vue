<script setup lang="ts">
import { computed, ref } from 'vue'
import { addDays, format } from 'date-fns'
import TrackingRatingValue from '@/components/TrackingRatingValue.vue'
import { useResponsiveChartWidth } from '@/services/responsiveChart'
import { aggregateTrackingEntries, formatTrackingValue } from '@/services/tracking'
import type { TrackingEntry, TrackingTracker } from '@/types/domain'

const props = defineProps<{
  trackers: TrackingTracker[]
  entries: TrackingEntry[]
  weekStart: Date
  selectedDate: Date
}>()

const selectedDayIndex = ref<number>()
const { chartRoot, chartWidth } = useResponsiveChartWidth()
const chartHeight = 250
const plotLeft = 16
const plotRight = 16
const plotTop = 14
const plotBottom = 42
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
    const daily = aggregateTrackingEntries(tracker, weekEntries.value)
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

const fallbackDayIndex = computed(() => {
  const selectedKey = format(props.selectedDate, 'yyyy-MM-dd')
  const index = days.value.findIndex(day => day.key === selectedKey)
  return index >= 0 ? index : 0
})
const readoutDayIndex = computed(() => selectedDayIndex.value ?? fallbackDayIndex.value)
const readoutDay = computed(() => days.value[readoutDayIndex.value])
const readoutValues = computed(() => series.value.map(item => ({
  tracker: item.tracker,
  value: item.values[readoutDayIndex.value] ?? null,
})))
const ariaLabel = computed(() => {
  const start = days.value[0]?.date
  const end = days.value.at(-1)?.date
  return start && end
    ? `Grouped tracking bars for the week of ${format(start, 'MMMM d')} to ${format(end, 'MMMM d, yyyy')}. Each tracker uses its own scale. Use left and right arrow keys to inspect a day.`
    : 'Grouped tracking bars for the visible week.'
})

function barWidth() {
  if (!series.value.length) return 0
  return Math.max(4, Math.min(18, (groupWidth.value - 16) / series.value.length - 2))
}

function barsWidth() {
  return series.value.length * barWidth() + Math.max(0, series.value.length - 1) * 2
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

function selectFromPointer(event: PointerEvent) {
  const rect = (event.currentTarget as SVGElement).getBoundingClientRect()
  if (!rect.width) return
  const x = (event.clientX - rect.left) / rect.width * chartWidth.value
  selectedDayIndex.value = Math.max(0, Math.min(6, Math.floor((x - plotLeft) / groupWidth.value)))
}

function clearPointerSelection(event: PointerEvent) {
  if (event.pointerType === 'mouse') selectedDayIndex.value = undefined
}

function onKeydown(event: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  if (event.key === 'Home') selectedDayIndex.value = 0
  else if (event.key === 'End') selectedDayIndex.value = 6
  else if (event.key === 'ArrowLeft') selectedDayIndex.value = Math.max(0, (selectedDayIndex.value ?? 7) - 1)
  else selectedDayIndex.value = Math.min(6, (selectedDayIndex.value ?? -1) + 1)
}
</script>

<template>
  <div ref="chartRoot" class="weekly-chart">
    <template v-if="series.length">
      <div class="chart-legend" aria-label="Trackers shown">
        <span v-for="item in series" :key="item.tracker.id">
          <i :style="{ background: item.tracker.color }" />{{ item.tracker.name }}
        </span>
      </div>

      <div class="chart-readout" aria-live="polite">
        <strong v-if="readoutDay">{{ format(readoutDay.date, 'EEEE, MMM d') }}</strong>
        <span v-for="item in readoutValues" :key="item.tracker.id" class="chart-readout__value">
          <b>{{ item.tracker.name }}:</b>
          <span class="chart-readout__display">
            <TrackingRatingValue
              v-if="item.tracker.kind === 'rating' && item.value !== null"
              :value="item.value"
              :max="item.tracker.scaleMax"
              :color="item.tracker.color"
              :label="item.tracker.name"
            />
            <template v-else-if="item.value !== null">{{ formatTrackingValue(item.tracker, item.value) }}</template>
            <template v-else>Not logged</template>
          </span>
        </span>
      </div>

      <div
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
            v-if="selectedDayIndex !== undefined"
            :x="plotLeft + selectedDayIndex * groupWidth + 3"
            :y="plotTop"
            :width="groupWidth - 6"
            :height="plotHeight"
            rx="8"
            class="selected-day"
          />

          <template v-for="(item, seriesIndex) in series" :key="item.tracker.id">
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
            class="day-label"
          >{{ day.label }}</text>
        </svg>
      </div>

    </template>

    <div v-else class="weekly-chart-empty py-7 text-center" role="status">
      <v-icon icon="mdi-chart-bar-stacked" size="36" color="secondary" />
      <p class="mt-3">No entries logged in this week.</p>
    </div>
  </div>
</template>

<style scoped>
.chart-legend,
.chart-readout {
  display: flex;
  align-items: center;
  gap: .5rem 1rem;
  flex-wrap: wrap;
}

.chart-legend { margin-bottom: .5rem; color: rgba(var(--v-theme-on-surface), .68); font-size: .72rem; font-weight: 800; }
.chart-legend span { display: inline-flex; align-items: center; gap: .4rem; }
.chart-legend i { width: .65rem; height: .65rem; flex: 0 0 auto; border-radius: .2rem; }
.chart-readout { min-height: 2.75rem; margin-bottom: .65rem; color: rgba(var(--v-theme-on-surface), .58); font-size: .7rem; }
.chart-readout strong { color: rgb(var(--v-theme-on-surface)); }
.chart-readout__value { display: inline-flex; align-items: center; gap: .35rem; }
.chart-readout__value b { font-weight: 800; }
.chart-readout__display { display: inline-flex; width: min(7.5rem, 38vw); min-width: 6rem; align-items: center; }
.chart-plot { outline: none; }
.chart-plot:focus-visible { border-radius: 1rem; outline: .125rem solid rgba(var(--v-theme-secondary), .72); outline-offset: .25rem; }
svg { display: block; width: 100%; height: auto; touch-action: pan-y; }
.grid-line { stroke: rgba(var(--v-theme-on-surface), .09); stroke-width: 1; }
.selected-day { fill: rgba(var(--v-theme-secondary), .06); }
.chart-bar { opacity: .92; transition: opacity 180ms ease; }
.day-label { fill: rgba(var(--v-theme-on-surface), .54); font-family: inherit; font-size: .6875rem; font-weight: 800; text-anchor: middle; }
.weekly-chart-empty { color: rgba(var(--v-theme-on-surface), .58); font-size: .8rem; }

@media (max-width: 30rem) {
  .chart-readout { align-items: flex-start; flex-direction: column; gap: .15rem; }
}

@media (prefers-reduced-motion: reduce) {
  .chart-bar { transition: none; }
}
</style>
