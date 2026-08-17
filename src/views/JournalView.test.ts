import { nextTick } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import JournalView from './JournalView.vue'

const mocks = vi.hoisted(() => ({
  route: { query: { date: '2026-08-05' } as Record<string, string> },
  router: { push: vi.fn(), replace: vi.fn() },
  journalStore: {
    entries: [] as Record<string, unknown>[],
    loading: false,
    loaded: true,
    loadedRange: '',
    error: '',
    loadTimelinePage: vi.fn(),
  },
  taskStore: { tasks: [] as Record<string, unknown>[], load: vi.fn() },
  trackingStore: { trackers: [] as Record<string, unknown>[], loaded: true, load: vi.fn() },
}))

vi.mock('vue-router', () => ({
  useRoute: () => mocks.route,
  useRouter: () => mocks.router,
}))

vi.mock('vuetify/directives', () => ({ Intersect: {}, Ripple: {} }))
vi.mock('@/stores/journal', () => ({ useJournalStore: () => mocks.journalStore }))
vi.mock('@/stores/tasks', () => ({ useTaskStore: () => mocks.taskStore }))
vi.mock('@/stores/tracking', () => ({ useTrackingStore: () => mocks.trackingStore }))

function entry(id: string, date: string, body: string) {
  return {
    id,
    title: '',
    body,
    color: '#D4A5FF',
    image: '',
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

function mountView() {
  return mount(JournalView, {
    global: {
      stubs: {
        ActionBottomSheet: { template: '<div><slot name="content" /><slot /></div>' },
        ColorSwatchPicker: true,
        VAlert: { template: '<div><slot /><slot name="append" /></div>' },
        VBtn: { template: '<button><slot /></button>' },
        VCard: { template: '<article><slot /></article>' },
        VChip: { template: '<span><slot /></span>' },
        VIcon: true,
        VImg: true,
        VProgressCircular: true,
        VTextField: true,
      },
    },
  })
}

describe('JournalView timeline', () => {
  beforeEach(() => {
    mocks.journalStore.entries = [
      entry('previous', '2026-08-04', 'Previous reflection'),
      entry('selected', '2026-08-05', 'Selected reflection'),
      entry('next', '2026-08-06', 'Next reflection'),
    ]
    mocks.journalStore.loadTimelinePage.mockReset().mockResolvedValue(false)
    mocks.journalStore.error = ''
    mocks.taskStore.load.mockReset().mockResolvedValue(undefined)
    mocks.trackingStore.trackers = []
    mocks.trackingStore.load.mockReset().mockResolvedValue(undefined)
  })

  it('loads the first timeline page and lists reflections newest first', async () => {
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.findComponent({ name: 'WeekNavigator' }).exists()).toBe(false)
    expect(mocks.journalStore.loadTimelinePage).toHaveBeenCalledWith(1, '2026-08-31')
    expect(wrapper.findAll('.new-reflection-action')).toHaveLength(1)
    expect(wrapper.findAll('.journal-entry').map(item => item.text())).toEqual([
      expect.stringContaining('Next reflection'),
      expect.stringContaining('Selected reflection'),
      expect.stringContaining('Previous reflection'),
    ])
    expect(wrapper.findAll('.section-heading').at(0)?.text()).toContain('2026')
  })

  it('does not show entries from another cached range before timeline hydration', async () => {
    mocks.journalStore.loadTimelinePage.mockReturnValue(new Promise(() => undefined))

    const wrapper = mountView()
    await nextTick()

    expect(wrapper.text()).toContain('Loading reflections…')
    expect(wrapper.text()).not.toContain('Selected reflection')
  })

  it('shows every tracker attached to a reflection', async () => {
    mocks.journalStore.entries = [{
      ...entry('selected', '2026-08-05', 'Tracked reflection'),
      trackers: ['mood', 'energy'],
      trackerSnapshots: { mood: 'Mood snapshot', energy: 'Energy snapshot' },
    }]
    mocks.trackingStore.trackers = [
      { id: 'mood', name: 'Mood', color: '#D4A5FF', icon: 'mdi-emoticon-outline' },
      { id: 'energy', name: 'Energy', color: '#C7F464', icon: 'mdi-lightning-bolt-outline' },
    ]
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.text()).toContain('Mood')
    expect(wrapper.text()).toContain('Energy')
  })
})
