import { defineComponent, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import JournalView from './JournalView.vue'

const mocks = vi.hoisted(() => ({
  route: { query: { date: '2026-08-05' } as Record<string, string> },
  router: { push: vi.fn(), replace: vi.fn() },
  journalStore: {
    entries: [] as Record<string, unknown>[],
    loading: false,
    loaded: true,
    error: '',
    loadRange: vi.fn(),
  },
  taskStore: { tasks: [] as Record<string, unknown>[], load: vi.fn() },
  trackingStore: { trackers: [] as Record<string, unknown>[], loaded: true, load: vi.fn() },
}))

vi.mock('vue-router', () => ({
  useRoute: () => mocks.route,
  useRouter: () => mocks.router,
}))

vi.mock('vuetify/directives', () => ({ Ripple: {} }))
vi.mock('@/stores/journal', () => ({ useJournalStore: () => mocks.journalStore }))
vi.mock('@/stores/tasks', () => ({ useTaskStore: () => mocks.taskStore }))
vi.mock('@/stores/tracking', () => ({ useTrackingStore: () => mocks.trackingStore }))

const WeekDateNavigatorStub = defineComponent({
  props: {
    modelValue: { type: Date, required: true },
    weekStart: Date,
  },
  emits: ['update:modelValue', 'update:weekStart'],
  template: `
    <div>
      <button class="previous-date" @click="$emit('update:modelValue', new Date(2026, 7, 4, 12))">Previous</button>
      <button class="next-date" @click="$emit('update:modelValue', new Date(2026, 7, 6, 12))">Next</button>
    </div>
  `,
})

function entry(id: string, date: string, body: string) {
  return {
    id,
    title: '',
    body,
    occurredAt: `${date}T16:00:00.000Z`,
    localDate: date,
    timezoneOffset: 240,
    trackers: [],
    taskSnapshot: '',
    trackerSnapshots: {},
    createdAt: `${date}T16:00:00.000Z`,
    updatedAt: `${date}T16:00:00.000Z`,
  }
}

describe('JournalView date navigation', () => {
  beforeEach(() => {
    mocks.journalStore.entries = [
      entry('previous', '2026-08-04', 'Previous reflection'),
      entry('selected', '2026-08-05', 'Selected reflection'),
      entry('next', '2026-08-06', 'Next reflection'),
    ]
    mocks.journalStore.loadRange.mockReset().mockResolvedValue(true)
    mocks.taskStore.load.mockReset().mockResolvedValue(undefined)
    mocks.trackingStore.trackers = []
    mocks.trackingStore.load.mockReset().mockResolvedValue(undefined)
  })

  it('reuses forward and back route transitions for the content below the date navigator', async () => {
    const wrapper = mount(JournalView, {
      global: {
        stubs: {
          WeekDateNavigator: WeekDateNavigatorStub,
          VAlert: { template: '<div><slot /><slot name="append" /></div>' },
          VBtn: { template: '<button><slot /></button>' },
          VCard: { template: '<article><slot /></article>' },
          VChip: { template: '<span><slot /></span>' },
          VIcon: true,
          VProgressCircular: true,
        },
      },
    })
    const selectedContent = wrapper.get('.journal-date-content').element

    expect(wrapper.get('transition-stub').attributes('name')).toBe('page-level-forward')
    expect(wrapper.text()).toContain('Selected reflection')

    await wrapper.get('.next-date').trigger('click')
    await nextTick()

    const nextContent = wrapper.get('.journal-date-content').element
    expect(wrapper.get('transition-stub').attributes('name')).toBe('page-level-forward')
    expect(wrapper.text()).toContain('Next reflection')
    expect(nextContent).not.toBe(selectedContent)

    await wrapper.get('.previous-date').trigger('click')
    await nextTick()

    expect(wrapper.get('transition-stub').attributes('name')).toBe('page-level-back')
    expect(wrapper.text()).toContain('Previous reflection')
    expect(wrapper.get('.journal-date-content').element).not.toBe(nextContent)
  })

  it('shows every tracker attached to a reflection', () => {
    mocks.journalStore.entries = [{
      ...entry('selected', '2026-08-05', 'Tracked reflection'),
      trackers: ['mood', 'energy'],
      trackerSnapshots: { mood: 'Mood snapshot', energy: 'Energy snapshot' },
    }]
    mocks.trackingStore.trackers = [
      { id: 'mood', name: 'Mood', color: '#D4A5FF', icon: 'mdi-emoticon-outline' },
      { id: 'energy', name: 'Energy', color: '#C7F464', icon: 'mdi-lightning-bolt-outline' },
    ]
    const wrapper = mount(JournalView, {
      global: {
        stubs: {
          WeekDateNavigator: WeekDateNavigatorStub,
          VAlert: { template: '<div><slot /><slot name="append" /></div>' },
          VBtn: { template: '<button><slot /></button>' },
          VCard: { template: '<article><slot /></article>' },
          VChip: { template: '<span><slot /></span>' },
          VIcon: true,
          VProgressCircular: true,
        },
      },
    })

    expect(wrapper.text()).toContain('Mood')
    expect(wrapper.text()).toContain('Energy')
  })
})
