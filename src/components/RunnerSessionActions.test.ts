import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import RunnerSessionActions from '@/components/RunnerSessionActions.vue'

const ActionBottomSheetStub = defineComponent({
  props: { modelValue: Boolean, title: String, ariaLabel: String },
  template: '<section v-if="modelValue" :aria-label="ariaLabel"><slot /></section>',
})

const ListItemStub = defineComponent({
  inheritAttrs: false,
  props: {
    title: String,
    disabled: Boolean,
    ariaPressed: [Boolean, String],
  },
  emits: ['click'],
  template: `
    <button
      type="button"
      :disabled="disabled"
      :aria-pressed="ariaPressed"
      @click="$emit('click')"
    >{{ title }}<slot name="append" /></button>
  `,
})

describe('RunnerSessionActions', () => {
  it('renders ordered actions and emits only enabled selections', async () => {
    const wrapper = mount(RunnerSessionActions, {
      props: {
        modelValue: true,
        title: 'Review actions',
        ariaLabel: 'Review session actions',
        items: [
          {
            action: 'amplification',
            title: 'Disable TTS amplification',
            icon: 'mdi-volume-plus',
            active: true,
            toggle: true,
          },
          {
            action: 'restart',
            title: 'Restart review',
            icon: 'mdi-restart',
            disabled: true,
            divider: true,
          },
          {
            action: 'end',
            title: 'End review',
            icon: 'mdi-stop-circle-outline',
            color: 'error',
          },
        ],
      },
      global: {
        stubs: {
          ActionBottomSheet: ActionBottomSheetStub,
          VDivider: true,
          VIcon: true,
          VListItem: ListItemStub,
        },
      },
    })

    const actions = wrapper.findAll('button')
    expect(actions.map(action => action.text())).toEqual([
      'Disable TTS amplification',
      'Restart review',
      'End review',
    ])
    expect(actions[0]!.attributes('aria-pressed')).toBe('true')

    await actions[1]!.trigger('click')
    expect(wrapper.emitted('action')).toBeUndefined()

    await actions[2]!.trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([[false]])
    expect(wrapper.emitted('action')).toEqual([['end']])
  })
})
