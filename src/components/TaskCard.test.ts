import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import { beforeEach } from 'vitest'
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

beforeEach(() => {
  sessionStorage.clear()
})

describe('TaskCard amount actions', () => {
  it('offers one Log amount action without quick-add buttons', async () => {
    const wrapper = mount(TaskCard, {
      props: { progress },
      global: {
        stubs: {
          VBtn: VBtnStub,
          VCard: { template: '<div><slot /></div>' },
          VExpandTransition: { template: '<div><slot /></div>' },
          ExpandTransition: { template: '<div><slot /></div>' },
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

  it('shows Health Connect progress without manual amount actions for step counters', () => {
    const stepProgress: TaskProgress = {
      ...progress,
      task: {
        ...progress.task,
        id: 'steps',
        name: 'Daily steps',
        type: 'step_counter',
        targetValue: 10000,
        unit: 'steps',
      },
      value: 4200,
      percent: 42,
    }
    const wrapper = mount(TaskCard, {
      props: { progress: stepProgress },
      global: {
        stubs: {
          VBtn: VBtnStub,
          VCard: { template: '<div><slot /></div>' },
          VExpandTransition: { template: '<div><slot /></div>' },
          ExpandTransition: { template: '<div><slot /></div>' },
          VIcon: true,
          VProgressCircular: { template: '<div><slot /></div>' },
          VProgressLinear: true,
        },
      },
    })

    expect(wrapper.text()).toContain('4,200 steps')
    expect(wrapper.text()).toContain('Health Connect')
    expect(wrapper.text()).not.toContain('Log amount')
  })

  it('shows interval duration beside its type without a nested interval card', () => {
    const intervalProgress: TaskProgress = {
      ...progress,
      task: {
        ...progress.task,
        id: 'training',
        name: 'Morning training',
        type: 'interval',
        intervalTemplate: 'morning-hiit',
      },
    }
    const wrapper = mount(TaskCard, {
      props: {
        progress: intervalProgress,
        interval: { name: 'Morning HIIT', duration: '12m' },
        canStartInterval: true,
      },
      global: {
        stubs: {
          VBtn: VBtnStub,
          VCard: { template: '<div><slot /></div>' },
          VExpandTransition: { template: '<div><slot /></div>' },
          ExpandTransition: { template: '<div><slot /></div>' },
          VIcon: true,
          VProgressCircular: { template: '<div><slot /></div>' },
          VProgressLinear: true,
        },
      },
    })

    expect(wrapper.get('.task-subtitle').text()).toBe('Interval · 12m total')
    expect(wrapper.find('.interval-task-details').exists()).toBe(false)
    expect(wrapper.text()).toContain('Start interval')
  })

  it('opens the task menu without toggling the task card', async () => {
    const wrapper = mount(TaskCard, {
      props: { progress },
      global: {
        stubs: {
          VBtn: VBtnStub,
          VCard: { template: '<div><slot /></div>' },
          VExpandTransition: { template: '<div><slot /></div>' },
          ExpandTransition: { template: '<div><slot /></div>' },
          VIcon: true,
          VProgressCircular: { template: '<div><slot /></div>' },
          VProgressLinear: true,
        },
      },
    })

    await wrapper.get('[aria-label="More actions for Water"]').trigger('click')

    expect(wrapper.emitted('actions')).toEqual([[progress]])
    expect(wrapper.emitted('toggle')).toBeUndefined()
    expect(wrapper.get('.task-card-header-main').attributes('aria-expanded')).toBe('true')
  })

  it('accepts one check-off action and persists its explicit intended state', async () => {
    const checkProgress: TaskProgress = {
      ...progress,
      task: {
        ...progress.task,
        id: 'medication',
        name: 'Medication',
        type: 'check',
      },
    }
    const wrapper = mount(TaskCard, {
      props: { progress: checkProgress },
      global: {
        stubs: {
          VBtn: VBtnStub,
          VCard: { template: '<div><slot /></div>' },
          VExpandTransition: { template: '<div><slot /></div>' },
          ExpandTransition: { template: '<div><slot /></div>' },
          VIcon: true,
          VProgressCircular: { template: '<div><slot /></div>' },
          VProgressLinear: true,
        },
      },
    })

    await wrapper.get('[aria-label="Complete Medication"]').trigger('click')
    await wrapper.get('[aria-label="Mark Medication incomplete"]').trigger('click')

    expect(wrapper.emitted('toggle')).toEqual([[checkProgress, true]])

    const completedProgress: TaskProgress = {
      ...checkProgress,
      complete: true,
      percent: 100,
      status: 'completed',
    }
    await wrapper.setProps({ busy: true })
    await wrapper.setProps({ progress: completedProgress })
    await wrapper.setProps({ busy: false })
    await wrapper.get('[aria-label="Mark Medication incomplete"]').trigger('click')

    expect(wrapper.emitted('toggle')).toEqual([
      [checkProgress, true],
      [completedProgress, false],
    ])
  })

  it('expands and collapses from the card header without a separate control', async () => {
    const wrapper = mount(TaskCard, {
      props: { progress },
      global: {
        stubs: {
          VBtn: VBtnStub,
          VCard: { template: '<div><slot /></div>' },
          VExpandTransition: { template: '<div><slot /></div>' },
          ExpandTransition: { template: '<div><slot /></div>' },
          VIcon: true,
          VProgressCircular: { template: '<div><slot /></div>' },
          VProgressLinear: true,
        },
      },
    })

    expect(wrapper.find('.progress-number').exists()).toBe(false)
    expect(wrapper.text()).toContain('Log amount')
    expect(wrapper.get('.task-card-details').find('.status-banner.text-error').text()).toContain('Not enough yet')
    expect(wrapper.get('.status-banner__amount').text()).toBe('2 L remaining')
    expect(wrapper.get('.task-card-header-actions').findAll('button').map(button => button.attributes('aria-label')))
      .toEqual(['More actions for Water'])

    await wrapper.get('.task-card-header-main').trigger('click')

    expect(wrapper.get('.task-card-header-main').attributes('aria-label')).toBe('Expand Water')
    expect(wrapper.get('.task-card-header-main').attributes('aria-expanded')).toBe('false')
    expect(wrapper.get('.task-card-body').attributes('style')).toContain('display: none')
  })

  it('right-aligns missing and exceeded amounts for exact and maximum targets', async () => {
    const wrapper = mount(TaskCard, {
      props: {
        progress: {
          ...progress,
          value: 1,
          task: { ...progress.task, targetOperator: 'eq' },
        },
      },
      global: {
        stubs: {
          VBtn: VBtnStub,
          VCard: { template: '<div><slot /></div>' },
          VExpandTransition: { template: '<div><slot /></div>' },
          ExpandTransition: { template: '<div><slot /></div>' },
          VIcon: true,
          VProgressCircular: { template: '<div><slot /></div>' },
          VProgressLinear: true,
        },
      },
    })

    expect(wrapper.get('.status-banner__amount').text()).toBe('1 L missing')

    await wrapper.setProps({
      progress: {
        ...progress,
        value: 3,
        task: { ...progress.task, targetOperator: 'lte' },
      },
    })

    expect(wrapper.get('.status-banner__amount').text()).toBe('1 L over')
  })

  it('shows the remaining allowance and surpassed amount for daily totals', async () => {
    const wrapper = mount(TaskCard, {
      props: {
        progress: {
          ...progress,
          value: 1,
          task: { ...progress.task, targetOperator: 'lte' },
        },
      },
      global: {
        stubs: {
          VBtn: VBtnStub,
          VCard: { template: '<div><slot /></div>' },
          VExpandTransition: { template: '<div><slot /></div>' },
          ExpandTransition: { template: '<div><slot /></div>' },
          VIcon: true,
          VProgressCircular: { template: '<div><slot /></div>' },
          VProgressLinear: true,
        },
      },
    })

    expect(wrapper.get('.status-banner.text-success').text()).toContain('Within target')
    expect(wrapper.get('.status-banner__amount').text()).toBe('1 L remaining')

    await wrapper.setProps({
      progress: {
        ...progress,
        value: 3,
        task: { ...progress.task, targetOperator: 'gte' },
      },
    })

    expect(wrapper.get('.status-banner.text-success').text()).toContain('Target surpassed')
    expect(wrapper.get('.status-banner__amount').text()).toBe('1 L over')
  })

  it('collapses every element below the header, including stacked status banners', async () => {
    const wrapper = mount(TaskCard, {
      props: {
        progress: {
          ...progress,
          locked: true,
          status: 'missed',
        },
      },
      global: {
        stubs: {
          VBtn: VBtnStub,
          VCard: { template: '<div><slot /></div>' },
          VExpandTransition: { template: '<div><slot /></div>' },
          ExpandTransition: { template: '<div><slot /></div>' },
          VIcon: true,
          VProgressCircular: { template: '<div><slot /></div>' },
          VProgressLinear: true,
        },
      },
    })

    expect(wrapper.get('.task-card-body').text()).toContain('Complete or resolve earlier program steps first')
    expect(wrapper.get('.task-card-body').text()).toContain('Missed')

    await wrapper.get('.task-card-header-main').trigger('click')

    expect(wrapper.get('.task-card-body').attributes('style')).toContain('display: none')
  })

  it('remembers each task expansion state for the browser session', async () => {
    const stubs = {
      VBtn: VBtnStub,
      VCard: { template: '<div><slot /></div>' },
      VExpandTransition: { template: '<div><slot /></div>' },
      ExpandTransition: { template: '<div><slot /></div>' },
      VIcon: true,
      VProgressCircular: { template: '<div><slot /></div>' },
      VProgressLinear: true,
    }
    const first = mount(TaskCard, {
      props: { progress },
      global: { stubs },
    })

    await first.get('.task-card-header-main').trigger('click')
    expect(first.get('.task-card-header-main').attributes('aria-expanded')).toBe('false')
    first.unmount()

    const restored = mount(TaskCard, {
      props: { progress },
      global: { stubs },
    })
    expect(restored.get('.task-card-header-main').attributes('aria-expanded')).toBe('false')

    const otherTask = mount(TaskCard, {
      props: {
        progress: {
          ...progress,
          task: { ...progress.task, id: 'protein', name: 'Protein' },
        },
      },
      global: { stubs },
    })
    expect(otherTask.get('.task-card-header-main').attributes('aria-expanded')).toBe('true')
  })

  it('automatically collapses when the task becomes complete', async () => {
    const wrapper = mount(TaskCard, {
      props: { progress },
      global: {
        stubs: {
          VBtn: VBtnStub,
          VCard: { template: '<div><slot /></div>' },
          VExpandTransition: { template: '<div><slot /></div>' },
          ExpandTransition: { template: '<div><slot /></div>' },
          VIcon: true,
          VProgressCircular: { template: '<div><slot /></div>' },
          VProgressLinear: true,
        },
      },
    })

    expect(wrapper.get('.task-card-header-main').attributes('aria-expanded')).toBe('true')

    await wrapper.setProps({
      progress: {
        ...progress,
        complete: true,
        percent: 100,
        status: 'completed',
      },
    })

    expect(wrapper.get('.task-card-header-main').attributes('aria-expanded')).toBe('false')
    expect(wrapper.get('.task-action-stack').isVisible()).toBe(false)
  })
})
