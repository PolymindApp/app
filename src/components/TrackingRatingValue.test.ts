import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import TrackingRatingValue from '@/components/TrackingRatingValue.vue'

const VRatingStub = defineComponent({
  inheritAttrs: false,
  props: {
    modelValue: Number,
    length: Number,
    activeColor: String,
    readonly: Boolean,
    halfIncrements: Boolean,
    density: String,
    size: String,
  },
  template: '<div class="v-rating-stub" v-bind="$attrs" />',
})

describe('TrackingRatingValue', () => {
  it('renders a compact read-only rating with an accessible numeric value', () => {
    const wrapper = mount(TrackingRatingValue, {
      props: {
        value: 7.5,
        max: 10,
        color: '#D4A5FF',
        label: 'Mood',
      },
      global: { stubs: { VRating: VRatingStub } },
    })
    const rating = wrapper.findComponent(VRatingStub)

    expect(rating.props()).toMatchObject({
      modelValue: 7.5,
      length: 10,
      activeColor: '#D4A5FF',
      readonly: true,
      halfIncrements: true,
      density: 'compact',
      size: 'x-small',
    })
    expect(rating.attributes('aria-label')).toBe('Mood: 7.5 out of 10')
  })
})
