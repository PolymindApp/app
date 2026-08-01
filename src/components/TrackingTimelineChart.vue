<script setup lang="ts">
import { computed, ref } from 'vue'
import { format, parseISO } from 'date-fns'
import { formatNumber } from '@/services/tracking'
import type { TrackingInsightPoint } from '@/types/domain'

const props = defineProps<{
  points: TrackingInsightPoint[]
  factorName: string
  factorUnit: string
  factorColor: string
  outcomeName: string
  outcomeUnit: string
  outcomeColor: string
  factorScaleMin?: number
  factorScaleMax?: number
  outcomeScaleMin?: number
  outcomeScaleMax?: number
}>()

const selectedIndex = ref<number>()
const chartWidth = 720
const plotLeft = 58
const plotRight = 20
const plotWidth = chartWidth - plotLeft - plotRight
const panelHeight = 102
const factorTop = 42
const outcomeTop = 205

const factorRange = computed(() => valueRange(
  props.points.map((point) => point.factorValue),
  props.factorScaleMin,
  props.factorScaleMax,
))
const outcomeRange = computed(() => valueRange(
  props.points.map((point) => point.outcomeValue),
  props.outcomeScaleMin,
  props.outcomeScaleMax,
))
const selectedPoint = computed(() => selectedIndex.value === undefined
  ? undefined
  : props.points[selectedIndex.value])
const xLabels = computed(() => {
  if (!props.points.length) return []
  const indices = [...new Set([0, Math.floor((props.points.length - 1) / 2), props.points.length - 1])]
  return indices.map((index) => ({ index, label: format(parseISO(props.points[index]!.date), 'MMM d') }))
})
const ariaLabel = computed(() => {
  const first = props.points[0]
  const last = props.points.at(-1)
  return first && last
    ? `${props.factorName} and ${props.outcomeName} over time from ${format(parseISO(first.date), 'MMMM d')} to ${format(parseISO(last.date), 'MMMM d, yyyy')}. Use left and right arrow keys to inspect dates.`
    : `${props.factorName} and ${props.outcomeName} over time.`
})

function xAt(index: number) {
  return plotLeft + (props.points.length <= 1 ? plotWidth / 2 : index / (props.points.length - 1) * plotWidth)
}

function yAt(value: number, top: number, range: [number, number]) {
  const ratio = Math.max(0, Math.min(1, (value - range[0]) / (range[1] - range[0])))
  return top + panelHeight - ratio * panelHeight
}

function seriesPath(key: 'factorValue' | 'outcomeValue', top: number, range: [number, number]) {
  return props.points.reduce((path, point, index) => {
    const value = point[key]
    if (value === null) return `${path} `
    const previous = props.points[index - 1]?.[key]
    const command = index === 0 || previous === null || previous === undefined ? 'M' : 'L'
    return `${path}${command}${xAt(index).toFixed(2)},${yAt(value, top, range).toFixed(2)} `
  }, '').trim()
}

function ticks(range: [number, number]) {
  return [range[1], (range[0] + range[1]) / 2, range[0]]
}

function tickY(index: number, top: number) {
  return top + index * panelHeight / 2
}

function selectFromPointer(event: PointerEvent) {
  if (!props.points.length) return
  const rect = (event.currentTarget as SVGElement).getBoundingClientRect()
  if (!rect.width) return
  const svgX = (event.clientX - rect.left) / rect.width * chartWidth
  selectedIndex.value = Math.max(
    0,
    Math.min(props.points.length - 1, Math.round((svgX - plotLeft) / plotWidth * (props.points.length - 1))),
  )
}

function clearPointerSelection(event: PointerEvent) {
  if (event.pointerType === 'mouse') selectedIndex.value = undefined
}

