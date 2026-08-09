import { defineComponent, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import TimerWheelPicker from '@/components/TimerWheelPicker.vue'

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    value(options: ScrollToOptions) {
      this.scrollTop = Number(options.top || 0)
    },
  })
})

afterEach(() => {
  document.body.innerHTML = ''
})

const VNumberInputStub = defineComponent({
  props: { modelValue: Number },
  template: '<input :value="modelValue" />',
})

function mountPicker() {
  return mount(TimerWheelPicker, {
    attachTo: document.body,
    props: { modelValue: 0 },
    global: { stubs: { VNumberInput: VNumberInputStub } },
  })
}

describe('TimerWheelPicker focus gate', () => {
  it('requires focus before scrolling and shows the focused state', async () => {
    const wrapper = mountPicker()
    const wheel = wrapper.find('.timer-wheel')
    const seconds = wrapper.findAll('.timer-wheel__column')[1]

    expect(wheel.classes()).not.toContain('timer-wheel--focused')
    expect(wrapper.find('.timer-wheel__focus-guard').text()).toBe('Tap to adjust')

    seconds.element.scrollTop = 52
    await seconds.trigger('scroll')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()

    await wrapper.find('.timer-wheel__focus-guard').trigger('pointerdown')
    expect(wheel.classes()).not.toContain('timer-wheel--focused')

    await wrapper.find('.timer-wheel__focus-guard').trigger('click')
    expect(wheel.classes()).toContain('timer-wheel--focused')
    expect(wrapper.find('.timer-wheel__focus-guard').exists()).toBe(false)

    seconds.element.scrollTop = 52
    await seconds.trigger('scroll')
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([1])

    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await nextTick()
    expect(wheel.classes()).not.toContain('timer-wheel--focused')
    expect(wrapper.find('.timer-wheel__focus-guard').exists()).toBe(true)

    wrapper.unmount()
  })

  it('can be focused with the keyboard and dismissed with Escape', async () => {
    const wrapper = mountPicker()
    const wheel = wrapper.find<HTMLElement>('.timer-wheel')

    wheel.element.focus()
    await nextTick()
    expect(wheel.classes()).toContain('timer-wheel--focused')

    await wheel.trigger('keydown', { key: 'Escape' })
    expect(wheel.classes()).not.toContain('timer-wheel--focused')
    expect(document.activeElement).not.toBe(wheel.element)

    wrapper.unmount()
  })

  it('uses the same wheel for hour and minute clock values', async () => {
    const wrapper = mount(TimerWheelPicker, {
      props: { modelValue: '09:45', mode: 'time' },
      global: { stubs: { VNumberInput: VNumberInputStub } },
    })

    const columns = wrapper.findAll('.timer-wheel__column')
    expect(wrapper.get('.timer-wheel').attributes('aria-label')).toBe('Time wheel')
    expect(columns[0]?.attributes('aria-label')).toBe('Hours')
    expect(columns[1]?.attributes('aria-label')).toBe('Minutes')
    expect(columns[0]?.findAll('.timer-wheel__option')).toHaveLength(24)

    await columns[0]?.findAll('.timer-wheel__option')[10]?.trigger('click')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['10:45'])
  })
})
