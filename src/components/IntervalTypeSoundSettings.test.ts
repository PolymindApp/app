import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import IntervalTypeSoundSettings from '@/components/IntervalTypeSoundSettings.vue'
import { defaultIntervalTypeSounds, INTERVAL_STEP_TYPES } from '@/services/intervalTypes'

const VSelectStub = defineComponent({
  name: 'VSelect',
  props: {
    modelValue: String,
    items: Array,
    label: String,
    disabled: Boolean,
  },
  emits: ['update:modelValue'],
  template: '<button type="button" @click="$emit(\'update:modelValue\', \'complete\')">{{ label }}</button>',
})

const VBtnStub = defineComponent({
  name: 'VBtn',
  props: { disabled: Boolean, loading: Boolean },
  template: '<button type="button" :disabled="disabled"><slot /></button>',
})

function mountSettings() {
  return mount(IntervalTypeSoundSettings, {
    props: { modelValue: defaultIntervalTypeSounds() },
    global: {
      stubs: {
        IntervalTypeIcon: true,
        VBtn: VBtnStub,
        VSelect: VSelectStub,
      },
    },
  })
}

describe('IntervalTypeSoundSettings', () => {
  it('renders a sound selector for every interval type', () => {
    const wrapper = mountSettings()

    expect(wrapper.findAllComponents(VSelectStub)).toHaveLength(INTERVAL_STEP_TYPES.length)
    expect(wrapper.findAllComponents(VSelectStub).map(select => select.props('label')))
      .toEqual(INTERVAL_STEP_TYPES.map(type => `${type.title} sound`))
  })

  it('emits changed assignments and preview requests', async () => {
    const wrapper = mountSettings()
    const workIndex = INTERVAL_STEP_TYPES.findIndex(type => type.value === 'work')

    await wrapper.findAllComponents(VSelectStub)[workIndex]!.trigger('click')
    expect(wrapper.emitted('change')?.[0]).toEqual(['work', 'complete'])

    await wrapper.findAllComponents(VBtnStub)[workIndex]!.trigger('click')
    expect(wrapper.emitted('preview')?.[0]).toEqual(['work', 'go'])
  })
})
