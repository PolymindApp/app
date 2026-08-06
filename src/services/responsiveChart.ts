import { onBeforeUnmount, onMounted, ref } from 'vue'

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
