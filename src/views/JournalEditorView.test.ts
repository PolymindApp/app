import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import JournalEditorView from './JournalEditorView.vue'

const mocks = vi.hoisted(() => ({
  route: {
    params: {} as Record<string, string>,
    query: {} as Record<string, string>,
  },
  router: { back: vi.fn(), replace: vi.fn() },
  journalStore: {
    entries: [] as Record<string, any>[],
    getEntry: vi.fn(),
    saveEntry: vi.fn(),
    deleteEntry: vi.fn(),
  },
  taskStore: {
    tasks: [] as Record<string, any>[],
    loading: false,
    load: vi.fn(),
  },
  trackingStore: {
    trackers: [] as Record<string, any>[],
    loading: false,
    loaded: false,
    load: vi.fn(),
  },
}))

vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => 'web' } }))
vi.mock('vue-router', () => ({
  useRoute: () => mocks.route,
  useRouter: () => mocks.router,
}))
vi.mock('@/stores/journal', () => ({ useJournalStore: () => mocks.journalStore }))
vi.mock('@/stores/tasks', () => ({ useTaskStore: () => mocks.taskStore }))
vi.mock('@/stores/tracking', () => ({ useTrackingStore: () => mocks.trackingStore }))

const AppFormStub = defineComponent({
  template: '<form><slot /></form>',
})
const BodyFieldStub = defineComponent({
  props: ['modelValue'],
  template: '<div class="body-field">{{ modelValue }}<slot name="label" /></div>',
})
const TitleFieldStub = defineComponent({
  props: ['modelValue'],
  template: '<div class="title-field">{{ modelValue }}</div>',
})
const DateFieldStub = defineComponent({
  props: ['modelValue'],
  template: '<div class="date-field">{{ modelValue }}</div>',
})
const SelectFieldStub = defineComponent({
  props: ['modelValue', 'loading'],
  template: '<div class="select-field">{{ modelValue }}</div>',
})

function reflection(id = 'reflection-1') {
  return {
    id,
    title: 'A title',
    body: 'Cached reflection',
    color: '#D4A5FF',
    image: '/api/journal-images/cached.jpg',
    occurredAt: '2026-08-05T16:00:00.000Z',
    localDate: '2026-08-05',
    timezoneOffset: 240,
    task: 'task-1',
    trackers: ['tracker-1'],
    taskSnapshot: '',
    trackerSnapshots: {},
    createdAt: '2026-08-05T16:00:00.000Z',
    updatedAt: '2026-08-05T16:00:00.000Z',
  }
}

function mountEditor() {
  return mount(JournalEditorView, {
    global: {
      stubs: {
        AppForm: AppFormStub,
        ColorSwatchPicker: true,
        ConfirmDialog: true,
        DateTimePickerField: DateFieldStub,
        FormActionBar: true,
        JournalImageField: true,
        VAlert: { template: '<div><slot /></div>' },
        VCard: { template: '<div><slot /></div>' },
        VProgressCircular: true,
        VSelect: SelectFieldStub,
        VTextField: TitleFieldStub,
        VTextarea: BodyFieldStub,
      },
    },
  })
}

describe('JournalEditorView local hydration', () => {
  beforeEach(() => {
    mocks.route.params = {}
    mocks.route.query = { date: '2026-08-05', task: 'task-1', tracker: 'tracker-1' }
    mocks.journalStore.entries = []
    mocks.journalStore.getEntry.mockReset()
    mocks.journalStore.saveEntry.mockReset()
    mocks.journalStore.deleteEntry.mockReset()
    mocks.taskStore.tasks = []
    mocks.taskStore.loading = true
    mocks.taskStore.load.mockReset().mockReturnValue(new Promise(() => undefined))
    mocks.trackingStore.trackers = []
    mocks.trackingStore.loading = true
    mocks.trackingStore.loaded = false
    mocks.trackingStore.load.mockReset().mockReturnValue(new Promise(() => undefined))
  })

  it('renders a new reflection immediately while context options load', () => {
    const wrapper = mountEditor()

    expect(wrapper.find('.journal-editor-fields').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('Loading reflection…')
    expect(wrapper.getComponent(DateFieldStub).props('modelValue')).toContain('2026-08-05')
    expect(wrapper.findAllComponents(SelectFieldStub).map(field => field.props('modelValue')))
      .toEqual(['task-1', ['tracker-1']])
    expect(mocks.taskStore.load).toHaveBeenCalledOnce()
    expect(mocks.trackingStore.load).toHaveBeenCalledOnce()
  })

  it('renders an in-memory edit without an intermediate loading state', () => {
    mocks.route.params = { id: 'reflection-1' }
    mocks.journalStore.entries = [reflection()]

    const wrapper = mountEditor()

    expect(wrapper.text()).not.toContain('Loading reflection…')
    expect(wrapper.getComponent(BodyFieldStub).props('modelValue')).toBe('Cached reflection')
    expect(wrapper.getComponent(TitleFieldStub).props('modelValue')).toBe('A title')
    expect(mocks.journalStore.getEntry).not.toHaveBeenCalled()
  })

  it('shows an IndexedDB edit as soon as it resolves without waiting for context options', async () => {
    mocks.route.params = { id: 'reflection-1' }
    mocks.journalStore.getEntry.mockResolvedValue(reflection())

    const wrapper = mountEditor()
    expect(wrapper.text()).toContain('Loading reflection…')

    await flushPromises()

    expect(wrapper.text()).not.toContain('Loading reflection…')
    expect(wrapper.getComponent(BodyFieldStub).props('modelValue')).toBe('Cached reflection')
    expect(mocks.taskStore.load).toHaveBeenCalledOnce()
    expect(mocks.trackingStore.load).toHaveBeenCalledOnce()
  })
})
