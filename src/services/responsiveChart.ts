import { onBeforeUnmount, onMounted, ref } from 'vue'

export const TRACKING_CHART_COLORS = ['#8FB8FF', '#C7F464'] as const

export function formatTrackingAxisTick(value: number) {
  const rounded = Math.ceil(value)
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(rounded === 0 ? 0 : rounded)
}

export function trackingAxisGutter(values: number[], minimum: number, padding = 16) {
  const longestLabel = values.reduce(
    (longest, value) => Math.max(longest, formatTrackingAxisTick(value).length),
    1,
  )
  return Math.max(minimum, longestLabel * 7 + padding)
}

export function useResponsiveChartWidth(maxWidth = 720) {
  const chartRoot = ref<HTMLElement>()
  const chartWidth = ref(maxWidth)
  let resizeObserver: ResizeObserver | undefined

  function updateChartWidth() {
    const width = chartRoot.value?.clientWidth
    if (!width) return
    chartWidth.value = Math.min(maxWidth, Math.round(width))
  }

  onMounted(() => {
    updateChartWidth()
    if (!chartRoot.value || typeof ResizeObserver === 'undefined') return
    resizeObserver = new ResizeObserver(updateChartWidth)
    resizeObserver.observe(chartRoot.value)
  })

  onBeforeUnmount(() => {
    resizeObserver?.disconnect()
  })

  return { chartRoot, chartWidth }
}
