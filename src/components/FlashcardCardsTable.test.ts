import { h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import FlashcardCardsTable from '@/components/FlashcardCardsTable.vue'
import type { Flashcard } from '@/types/domain'

const platform = vi.hoisted(() => ({ value: 'web' }))
const display = vi.hoisted(() => ({ smAndDown: false }))

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => platform.value,
  },
}))

vi.mock('vuetify', async () => {
  const { computed } = await import('vue')
  return {
    useDisplay: () => ({ smAndDown: computed(() => display.smAndDown) }),
  }
})

vi.mock('vuetify/directives', () => ({
  Intersect: {
    mounted: (element: HTMLElement, binding: { value: { handler: (intersecting: boolean) => void } }) => {
      Object.assign(element, {
        triggerIntersection: () => binding.value.handler(true),
      })
    },
    updated: (element: HTMLElement, binding: { value: { handler: (intersecting: boolean) => void } }) => {
      Object.assign(element, {
        triggerIntersection: () => binding.value.handler(true),
      })
    },
  },
  Ripple: {
    mounted: (element: HTMLElement) => {
      const container = document.createElement('span')
      container.className = 'v-ripple__container'
      element.append(container)
    },
  },
}))

function card(index: number): Flashcard {
  return {
    id: `card-${index}`,
    front: `Front ${index}`,
    back: `Back ${index}`,
    note: '',
    tags: index % 2 ? ['tag-1'] : [],
    createdAt: '2026-08-07T12:00:00.000Z',
    updatedAt: '2026-08-07T12:00:00.000Z',
    passiveViews: 0,
    successCount: 0,
    errorCount: 0,
  }
}

function mountTable(cards: Flashcard[], slots: Record<string, any> = {}) {
  return mount(FlashcardCardsTable, {
    props: {
      cards,
      tags: [{ id: 'tag-1', name: 'Vocabulary' }],
      modelValue: [],
    },
    slots,
    global: {
      stubs: {
        ExpandTransition: { template: '<div><slot /></div>' },
        VAlert: { template: '<div><slot /></div>' },
        VBtn: { template: '<button><slot /></button>' },
        VCheckboxBtn: {
          props: ['modelValue'],
          emits: ['update:modelValue'],
          template: '<button class="checkbox-stub" @click="$emit(\'update:modelValue\', !modelValue)" />',
        },
        VExpandTransition: { template: '<div><slot /></div>' },
        VIcon: true,
        VPagination: { template: '<nav class="pagination-stub" />' },
        VProgressCircular: true,
        VTable: { template: '<table><slot /></table>' },
      },
    },
  })
}

