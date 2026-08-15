import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

export const TRACKING_CHART_COLORS = ['#8FB8FF', '#C7F464'] as const
const MAX_TRACKING_CHART_ZOOM = 8

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

export function useScrollableTrackingChartWidth(
  dataKey: () => unknown,
) {
  const chartRoot = ref<HTMLElement>()
  const chartScroll = ref<HTMLElement>()
  const chartViewportWidth = ref(720)
  const zoomLevel = ref(1)
  let resizeObserver: ResizeObserver | undefined

  function updateChartViewportWidth() {
    const width = chartRoot.value?.clientWidth
    if (!width) return
    chartViewportWidth.value = Math.round(width)
  }

  onMounted(() => {
    updateChartViewportWidth()
    if (!chartRoot.value || typeof ResizeObserver === 'undefined') return
    resizeObserver = new ResizeObserver(updateChartViewportWidth)
    resizeObserver.observe(chartRoot.value)
  })

  onBeforeUnmount(() => {
    resizeObserver?.disconnect()
  })

  const chartWidth = computed(() => Math.max(
    chartViewportWidth.value,
    Math.round(chartViewportWidth.value * zoomLevel.value),
  ))
  const horizontallyScrollable = computed(() => chartWidth.value > chartViewportWidth.value)

  function zoomTo(nextZoom: number, anchorClientX?: number) {
    const boundedZoom = Math.min(MAX_TRACKING_CHART_ZOOM, Math.max(1, nextZoom))
    const clampedZoom = boundedZoom < 1.001 ? 1 : boundedZoom
    if (clampedZoom !== 1 && Math.abs(clampedZoom - zoomLevel.value) < .001) return false
    if (clampedZoom === zoomLevel.value) return false

    const scroll = chartScroll.value
    const oldWidth = chartWidth.value
    const anchor = scroll
      ? Math.min(scroll.clientWidth, Math.max(0, anchorClientX === undefined
        ? scroll.clientWidth / 2
        : anchorClientX - scroll.getBoundingClientRect().left))
      : 0
    const anchorRatio = scroll && oldWidth ? (scroll.scrollLeft + anchor) / oldWidth : .5

    zoomLevel.value = clampedZoom
    void nextTick(() => {
      if (!scroll) return
      scroll.scrollLeft = Math.max(0, anchorRatio * chartWidth.value - anchor)
    })
    return true
  }

  function zoomBy(factor: number, anchorClientX?: number) {
    return zoomTo(zoomLevel.value * factor, anchorClientX)
  }

  watch(dataKey, () => {
    zoomLevel.value = 1
    void nextTick(() => {
      if (chartScroll.value) chartScroll.value.scrollLeft = 0
    })
  }, { flush: 'post' })

  return { chartRoot, chartScroll, chartViewportWidth, chartWidth, horizontallyScrollable, zoomLevel, zoomBy, zoomTo }
}
