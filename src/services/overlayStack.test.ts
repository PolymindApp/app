import { defineComponent, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { closeTopOverlay, useOverlayStack } from '@/services/overlayStack'

const OverlayHarness = defineComponent({
  props: {
    active: Boolean,
  },
  setup(props) {
    return { zIndex: useOverlayStack(() => props.active) }
  },
  template: '<div :data-z-index="zIndex" />',
})

const DismissibleOverlayHarness = defineComponent({
  props: {
    active: Boolean,
    close: {
      type: Function,
      required: true,
    },
  },
  setup(props) {
    const active = ref(props.active)
    const close = () => {
      props.close()
      active.value = false
    }
    return { zIndex: useOverlayStack(active, close) }
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

    first.unmount()
    second.unmount()
  })

  it('keeps an active overlay on its assigned layer', async () => {
    const wrapper = mount(OverlayHarness, { props: { active: true } })
    const initialLayer = wrapper.attributes('data-z-index')

    await wrapper.setProps({ active: true })

    expect(wrapper.attributes('data-z-index')).toBe(initialLayer)

    wrapper.unmount()
  })

  it('closes one overlay per call in reverse opening order', () => {
    const closed: string[] = []
    const first = mount(DismissibleOverlayHarness, {
      props: { active: true, close: () => closed.push('first') },
    })
    const second = mount(DismissibleOverlayHarness, {
      props: { active: true, close: () => closed.push('second') },
    })

    expect(closeTopOverlay()).toBe(true)
    expect(closed).toEqual(['second'])

    expect(closeTopOverlay()).toBe(true)
    expect(closed).toEqual(['second', 'first'])

    expect(closeTopOverlay()).toBe(false)

    first.unmount()
    second.unmount()
  })
})
