import { defineComponent } from 'vue'
import { config, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import TrackingWeeklyBarChart from '@/components/TrackingWeeklyBarChart.vue'
import type { TrackingEntry, TrackingTracker } from '@/types/domain'

const VProgressLinearStub = defineComponent({
  props: { modelValue: Number },
  template: '<div class="v-progress-linear-stub" />',
})
const VBtnStub = defineComponent({
  props: { size: String, variant: String },
  template: '<button v-bind="$attrs"><slot /></button>',
})

config.global.stubs.VBtn = VBtnStub

beforeEach(() => {
  localStorage.clear()
})

function tracker(overrides: Partial<TrackingTracker>): TrackingTracker {
  return {
    id: 'tracker',
    name: 'Tracker',
    description: '',
    role: 'factor',
    kind: 'event',
    category: 'other',
    unit: '',
    scaleMin: 0,
    scaleMax: 0,
    favorableDirection: 'neutral',
    dailyAggregation: 'count',
    active: true,
    sortOrder: 0,
    color: '#C7F464',
    icon: 'mdi-circle',
    ...overrides,
  }
}

function entry(id: string, trackerId: string, date: string, value: number): TrackingEntry {
  return {
    id,
    tracker: trackerId,
    occurredAt: `${date}T12:00:00.000Z`,
    localDate: date,
    timezoneOffset: 0,
    value,
    note: '',
  }
}

describe('TrackingWeeklyBarChart', () => {
  it('uses the rendered mobile width so chart labels match the insights charts', async () => {
    let resize = () => undefined
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resize = callback }
      observe() {}
      disconnect() {}
    })
    const wrapper = mount(TrackingWeeklyBarChart, {
      props: {
        weekStart: new Date(2026, 6, 27, 12),
        selectedDate: new Date(2026, 6, 27, 12),
        trackers: [tracker({})],
        entries: [entry('one', 'tracker', '2026-07-27', 1)],
      },
    })
    Object.defineProperty(wrapper.element, 'clientWidth', { configurable: true, value: 320 })
    resize()
    await wrapper.vm.$nextTick()

    expect(wrapper.find('svg').attributes('viewBox')).toBe('0 0 320 125')

    wrapper.unmount()
    vi.unstubAllGlobals()
  })

  it('groups each tracker by day and exposes the aggregated values', async () => {
    const wrapper = mount(TrackingWeeklyBarChart, {
      props: {
        weekStart: new Date(2026, 6, 27, 12),
        selectedDate: new Date(2026, 6, 27, 12),
        trackers: [
          tracker({ id: 'meditation', name: 'Meditation' }),
          tracker({
            id: 'mood',
            name: 'Mood',
            role: 'outcome',
            kind: 'rating',
            unit: '/ 10',
            scaleMin: 1,
            scaleMax: 10,
            dailyAggregation: 'average',
            sortOrder: 1,
            color: '#D4A5FF',
          }),
        ],
        entries: [
          entry('one', 'meditation', '2026-07-27', 1),
          entry('two', 'meditation', '2026-07-27', 1),
          entry('three', 'mood', '2026-07-27', 6),
          entry('four', 'mood', '2026-07-27', 8),
          entry('outside', 'meditation', '2026-07-20', 1),
        ],
      },
      global: { stubs: { VProgressLinear: VProgressLinearStub } },
    })

    expect(wrapper.find('.chart-legend').text()).toContain('Meditation')
    expect(wrapper.find('.chart-legend').text()).toContain('Mood')
    expect(wrapper.find('.chart-readout').exists()).toBe(false)
    expect(wrapper.find('.chart-legend').text()).toContain('Meditation (2 times)')
    expect(wrapper.find('.chart-legend').text()).toContain('Mood (7/10)')
    expect(wrapper.findAll('.chart-plot, .chart-legend')[0]?.classes()).toContain('chart-plot')
    expect(wrapper.findAll('.chart-plot, .chart-legend')[1]?.classes()).toContain('chart-legend')
    expect(wrapper.find('.selected-day').exists()).toBe(true)
    expect(wrapper.find('.chart-legend').attributes('aria-label')).toContain('Monday, July 27')

    await wrapper.find('.chart-plot').trigger('keydown', { key: 'ArrowRight' })

    expect(wrapper.find('.chart-legend').attributes('aria-label')).toContain('Tuesday, July 28')
    expect(wrapper.find('.chart-legend').text()).not.toContain('()')
    expect(wrapper.findAll('.chart-legend__item').map(item => item.text())).toEqual(['Meditation', 'Mood'])
  })

  it('starts with every tracker enabled and toggles chart series from the legend', async () => {
    const wrapper = mount(TrackingWeeklyBarChart, {
      props: {
        weekStart: new Date(2026, 6, 27, 12),
        selectedDate: new Date(2026, 6, 27, 12),
        trackers: [
          tracker({ id: 'meditation', name: 'Meditation' }),
          tracker({ id: 'mood', name: 'Mood', kind: 'rating', scaleMax: 10, sortOrder: 1 }),
        ],
        entries: [
          entry('one', 'meditation', '2026-07-27', 1),
          entry('two', 'mood', '2026-07-27', 7),
        ],
      },
    })

    const legendItems = wrapper.findAll('.chart-legend__item')
    expect(legendItems.map(item => item.attributes('aria-pressed'))).toEqual(['true', 'true'])
    expect(wrapper.findAll('.chart-bar').filter(bar => bar.isVisible())).toHaveLength(8)

    await legendItems[0]!.trigger('click')

    expect(legendItems[0]!.attributes('aria-pressed')).toBe('false')
    expect(legendItems[0]!.classes()).toContain('chart-legend__item--inactive')
    expect(wrapper.findAll('.chart-bar').filter(bar => bar.isVisible())).toHaveLength(1)

    await legendItems[0]!.trigger('click')

    expect(legendItems[0]!.attributes('aria-pressed')).toBe('true')
    expect(wrapper.findAll('.chart-bar').filter(bar => bar.isVisible())).toHaveLength(8)
  })

  it('restores inactive legends and remembers subsequent changes', async () => {
    localStorage.setItem(
      'backontrack-tracking-chart-inactive-trackers',
      JSON.stringify(['meditation']),
    )
    const wrapper = mount(TrackingWeeklyBarChart, {
      props: {
        weekStart: new Date(2026, 6, 27, 12),
        selectedDate: new Date(2026, 6, 27, 12),
        trackers: [
          tracker({ id: 'meditation', name: 'Meditation' }),
          tracker({ id: 'mood', name: 'Mood', kind: 'rating', scaleMax: 10, sortOrder: 1 }),
        ],
        entries: [
          entry('one', 'meditation', '2026-07-27', 1),
          entry('two', 'mood', '2026-07-27', 7),
        ],
      },
    })

    const legendItems = wrapper.findAll('.chart-legend__item')
    expect(legendItems.map(item => item.attributes('aria-pressed'))).toEqual(['false', 'true'])

    await legendItems[1]!.trigger('click')

    expect(JSON.parse(localStorage.getItem('backontrack-tracking-chart-inactive-trackers') || '[]'))
      .toEqual(['meditation', 'mood'])
  })

  it('shows unlogged event days as not occurred', () => {
    const wrapper = mount(TrackingWeeklyBarChart, {
      props: {
        weekStart: new Date(2026, 6, 27, 12),
        selectedDate: new Date(2026, 6, 27, 12),
        trackers: [tracker({ id: 'migraine', name: 'Migraine' })],
        entries: [],
      },
      global: { stubs: { VProgressLinear: VProgressLinearStub } },
    })

    expect(wrapper.find('.weekly-chart-empty').exists()).toBe(false)
    expect(wrapper.find('.chart-legend__item').text()).toBe('Migraine')
    expect(wrapper.findAll('.chart-bar')).toHaveLength(7)
  })

  it('shows a weekly empty state when there are no entries in range', () => {
    const wrapper = mount(TrackingWeeklyBarChart, {
      props: {
        weekStart: new Date(2026, 6, 27, 12),
        selectedDate: new Date(2026, 6, 27, 12),
        trackers: [tracker({ kind: 'rating', scaleMin: 1, scaleMax: 10, dailyAggregation: 'average' })],
        entries: [],
      },
      global: { stubs: { VIcon: true, VProgressLinear: VProgressLinearStub } },
    })

    expect(wrapper.find('.weekly-chart-empty').text()).toContain('No entries logged in this week.')
  })
})
