import { defineComponent, reactive } from 'vue'
import { mount } from '@vue/test-utils'
import FlashcardReviewSettingsFields from '@/components/FlashcardReviewSettingsFields.vue'
import type { FlashcardReviewSettings } from '@/types/domain'

const LabeledSliderStub = defineComponent({
  props: { modelValue: Number, title: String },
  emits: ['update:modelValue'],
  template: `
    <button
      v-if="title === 'Max cards per session'"
      class="max-cards-slider"
      @click="$emit('update:modelValue', '50')"
    >{{ modelValue }}</button>
  `,
})

const NumberInputStub = defineComponent({
  props: { modelValue: Number },
  template: '<input class="custom-max-cards" :value="modelValue" />',
})

function settings(): FlashcardReviewSettings {
  return reactive({
    mode: 'manual',
    cardSides: 'both',
    indefinite: false,
    maxCards: 20,
    frontSeconds: 5,
    backSeconds: 5,
    backSpeechRepeatCount: 1,
    speechEnabled: false,
    frontLanguage: '',
    backLanguage: '',
    sortMode: 'difficult',
  })
}

describe('FlashcardReviewSettingsFields max cards', () => {
  it('shows the custom max cards field when the slider reaches 50', async () => {
    const draft = settings()
    const wrapper = mount(FlashcardReviewSettingsFields, {
      props: {
        modelValue: draft,
        speechSupport: { available: false, languages: [] },
        availableCards: 100,
      },
      global: {
        stubs: {
          LabeledSlider: LabeledSliderStub,
          VCard: { template: '<section><slot /></section>' },
          ExpandTransition: { template: '<div><slot /></div>' },
          VExpandTransition: { template: '<div><slot /></div>' },
          VNumberInput: NumberInputStub,
          VBtnToggle: { template: '<div><slot /></div>' },
          VBtn: true,
          VDivider: true,
          VIcon: true,
          VListItem: true,
          VSelect: true,
          VSwitch: true,
        },
      },
    })

    expect(wrapper.find('.custom-max-cards').exists()).toBe(false)
    await wrapper.get('.max-cards-slider').trigger('click')
    expect(draft.maxCards).toBe(50)
    expect(wrapper.find('.custom-max-cards').exists()).toBe(true)
  })
})
