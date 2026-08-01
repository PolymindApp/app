import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import TrackingRatingValue from '@/components/TrackingRatingValue.vue'
import TrackingWeeklyBarChart from '@/components/TrackingWeeklyBarChart.vue'
import type { TrackingEntry, TrackingTracker } from '@/types/domain'

const VRatingStub = defineComponent({
  props: { modelValue: Number },
  template: '<div class="v-rating-stub" />',
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
    reminderEnabled: false,
    reminderTime: '20:00',
    reminderShowName: false,
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
  it('groups each tracker by day and exposes the aggregated values', async () => {
    const wrapper = mount(TrackingWeeklyBarChart, {
      props: {
        weekStart: new Date(2026, 6, 27, 12),
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
      global: { stubs: { VRating: VRatingStub } },
    })

    expect(wrapper.find('.chart-legend').text()).toContain('Meditation')
    expect(wrapper.find('.chart-legend').text()).toContain('Mood')

    await wrapper.find('.chart-plot').trigger('keydown', { key: 'ArrowRight' })

    expect(wrapper.find('.chart-readout').text()).toContain('Monday, Jul 27')
    expect(wrapper.find('.chart-readout').text()).toContain('Meditation:')
    expect(wrapper.find('.chart-readout').text()).toContain('2 times')
    expect(wrapper.findComponent(TrackingRatingValue).props('value')).toBe(7)
  })

  it('shows a weekly empty state when there are no entries in range', () => {
    const wrapper = mount(TrackingWeeklyBarChart, {
      props: {
        weekStart: new Date(2026, 6, 27, 12),
        trackers: [tracker({})],
        entries: [],
      },
      global: { stubs: { VIcon: true, VRating: VRatingStub } },
    })

    expect(wrapper.find('.weekly-chart-empty').text()).toContain('No entries logged in this week.')
  })
})
