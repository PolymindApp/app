import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TrackingLogBottomSheet from '@/components/TrackingLogBottomSheet.vue'
import type { TrackingTracker } from '@/types/domain'

const apiMocks = vi.hoisted(() => ({
  createEntry: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  api: {
    authStore: { record: { id: 'user-1' } },
    collection: (name: string) => {
      if (name === 'tracking_entries') return { create: apiMocks.createEntry }
      throw new Error(`Unexpected collection: ${name}`)
    },
  },
}))

const tracker: TrackingTracker = {
  id: 'mood',
  name: 'Mood',
  description: 'How did the day feel?',
  role: 'outcome',
  kind: 'yes_no',
  category: 'mood',
  unit: '',
  scaleMin: 0,
  scaleMax: 0,
  favorableDirection: 'higher',
  dailyAggregation: 'last',
  active: true,
  sortOrder: 0,
  color: '#D4A5FF',
  icon: 'mdi-emoticon-outline',
}

const VBtnStub = defineComponent({
  props: { disabled: Boolean, loading: Boolean },
  emits: ['click'],
  template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
})

describe('TrackingLogBottomSheet', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    apiMocks.createEntry.mockReset()
    apiMocks.createEntry.mockImplementation(async payload => ({ id: 'entry-1', ...payload }))
  })

  it('logs through the shared sheet and closes after saving', async () => {
    const wrapper = mount(TrackingLogBottomSheet, {
      props: {
        modelValue: true,
        tracker,
        date: '2026-08-06',
        context: 'Daily check-in',
      },
      global: {
        stubs: {
          ActionBottomSheet: {
            props: ['modelValue', 'title', 'description'],
            template: '<div><slot name="content" /></div>',
          },
          DateTimePickerField: true,
          LabeledSlider: true,
          VAlert: true,
          VBtn: VBtnStub,
          VIcon: true,
          VNumberInput: true,
          VTextarea: true,
        },
      },
    })

    expect(wrapper.text()).toContain('Daily check-in')
    await wrapper.get('button').trigger('click')
    await flushPromises()

    expect(apiMocks.createEntry).toHaveBeenCalledWith(expect.objectContaining({
      owner: 'user-1',
      tracker: 'mood',
      local_date: '2026-08-06',
      value: 1,
    }))
    expect(wrapper.emitted('saved')?.[0]?.[0]).toMatchObject({
      id: 'entry-1',
      tracker: 'mood',
      localDate: '2026-08-06',
      value: 1,
    })
    expect(wrapper.emitted('update:modelValue')).toContainEqual([false])
  })
})
