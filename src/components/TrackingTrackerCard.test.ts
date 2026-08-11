import { mount } from '@vue/test-utils'
import { vi } from 'vitest'
import TrackingTrackerCard from '@/components/TrackingTrackerCard.vue'
import type { TrackingEntry, TrackingTracker } from '@/types/domain'

const tracker: TrackingTracker = {
  id: 'meditation',
  name: 'Meditation',
  description: 'Daily practice',
  role: 'factor',
  kind: 'duration',
  category: 'mind',
  unit: 'minutes',
  scaleMin: 0,
  scaleMax: 0,
  favorableDirection: 'higher',
  dailyAggregation: 'sum',
  active: true,
  sortOrder: 0,
  color: '#C7F464',
  icon: 'mdi-meditation',
}

const entry: TrackingEntry = {
  id: 'entry-1',
  tracker: tracker.id,
  occurredAt: '2026-08-03T14:30:00.000Z',
  localDate: '2026-08-03',
  timezoneOffset: 240,
  value: 900,
  note: 'Felt settled',
}

describe('TrackingTrackerCard', () => {
  it('logs from the tracker header and opens actions from the menu without triggering parent controls', async () => {
    const wrapper = mount(TrackingTrackerCard, {
      props: { tracker, entries: [entry] },
      global: {
        stubs: {
          VBtn: { template: '<button><slot /></button>' },
          VCard: { template: '<div><slot /></div>' },
          VIcon: true,
          TrackingRatingValue: true,
        },
      },
    })

    await wrapper.get('.tracker-card__log').trigger('click')
    expect(wrapper.emitted('log')).toEqual([[tracker]])

    const cardClick = vi.fn()
    const cardTouchStart = vi.fn()
    wrapper.get('.tracker-card').element.addEventListener('click', cardClick)
    wrapper.get('.tracker-card').element.addEventListener('touchstart', cardTouchStart)

    await wrapper.get('.tracker-card__menu').trigger('touchstart')
    await wrapper.get('.tracker-card__menu').trigger('click')

    expect(wrapper.emitted('actions')).toEqual([[tracker]])
    expect(wrapper.emitted('log')).toHaveLength(1)
    expect(cardTouchStart).not.toHaveBeenCalled()
    expect(cardClick).not.toHaveBeenCalled()

    await wrapper.get('.tracker-entry').trigger('touchstart')
    await wrapper.get('.tracker-entry').trigger('click')

    expect(wrapper.get('.tracker-entry__note').element.parentElement)
      .toBe(wrapper.get('.tracker-entry').element)
    expect(wrapper.emitted('entry')).toEqual([[entry]])
    expect(wrapper.emitted('actions')).toHaveLength(1)
    expect(wrapper.emitted('log')).toHaveLength(1)
    expect(cardTouchStart).not.toHaveBeenCalled()
    expect(cardClick).not.toHaveBeenCalled()
  })

  it('aligns time and rating on the first row with the note as a separate row', () => {
    const wrapper = mount(TrackingTrackerCard, {
      props: {
        tracker: {
          ...tracker,
          kind: 'rating',
          scaleMin: 1,
          scaleMax: 5,
        },
        entries: [{ ...entry, value: 4 }],
      },
      global: {
        stubs: {
          VBtn: { template: '<button><slot /></button>' },
          VCard: { template: '<div><slot /></div>' },
          VIcon: true,
          TrackingRatingValue: true,
        },
      },
    })

    const row = wrapper.get('.tracker-entry').element
    expect(wrapper.get('.tracker-entry__time').element.parentElement).toBe(row)
    expect(wrapper.get('tracking-rating-value-stub').element.parentElement).toBe(row)
    expect(wrapper.get('.tracker-entry__note').element.parentElement).toBe(row)
  })

  it('shows an unlogged event as not occurred while keeping the card log action available', async () => {
    const eventTracker: TrackingTracker = {
      ...tracker,
      id: 'migraine',
      name: 'Migraine',
      kind: 'event',
      unit: 'times',
      dailyAggregation: 'count',
    }
    const wrapper = mount(TrackingTrackerCard, {
      props: { tracker: eventTracker, entries: [] },
      global: {
        stubs: {
          VBtn: { template: '<button><slot /></button>' },
          VCard: { template: '<div><slot /></div>' },
          VIcon: true,
        },
      },
    })

    expect(wrapper.get('.tracker-event-absence').text()).toContain('Not occurred')
    await wrapper.get('.tracker-card__log').trigger('click')
    expect(wrapper.emitted('log')).toEqual([[eventTracker]])
  })
})
