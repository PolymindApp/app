import { defineComponent, reactive } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import IntervalRunnerView from '@/views/IntervalRunnerView.vue'
import type { IntervalSession } from '@/types/domain'

const mocks = vi.hoisted(() => ({
  route: {
    params: { sessionId: 'session-1' } as Record<string, string>,
    query: {} as Record<string, string>,
  },
  router: { replace: vi.fn() },
  intervalStore: {
    loaded: true,
    templates: [],
    sessions: [] as IntervalSession[],
    activeSession: undefined,
    load: vi.fn(),
    updateSession: vi.fn(),
    updateSessionFlashcardReview: vi.fn(),
    completeSession: vi.fn(),
    startSession: vi.fn(),
    mirrorRuntime: vi.fn(),
  },
  flashcardStore: {
    loaded: true,
    reviewSets: [],
    cards: [],
    reviewSetCards: {},
    load: vi.fn(),
    loadReviewSetCards: vi.fn(),
    deleteCard: vi.fn(),
    deleteReviewSetCard: vi.fn(),
  },
  taskStore: {
    tasks: [],
    steps: [],
    load: vi.fn(),
    makeProgress: vi.fn(),
    setStatus: vi.fn(),
  },
}))

vi.mock('vue-router', () => ({
  useRoute: () => mocks.route,
  useRouter: () => mocks.router,
}))
vi.mock('@/stores/intervals', () => ({ useIntervalStore: () => mocks.intervalStore }))
vi.mock('@/stores/flashcards', () => ({ useFlashcardStore: () => mocks.flashcardStore }))
vi.mock('@/stores/tasks', () => ({ useTaskStore: () => mocks.taskStore }))
vi.mock('@/services/backgroundInterval', () => ({
  nativeBackgroundIntervalIsActive: vi.fn().mockReturnValue(false),
  stopBackgroundInterval: vi.fn().mockResolvedValue(undefined),
  syncBackgroundInterval: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/services/flashcardSpeech', () => ({
  loadFlashcardSpeechSupport: vi.fn().mockResolvedValue({ available: false, languages: [] }),
  speakFlashcardText: vi.fn().mockResolvedValue(undefined),
  stopFlashcardSpeech: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/services/intervalCues', () => ({
  notifyIntervalTransition: vi.fn().mockResolvedValue(undefined),
  playIntervalCompleteCue: vi.fn(),
  playIntervalCountCue: vi.fn(),
  playIntervalGoCue: vi.fn(),
  prepareIntervalCues: vi.fn().mockResolvedValue(undefined),
  requestIntervalWakeLock: vi.fn().mockResolvedValue(undefined),
}))

const FlashcardContextActionsStub = defineComponent({
  props: { modelValue: Boolean },
  emits: ['update:modelValue', 'action'],
  template: `
    <div v-if="modelValue" class="flashcard-context-actions">
      <button type="button" @click="$emit('update:modelValue', false)">Close context</button>
      <button
        type="button"
        @click="$emit('update:modelValue', false); $emit('action', 'eject')"
      >Eject</button>
    </div>
  `,
})

const ConfirmDialogStub = defineComponent({
  props: { modelValue: Boolean, title: String },
  emits: ['update:modelValue'],
  template: `
    <div v-if="modelValue" class="confirm-dialog" :data-title="title">
      <button type="button" @click="$emit('update:modelValue', false)">Cancel</button>
    </div>
  `,
})

function intervalSession(status: 'running' | 'paused', image = ''): IntervalSession {
  const now = new Date().toISOString()
  return {
    id: 'session-1',
    taskDate: '2026-08-08',
    source: 'quick',
    status,
    name: 'Study intervals',
    definition: {
      version: 1,
      children: [{
        id: 'study',
        type: 'step',
        name: 'Study',
        kind: 'work',
        durationSeconds: 600,
      }],
    },
    cues: { soundEnabled: true, vibrationEnabled: true },
    flashcardReview: {
      reviewSet: 'set-1',
      name: 'Vocabulary',
      tags: [],
      sortMode: 'difficult',
      cardSides: 'both',
      frontSeconds: 5,
      backSeconds: 5,
      backSpeechRepeatCount: 1,
      noteBeforeBack: false,
      speechEnabled: false,
      frontLanguage: '',
      backLanguage: '',
      cards: [{
        id: 'card-1',
        front: 'House',
        back: 'Maison',
        note: '',
        image,
        tags: [],
      }],
    },
    startedAt: now,
    plannedSeconds: 600,
    elapsedSeconds: 0,
    runtime: {
      stepIndex: 0,
      remainingMs: 600_000,
      stepStartedAt: status === 'running' ? now : undefined,
      accumulatedMs: 0,
      updatedAt: now,
    },
    updated: now,
  }
}

