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

  it('shows only card context actions and disables unavailable ones', () => {
    const wrapper = mount(FlashcardContextActions, {
      props: {
        modelValue: true,
        canManageCard: false,
        canAddCard: false,
        canEjectCard: false,
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

    expect(wrapper.text()).not.toContain('Previous')
    expect(wrapper.text()).not.toContain('Pause')
    expect(wrapper.text()).not.toContain('Next')
    expect(wrapper.text()).not.toContain('Undo last eject')
    expect(wrapper.findAll('button').find(button => button.text() === 'Add card')!.attributes('disabled')).toBeDefined()
    expect(wrapper.findAll('button').find(button => button.text() === 'Eject card')!.attributes('disabled')).toBeDefined()
    expect(wrapper.findAll('button').find(button => button.text() === 'Remove card')!.attributes('disabled')).toBeDefined()
  })

  it('shows Undo last eject only when requested and enables it when an eject is available', async () => {
    const wrapper = mount(FlashcardContextActions, {
      props: {
        modelValue: true,
        showUndoEject: true,
        canUndoEject: false,
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

    const undoButton = () => wrapper.findAll('button')
      .find(button => button.text() === 'Undo last eject')!
    expect(undoButton().attributes('disabled')).toBeDefined()

    await wrapper.setProps({ canUndoEject: true })
    expect(undoButton().attributes('disabled')).toBeUndefined()
    await undoButton().trigger('click')

    expect(wrapper.emitted('update:modelValue')).toEqual([[false]])
    expect(wrapper.emitted('action')).toEqual([['undo_eject']])
  })
})
