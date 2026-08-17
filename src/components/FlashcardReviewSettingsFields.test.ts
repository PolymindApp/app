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

const SwitchStub = defineComponent({
  props: { modelValue: Boolean, ariaLabel: String },
  emits: ['update:modelValue'],
  template: `
    <button
      :aria-label="ariaLabel"
      @click="$emit('update:modelValue', !modelValue)"
    />
  `,
})

const ModeToggleStub = defineComponent({
  emits: ['update:modelValue'],
  template: `
    <button
      class="select-passive-mode"
      @click="$emit('update:modelValue', 'passive')"
    >
      <slot />
    </button>
  `,
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
    noteBeforeBack: false,
    speechEnabled: false,
    frontLanguage: '',
    backLanguage: '',
    sortMode: 'difficult',
  })
}

describe('FlashcardReviewSettingsFields max cards', () => {
  it('enables indefinite reviews by default when passive mode is selected', async () => {
    const draft = settings()
    const wrapper = mount(FlashcardReviewSettingsFields, {
      props: {
        modelValue: draft,
        speechSupport: { available: false, languages: [] },
      },
      global: {
        stubs: {
          LabeledSlider: true,
          VCard: { template: '<section><slot /></section>' },
          ExpandTransition: { template: '<div><slot /></div>' },
          VExpandTransition: { template: '<div><slot /></div>' },
          VNumberInput: true,
          VBtnToggle: ModeToggleStub,
          VBtn: true,
          VDivider: true,
          VIcon: true,
          VListItem: true,
          VSelect: true,
          VSwitch: SwitchStub,
        },
      },
    })

    await wrapper.get('.select-passive-mode').trigger('click')

    expect(draft.mode).toBe('passive')
    expect(draft.indefinite).toBe(true)
  })

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
          VSwitch: SwitchStub,
        },
      },
    })

    expect(wrapper.find('.custom-max-cards').exists()).toBe(false)
    await wrapper.get('.max-cards-slider').trigger('click')
    expect(draft.maxCards).toBe(50)
    expect(wrapper.find('.custom-max-cards').exists()).toBe(true)
  })

  it('offers a note-before-answer response order', async () => {
    const draft = settings()
    const wrapper = mount(FlashcardReviewSettingsFields, {
      props: {
        modelValue: draft,
        speechSupport: { available: false, languages: [] },
      },
      global: {
        stubs: {
          LabeledSlider: true,
          VCard: { template: '<section><slot /></section>' },
          ExpandTransition: { template: '<div><slot /></div>' },
          VExpandTransition: { template: '<div><slot /></div>' },
          VNumberInput: true,
          VBtnToggle: { template: '<div><slot /></div>' },
          VBtn: true,
          VDivider: true,
          VIcon: true,
          VListItem: true,
          VSelect: true,
          VSwitch: SwitchStub,
        },
      },
    })

    await wrapper.get('[aria-label="Show flashcard note before answer"]').trigger('click')

    expect(draft.noteBeforeBack).toBe(true)
  })
})
