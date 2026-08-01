import { mount } from '@vue/test-utils'
import TrackingRelationshipChart from '@/components/TrackingRelationshipChart.vue'
import TrackingTimelineChart from '@/components/TrackingTimelineChart.vue'
import type { TrackingInsightResult } from '@/services/tracking'

const timelineProps = {
  factorName: 'Exercise',
  factorUnit: 'minutes',
  factorColor: '#8FB8FF',
  outcomeName: 'Energy',
  outcomeUnit: '/ 10',
  outcomeColor: '#C7F464',
}

describe('TrackingTimelineChart', () => {
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
    expect(factorPath.match(/M/g)).toHaveLength(2)
    expect(wrapper.findAll('.series-dot--factor').filter((dot) => dot.isVisible())).toHaveLength(2)

    await wrapper.trigger('keydown', { key: 'ArrowRight' })
    expect(wrapper.find('.chart-readout').text()).toContain('Wed, Jul 1')
    expect(wrapper.find('.chart-readout').text()).toContain('Exercise: 20 minutes')
  })
})

describe('TrackingRelationshipChart', () => {
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
    expect(wrapper.text()).toContain('Absent · 1')
    expect(wrapper.text()).toContain('Present · 1')
  })
})