function onKeydown(event: KeyboardEvent) {
  if (!props.points.length || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  if (event.key === 'Home') selectedIndex.value = 0
  else if (event.key === 'End') selectedIndex.value = props.points.length - 1
  else if (event.key === 'ArrowLeft') selectedIndex.value = Math.max(0, (selectedIndex.value ?? props.points.length) - 1)
  else selectedIndex.value = Math.min(props.points.length - 1, (selectedIndex.value ?? -1) + 1)
}

function valueRange(values: Array<number | null>, configuredMin?: number, configuredMax?: number): [number, number] {
  const observed = values.filter((value): value is number => value !== null)
  let min = configuredMin ?? (observed.length ? Math.min(...observed) : 0)
  let max = configuredMax ?? (observed.length ? Math.max(...observed) : 1)
  if (min === max) {
    const padding = Math.max(Math.abs(min) * .1, 1)
    min -= padding
    max += padding
  } else if (configuredMin === undefined || configuredMax === undefined) {
    const padding = (max - min) * .08
    if (configuredMin === undefined) min -= padding
    if (configuredMax === undefined) max += padding
  }
  return [min, max]
}

function displayValue(value: number | null, unit: string) {
  return value === null ? 'Not logged' : `${formatNumber(value)}${unit ? ` ${unit}` : ''}`
}
</script>

<template>
  <div
    class="timeline-chart"
    :style="{ '--factor-color': factorColor, '--outcome-color': outcomeColor }"
    tabindex="0"
    role="img"
    :aria-label="ariaLabel"
    @keydown="onKeydown"
  >
    <div class="chart-legend">
      <span><i class="legend-mark legend-mark--factor" />{{ factorName }}</span>
      <span><i class="legend-mark legend-mark--outcome" />{{ outcomeName }}</span>
    </div>

    <div class="chart-readout" aria-live="polite">
      <template v-if="selectedPoint">
        <strong>{{ format(parseISO(selectedPoint.date), 'EEE, MMM d') }}</strong>
        <span>{{ factorName }}: {{ displayValue(selectedPoint.factorValue, factorUnit) }}</span>
        <span>{{ outcomeName }}: {{ displayValue(selectedPoint.outcomeValue, outcomeUnit) }}</span>
      </template>
      <span v-else>Tap, hover, or use arrow keys to inspect a date.</span>
    </div>

    <svg
      viewBox="0 0 720 350"
      aria-hidden="true"
      @pointerdown="selectFromPointer"
      @pointermove="selectFromPointer"
      @pointerleave="clearPointerSelection"
    >
      <g v-for="(tick, index) in ticks(factorRange)" :key="`factor-${index}`">
        <line :x1="plotLeft" :x2="chartWidth - plotRight" :y1="tickY(index, factorTop)" :y2="tickY(index, factorTop)" class="grid-line" />
        <text :x="plotLeft - 8" :y="tickY(index, factorTop) + 4" class="axis-value">{{ formatNumber(tick) }}</text>
      </g>
      <g v-for="(tick, index) in ticks(outcomeRange)" :key="`outcome-${index}`">
        <line :x1="plotLeft" :x2="chartWidth - plotRight" :y1="tickY(index, outcomeTop)" :y2="tickY(index, outcomeTop)" class="grid-line" />
        <text :x="plotLeft - 8" :y="tickY(index, outcomeTop) + 4" class="axis-value">{{ formatNumber(tick) }}</text>
      </g>

      <text :x="plotLeft" y="24" class="panel-label">{{ factorName }}{{ factorUnit ? ` · ${factorUnit}` : '' }}</text>
      <text :x="plotLeft" y="187" class="panel-label">{{ outcomeName }}{{ outcomeUnit ? ` · ${outcomeUnit}` : '' }}</text>

      <path :d="seriesPath('factorValue', factorTop, factorRange)" class="series-line series-line--outline" />
      <path :d="seriesPath('factorValue', factorTop, factorRange)" class="series-line series-line--factor" />
      <circle
        v-for="(point, index) in points"
        v-show="point.factorValue !== null"
        :key="`factor-dot-${point.date}`"
        :cx="xAt(index)"
        :cy="point.factorValue === null ? factorTop + panelHeight : yAt(point.factorValue, factorTop, factorRange)"
        r="3.5"
        class="series-dot series-dot--factor"
      />

      <path :d="seriesPath('outcomeValue', outcomeTop, outcomeRange)" class="series-line series-line--outline" />
      <path :d="seriesPath('outcomeValue', outcomeTop, outcomeRange)" class="series-line series-line--outcome" />
      <circle
        v-for="(point, index) in points"
        v-show="point.outcomeValue !== null"
        :key="`outcome-dot-${point.date}`"
        :cx="xAt(index)"
        :cy="point.outcomeValue === null ? outcomeTop + panelHeight : yAt(point.outcomeValue, outcomeTop, outcomeRange)"
        r="3.5"
        class="series-dot series-dot--outcome"
      />

      <g v-if="selectedIndex !== undefined">
        <line :x1="xAt(selectedIndex)" :x2="xAt(selectedIndex)" y1="28" y2="307" class="cursor-line" />
        <circle
          v-if="selectedPoint && selectedPoint.factorValue !== null"
          :cx="xAt(selectedIndex)"
          :cy="yAt(selectedPoint!.factorValue!, factorTop, factorRange)"
          r="7"
          class="selected-dot selected-dot--factor"
        />
        <circle
          v-if="selectedPoint && selectedPoint.outcomeValue !== null"
          :cx="xAt(selectedIndex)"
          :cy="yAt(selectedPoint!.outcomeValue!, outcomeTop, outcomeRange)"
          r="7"
          class="selected-dot selected-dot--outcome"
        />
      </g>

      <text
        v-for="label in xLabels"
        :key="label.index"
        :x="xAt(label.index)"
        y="336"
        class="axis-date"
        :text-anchor="label.index === 0 ? 'start' : label.index === points.length - 1 ? 'end' : 'middle'"
      >{{ label.label }}</text>
    </svg>
  </div>
</template>

<style scoped>
.timeline-chart {
  --factor-color: rgb(var(--v-theme-info));
  --outcome-color: rgb(var(--v-theme-secondary));

  outline: none;
}

.timeline-chart:focus-visible {
  border-radius: 1rem;
  outline: .125rem solid rgb(var(--v-theme-secondary) / .72);
  outline-offset: .25rem;
}

.chart-legend,
.chart-readout {
  display: flex;
  align-items: center;
  gap: .75rem 1rem;
  flex-wrap: wrap;
}

.chart-legend { color: rgba(var(--v-theme-on-surface), .86); font-size: .72rem; font-weight: 800; }
.chart-legend span { display: inline-flex; align-items: center; gap: .4rem; }
.legend-mark { width: .7rem; height: .7rem; border-radius: 50%; background: var(--factor-color); }
.legend-mark--outcome { border-radius: .15rem; background: var(--outcome-color); }
.chart-readout { min-height: 2.75rem; margin-top: .65rem; color: rgba(var(--v-theme-on-surface), .76); font-size: .7rem; }
.chart-readout strong { color: rgb(var(--v-theme-on-surface)); }

svg { display: block; width: 100%; height: auto; touch-action: pan-y; }
.grid-line { stroke: rgba(var(--v-theme-on-surface), .2); stroke-width: 1; }
.axis-value,
.axis-date,
.panel-label { fill: rgba(var(--v-theme-on-surface), .8); font-family: inherit; font-size: .6875rem; font-weight: 700; }
.axis-value { text-anchor: end; }
.panel-label { fill: rgba(var(--v-theme-on-surface), .94); font-size: .75rem; font-weight: 800; }
.series-line { fill: none; stroke-width: 3.5; stroke-linecap: round; stroke-linejoin: round; }
.series-line--outline { stroke: rgba(var(--v-theme-on-surface), .54); stroke-width: 6.5; }
.series-line--factor { stroke: var(--factor-color); }
.series-line--outcome { stroke: var(--outcome-color); }
.series-dot { stroke: rgba(var(--v-theme-on-surface), .82); stroke-width: 2.5; }
.series-dot--factor { fill: var(--factor-color); }
.series-dot--outcome { fill: var(--outcome-color); }
.cursor-line { stroke: rgba(var(--v-theme-on-surface), .7); stroke-width: 1.5; stroke-dasharray: 4 4; }
.selected-dot { fill: rgb(var(--v-theme-surface)); stroke-width: 3; }
.selected-dot--factor { stroke: var(--factor-color); }
.selected-dot--outcome { stroke: var(--outcome-color); }

@media (max-width: 30rem) {
  .chart-readout { align-items: flex-start; flex-direction: column; gap: .15rem; }
}
</style>
