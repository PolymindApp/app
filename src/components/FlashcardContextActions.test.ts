import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import FlashcardContextActions from '@/components/FlashcardContextActions.vue'

const BottomSheetStub = defineComponent({
  setup(_, { slots }) {
    return () => h('section', [slots.content?.(), slots.default?.()])
  },
})

const ButtonStub = defineComponent({
  inheritAttrs: false,
  props: { ariaLabel: String, disabled: Boolean },
  emits: ['click'],
  setup(props, { attrs, emit }) {
    return () => h('button', {
      ...attrs,
      'aria-label': props.ariaLabel,
      disabled: props.disabled,
      onClick: () => emit('click'),
    })
  },
})

const ListItemStub = defineComponent({
  inheritAttrs: false,
  props: { title: String, disabled: Boolean },
  emits: ['click'],
  setup(props, { emit }) {
    return () => h('button', {
      disabled: props.disabled,
      onClick: () => emit('click'),
    }, props.title)
  },
})

describe('FlashcardContextActions', () => {
  it('closes the sheet and emits the selected context action', async () => {
    const wrapper = mount(FlashcardContextActions, {
      props: { modelValue: true },
      global: {
        stubs: {
          ActionBottomSheet: BottomSheetStub,
          VBtn: ButtonStub,
          VDivider: true,
          VListItem: ListItemStub,
        },
      },
    })

    await wrapper.findAll('button').find(button => button.text() === 'Edit card')!.trigger('click')

    expect(wrapper.emitted('update:modelValue')).toEqual([[false]])
    expect(wrapper.emitted('action')).toEqual([['edit']])
  })

  it('disables unavailable navigation and card management actions', () => {
    const wrapper = mount(FlashcardContextActions, {
      props: {
        modelValue: true,
        canPrevious: false,
        canNext: false,
        canManageCard: false,
        canAddCard: false,
      },
      global: {
        stubs: {
          ActionBottomSheet: BottomSheetStub,
          VBtn: ButtonStub,
          VDivider: true,
          VListItem: ListItemStub,
        },
      },
    })

    expect(wrapper.get('[aria-label="Previous"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[aria-label="Next"]').attributes('disabled')).toBeDefined()
    expect(wrapper.findAll('button').find(button => button.text() === 'Add card')!.attributes('disabled')).toBeDefined()
    expect(wrapper.findAll('button').find(button => button.text() === 'Remove card')!.attributes('disabled')).toBeDefined()
  })
})
