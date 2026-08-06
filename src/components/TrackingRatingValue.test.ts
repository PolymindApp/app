import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import TrackingRatingValue from '@/components/TrackingRatingValue.vue'

const VProgressLinearStub = defineComponent({
  inheritAttrs: false,
  props: {
    modelValue: Number,
    color: String,
    bgColor: String,
    bgOpacity: Number,
    height: [Number, String],
    rounded: Boolean,
  },
  template: '<div class="v-progress-linear-stub" v-bind="$attrs" />',
})

describe('TrackingRatingValue', () => {
  it('renders a compact progress bar with a visible and accessible numeric value', () => {
    const wrapper = mount(TrackingRatingValue, {
      props: {
        value: 7.5,
        max: 10,
        color: '#D4A5FF',
        label: 'Mood',
      },
      global: { stubs: { VProgressLinear: VProgressLinearStub } },
    })
    const progress = wrapper.findComponent(VProgressLinearStub)

    expect(progress.props()).toMatchObject({
      modelValue: 75,
      color: '#D4A5FF',
      bgColor: 'surface-variant',
      bgOpacity: 1,
      height: 7,
      rounded: true,
    })
    expect(progress.attributes('aria-label')).toBe('Mood: 7.5 out of 10')
    expect(progress.attributes('aria-valuetext')).toBe('Mood: 7.5 out of 10')
    expect(wrapper.get('span').text()).toBe('7.5 / 10')
  })
})
