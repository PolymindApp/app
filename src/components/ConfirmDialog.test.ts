import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import ConfirmDialog from '@/components/ConfirmDialog.vue'

const ButtonStub = defineComponent({
  inheritAttrs: false,
  props: {
    disabled: Boolean,
    loading: Boolean,
    size: String,
  },
  emits: ['click'],
  template: `
    <button
      v-bind="$attrs"
      :data-size="size"
      :disabled="disabled || loading"
      @click="$emit('click')"
    >
      <slot />
    </button>
  `,
})

describe('ConfirmDialog', () => {
  it('makes the confirmation action large without enlarging cancel', () => {
    const wrapper = mount(ConfirmDialog, {
      props: {
        modelValue: true,
        title: 'Delete this item?',
        message: 'This cannot be undone.',
        confirmText: 'Delete',
      },
      global: {
        stubs: {
          VBtn: ButtonStub,
          VCard: { template: '<div><slot /></div>' },
          VDialog: { template: '<div><slot /></div>' },
          VIcon: true,
        },
      },
    })

    expect(wrapper.get('.confirm-actions__primary').attributes('data-size')).toBe('large')
    expect(wrapper.get('.confirm-actions__cancel').attributes('data-size')).toBeUndefined()
  })
})
