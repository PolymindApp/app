<script setup lang="ts">
import { computed, ref } from 'vue'
import { format, parseISO } from 'date-fns'
import { useResponsiveChartWidth } from '@/services/responsiveChart'
import { formatNumber } from '@/services/tracking'
import type { TrackingInsightResult } from '@/services/tracking'
import type { TrackingRelationshipPoint } from '@/types/domain'

const props = defineProps<{
  insight: TrackingInsightResult
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
const { chartRoot, chartWidth } = useResponsiveChartWidth()
const chartHeight = 300
const compactLayout = computed(() => chartWidth.value < 420)
const plotLeft = computed(() => compactLayout.value ? 52 : 64)
const plotRight = computed(() => compactLayout.value ? 12 : 24)
const plotTop = 18
const plotBottom = 48
const plotWidth = computed(() => Math.max(1, chartWidth.value - plotLeft.value - plotRight.value))
const plotHeight = chartHeight - plotTop - plotBottom

const outcomeRange = computed(() => valueRange(
  props.insight.matched.map((point) => point.outcomeValue),
  props.outcomeScaleMin,
  props.outcomeScaleMax,
))
const factorRange = computed(() => valueRange(
  props.insight.matched.map((point) => point.factorValue),
  props.factorScaleMin,
  props.factorScaleMax,
))
const plottedPoints = computed(() => props.insight.matched.map((point, index) => ({
  point,
  x: props.insight.mode === 'presence'
    ? presenceX(point, index)
    : xAt(point.factorValue),
  y: yAt(point.outcomeValue),
})))
const selectedPoint = computed(() => selectedIndex.value === undefined
  ? undefined
  : props.insight.matched[selectedIndex.value])
const ariaLabel = computed(() => props.insight.mode === 'presence'
  ? `${props.outcomeName} values grouped by whether ${props.factorName} was present or absent. Use left and right arrow keys to inspect paired days.`
  : `${props.outcomeName} plotted against ${props.factorName} for ${props.insight.matched.length} paired days. Use left and right arrow keys to inspect points.`)

function presenceX(point: TrackingRelationshipPoint, index: number) {
  const center = point.factorValue > 0 ? plotLeft.value + plotWidth.value * .72 : plotLeft.value + plotWidth.value * .28
  const jitter = ((index * 37) % 43 - 21) * .75
  return center + jitter
}

function xAt(value: number) {
  return plotLeft.value + (value - factorRange.value[0]) / (factorRange.value[1] - factorRange.value[0]) * plotWidth.value
}

function yAt(value: number) {
  const ratio = Math.max(0, Math.min(1, (value - outcomeRange.value[0]) / (outcomeRange.value[1] - outcomeRange.value[0])))
  return plotTop + plotHeight - ratio * plotHeight
}

function yTicks() {
  return [outcomeRange.value[1], (outcomeRange.value[0] + outcomeRange.value[1]) / 2, outcomeRange.value[0]]
}

function xTicks() {
  return [factorRange.value[0], (factorRange.value[0] + factorRange.value[1]) / 2, factorRange.value[1]]
}

function meanY(present: boolean) {
  const stats = present ? props.insight.comparison?.first : props.insight.comparison?.second
  return stats?.count ? yAt(stats.mean) : undefined
}

function trendLine() {
  const trend = props.insight.trend
  if (!trend?.hasVariation || trend.count < 2) return undefined
  const x1 = factorRange.value[0]
  const x2 = factorRange.value[1]
  return {
    x1: xAt(x1),
    y1: yAt(trend.intercept + trend.slope * x1),
    x2: xAt(x2),
    y2: yAt(trend.intercept + trend.slope * x2),
  }
}

function selectFromPointer(event: PointerEvent) {
  if (!plottedPoints.value.length) return
  const rect = (event.currentTarget as SVGElement).getBoundingClientRect()
  if (!rect.width || !rect.height) return
  const pointerX = (event.clientX - rect.left) / rect.width * chartWidth.value
  const pointerY = (event.clientY - rect.top) / rect.height * chartHeight
  const closest = plottedPoints.value.reduce(
    (best, candidate, index) => {
      const distance = (candidate.x - pointerX) ** 2 + (candidate.y - pointerY) ** 2
      return distance < best.distance ? { index, distance } : best
    },
    { index: 0, distance: Number.POSITIVE_INFINITY },
  )
  selectedIndex.value = closest.index
}

function clearPointerSelection(event: PointerEvent) {
  if (event.pointerType === 'mouse') selectedIndex.value = undefined
}

function onKeydown(event: KeyboardEvent) {
  const count = props.insight.matched.length
  if (!count || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  if (event.key === 'Home') selectedIndex.value = 0
  else if (event.key === 'End') selectedIndex.value = count - 1
  else if (event.key === 'ArrowLeft') selectedIndex.value = Math.max(0, (selectedIndex.value ?? count) - 1)
  else selectedIndex.value = Math.min(count - 1, (selectedIndex.value ?? -1) + 1)
}

function valueRange(values: number[], configuredMin?: number, configuredMax?: number): [number, number] {
  let min = configuredMin ?? (values.length ? Math.min(...values) : 0)
  let max = configuredMax ?? (values.length ? Math.max(...values) : 1)
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

function displayValue(value: number, unit: string) {
  return `${formatNumber(value)}${unit ? ` ${unit}` : ''}`
}
</script>

<template>
  <div
    ref="chartRoot"
    class="relationship-chart"
    :style="{ '--factor-color': factorColor, '--outcome-color': outcomeColor }"
    tabindex="0"
    role="img"
    :aria-label="ariaLabel"
    @keydown="onKeydown"
  >
    <div class="chart-readout" aria-live="polite">
      <template v-if="selectedPoint">
        <strong>{{ format(parseISO(selectedPoint.date), 'EEE, MMM d') }}</strong>
        <span>{{ factorName }}: {{ displayValue(selectedPoint.factorValue, factorUnit) }}</span>
        <span>{{ outcomeName }}: {{ displayValue(selectedPoint.outcomeValue, outcomeUnit) }}</span>
      </template>
      <span v-else>Tap, hover, or use arrow keys to inspect a paired day.</span>
    </div>

    <svg
      :viewBox="`0 0 ${chartWidth} ${chartHeight}`"
      aria-hidden="true"
      @pointerdown="selectFromPointer"
      @pointermove="selectFromPointer"
      @pointerleave="clearPointerSelection"
    >
      <g v-for="(tick, index) in yTicks()" :key="`y-${index}`">
        <line :x1="plotLeft" :x2="chartWidth - plotRight" :y1="plotTop + index * plotHeight / 2" :y2="plotTop + index * plotHeight / 2" class="grid-line" />
        <text :x="plotLeft - 8" :y="plotTop + index * plotHeight / 2 + 4" class="axis-value axis-value--outcome">{{ formatNumber(tick) }}</text>
      </g>

      <text :x="16" :y="plotTop + plotHeight / 2" class="axis-title axis-title--outcome axis-title--vertical" :transform="`rotate(-90 16 ${plotTop + plotHeight / 2})`">
        {{ outcomeName }}{{ outcomeUnit ? ` · ${outcomeUnit}` : '' }}
      </text>

      <template v-if="insight.mode === 'presence'">
        <line
          v-if="meanY(false) !== undefined"
          :x1="plotLeft + plotWidth * .18"
          :x2="plotLeft + plotWidth * .38"
          :y1="meanY(false)"
          :y2="meanY(false)"
          class="mean-line"
        />
        <line
          v-if="meanY(true) !== undefined"
          :x1="plotLeft + plotWidth * .62"
          :x2="plotLeft + plotWidth * .82"
          :y1="meanY(true)"
          :y2="meanY(true)"
          class="mean-line"
        />
        <text :x="plotLeft + plotWidth * .28" :y="chartHeight - 20" class="axis-category axis-category--factor">Absent · {{ insight.comparison?.second.count || 0 }}</text>
        <text :x="plotLeft + plotWidth * .72" :y="chartHeight - 20" class="axis-category axis-category--factor">Present · {{ insight.comparison?.first.count || 0 }}</text>
      </template>

      <template v-else>
        <line v-if="trendLine()" v-bind="trendLine()" class="trend-line" />
        <g v-for="(tick, index) in xTicks()" :key="`x-${index}`">
          <text
            :x="plotLeft + index * plotWidth / 2"
            :y="chartHeight - 25"
            class="axis-category axis-category--factor"
            :text-anchor="index === 0 ? 'start' : index === 2 ? 'end' : 'middle'"
          >{{ formatNumber(tick) }}</text>
        </g>
        <text :x="plotLeft + plotWidth / 2" :y="chartHeight - 5" class="axis-title axis-title--factor">
          {{ factorName }}{{ factorUnit ? ` · ${factorUnit}` : '' }}
        </text>
      </template>

      <circle
        v-for="(plotted, index) in plottedPoints"
        :key="plotted.point.date"
        :cx="plotted.x"
        :cy="plotted.y"
        :r="selectedIndex === index ? 7 : 5"
        :class="['relationship-dot', { 'relationship-dot--selected': selectedIndex === index }]"
      />
    </svg>

    <div class="chart-key">
      <span><i />Each dot is one date with both values</span>
      <span v-if="insight.mode === 'presence'"><b />Horizontal mark is the group mean</span>
      <span v-else-if="insight.trend?.hasVariation"><b />Line shows the observed linear trend</span>
    </div>
  </div>
</template>

<style scoped>
.relationship-chart {
  --factor-color: rgb(var(--v-theme-info));
  --outcome-color: rgb(var(--v-theme-secondary));
  --factor-contrast: color-mix(in srgb, var(--factor-color) 72%, rgb(var(--v-theme-on-surface)));
  --outcome-contrast: color-mix(in srgb, var(--outcome-color) 72%, rgb(var(--v-theme-on-surface)));

  outline: none;
}

.relationship-chart:focus-visible {
  border-radius: 1rem;
  outline: .125rem solid rgb(var(--v-theme-secondary) / .72);
  outline-offset: .25rem;
}

.chart-readout {
  display: flex;
  min-height: 2.75rem;
  align-items: center;
  gap: .75rem 1rem;
  flex-wrap: wrap;
  color: rgb(var(--v-theme-on-surface) / .76);
  font-size: .7rem;
}

.chart-readout strong { color: rgb(var(--v-theme-on-surface)); }
svg { display: block; width: 100%; height: auto; touch-action: pan-y; }
.grid-line { stroke: rgb(var(--v-theme-on-surface) / .18); stroke-width: 1; }
.axis-value,
.axis-category,
.axis-title { fill: rgb(var(--v-theme-on-surface) / .78); font-family: inherit; font-size: .6875rem; font-weight: 700; }
.axis-value { text-anchor: end; }
.axis-category,
.axis-title { text-anchor: middle; }
.axis-title { font-size: .75rem; font-weight: 850; }
.axis-value--outcome,
.axis-title--outcome { fill: var(--outcome-contrast); }
.axis-category--factor,
.axis-title--factor { fill: var(--factor-contrast); }
.relationship-dot { fill: var(--outcome-contrast); stroke: rgb(var(--v-theme-on-surface) / .88); stroke-width: 2.25; transition: r 160ms ease, stroke-width 160ms ease; }
.relationship-dot--selected { stroke: rgb(var(--v-theme-on-surface)); stroke-width: 4; }
.mean-line { stroke: var(--factor-contrast); stroke-width: 5; stroke-linecap: round; filter: drop-shadow(0 0 1px rgb(var(--v-theme-on-surface) / .8)); }
.trend-line { stroke: var(--factor-contrast); stroke-width: 3.5; stroke-dasharray: 8 6; stroke-linecap: round; filter: drop-shadow(0 0 1px rgb(var(--v-theme-on-surface) / .8)); }
.chart-key { display: flex; gap: .5rem 1rem; flex-wrap: wrap; color: rgb(var(--v-theme-on-surface) / .72); font-size: .68rem; }
.chart-key span { display: inline-flex; align-items: center; gap: .35rem; }
.chart-key i { width: .55rem; height: .55rem; border: 1px solid rgb(var(--v-theme-on-surface) / .8); border-radius: 50%; background: var(--outcome-contrast); }
.chart-key b { display: inline-block; width: .85rem; height: .2rem; border-radius: 999rem; background: var(--factor-contrast); box-shadow: 0 0 0 1px rgb(var(--v-theme-on-surface) / .54); }

@media (max-width: 30rem) {
  .chart-readout { align-items: flex-start; flex-direction: column; gap: .15rem; }
}

@media (prefers-reduced-motion: reduce) {
  .relationship-dot { transition: none; }
}
</style>
