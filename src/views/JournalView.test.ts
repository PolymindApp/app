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
    loadedRange: '2026-08-01:2026-08-31',
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

const WeekNavigatorStub = defineComponent({
  props: {
    modelValue: { type: Date, required: true },
    type: String,
  },
  emits: ['update:modelValue'],
  template: `
    <div>
      <button class="previous-date" @click="$emit('update:modelValue', new Date(2026, 6, 1, 12))">Previous</button>
      <button class="next-date" @click="$emit('update:modelValue', new Date(2026, 8, 1, 12))">Next</button>
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

describe('JournalView month navigation', () => {
  beforeEach(() => {
    mocks.journalStore.entries = [
      entry('previous', '2026-08-04', 'Previous reflection'),
      entry('selected', '2026-08-05', 'Selected reflection'),
      entry('next', '2026-08-06', 'Next reflection'),
    ]
    mocks.journalStore.loadRange.mockReset().mockResolvedValue(true)
    mocks.journalStore.loading = false
    mocks.journalStore.loaded = true
    mocks.journalStore.loadedRange = '2026-08-01:2026-08-31'
    mocks.taskStore.load.mockReset().mockResolvedValue(undefined)
    mocks.trackingStore.trackers = []
    mocks.trackingStore.load.mockReset().mockResolvedValue(undefined)
  })

  it('keeps the loaded month visible during a background refresh', () => {
    mocks.journalStore.loading = true
    mocks.journalStore.loadRange.mockReturnValue(new Promise(() => undefined))

    const wrapper = mount(JournalView, {
      global: {
        stubs: {
          WeekNavigator: WeekNavigatorStub,
          VAlert: { template: '<div><slot /><slot name="append" /></div>' },
          VBtn: { template: '<button><slot /></button>' },
          VCard: { template: '<article><slot /></article>' },
          VChip: { template: '<span><slot /></span>' },
          VIcon: true,
          VProgressCircular: true,
        },
      },
    })

    expect(wrapper.text()).toContain('Selected reflection')
    expect(wrapper.text()).not.toContain('Loading reflections…')
  })

  it('does not show entries cached for another month during initial hydration', () => {
    mocks.journalStore.loading = true
    mocks.journalStore.loadedRange = '2026-07-01:2026-07-31'
    mocks.journalStore.loadRange.mockReturnValue(new Promise(() => undefined))

    const wrapper = mount(JournalView, {
      global: {
        stubs: {
          WeekNavigator: WeekNavigatorStub,
          VAlert: { template: '<div><slot /><slot name="append" /></div>' },
          VBtn: { template: '<button><slot /></button>' },
          VCard: { template: '<article><slot /></article>' },
          VChip: { template: '<span><slot /></span>' },
          VIcon: true,
          VProgressCircular: true,
        },
      },
    })

    expect(wrapper.text()).toContain('Loading reflections…')
    expect(wrapper.text()).not.toContain('Selected reflection')
  })

  it('loads a full month and lists all reflections newest first', async () => {
    const wrapper = mount(JournalView, {
      global: {
        stubs: {
          WeekNavigator: WeekNavigatorStub,
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

    expect(wrapper.getComponent(WeekNavigatorStub).props('type')).toBe('month')
    expect(wrapper.findAll('.new-reflection-action')).toHaveLength(1)
    expect(wrapper.get('.new-reflection-action').classes()).toContain('mt-3')
    expect(wrapper.get('.new-reflection-action').text()).toContain('New reflection')
    expect(wrapper.get('.new-reflection-action').element.compareDocumentPosition(selectedContent))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(mocks.journalStore.loadRange).toHaveBeenCalledWith('2026-08-01', '2026-08-31')
    expect(wrapper.get('transition-stub').attributes('name')).toBe('page-level-forward')
    expect(wrapper.findAll('.journal-entry').map(item => item.text())).toEqual([
      expect.stringContaining('Next reflection'),
      expect.stringContaining('Selected reflection'),
      expect.stringContaining('Previous reflection'),
    ])
    expect(wrapper.find('.section-heading .text-caption').exists()).toBe(false)
    expect(wrapper.text()).toContain('Selected reflection')

    await wrapper.get('.next-date').trigger('click')
    await nextTick()

    const nextContent = wrapper.get('.journal-date-content').element
    expect(mocks.journalStore.loadRange).toHaveBeenLastCalledWith('2026-09-01', '2026-09-30')
    expect(wrapper.get('transition-stub').attributes('name')).toBe('page-level-forward')
    expect(nextContent).not.toBe(selectedContent)

    await wrapper.get('.previous-date').trigger('click')
    await nextTick()

    expect(mocks.journalStore.loadRange).toHaveBeenLastCalledWith('2026-07-01', '2026-07-31')
    expect(wrapper.get('transition-stub').attributes('name')).toBe('page-level-back')
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
          WeekNavigator: WeekNavigatorStub,
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
