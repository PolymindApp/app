import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import WeekNavigator from '@/components/WeekNavigator.vue'

const VBtnStub = defineComponent({
  inheritAttrs: false,
  emits: ['click'],
  template: '<button v-bind="$attrs" @click="$emit(\'click\')" />',
})

function mountNavigator(type?: 'day' | 'week' | 'month' | 'year') {
  return mount(WeekNavigator, {
    props: {
      modelValue: new Date(2026, 7, 5, 12),
      ...(type ? { type } : {}),
    },
    global: { stubs: { VBtn: VBtnStub } },
  })
}

describe('WeekNavigator', () => {
  it('continues to navigate by week by default', async () => {
    const wrapper = mountNavigator()

    expect(wrapper.text()).toContain('Aug 3 – 9')
    await wrapper.get('[aria-label="Next week"]').trigger('click')

    const selected = wrapper.emitted('update:modelValue')?.at(-1)?.[0] as Date
    expect(formatDate(selected)).toBe('2026-08-10')
    expect(wrapper.emitted('navigate')).toEqual([['next']])
  })

  it.each([
    ['day', 'Wednesday, August 5, 2026', '2026-08-06'],
    ['month', 'August 2026', '2026-09-01'],
    ['year', '2026', '2027-01-01'],
  ] as const)('navigates by %s', async (type, label, expectedDate) => {
    const wrapper = mountNavigator(type)

    expect(wrapper.text()).toContain(label)
    await wrapper.get(`[aria-label="Next ${type}"]`).trigger('click')

    const selected = wrapper.emitted('update:modelValue')?.at(-1)?.[0] as Date
    expect(formatDate(selected)).toBe(expectedDate)
    expect(wrapper.emitted('navigate')).toEqual([['next']])
  })
})

function formatDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
