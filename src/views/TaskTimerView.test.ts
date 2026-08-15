import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import TaskTimerView from './TaskTimerView.vue'
import type { TaskProgress, TrackingTracker } from '@/types/domain'

const mocks = vi.hoisted(() => ({
  route: {
    params: { id: 'tracking-task' },
    query: { date: '2026-08-06', tracker: 'focus-time' },
  },
  router: { push: vi.fn(), replace: vi.fn() },
  taskStore: {
    tasks: [] as TaskProgress['task'][],
    selectedDate: new Date(),
    load: vi.fn(),
    makeProgress: vi.fn(),
    addEntry: vi.fn(),
  },
  trackingStore: {
    loaded: true,
    trackers: [] as TrackingTracker[],
    entries: [] as Array<Record<string, unknown>>,
    load: vi.fn(),
    addEntry: vi.fn(),
  },
}))

vi.mock('vue-router', () => ({
  useRoute: () => mocks.route,
  useRouter: () => mocks.router,
  onBeforeRouteLeave: vi.fn(),
}))
vi.mock('@/stores/tasks', () => ({ useTaskStore: () => mocks.taskStore }))
vi.mock('@/stores/tracking', () => ({ useTrackingStore: () => mocks.trackingStore }))
vi.mock('@/services/intervalCues', () => ({
  playTaskCompleteCue: vi.fn(),
  prepareTaskCompleteCue: vi.fn(),
  requestIntervalWakeLock: vi.fn().mockResolvedValue(undefined),
}))

const VBtnStub = defineComponent({
  props: { disabled: Boolean },
  emits: ['click'],
  template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
})

const ConfirmDialogStub = defineComponent({
  props: { modelValue: Boolean },
  emits: ['confirm'],
  template: '<button v-if="modelValue" class="confirm-timer-log" @click="$emit(\'confirm\')">Confirm</button>',
})

describe('TaskTimerView duration trackers', () => {
  beforeEach(() => {
    localStorage.clear()
    mocks.router.push.mockReset()
    mocks.router.replace.mockReset()
    mocks.taskStore.load.mockReset().mockResolvedValue(undefined)
    mocks.taskStore.addEntry.mockReset()
    mocks.trackingStore.load.mockReset().mockResolvedValue(undefined)
    mocks.trackingStore.addEntry.mockReset().mockResolvedValue(undefined)
    mocks.taskStore.tasks = [{
      id: 'tracking-task',
      name: 'Deep work tracking',
      description: '',
      type: 'tracking',
      mandatory: true,
      reviewWhenMissed: false,
      active: true,
      startDate: '2026-08-01',
      recurrenceType: 'daily',
      weekdays: [],
      intervalWeeks: 1,
      entryNotesEnabled: false,
      entryNoteSuggestionsEnabled: false,
      reminderEnabled: false,
      reminderTimes: [],
      sortOrder: 0,
      trackingTrackers: ['focus-time'],
    }]
    mocks.trackingStore.trackers = [{
      id: 'focus-time',
      name: 'Focus time',
      description: '',
      role: 'factor',
      kind: 'duration',
      category: 'activity',
      unit: 'minutes',
      scaleMin: 0,
      scaleMax: 0,
      favorableDirection: 'neutral',
      dailyAggregation: 'sum',
      active: true,
      sortOrder: 0,
      color: '#66D9C8',
      icon: 'mdi-timer-outline',
    }]
    mocks.trackingStore.entries = [{
      id: 'prior-log',
      tracker: 'focus-time',
      occurredAt: '2026-08-06T12:00:00.000Z',
      localDate: '2026-08-06',
      timezoneOffset: 240,
      value: 1800,
      note: '',
    }]
    mocks.taskStore.makeProgress.mockReset().mockReturnValue({
      task: mocks.taskStore.tasks[0],
      scheduledDate: '2026-08-06',
      value: 1,
      percent: 100,
      complete: true,
      status: 'completed',
    })
    localStorage.setItem('backontrack-task-timer:tracking-task:tracker:focus-time:2026-08-06', JSON.stringify({
      version: 1,
      taskId: 'tracking-task:tracker:focus-time',
      dateKey: '2026-08-06',
      status: 'paused',
      accumulatedMs: 60_000,
      completionCuePlayed: false,
      updatedAt: '2026-08-06T12:01:00.000Z',
    }))
  })

  it('logs timer seconds to the attached duration tracker', async () => {
    const wrapper = mount(TaskTimerView, {
      global: {
        stubs: {
          ConfirmDialog: ConfirmDialogStub,
          VAlert: true,
          VBtn: VBtnStub,
          VProgressCircular: { template: '<div><slot /></div>' },
        },
      },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('Focus time')
    expect(wrapper.text()).toContain('30m logged before this timer')
    await wrapper.get('[aria-label="Stop and log time"]').trigger('click')
    await wrapper.get('.confirm-timer-log').trigger('click')
    await flushPromises()

    expect(mocks.trackingStore.addEntry).toHaveBeenCalledWith(expect.objectContaining({
      tracker: 'focus-time',
      localDate: '2026-08-06',
      value: 60,
      note: 'Logged with timer',
    }))
    expect(mocks.taskStore.addEntry).not.toHaveBeenCalled()
    expect(mocks.router.replace).toHaveBeenCalledWith('/tasks')
    expect(localStorage.getItem('backontrack-task-timer:tracking-task:tracker:focus-time:2026-08-06')).toBeNull()

    wrapper.unmount()
  })
})
