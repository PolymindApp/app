import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

export const TRACKING_CHART_COLORS = ['#8FB8FF', '#C7F464'] as const
export const MOBILE_TRACKING_CHART_DAYS = 7
const MOBILE_TRACKING_CHART_QUERY = '(max-width: 59.99875rem)'

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
  dayCount: () => number,
  dataKey: () => unknown,
  maxWidth = 720,
) {
  const chartRoot = ref<HTMLElement>()
  const chartScroll = ref<HTMLElement>()
  const chartViewportWidth = ref(maxWidth)
  const mobileViewport = ref(false)
  let resizeObserver: ResizeObserver | undefined
  let mobileQuery: MediaQueryList | undefined

  function updateChartViewportWidth() {
    const width = chartRoot.value?.clientWidth
    if (!width) return
    chartViewportWidth.value = Math.round(width)
  }

  function updateMobileViewport() {
    mobileViewport.value = mobileQuery?.matches || false
  }

  onMounted(() => {
    updateChartViewportWidth()
    if (typeof window.matchMedia === 'function') {
      mobileQuery = window.matchMedia(MOBILE_TRACKING_CHART_QUERY)
      updateMobileViewport()
      mobileQuery.addEventListener('change', updateMobileViewport)
    }
    if (!chartRoot.value || typeof ResizeObserver === 'undefined') return
    resizeObserver = new ResizeObserver(updateChartViewportWidth)
    resizeObserver.observe(chartRoot.value)
  })

  onBeforeUnmount(() => {
    resizeObserver?.disconnect()
    mobileQuery?.removeEventListener('change', updateMobileViewport)
  })

  const horizontallyScrollable = computed(() =>
    mobileViewport.value && dayCount() > MOBILE_TRACKING_CHART_DAYS,
  )
  const chartWidth = computed(() => horizontallyScrollable.value
    ? Math.round(chartViewportWidth.value * dayCount() / MOBILE_TRACKING_CHART_DAYS)
    : Math.min(maxWidth, chartViewportWidth.value),
  )

  watch([horizontallyScrollable, dataKey], ([canScroll]) => {
    if (!canScroll || !chartScroll.value) return
    chartScroll.value.scrollLeft = Math.max(
      0,
      chartScroll.value.scrollWidth - chartScroll.value.clientWidth,
    )
  }, { flush: 'post', immediate: true })

  return { chartRoot, chartScroll, chartViewportWidth, chartWidth, horizontallyScrollable }
}
