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

const VListItemStub = defineComponent({
  props: { title: String, subtitle: String },
  template: '<div><slot name="prepend" /><span>{{ title }}</span><small>{{ subtitle }}</small><slot name="append" /></div>',
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
    reminderEnabled: false,
    reminderTimes: [],
    sortOrder: 0,
  },
  scheduledDate: '2026-08-01',
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
  it('opens a reflection from a journaling task', async () => {
    const journalProgress: TaskProgress = {
      ...progress,
      task: {
        ...progress.task,
        id: 'daily-reflection',
        name: 'Daily reflection',
        type: 'journal',
      },
    }
    const wrapper = mount(TaskCard, {
      props: { progress: journalProgress, canWriteJournal: true },
      global: {
        stubs: {
          VBtn: VBtnStub,
          VCard: { template: '<div><slot /></div>' },
          VExpandTransition: { template: '<div><slot /></div>' },
          ExpandTransition: { template: '<div><slot /></div>' },
          VIcon: true,
        },
      },
    })

    const writeButton = wrapper.findAll('button').find(button => button.text() === 'Write reflection')
    expect(writeButton).toBeDefined()
    await writeButton!.trigger('click')
    expect(wrapper.emitted('writeJournal')).toEqual([[journalProgress]])
  })

  it('opens a tracker log by clicking its list item', async () => {
    const trackingProgress: TaskProgress = {
      ...progress,
      task: {
        ...progress.task,
        id: 'daily-check-in',
        name: 'Daily check-in',
        type: 'tracking',
        trackingTrackers: ['mood', 'energy'],
      },
      value: 1,
      percent: 50,
    }
    const wrapper = mount(TaskCard, {
      props: {
        progress: trackingProgress,
        canLogTracking: true,
        trackers: [
          { id: 'mood', name: 'Mood', kind: 'rating', icon: 'mdi-emoticon-outline', color: '#D4A5FF', logged: true },
          { id: 'energy', name: 'Energy', kind: 'rating', icon: 'mdi-lightning-bolt-outline', color: '#FFB86B', logged: false },
        ],
      },
      global: {
        stubs: {
          VBtn: VBtnStub,
          VCard: { template: '<div><slot /></div>' },
          VList: { template: '<div><slot /></div>' },
          VListItem: VListItemStub,
          VExpandTransition: { template: '<div><slot /></div>' },
          ExpandTransition: { template: '<div><slot /></div>' },
          VIcon: true,
          VProgressCircular: { template: '<div><slot /></div>' },
          VProgressLinear: true,
        },
      },
    })

    expect(wrapper.text()).toContain('1 of 2 trackers logged')
    expect(wrapper.text()).toContain('Mood')
    expect(wrapper.text()).toContain('Energy')
    expect(wrapper.text()).toContain('Logged for this date')
    expect(wrapper.text()).toContain('Not logged for this date')

    expect(wrapper.findAll('button').filter(item => item.text() === 'Log')).toHaveLength(0)
    const trackerItems = wrapper.findAllComponents(VListItemStub)
    expect(trackerItems).toHaveLength(2)
    await trackerItems[1]!.trigger('click')
    expect(wrapper.emitted('logTracking')).toEqual([[trackingProgress, 'energy']])
  })

  it('offers amount and timer actions for a duration tracker', async () => {
    const trackingProgress: TaskProgress = {
      ...progress,
      task: {
        ...progress.task,
        id: 'mindfulness-time',
        name: 'Mindfulness time',
        type: 'tracking',
        trackingTrackers: ['meditation-duration'],
      },
      value: 0,
      percent: 0,
    }
    const wrapper = mount(TaskCard, {
      props: {
        progress: trackingProgress,
        canLogTracking: true,
        trackers: [{
          id: 'meditation-duration',
          name: 'Meditation duration',
          kind: 'duration',
          icon: 'mdi-timer-outline',
          color: '#66D9C8',
          logged: true,
          loggedValue: '30m',
        }],
      },
      global: {
        stubs: {
          VBtn: VBtnStub,
          VCard: { template: '<div><slot /></div>' },
          VList: { template: '<div><slot /></div>' },
          VListItem: VListItemStub,
          VExpandTransition: { template: '<div><slot /></div>' },
          ExpandTransition: { template: '<div><slot /></div>' },
          VIcon: true,
          VProgressCircular: { template: '<div><slot /></div>' },
          VProgressLinear: true,
        },
      },
    })
    const logAmount = wrapper.findAll('button').find(button => button.text() === 'Log amount')
    const logTime = wrapper.findAll('button').find(button => button.text() === 'Log time')

    expect(logAmount).toBeDefined()
    expect(logTime).toBeDefined()
    expect(wrapper.text()).toContain('30m logged for this date')
    await logAmount!.trigger('click')
    await logTime!.trigger('click')

    expect(wrapper.emitted('logTracking')).toEqual([[trackingProgress, 'meditation-duration']])
    expect(wrapper.emitted('logTrackingTime')).toEqual([[trackingProgress, 'meditation-duration']])
  })

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
      props: {
        progress: stepProgress,
        stepCountError: 'Open Polymind on a supported Android device to load steps from Health Connect.',
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

    expect(wrapper.text()).toContain('4,200 steps')
    expect(wrapper.text()).toContain('Health Connect')
    expect(wrapper.text()).not.toContain('Log amount')
    const sourceMessage = wrapper.get('.step-source-message')
    expect(sourceMessage.text()).toContain('Open Polymind on a supported Android device')
    expect(sourceMessage.element.compareDocumentPosition(wrapper.get('.step-source').element)
      & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
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

  it('uses the Manage Tasks type icon treatment for an incomplete task', () => {
    const durationProgress: TaskProgress = {
      ...progress,
      task: {
        ...progress.task,
        id: 'focus-time',
        name: 'Focus time',
        type: 'duration',
        color: undefined,
        targetValue: 4,
        unit: 'hours',
      },
      value: 1,
      percent: 25,
    }
    const wrapper = mount(TaskCard, {
      props: { progress: durationProgress },
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

    expect(wrapper.get('.check-control').classes()).toContain('check-control--type')
    expect(wrapper.get('.check-control v-icon-stub').attributes('icon')).toBe('mdi-timer-outline')
    expect(wrapper.get('.task-card').attributes('style')).toContain('--task-color: #D4A5FF')
  })

  it('keeps a completed check-off inside the status-control treatment', () => {
    const completedCheck: TaskProgress = {
      ...progress,
      task: {
        ...progress.task,
        id: 'medication',
        name: 'Medication',
        type: 'check',
        color: '#8FB8FF',
      },
      value: 0,
      percent: 100,
      complete: true,
      status: 'completed',
    }
    const wrapper = mount(TaskCard, {
      props: { progress: completedCheck },
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

    const control = wrapper.get('div.check-control')
    expect(control.classes()).toContain('check-control--status')
    expect(control.classes()).toContain('check-control--done')
    expect(control.classes()).not.toContain('check-control--type')
    expect(control.get('v-icon-stub').attributes('icon')).toBe('mdi-check-bold')
  })

  it('reflects live Review set details and launches the attached set', async () => {
    const flashcardProgress: TaskProgress = {
      ...progress,
      task: {
        ...progress.task,
        id: 'review-algebra',
        name: 'Review algebra',
        type: 'flashcards',
        flashcardReviewSet: 'algebra',
      },
    }
    const wrapper = mount(TaskCard, {
      props: {
        progress: flashcardProgress,
        reviewSet: { name: 'Algebra', cardCount: 12, mode: 'manual' },
        canStartReview: true,
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

    expect(wrapper.get('.task-subtitle').text()).toBe('Algebra · Manual · 12 cards')

    await wrapper.setProps({
      reviewSet: { name: 'Advanced algebra', cardCount: 1, mode: 'passive' },
    })
    expect(wrapper.get('.task-subtitle').text()).toBe('Advanced algebra · Passive · 1 card')

    const start = wrapper.findAll('button').find(button => button.text() === 'Start review')
    expect(start).toBeDefined()
    await start!.trigger('click')
    expect(wrapper.emitted('startReview')).toEqual([[flashcardProgress]])
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
    expect(wrapper.get('.task-card-header-main').attributes()).toHaveProperty('data-task-drag-handle')
    expect(wrapper.get('.task-menu-button').attributes()).not.toHaveProperty('data-task-drag-handle')
  })

  it('keeps tasks outside the schedule compact and editable', async () => {
    const wrapper = mount(TaskCard, {
      props: { progress, scheduleStatus: 'not-scheduled' },
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

    expect(wrapper.get('.schedule-status').text()).toBe('Not scheduled')
    expect(wrapper.find('.task-card-body').exists()).toBe(false)
    expect(wrapper.get('.task-card-header-main').attributes()).not.toHaveProperty('role')
    expect(wrapper.get('.task-card-header-main').attributes()).not.toHaveProperty('aria-expanded')

    await wrapper.get('[aria-label="More actions for Water"]').trigger('click')
    expect(wrapper.emitted('actions')).toEqual([[progress]])

    await wrapper.setProps({ scheduleStatus: 'paused' })
    expect(wrapper.get('.schedule-status').text()).toBe('Paused')
  })

  it('expands a check-off from its header and toggles only from Done or Undone', async () => {
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

    const statusIcon = wrapper.get('div.check-control')
    const header = wrapper.get('.task-card-header-main')
    expect(wrapper.get('[aria-label="More actions for Medication"]').exists()).toBe(true)
    expect(statusIcon.attributes('aria-hidden')).toBe('true')
    expect(header.attributes('aria-expanded')).toBe('true')
    await statusIcon.trigger('click')
    await wrapper.get('.task-card').trigger('click')
    expect(wrapper.emitted('toggle')).toBeUndefined()
    expect(header.attributes('aria-label')).toBe('Expand Medication')
    expect(header.attributes('aria-expanded')).toBe('false')
    expect(wrapper.get('.task-card-body').attributes('style')).toContain('display: none')

    await header.trigger('click')
    expect(header.attributes('aria-expanded')).toBe('true')

    const completeButton = wrapper.get('[aria-label="Done Medication"]')
    expect(completeButton.text()).toBe('Done')
    await completeButton.trigger('click')
    await completeButton.trigger('click')

    expect(wrapper.emitted('toggle')).toEqual([[checkProgress, true]])
    expect(header.attributes('aria-expanded')).toBe('false')

    const completedProgress: TaskProgress = {
      ...checkProgress,
      complete: true,
      percent: 100,
      status: 'completed',
    }
    await wrapper.setProps({ busy: true })
    await wrapper.setProps({ progress: completedProgress })
    await wrapper.setProps({ busy: false })
    await header.trigger('click')
    const uncompleteButton = wrapper.get('[aria-label="Undone Medication"]')
    expect(uncompleteButton.text()).toBe('Undone')
    await uncompleteButton.trigger('click')

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
