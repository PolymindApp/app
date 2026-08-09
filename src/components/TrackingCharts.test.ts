import { mount } from '@vue/test-utils'
import TrackingRelationshipChart from '@/components/TrackingRelationshipChart.vue'
import TrackingTimelineChart from '@/components/TrackingTimelineChart.vue'
import { TRACKING_CHART_COLORS } from '@/services/responsiveChart'
import type { TrackingInsightResult } from '@/services/tracking'

const timelineProps = {
  factorName: 'Exercise',
  factorUnit: 'minutes',
  outcomeName: 'Energy',
  outcomeUnit: '/ 10',
}

function timelinePoints(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    date: `2026-07-${String(index + 1).padStart(2, '0')}`,
    factorValue: index + 1,
    outcomeValue: index + 2,
  }))
}

describe('TrackingTimelineChart', () => {
  it('uses distinct predetermined colors for factor and outcome series', () => {
    const wrapper = mount(TrackingTimelineChart, {
      props: {
        ...timelineProps,
        points: [
          { date: '2026-07-01', factorValue: 20, outcomeValue: 5 },
          { date: '2026-07-02', factorValue: 30, outcomeValue: 6 },
        ],
      },
    })
    const style = (wrapper.element as HTMLElement).style

    expect(new Set(TRACKING_CHART_COLORS).size).toBe(TRACKING_CHART_COLORS.length)
    expect(style.getPropertyValue('--factor-color')).toBe(TRACKING_CHART_COLORS[0])
    expect(style.getPropertyValue('--outcome-color')).toBe(TRACKING_CHART_COLORS[1])
  })

  it('uses the rendered mobile width so chart labels do not scale down from a desktop canvas', async () => {
    let resize = () => undefined
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resize = callback }
      observe() {}
      disconnect() {}
    })
    const wrapper = mount(TrackingTimelineChart, {
      props: {
        ...timelineProps,
        points: [
          { date: '2026-07-01', factorValue: 20, outcomeValue: 5 },
          { date: '2026-07-02', factorValue: 30, outcomeValue: 6 },
        ],
      },
    })
    Object.defineProperty(wrapper.element, 'clientWidth', { configurable: true, value: 320 })
    resize()
    await wrapper.vm.$nextTick()

    expect(wrapper.find('svg').attributes('viewBox')).toBe('0 0 320 294')
    expect(wrapper.find('.axis-line--outcome').attributes('x1')).toBe('276')

    wrapper.unmount()
    vi.unstubAllGlobals()
  })

  it('shows seven days per mobile viewport and scrolls longer ranges horizontally', async () => {
    let resize = () => undefined
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })))
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resize = callback }
      observe() {}
      disconnect() {}
    })
    const wrapper = mount(TrackingTimelineChart, {
      props: { ...timelineProps, points: timelinePoints(14) },
    })
    Object.defineProperty(wrapper.element, 'clientWidth', { configurable: true, value: 320 })
    resize()
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.chart-scroll--active').exists()).toBe(true)
    expect(wrapper.find('svg').attributes('viewBox')).toBe('0 0 640 294')
    expect(wrapper.find('svg').attributes('style')).toContain('width: 640px')
    expect(wrapper.findAll('.axis-date')).toHaveLength(14)

    wrapper.unmount()
    vi.unstubAllGlobals()
  })

  it('keeps longer ranges fitted to the chart on desktop', async () => {
    let resize = () => undefined
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })))
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resize = callback }
      observe() {}
      disconnect() {}
    })
    const wrapper = mount(TrackingTimelineChart, {
      props: { ...timelineProps, points: timelinePoints(14) },
    })
    Object.defineProperty(wrapper.element, 'clientWidth', { configurable: true, value: 640 })
    resize()
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.chart-scroll--active').exists()).toBe(false)
    expect(wrapper.find('svg').attributes('viewBox')).toBe('0 0 640 294')
    expect(wrapper.find('svg').attributes('style')).toBeUndefined()

    wrapper.unmount()
    vi.unstubAllGlobals()
  })

  it('draws gaps for missing values and exposes keyboard date inspection', async () => {
    const wrapper = mount(TrackingTimelineChart, {
      props: {
        ...timelineProps,
        points: [
          { date: '2026-07-01', factorValue: 20, outcomeValue: 5 },
          { date: '2026-07-02', factorValue: null, outcomeValue: 6 },
          { date: '2026-07-03', factorValue: 40, outcomeValue: null },
        ],
      },
    })

    const factorPath = wrapper.find('.series-line--factor').attributes('d')
    const outcomePath = wrapper.find('.series-line--outcome').attributes('d')
    expect(wrapper.findAll('.series-line')).toHaveLength(2)
    expect(wrapper.find('.series-line--outline').exists()).toBe(false)
    expect(factorPath.match(/M/g)).toHaveLength(2)
    expect(wrapper.findAll('.series-dot--factor').filter((dot) => dot.isVisible())).toHaveLength(2)
    expect(wrapper.findAll('.axis-value--outcome')).toHaveLength(3)
    expect(wrapper.find('.axis-label--outcome').text()).toContain('Energy')

    const factorStartY = Number(factorPath.match(/^M[^,]+,([\d.]+)/)?.[1])
    const outcomeStartY = Number(outcomePath.match(/^M[^,]+,([\d.]+)/)?.[1])
    expect(factorStartY).toBeCloseTo(outcomeStartY)

    await wrapper.trigger('keydown', { key: 'ArrowRight' })
    expect(wrapper.find('.chart-readout').text()).toContain('Wed, Jul 1')
    expect(wrapper.find('.chart-readout').text()).toContain('Exercise: 20 minutes')
  })

  it('rounds large axis values up and expands both axis gutters', async () => {
    let resize = () => undefined
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resize = callback }
      observe() {}
      disconnect() {}
    })
    const wrapper = mount(TrackingTimelineChart, {
      props: {
        ...timelineProps,
        factorScaleMin: 0,
        factorScaleMax: 2689.2,
        outcomeScaleMin: 0,
        outcomeScaleMax: 2689.2,
        points: [
          { date: '2026-07-01', factorValue: 1000, outcomeValue: 1200 },
          { date: '2026-07-02', factorValue: 2689.2, outcomeValue: 2689.2 },
        ],
      },
    })
    Object.defineProperty(wrapper.element, 'clientWidth', { configurable: true, value: 320 })
    resize()
    await wrapper.vm.$nextTick()

    expect(wrapper.findAll('.axis-value--factor').map(label => label.text())).toEqual(['2,690', '1,345', '0'])
    expect(wrapper.findAll('.axis-value--outcome').map(label => label.text())).toEqual(['2,690', '1,345', '0'])
    expect(wrapper.find('.axis-line--factor').attributes('x1')).toBe('51')
    expect(wrapper.find('.axis-line--outcome').attributes('x1')).toBe('269')

    wrapper.unmount()
    vi.unstubAllGlobals()
  })
})

