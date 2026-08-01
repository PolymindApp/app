import { defineComponent, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import WeekDateNavigator from '@/components/WeekDateNavigator.vue'

const VBtnStub = defineComponent({
  inheritAttrs: false,
  emits: ['click'],
  template: '<button v-bind="$attrs" @click="$emit(\'click\')" />',
})

function mountNavigator(selectedDate = new Date(2026, 7, 1, 12)) {
  return mount(WeekDateNavigator, {
    props: { modelValue: selectedDate },
    global: { stubs: { VBtn: VBtnStub } },
  })
}

describe('WeekDateNavigator', () => {
  it('shows the selected week and emits the chosen day', async () => {
    const wrapper = mountNavigator()
    const days = wrapper.findAll('.date-chip')

    expect(days).toHaveLength(7)
    expect(days[0].attributes('aria-label')).toBe('Monday, July 27, 2026')
    expect(days[5].attributes('aria-pressed')).toBe('true')

    await days[1].trigger('click')

    const selected = wrapper.emitted('update:modelValue')?.at(-1)?.[0]
    expect(selected).toBeInstanceOf(Date)
    expect((selected as Date).getFullYear()).toBe(2026)
    expect((selected as Date).getMonth()).toBe(6)
    expect((selected as Date).getDate()).toBe(28)
  })

  it('moves the seven-day strip with the shared week controls', async () => {
    const wrapper = mountNavigator()

    await wrapper.find('[aria-label="Previous week"]').trigger('click')
    await nextTick()

    expect(wrapper.findAll('.date-chip')[0].attributes('aria-label')).toBe('Monday, July 20, 2026')
    const visibleWeek = wrapper.emitted('update:weekStart')?.at(-1)?.[0] as Date
    expect(visibleWeek.getFullYear()).toBe(2026)
    expect(visibleWeek.getMonth()).toBe(6)
    expect(visibleWeek.getDate()).toBe(20)
  })
})
