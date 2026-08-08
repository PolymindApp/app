import { defineComponent, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import FlashcardCardsManager from '@/components/FlashcardCardsManager.vue'
import type { Flashcard } from '@/types/domain'

const bulkUpdateCards = vi.hoisted(() => vi.fn())

vi.mock('@/stores/flashcards', () => ({
  useFlashcardStore: () => ({ bulkUpdateCards }),
}))

const AutocompleteStub = defineComponent({
  props: { modelValue: Array, items: Array },
  emits: ['update:modelValue'],
  template: `
    <div class="autocomplete-stub">
      <button class="filter-tag" @click="$emit('update:modelValue', ['tag-1'])">Filter</button>
    </div>
  `,
})

const ButtonStub = defineComponent({
  inheritAttrs: false,
  props: { disabled: Boolean, to: Object },
  emits: ['click'],
  template: '<button v-bind="$attrs" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
})

const TableStub = defineComponent({
  props: {
    cards: { type: Array, required: true },
    selectable: Boolean,
    interactive: Boolean,
    modelValue: Array,
  },
  emits: ['open-card', 'update:modelValue'],
  template: `
    <div
      class="table-stub"
      :data-selectable="selectable"
      :data-interactive="interactive"
    >
      <button
        v-for="card in cards"
        :key="card.id"
        class="open-card"
        @click="$emit('open-card', card)"
      >
        {{ card.front }}
      </button>
    </div>
  `,
})

function card(id: string, front: string, tags: string[]): Flashcard {
  return {
    id,
    front,
    back: `${front} back`,
    note: '',
    image: '',
    imageSource: 'none',
    tags,
    createdAt: '2026-08-08T12:00:00.000Z',
    updatedAt: '2026-08-08T12:00:00.000Z',
    passiveViews: 0,
    successCount: 0,
    errorCount: 0,
  }
}

function mountManager(props: Record<string, unknown> = {}) {
  return mount(FlashcardCardsManager, {
    props: {
      cards: [
        card('card-1', 'Tagged card', ['tag-1']),
        card('card-2', 'Untagged card', []),
      ],
      tags: [{ id: 'tag-1', name: 'Vocabulary' }],
      ...props,
    },
    global: {
      stubs: {
        ActionBottomSheet: true,
        ConfirmDialog: true,
        FlashcardBulkImageAssignmentDialog: true,
        FlashcardCardsTable: TableStub,
        FlashcardTagCombobox: true,
        VAlert: { template: '<div><slot /></div>' },
        VAutocomplete: AutocompleteStub,
        VBadge: { template: '<span><slot /></span>' },
        VBtn: ButtonStub,
        VCard: { template: '<div><slot /></div>' },
        VDivider: true,
        VIcon: true,
        VList: { template: '<div><slot /></div>' },
        VListItem: {
          props: ['title'],
          template: '<div class="bulk-item">{{ title }}</div>',
        },
        VListSubheader: { template: '<div><slot /></div>' },
        VMenu: { template: '<div><slot name="activator" :props="{}" /><slot /></div>' },
        VSelect: true,
      },
    },
  })
}

describe('FlashcardCardsManager', () => {
  it('filters cards and reports the visible count without rendering a section heading', async () => {
    const wrapper = mountManager()

    expect(wrapper.find('h2').exists()).toBe(false)
    expect(wrapper.get('.table-stub').text()).toContain('Tagged card')
    expect(wrapper.get('.table-stub').text()).toContain('Untagged card')
    expect(wrapper.emitted('update:filteredCount')?.at(-1)).toEqual([2])

    await wrapper.get('.filter-tag').trigger('click')
    await nextTick()

    expect(wrapper.get('.table-stub').text()).toContain('Tagged card')
    expect(wrapper.get('.table-stub').text()).not.toContain('Untagged card')
    expect(wrapper.emitted('update:filteredCount')?.at(-1)).toEqual([1])
  })

  it('adapts the shared manager for editable and read-only Review sets', async () => {
    const editable = mountManager({
      addAriaLabel: 'Add a card to this Review set',
      canAdd: true,
      interactive: true,
    })
    await editable.get('[aria-label="Add a card to this Review set"]').trigger('click')
    expect(editable.emitted('add-card')).toEqual([[]])
    expect(editable.get('.table-stub').attributes('data-selectable')).toBe('false')
    expect(editable.get('.table-stub').attributes('data-interactive')).toBe('true')

    const readOnly = mountManager({ canAdd: false, interactive: false })
    expect(readOnly.find('.card-filter-actions').exists()).toBe(false)
    expect(readOnly.get('.table-stub').attributes('data-selectable')).toBe('false')
    expect(readOnly.get('.table-stub').attributes('data-interactive')).toBe('false')
  })

  it('keeps the complete library action layout and selectable table', () => {
    const wrapper = mountManager({ libraryActions: true, selectable: true })

    expect(wrapper.get('.card-filter-actions').classes()).toContain('card-filter-actions--4')
    expect(wrapper.get('[aria-label="Manage flashcard tags"]').exists()).toBe(true)
    expect(wrapper.get('[aria-label="Import flashcards"]').exists()).toBe(true)
    expect(wrapper.get('[aria-label="Add a new flashcard"]').exists()).toBe(true)
    expect(wrapper.get('.table-stub').attributes('data-selectable')).toBe('true')
  })

  it('offers scoped import and bulk actions for editable Review sets', () => {
    const wrapper = mountManager({
      bulkActions: ['assign_images', 'delete'],
      canAdd: true,
      importReviewSetId: 'set-1',
      selectable: true,
      showImport: true,
    })

    expect(wrapper.get('.card-filter-actions').classes()).toContain('card-filter-actions--3')
    expect(wrapper.get('.table-stub').attributes('data-selectable')).toBe('true')
    expect(wrapper.findAll('.bulk-item').map(item => item.text())).toEqual([
      'Assign images',
      'Delete cards',
    ])
    const importButton = wrapper.findAllComponents(ButtonStub)
      .find(button => button.attributes('aria-label') === 'Import flashcards')
    expect(importButton?.props('to')).toEqual({
      name: 'flashcard-import',
      query: { reviewSetId: 'set-1' },
    })
  })
})
