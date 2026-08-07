import { nextTick } from 'vue'
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

function card(index: number, image = ''): Flashcard {
  return {
    id: `card-${index}`,
    front: `Front ${index}`,
    back: `Back ${index}`,
    note: '',
    image,
    imageSource: image ? 'url' : 'none',
    tags: index % 2 ? ['tag-1'] : [],
    createdAt: '2026-08-07T12:00:00.000Z',
    updatedAt: '2026-08-07T12:00:00.000Z',
    passiveViews: 0,
    successCount: 0,
    errorCount: 0,
  }
}

function mountTable(cards: Flashcard[]) {
  return mount(FlashcardCardsTable, {
    props: {
      cards,
      tags: [{ id: 'tag-1', name: 'Vocabulary' }],
      modelValue: [],
    },
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
        VImg: {
          props: ['src'],
          template: '<img class="image-stub" :src="src" />',
        },
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

  it('shows a compact image cell with an empty placeholder by default', () => {
    const cards = [
      card(1, 'https://images.example.test/card.jpg'),
      card(2),
    ]
    const wrapper = mountTable(cards)

    expect(wrapper.findAll('thead th').map(heading => heading.text())).toEqual([
      '',
      'Image',
      'Faces',
      'Tags',
    ])
    expect(wrapper.findAll('.flashcard-table__image-frame')).toHaveLength(2)
    expect(wrapper.get('.image-stub').attributes('src')).toBe(cards[0]?.image)
    expect(wrapper.get('[aria-label="No image"]').exists()).toBe(true)
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