function mountRunner() {
  return mount(IntervalRunnerView, {
    global: {
      directives: { ripple: {} },
      stubs: {
        ActionBottomSheet: true,
        AppForm: true,
        ConfirmDialog: ConfirmDialogStub,
        FlashcardCardDialog: true,
        FlashcardContextActions: FlashcardContextActionsStub,
        FlashcardResponseText: true,
        FlashcardReviewSettingsFields: true,
        IntervalTypeIcon: true,
        LabeledSlider: true,
        VAlert: true,
        VBtn: true,
        VCard: true,
        VCardActions: true,
        VCardText: true,
        VCardTitle: true,
        VDialog: true,
        VDivider: true,
        VIcon: true,
        VProgressCircular: true,
        VProgressLinear: true,
        VSpacer: true,
        VTextarea: true,
      },
    },
  })
}

describe('IntervalRunnerView flashcard area', () => {
  beforeEach(() => {
    mocks.intervalStore.sessions = reactive([intervalSession('running')])
    mocks.intervalStore.updateSession.mockReset().mockImplementation(async (id, updates) => {
      const session = mocks.intervalStore.sessions.find(item => item.id === id)
      if (!session) throw new Error('Missing session')
      Object.assign(session, updates)
      return session
    })
    mocks.intervalStore.load.mockReset().mockResolvedValue(undefined)
    mocks.flashcardStore.load.mockReset().mockResolvedValue(undefined)
    mocks.taskStore.load.mockReset().mockResolvedValue(undefined)
  })

  it('resumes after closing the context menu when the interval was playing', async () => {
    const wrapper = mountRunner()
    await flushPromises()
    mocks.intervalStore.updateSession.mockClear()

    await wrapper.get('.interval-review-card').trigger('click')
    await flushPromises()

    expect(mocks.intervalStore.sessions[0]?.status).toBe('paused')
    expect(wrapper.get('.flashcard-context-actions').exists()).toBe(true)

    await wrapper.get('.flashcard-context-actions button').trigger('click')
    await flushPromises()

    expect(mocks.intervalStore.sessions[0]?.status).toBe('running')
    expect(mocks.intervalStore.updateSession).toHaveBeenLastCalledWith(
      'session-1',
      expect.objectContaining({ status: 'running' }),
    )

    wrapper.unmount()
  })

  it('stays paused after closing the context menu when it was already paused', async () => {
    mocks.intervalStore.sessions = reactive([intervalSession('paused')])
    const wrapper = mountRunner()
    await flushPromises()
    mocks.intervalStore.updateSession.mockClear()

    await wrapper.get('.interval-review-card').trigger('click')
    await flushPromises()
    await wrapper.get('.flashcard-context-actions button').trigger('click')
    await flushPromises()

    expect(mocks.intervalStore.sessions[0]?.status).toBe('paused')
    expect(mocks.intervalStore.updateSession).not.toHaveBeenCalled()

    wrapper.unmount()
  })

  it('stays paused for a context action and resumes when its dialog closes', async () => {
    const wrapper = mountRunner()
    await flushPromises()

    await wrapper.get('.interval-review-card').trigger('click')
    await flushPromises()
    await wrapper.findAll('.flashcard-context-actions button')[1]!.trigger('click')
    await flushPromises()

    expect(mocks.intervalStore.sessions[0]?.status).toBe('paused')
    expect(wrapper.get('[data-title="Eject this flashcard?"]').exists()).toBe(true)

    await wrapper.get('[data-title="Eject this flashcard?"] button').trigger('click')
    await flushPromises()

    expect(mocks.intervalStore.sessions[0]?.status).toBe('running')

    wrapper.unmount()
  })

  it('shows a flashcard image inside the progress rings and fades the type icon', async () => {
    mocks.intervalStore.sessions = reactive([intervalSession('running', '/flashcard-image.jpg')])
    const wrapper = mountRunner()
    await flushPromises()

    const image = wrapper.get('.progress-rings .runner-flashcard-image')
    expect(image.attributes('src')).toBe('/flashcard-image.jpg')
    expect(wrapper.find('.interval-review-card .runner-flashcard-image').exists()).toBe(false)
    expect(wrapper.get('.runner-type-backdrop').classes()).toContain('runner-type-backdrop--hidden')

    wrapper.unmount()
  })

  it('keeps the interval type icon visible when the flashcard has no image', async () => {
    const wrapper = mountRunner()
    await flushPromises()

    expect(wrapper.find('.runner-flashcard-image').exists()).toBe(false)
    expect(wrapper.get('.runner-type-backdrop').classes()).not.toContain('runner-type-backdrop--hidden')

    wrapper.unmount()
  })
})
