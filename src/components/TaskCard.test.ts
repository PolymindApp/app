import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import TaskCard from '@/components/TaskCard.vue'
import type { TaskProgress } from '@/types/domain'

const VBtnStub = defineComponent({
  props: { disabled: Boolean },
  emits: ['click'],
  template: '<button :disabled="disabled" @click="$emit(\'click\', $event)"><slot /></button>',
})

const progress: TaskProgress = {
  task: {
    id: 'water',
    name: 'Water',
    description: 'Daily water',
    type: 'daily_total',
    mandatory: true,
    reviewWhenMissed: false,
    active: true,
    startDate: '2026-08-01',
    recurrenceType: 'daily',
    weekdays: [],
    intervalWeeks: 1,
    targetValue: 2,
    targetOperator: 'gte',
    unit: 'L',
    goalPeriod: 'occurrence',
    entryNotesEnabled: false,
    entryNoteSuggestionsEnabled: false,
    sortOrder: 0,
  },
  value: 0,
  percent: 0,
  complete: false,
  sealed: false,
  status: 'pending',
}

describe('TaskCard amount actions', () => {
  it('offers one Log amount action without quick-add buttons', async () => {
    const wrapper = mount(TaskCard, {
      props: { progress },
      global: {
        stubs: {
          VBtn: VBtnStub,
          VCard: { template: '<div><slot /></div>' },
          VIcon: true,
          VProgressCircular: { template: '<div><slot /></div>' },
          VProgressLinear: true,
        },
      },
    })
    const logAmount = wrapper.findAll('button').find((button) => button.text() === 'Log amount')

    expect(logAmount).toBeDefined()
    expect(wrapper.text()).not.toContain('Custom')
    expect(wrapper.text()).not.toContain('+1')

    await logAmount!.trigger('click')
    expect(wrapper.emitted('logAmount')).toEqual([[progress]])
  })

  it('opens journal actions without toggling the task card', async () => {
    const wrapper = mount(TaskCard, {
      props: { progress },
      global: {
        stubs: {
          VBtn: VBtnStub,
          VCard: { template: '<div><slot /></div>' },
          VIcon: true,
          VProgressCircular: { template: '<div><slot /></div>' },
          VProgressLinear: true,
        },
      },
    })

    await wrapper.get('[aria-label="Journal actions for Water"]').trigger('click')

    expect(wrapper.emitted('journalActions')).toEqual([[progress]])
    expect(wrapper.emitted('toggle')).toBeUndefined()
  })
})