describe('TrackingRelationshipChart', () => {
  it('uses the same predetermined factor and outcome colors as the timeline', () => {
    const insight: TrackingInsightResult = {
      points: [],
      matched: [
        { date: '2026-07-01', factorValue: 10, outcomeValue: 4 },
        { date: '2026-07-02', factorValue: 20, outcomeValue: 6 },
      ],
      mode: 'quantity',
      ready: false,
      earlySignal: false,
      direction: 'mixed',
      summary: '',
      caution: '',
      trend: { count: 2, slope: .2, intercept: 2, correlation: 1, hasVariation: true },
    }
    const wrapper = mount(TrackingRelationshipChart, {
      props: { ...timelineProps, insight },
    })
    const style = (wrapper.element as HTMLElement).style

    expect(style.getPropertyValue('--factor-color')).toBe(TRACKING_CHART_COLORS[0])
    expect(style.getPropertyValue('--outcome-color')).toBe(TRACKING_CHART_COLORS[1])
  })

  it('keeps a full-height plot with mobile-width coordinates', async () => {
    let resize = () => undefined
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resize = callback }
      observe() {}
      disconnect() {}
    })
    const insight: TrackingInsightResult = {
      points: [],
      matched: [
        { date: '2026-07-01', factorValue: 10, outcomeValue: 4 },
        { date: '2026-07-02', factorValue: 20, outcomeValue: 6 },
      ],
      mode: 'quantity',
      ready: false,
      earlySignal: false,
      direction: 'mixed',
      summary: '',
      caution: '',
      trend: { count: 2, slope: .2, intercept: 2, correlation: 1, hasVariation: true },
    }
    const wrapper = mount(TrackingRelationshipChart, {
      props: { ...timelineProps, insight },
    })
    Object.defineProperty(wrapper.element, 'clientWidth', { configurable: true, value: 320 })
    resize()
    await wrapper.vm.$nextTick()

    expect(wrapper.find('svg').attributes('viewBox')).toBe('0 0 320 300')
    expect(wrapper.find('.grid-line').attributes('x2')).toBe('308')

    wrapper.unmount()
    vi.unstubAllGlobals()
  })

  it('uses the selected date count for a seven-day mobile scroll viewport', async () => {
    let resize = () => undefined
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })))
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resize = callback }
      observe() {}
      disconnect() {}
    })
    const insight: TrackingInsightResult = {
      points: timelinePoints(14),
      matched: [
        { date: '2026-07-01', factorValue: 10, outcomeValue: 4 },
        { date: '2026-07-14', factorValue: 20, outcomeValue: 6 },
      ],
      mode: 'quantity',
      ready: false,
      earlySignal: false,
      direction: 'mixed',
      summary: '',
      caution: '',
      trend: { count: 2, slope: .2, intercept: 2, correlation: 1, hasVariation: true },
    }
    const wrapper = mount(TrackingRelationshipChart, {
      props: { ...timelineProps, insight },
    })
    Object.defineProperty(wrapper.element, 'clientWidth', { configurable: true, value: 320 })
    resize()
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.chart-scroll--active').exists()).toBe(true)
    expect(wrapper.find('svg').attributes('viewBox')).toBe('0 0 640 300')
    expect(wrapper.find('svg').attributes('style')).toContain('width: 640px')

    wrapper.unmount()
    vi.unstubAllGlobals()
  })

  it('rounds large y-axis values up and leaves room for the complete labels', () => {
    const insight: TrackingInsightResult = {
      points: [],
      matched: [
        { date: '2026-07-01', factorValue: 10, outcomeValue: 1000 },
        { date: '2026-07-02', factorValue: 20, outcomeValue: 2689.2 },
      ],
      mode: 'quantity',
      ready: false,
      earlySignal: false,
      direction: 'mixed',
      summary: '',
      caution: '',
      trend: { count: 2, slope: 168.92, intercept: -689.2, correlation: 1, hasVariation: true },
    }
    const wrapper = mount(TrackingRelationshipChart, {
      props: {
        ...timelineProps,
        insight,
        outcomeScaleMin: 0,
        outcomeScaleMax: 2689.2,
      },
    })

    expect(wrapper.findAll('.axis-value--outcome').map(label => label.text())).toEqual(['2,690', '1,345', '0'])
    expect(wrapper.find('.grid-line').attributes('x1')).toBe('67')
  })

  it('renders actual factor amounts and a quantitative trend line', () => {
    const insight: TrackingInsightResult = {
      points: [],
      matched: [
        { date: '2026-07-01', factorValue: 10, outcomeValue: 4 },
        { date: '2026-07-02', factorValue: 20, outcomeValue: 6 },
        { date: '2026-07-03', factorValue: 30, outcomeValue: 8 },
      ],
      mode: 'quantity',
      ready: false,
      earlySignal: false,
      direction: 'mixed',
      summary: '',
      caution: '',
      trend: { count: 3, slope: .2, intercept: 2, correlation: 1, hasVariation: true },
    }
    const wrapper = mount(TrackingRelationshipChart, {
      props: { ...timelineProps, insight },
    })

    expect(wrapper.findAll('.relationship-dot')).toHaveLength(3)
    expect(wrapper.find('.trend-line').exists()).toBe(true)
    expect(wrapper.find('.axis-title--outcome').text()).toContain('Energy')
    expect(wrapper.find('.axis-title--factor').text()).toContain('Exercise')
    expect(wrapper.text()).toContain('Line shows the observed linear trend')
  })

  it('renders present and absent distributions with mean markers', () => {
    const insight: TrackingInsightResult = {
      points: [],
      matched: [
        { date: '2026-07-01', factorValue: 0, outcomeValue: 4 },
        { date: '2026-07-02', factorValue: 1, outcomeValue: 8 },
      ],
      mode: 'presence',
      ready: false,
      earlySignal: false,
      direction: 'mixed',
      summary: '',
      caution: '',
      comparison: {
        ready: false,
        earlySignal: false,
        first: { label: 'Factor present', count: 1, mean: 8, median: 8 },
        second: { label: 'Factor absent', count: 1, mean: 4, median: 4 },
        absoluteDifference: 4,
        direction: 'mixed',
        summary: '',
        caution: '',
      },
    }
    const wrapper = mount(TrackingRelationshipChart, {
      props: { ...timelineProps, insight },
    })

    expect(wrapper.findAll('.mean-line')).toHaveLength(2)
    expect(wrapper.findAll('.axis-category--factor')).toHaveLength(2)
    expect(wrapper.text()).toContain('Absent · 1')
    expect(wrapper.text()).toContain('Present · 1')
  })
})