describe('FlashcardCardsTable', () => {
  beforeEach(() => {
    platform.value = 'web'
    display.smAndDown = false
  })

  it('keeps ten-row pagination on desktop and emits the opened card', async () => {
    const cards = Array.from({ length: 25 }, (_, index) => card(index + 1))
    const wrapper = mountTable(cards)

    expect(wrapper.findAll('tbody tr')).toHaveLength(10)
    expect(wrapper.find('.pagination-stub').exists()).toBe(true)
    expect(wrapper.findAll('.card-library-table__row-ripple')).toHaveLength(10)
    expect(wrapper.findAll('.v-ripple__container')).toHaveLength(10)
    expect(wrapper.findAll('.v-ripple__container').every(item => item.element.parentElement?.classList.contains('card-library-table__row-ripple')))
      .toBe(true)
    expect(wrapper.findAll('tbody tr').every(row => [...row.element.children].every(child => child.tagName === 'TD')))
      .toBe(true)

    await wrapper.get('.card-library-table__row-ripple').trigger('click')
    expect(wrapper.emitted('open-card')).toEqual([[cards[0]]])
  })

  it('shows a compact card action cell by default', () => {
    const cards = [card(1), card(2)]
    const wrapper = mountTable(cards)

    expect(wrapper.findAll('thead th').map(heading => heading.text())).toEqual([
      '',
      'Card',
      'Faces',
      'Tags',
      'Notes',
    ])
    expect(wrapper.findAll('.card-library-table__action-cell')).toHaveLength(2)
  })

  it('provides a focusable horizontal scroll region for every table column', () => {
    const wrapper = mountTable([card(1)])
    const scrollRegion = wrapper.get('.card-library-scroll')

    expect(scrollRegion.attributes('role')).toBe('region')
    expect(scrollRegion.attributes('aria-label')).toBe('Flashcard table')
    expect(scrollRegion.attributes('tabindex')).toBe('0')
    expect(scrollRegion.find('.card-library-header').exists()).toBe(false)
    expect(wrapper.get('.card-library-header').element.nextElementSibling)
      .toBe(scrollRegion.element)
    expect(scrollRegion.findAll('thead th').map(heading => heading.text())).toEqual([
      '',
      'Card',
      'Faces',
      'Tags',
      'Notes',
    ])
  })

  it('keeps the sticky header aligned while the table scrolls horizontally', async () => {
    const wrapper = mountTable([card(1)])
    const scrollRegion = wrapper.get('.card-library-scroll')
    const headerTrack = wrapper.get('.card-library-header__track')

    expect(headerTrack.attributes('style')).toContain('translateX(-0px)')
    scrollRegion.element.scrollLeft = 144
    await scrollRegion.trigger('scroll')

    expect(headerTrack.attributes('style')).toContain('translateX(-144px)')
  })

  it('allows the final column to represent Review set inclusion instead of tags', () => {
    const wrapper = mountTable([card(1), card(2)], {
      'last-column-heading': 'Included?',
      'last-column': ({ card: item }: { card: Flashcard }) => h(
        'span',
        { class: 'included-state' },
        item.id === 'card-1' ? 'Included' : 'Excluded',
      ),
    })

    expect(wrapper.findAll('thead th').at(-2)?.text()).toBe('Included?')
    expect(wrapper.findAll('thead th').at(-1)?.text()).toBe('Notes')
    expect(wrapper.findAll('.included-state').map(state => state.text()))
      .toEqual(['Included', 'Excluded'])
    expect(wrapper.text()).not.toContain('Vocabulary')
  })

  it('supports visually hidden Review set column headings', () => {
    const wrapper = mountTable([card(1)], {
      'action-column-heading': () => h('span', { class: 'd-sr-only' }, 'Card action'),
      'last-column-heading': () => h('span', { class: 'd-sr-only' }, 'Included?'),
    })

    const headings = wrapper.findAll('thead th')
    expect(headings[1]?.get('.d-sr-only').text()).toBe('Card action')
    expect(headings.at(-2)?.get('.d-sr-only').text()).toBe('Included?')
    expect(headings.at(-1)?.text()).toBe('Notes')
  })

  it('toggles selection from the selection cell without opening the card', async () => {
    const cards = [card(1)]
    const wrapper = mountTable(cards)

    await wrapper.get('tbody .card-library-table__select').trigger('click')

    expect(wrapper.emitted('update:modelValue')).toEqual([[['card-1']]])
    expect(wrapper.emitted('open-card')).toBeUndefined()
  })

  it('loads cards incrementally on Android without rendering pagination', async () => {
    platform.value = 'android'
    const wrapper = mountTable(Array.from({ length: 25 }, (_, index) => card(index + 1)))

    expect(wrapper.findAll('tbody tr')).toHaveLength(10)
    expect(wrapper.find('.pagination-stub').exists()).toBe(false)

    const firstSentinel = wrapper.get('.card-library-load-more').element as HTMLElement & {
      triggerIntersection: () => void
    }
    firstSentinel.triggerIntersection()
    await nextTick()
    expect(wrapper.findAll('tbody tr')).toHaveLength(20)

    const secondSentinel = wrapper.get('.card-library-load-more').element as HTMLElement & {
      triggerIntersection: () => void
    }
    secondSentinel.triggerIntersection()
    await nextTick()
    expect(wrapper.findAll('tbody tr')).toHaveLength(25)
    expect(wrapper.find('.card-library-load-more').exists()).toBe(false)
  })

  it('loads cards incrementally on mobile web without rendering pagination', async () => {
    display.smAndDown = true
    const wrapper = mountTable(Array.from({ length: 25 }, (_, index) => card(index + 1)))

    expect(wrapper.findAll('tbody tr')).toHaveLength(10)
    expect(wrapper.find('.pagination-stub').exists()).toBe(false)

    const sentinel = wrapper.get('.card-library-load-more').element as HTMLElement & {
      triggerIntersection: () => void
    }
    sentinel.triggerIntersection()
    await nextTick()

    expect(wrapper.findAll('tbody tr')).toHaveLength(20)
  })

  it.each([
    { name: 'desktop pagination', configure: () => undefined },
    { name: 'mobile infinite scrolling', configure: () => { display.smAndDown = true } },
  ])('selects the complete result set with $name', async ({ configure }) => {
    configure()
    const cards = Array.from({ length: 25 }, (_, index) => card(index + 1))
    const wrapper = mountTable(cards)

    expect(wrapper.findAll('tbody tr')).toHaveLength(10)
    await wrapper.get('.checkbox-stub').trigger('click')

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([
      cards.map(item => item.id),
    ])
  })
})
