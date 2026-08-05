import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import FormActionBar from '@/components/FormActionBar.vue'

const VBtnStub = defineComponent({
  props: {
    disabled: Boolean,
    icon: String,
    loading: Boolean,
  },
  emits: ['click'],
  template: `
    <button :disabled="disabled" :data-loading="loading" @click="$emit('click')">
      <slot />
      <span v-if="icon">{{ icon }}</span>
    </button>
  `,
})

function mountActionBar(props: Record<string, unknown> = {}) {
  return mount(FormActionBar, {
    props,
    global: {
      stubs: { VBtn: VBtnStub },
    },
  })
}

describe('FormActionBar', () => {
  it('shows cancel and the supplied create action without delete controls', () => {
    const wrapper = mountActionBar({ primaryText: 'Create' })

    expect(wrapper.find('.form-action-bar__delete').exists()).toBe(false)
    expect(wrapper.find('.form-action-bar__cancel').text()).toBe('Cancel')
    expect(wrapper.find('.form-action-bar__primary').text()).toBe('Create')
  })

  it('orders delete, cancel, and save actions and emits their events', async () => {
    const wrapper = mountActionBar({
      primaryText: 'Save',
      showDelete: true,
      deleteLabel: 'Delete tracker',
    })
    const actions = wrapper.find('.form-action-bar__inner').findAll('button')

    expect(actions.map((action) => action.classes())).toEqual([
      expect.arrayContaining(['form-action-bar__delete']),
      expect.arrayContaining(['form-action-bar__cancel']),
      expect.arrayContaining(['form-action-bar__primary']),
    ])
    expect(actions[0].attributes('aria-label')).toBe('Delete tracker')

    await actions[0].trigger('click')
    await actions[1].trigger('click')
    await actions[2].trigger('click')

    expect(wrapper.emitted('delete')).toHaveLength(1)
    expect(wrapper.emitted('cancel')).toHaveLength(1)
    expect(wrapper.emitted('submit')).toHaveLength(1)
  })

  it('locks secondary actions while a save is in progress', () => {
    const wrapper = mountActionBar({ loading: true, showDelete: true })

    expect(wrapper.find('.form-action-bar__delete').attributes()).toHaveProperty('disabled')
    expect(wrapper.find('.form-action-bar__cancel').attributes()).toHaveProperty('disabled')
    expect(wrapper.find('.form-action-bar__primary').attributes('data-loading')).toBe('true')
  })

  it('supports an embedded action row inside modal forms', () => {
    const wrapper = mountActionBar({ embedded: true })

    expect(wrapper.classes()).toContain('form-action-bar--embedded')
  })
})
