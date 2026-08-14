import { defineComponent, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import FlashcardCardsManager from '@/components/FlashcardCardsManager.vue'
import type { Flashcard } from '@/types/domain'

const bulkUpdateCards = vi.hoisted(() => vi.fn())

vi.mock('@/stores/flashcards', () => ({
  useFlashcardStore: () => ({ bulkUpdateCards }),
}))

const TextFieldStub = defineComponent({
  props: { modelValue: String, label: String },
  emits: ['update:modelValue'],
  template: `
    <input
      class="search-input"
      :aria-label="label"
      :value="modelValue"
      @input="$emit('update:modelValue', $event.target.value)"
    >
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
        v-if="selectable"
        class="select-all-cards"
        @click="$emit('update:modelValue', cards.map(card => card.id))"
      >Select all</button>
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

const ConfirmDialogStub = defineComponent({
  props: { modelValue: Boolean, title: String },
  emits: ['confirm', 'update:modelValue'],
  template: `
    <div v-if="modelValue" class="confirm-dialog" :data-title="title">
      <button class="confirm-action" @click="$emit('confirm')">Confirm</button>
    </div>
  `,
})

const ActionBottomSheetStub = defineComponent({
  template: '<section class="action-bottom-sheet-stub"><slot name="content" /><slot /></section>',
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

function mountManager(props: Record<string, unknown> = {}, attachTo?: Element) {
  return mount(FlashcardCardsManager, {
    attachTo,
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
        ActionBottomSheet: ActionBottomSheetStub,
        ConfirmDialog: ConfirmDialogStub,
        FlashcardBulkImageAssignmentDialog: true,
        FlashcardCardsTable: TableStub,
        FlashcardTagCombobox: true,
        VAlert: { template: '<div><slot /></div>' },
        VBadge: { template: '<span><slot /></span>' },
        VBtn: ButtonStub,
        VCard: { template: '<div><slot /></div>' },
        VDivider: true,
        VIcon: true,
        VList: { template: '<div><slot /></div>' },
        VListItem: {
          props: ['disabled', 'title'],
          emits: ['click'],
          template: '<button class="bulk-item" :disabled="disabled" @click="$emit(\'click\')">{{ title }}</button>',
        },
        VListSubheader: { template: '<div><slot /></div>' },
        VMenu: { template: '<div><slot name="activator" :props="{}" /><slot /></div>' },
        VSelect: true,
        VTextField: TextFieldStub,
      },
    },
  })
}

describe('FlashcardCardsManager', () => {
  it('searches fronts, backs, notes, and tag names while reporting the visible count', async () => {
    const wrapper = mountManager({
      cards: [
        { ...card('card-1', 'Alpha prompt', ['tag-1']), back: 'Reverse answer', note: 'Memory clue' },
        { ...card('card-2', 'Beta prompt', []), back: 'Other answer', note: 'Other note' },
      ],
    })
    const search = wrapper.get<HTMLInputElement>('.search-input')

    expect(wrapper.find('h2').exists()).toBe(false)
    expect(wrapper.get('.table-stub').text()).toContain('Alpha prompt')
    expect(wrapper.get('.table-stub').text()).toContain('Beta prompt')
    expect(wrapper.emitted('update:filteredCount')?.at(-1)).toEqual([2])

    for (const query of ['alpha', 'reverse', 'memory', 'vocabulary', 'REVERSE memory']) {
      await search.setValue(query)
      await nextTick()

      expect(wrapper.get('.table-stub').text()).toContain('Alpha prompt')
      expect(wrapper.get('.table-stub').text()).not.toContain('Beta prompt')
      expect(wrapper.emitted('update:filteredCount')?.at(-1)).toEqual([1])
    }

    await search.setValue('missing')
    expect(wrapper.text()).toContain('No cards match your search')
    expect(wrapper.text()).toContain('Clear the search or try another term.')
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
    expect(wrapper.findAll('.bulk-item').map(item => item.text())).toContain('Swap front and back')
    expect(wrapper.findAll('.bulk-item').map(item => item.text())).toContain('Swap note and back')
  })

  it.each([
    { title: 'Swap front and back', action: 'swap_front_back' },
    { title: 'Swap note and back', action: 'swap_note_back' },
  ] as const)('confirms and runs the $title bulk action', async ({ title, action }) => {
    const bulkActionHandler = vi.fn().mockResolvedValue(undefined)
    const cards = [
      { ...card('card-1', 'First', []), note: 'First note' },
      { ...card('card-2', 'Second', []), note: 'Second note' },
    ]
    const wrapper = mountManager({ cards, libraryActions: true, selectable: true, bulkActionHandler })

    await wrapper.get('.select-all-cards').trigger('click')
    await wrapper.findAll('.bulk-item').find(item => item.text() === title)!.trigger('click')

    expect(wrapper.get('.confirm-dialog').attributes('data-title')).toContain(title)
    await wrapper.get('.confirm-action').trigger('click')

    expect(bulkActionHandler).toHaveBeenCalledWith(action, ['card-1', 'card-2'], [])
  })

  it('disables note and back swapping when a selected card has no note', async () => {
    const wrapper = mountManager({ libraryActions: true, selectable: true })

    await wrapper.get('.select-all-cards').trigger('click')

    const swapNoteAndBack = wrapper.findAll('.bulk-item')
      .find(item => item.text() === 'Swap note and back')
    expect(swapNoteAndBack?.attributes('disabled')).toBeDefined()
  })

  it('offers scoped import and deletion for editable Review sets', () => {
    const wrapper = mountManager({
      bulkActions: ['delete'],
      canAdd: true,
      importReviewSetId: 'set-1',
      selectable: true,
      showImport: true,
    })

    expect(wrapper.get('.card-filter-actions').classes()).toContain('card-filter-actions--3')
    expect(wrapper.get('.table-stub').attributes('data-selectable')).toBe('true')
    expect(wrapper.findAll('.bulk-item').map(item => item.text())).toEqual(['Delete cards'])
    const importButton = wrapper.findAllComponents(ButtonStub)
      .find(button => button.attributes('aria-label') === 'Import flashcards')
    expect(importButton?.props('to')).toEqual({
      name: 'flashcard-import',
      query: { reviewSetId: 'set-1' },
    })
  })

  it('supports Review set inclusion actions as its only toolbar control', async () => {
    const selectionActionHandler = vi.fn()
    const wrapper = mountManager({
      canAdd: false,
      selectable: true,
      selectionActions: [
        { action: 'exclude', title: 'Exclude', icon: 'mdi-minus-circle-outline' },
        { action: 'include', title: 'Include', icon: 'mdi-check-circle-outline' },
      ],
      selectionActionHandler,
      showSearchFilter: false,
      tableSurface: false,
    })

    expect(wrapper.find('.search-input').exists()).toBe(false)
    expect(wrapper.get('.card-filter-actions').classes()).toContain('card-filter-actions--only')
    expect(wrapper.findAll('.card-filter-action')).toHaveLength(1)
    expect(wrapper.findAll('.bulk-item').map(item => item.text())).toEqual(['Exclude', 'Include'])

    await wrapper.get('.select-all-cards').trigger('click')
    await wrapper.findAll('.bulk-item')[0]!.trigger('click')
    await nextTick()

    expect(selectionActionHandler).toHaveBeenCalledWith('exclude', ['card-1', 'card-2'])
  })

  it('combines Review set inclusion actions with standard card bulk actions', () => {
    const wrapper = mountManager({
      bulkActions: ['swap_front_back', 'add_tags', 'delete'],
      canAdd: false,
      selectable: true,
      selectionActions: [
        { action: 'exclude', title: 'Exclude', icon: 'mdi-minus-circle-outline' },
        { action: 'include', title: 'Include', icon: 'mdi-check-circle-outline' },
      ],
    })

    expect(wrapper.findAll('.bulk-item').map(item => item.text())).toEqual([
      'Exclude',
      'Include',
      'Swap front and back',
      'Add tags',
      'Delete cards',
    ])
  })
})
