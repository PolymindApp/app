import { defineComponent, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { useOverlayStack } from '@/services/overlayStack'

const OverlayHarness = defineComponent({
  props: {
    active: Boolean,
  },
  setup(props) {
    return { zIndex: useOverlayStack(() => props.active) }
  },
  template: '<div :data-z-index="zIndex" />',
})

describe('overlayStack', () => {
  it('places overlays above each other in opening order', async () => {
    const first = mount(OverlayHarness, { props: { active: false } })
    const second = mount(OverlayHarness, { props: { active: false } })

    await first.setProps({ active: true })
    const firstLayer = Number(first.attributes('data-z-index'))

    await second.setProps({ active: true })
    const secondLayer = Number(second.attributes('data-z-index'))

    expect(secondLayer).toBeGreaterThan(firstLayer)

    await first.setProps({ active: false })
    await first.setProps({ active: true })
    await nextTick()

    expect(Number(first.attributes('data-z-index'))).toBeGreaterThan(secondLayer)
  })

  it('keeps an active overlay on its assigned layer', async () => {
    const wrapper = mount(OverlayHarness, { props: { active: true } })
    const initialLayer = wrapper.attributes('data-z-index')

    await wrapper.setProps({ active: true })

    expect(wrapper.attributes('data-z-index')).toBe(initialLayer)
  })
})
