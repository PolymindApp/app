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

function dispatchPointer(type: string, pointerId: number) {
  const event = new Event(type, { bubbles: true })
  Object.defineProperty(event, 'pointerId', { value: pointerId })
  document.dispatchEvent(event)
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

  it('snaps the selected value to the center when scrolling settles', async () => {
    const wrapper = mountPicker()
    await wrapper.find('.timer-wheel__focus-guard').trigger('click')
    const seconds = wrapper.findAll<HTMLElement>('.timer-wheel__column')[1]!

    seconds.element.scrollTop = 10 * 52 + 20
    await seconds.trigger('scroll')
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([10])
    expect(seconds.element.scrollTop).toBe(10 * 52 + 20)

    await seconds.trigger('scrollend')

    expect(seconds.element.scrollTop).toBe(10 * 52)
    expect(seconds.find('.timer-wheel__option--selected').text()).toContain('10')

    wrapper.unmount()
  })

  it('waits for pointer release before snapping a settled scroll', async () => {
    const wrapper = mountPicker()
    await wrapper.find('.timer-wheel__focus-guard').trigger('click')
    const seconds = wrapper.findAll<HTMLElement>('.timer-wheel__column')[1]!

    await seconds.trigger('pointerdown', { pointerId: 7 })
    expect(seconds.classes()).toContain('timer-wheel__column--interacting')

    seconds.element.scrollTop = 10 * 52 + 20
    await seconds.trigger('scroll')
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))
    await seconds.trigger('scrollend')

    expect(seconds.element.scrollTop).toBe(10 * 52 + 20)
    expect(seconds.find('.timer-wheel__option--selected').text()).toContain('10')

    dispatchPointer('pointerup', 7)
    await nextTick()

    expect(seconds.classes()).not.toContain('timer-wheel__column--interacting')
    expect(seconds.element.scrollTop).toBe(10 * 52)

    wrapper.unmount()
  })

  it('cancels a queued settle when a new gesture reverses the scroll', async () => {
    const wrapper = mountPicker()
    await wrapper.find('.timer-wheel__focus-guard').trigger('click')
    const seconds = wrapper.findAll<HTMLElement>('.timer-wheel__column')[1]!

    await seconds.trigger('pointerdown', { pointerId: 7 })
    seconds.element.scrollTop = 10 * 52 + 20
    await seconds.trigger('scroll')
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))
    dispatchPointer('pointerup', 7)

    await seconds.trigger('pointerdown', { pointerId: 8 })
    await new Promise(resolve => window.setTimeout(resolve, 140))
    seconds.element.scrollTop = 8 * 52 + 20
    dispatchPointer('pointerup', 8)
    await nextTick()

    expect(seconds.element.scrollTop).toBe(8 * 52 + 20)

    await new Promise(resolve => window.setTimeout(resolve, 140))
    expect(seconds.element.scrollTop).toBe(8 * 52)

    wrapper.unmount()
  })

  it('uses the same wheel for hour and minute clock values', async () => {
    const wrapper = mount(TimerWheelPicker, {
      attachTo: document.body,
      props: { modelValue: '09:45', mode: 'time' },
      global: { stubs: { VNumberInput: VNumberInputStub } },
    })

    await nextTick()
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))

    const columns = wrapper.findAll('.timer-wheel__column')
    expect(wrapper.get('.timer-wheel').attributes('aria-label')).toBe('Time wheel')
    expect(columns[0]?.attributes('aria-label')).toBe('Hours')
    expect(columns[1]?.attributes('aria-label')).toBe('Minutes')
    expect(columns[0]?.findAll('.timer-wheel__option')).toHaveLength(24)
    expect((columns[0]?.element as HTMLElement).scrollTop).toBe(9 * 52)
    expect((columns[1]?.element as HTMLElement).scrollTop).toBe(45 * 52)

    await columns[0]?.findAll('.timer-wheel__option')[10]?.trigger('click')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['10:45'])

    wrapper.unmount()
  })
})
