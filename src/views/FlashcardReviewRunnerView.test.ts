import { defineComponent, reactive } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import FlashcardReviewRunnerView from '@/views/FlashcardReviewRunnerView.vue'
import type { Flashcard, FlashcardReviewSession, FlashcardReviewSet } from '@/types/domain'

const mocks = vi.hoisted(() => ({
  route: {
    params: { reviewSetId: 'set-1' } as Record<string, string>,
    query: {} as Record<string, string>,
  },
  router: { replace: vi.fn() },
  speechOverAmplificationIsEnabled: vi.fn(),
  speakFlashcardText: vi.fn(),
  toggleSpeechOverAmplification: vi.fn(),
  store: {
    loaded: true,
    reviewSets: [] as FlashcardReviewSet[],
    cards: [] as Flashcard[],
    reviewSetCards: {} as Record<string, Flashcard[]>,
    sessions: [] as FlashcardReviewSession[],
    load: vi.fn(),
    loadSession: vi.fn(),
    loadReviewSetCards: vi.fn(),
    startReview: vi.fn(),
    act: vi.fn(),
  },
}))

vi.mock('vue-router', () => ({
  useRoute: () => mocks.route,
  useRouter: () => mocks.router,
  onBeforeRouteLeave: vi.fn(),
}))
vi.mock('@/stores/flashcards', () => ({ useFlashcardStore: () => mocks.store }))
vi.mock('@/services/flashcardSpeech', () => ({
  backgroundFlashcardReviewState: vi.fn().mockResolvedValue(undefined),
  flashcardSpeechOverAmplificationIsEnabled: mocks.speechOverAmplificationIsEnabled,
  loadFlashcardSpeechSupport: vi.fn().mockResolvedValue({ available: false, languages: [] }),
  nativeFlashcardBackgroundIsAvailable: vi.fn().mockReturnValue(false),
  speakFlashcardText: mocks.speakFlashcardText,
  stopBackgroundFlashcardReview: vi.fn().mockResolvedValue(undefined),
  stopFlashcardSpeech: vi.fn().mockResolvedValue(undefined),
  syncBackgroundFlashcardReview: vi.fn().mockResolvedValue(false),
  toggleFlashcardSpeechOverAmplification: mocks.toggleSpeechOverAmplification,
}))
vi.mock('@/services/intervalCues', () => ({ playReviewCompleteCue: vi.fn() }))
vi.mock('@/services/screenWakeLock', () => ({
  requestScreenWakeLock: vi.fn().mockResolvedValue(undefined),
}))

const ButtonStub = defineComponent({
  inheritAttrs: false,
  props: { ariaLabel: String, ariaPressed: [Boolean, String], disabled: Boolean, loading: Boolean },
  emits: ['click'],
  template: `
    <button
      :aria-label="ariaLabel"
      :aria-pressed="ariaPressed"
      :disabled="disabled || loading"
      @click="$emit('click', $event)"
    ><slot /></button>
  `,
})

const FlashcardContextActionsStub = defineComponent({
  props: { modelValue: Boolean },
  template: '<div v-if="modelValue" class="flashcard-context-actions" />',
})

const RunnerSessionActionsStub = defineComponent({
  name: 'RunnerSessionActions',
  props: {
    modelValue: Boolean,
    items: { type: Array, default: () => [] },
  },
  emits: ['update:modelValue', 'action'],
  template: `
    <div v-if="modelValue" class="runner-session-actions">
      <button
        v-for="item in items"
        :key="item.action"
        type="button"
        :data-action="item.action"
        :disabled="item.disabled"
        :aria-pressed="item.toggle ? item.active : undefined"
        @click="$emit('update:modelValue', false); $emit('action', item.action)"
      >{{ item.title }}</button>
    </div>
  `,
})

const reviewSet: FlashcardReviewSet = {
  id: 'set-1',
  name: 'Vocabulary',
  tags: [],
  tagDetails: [],
  owner: 'user-1',
  ownerName: 'Mom User',
  ownerAvatar: '',
  accessRole: 'owner',
  matchingCardCount: 1,
  mode: 'manual',
  cardSides: 'both',
  indefinite: false,
  maxCards: 20,
  frontSeconds: 5,
  backSeconds: 5,
  backSpeechRepeatCount: 1,
  noteBeforeBack: false,
  speechEnabled: false,
  frontLanguage: '',
  backLanguage: '',
  sortMode: 'recently_added',
  sortOrder: 0,
  createdAt: '2026-08-08T12:00:00.000Z',
  updatedAt: '2026-08-08T12:00:00.000Z',
}

const card: Flashcard = {
  id: 'card-1',
  front: 'House',
  back: 'Maison',
  note: '',
  image: '',
  imageSource: 'none',
  tags: [],
  createdAt: '2026-08-08T12:00:00.000Z',
  updatedAt: '2026-08-08T12:00:00.000Z',
  passiveViews: 0,
  successCount: 0,
  errorCount: 0,
}

function runningSession(): FlashcardReviewSession {
  return {
    id: 'session-1',
    reviewSet: reviewSet.id,
    status: 'running',
    name: reviewSet.name,
    mode: reviewSet.mode,
    cardSides: reviewSet.cardSides,
    indefinite: reviewSet.indefinite,
    maxCards: reviewSet.maxCards,
    sortMode: reviewSet.sortMode,
    tags: [],
    frontSeconds: reviewSet.frontSeconds,
    backSeconds: reviewSet.backSeconds,
    backSpeechRepeatCount: reviewSet.backSpeechRepeatCount,
    noteBeforeBack: reviewSet.noteBeforeBack,
    speechEnabled: reviewSet.speechEnabled,
    frontLanguage: reviewSet.frontLanguage,
    backLanguage: reviewSet.backLanguage,
    queue: [{ id: card.id, front: card.front, back: card.back, note: '', image: '', tags: [] }],
    startedAt: '2026-08-08T12:00:00.000Z',
    updatedAt: '2026-08-08T12:00:00.000Z',
    elapsedSeconds: 0,
    totalCards: 1,
    viewedCount: 0,
    successCount: 0,
    errorCount: 0,
    ejectedCount: 0,
  }
}

function mountRunner() {
  return mount(FlashcardReviewRunnerView, {
    global: {
      directives: { ripple: {} },
      stubs: {
        AppForm: { template: '<form><slot /></form>' },
        ConfirmDialog: true,
        FlashcardCardDialog: true,
        FlashcardContextActions: FlashcardContextActionsStub,
        FlashcardResponseText: true,
        FlashcardReviewSettingsFields: true,
        RunnerSessionActions: RunnerSessionActionsStub,
        VAlert: true,
        VBtn: ButtonStub,
        VCard: { template: '<section><slot /></section>' },
        VCardActions: { template: '<div><slot /></div>' },
        VCardText: { template: '<div><slot /></div>' },
        VCardTitle: { template: '<div><slot /></div>' },
        VDialog: { template: '<div><slot /></div>' },
        VDivider: true,
        VIcon: true,
        VProgressCircular: true,
        VProgressLinear: true,
        VSpacer: true,
      },
    },
  })
}

describe('FlashcardReviewRunnerView Review set preview', () => {
  beforeEach(() => {
    mocks.route.params = { reviewSetId: 'set-1' }
    mocks.route.query = {}
    mocks.router.replace.mockReset().mockResolvedValue(undefined)
    mocks.speechOverAmplificationIsEnabled.mockReset().mockReturnValue(false)
    mocks.speakFlashcardText.mockReset().mockResolvedValue(undefined)
    mocks.toggleSpeechOverAmplification.mockReset().mockResolvedValue(true)
    mocks.store.reviewSets = [reviewSet]
    mocks.store.cards = [card]
    mocks.store.sessions = reactive<FlashcardReviewSession[]>([])
    mocks.store.load.mockReset().mockResolvedValue(undefined)
    mocks.store.loadSession.mockReset()
    mocks.store.loadReviewSetCards.mockReset()
    mocks.store.act.mockReset()
    mocks.store.startReview.mockReset().mockImplementation(async () => {
      const session = runningSession()
      mocks.store.sessions.unshift(session)
      return session
    })
  })

  it('waits for Play before creating the running session', async () => {
    const wrapper = mountRunner()
    await flushPromises()

    expect(mocks.store.startReview).not.toHaveBeenCalled()
    expect(wrapper.get('[aria-label="Start review"]').attributes('disabled')).toBeUndefined()
    expect(wrapper.find('[aria-label="Eject current card"]').exists()).toBe(false)
    expect(wrapper.findAll('button').filter(button => button.text() === 'Options')).toHaveLength(0)
    expect(wrapper.getComponent(RunnerSessionActionsStub).props('items')).toEqual([
      expect.objectContaining({ action: 'options', disabled: true }),
      expect.objectContaining({ action: 'eject', disabled: true }),
      expect.objectContaining({ action: 'restart', disabled: true }),
      expect.objectContaining({ action: 'end', disabled: true }),
    ])

    await wrapper.get('[aria-label="Start review"]').trigger('click')
    await flushPromises()

    expect(mocks.store.startReview).toHaveBeenCalledWith('set-1', {
      task: undefined,
      programStep: undefined,
      taskDate: undefined,
    })
    expect(mocks.router.replace).toHaveBeenCalledWith({
      name: 'flashcard-review-runner',
      params: { sessionId: 'session-1' },
      query: {},
    })
    expect(wrapper.find('[aria-label="Pause review"]').exists()).toBe(true)
    expect(wrapper.getComponent(RunnerSessionActionsStub).props('items')).toEqual([
      expect.objectContaining({ action: 'options', disabled: false }),
      expect.objectContaining({ action: 'eject', disabled: false }),
      expect.objectContaining({ action: 'restart', disabled: false }),
      expect.objectContaining({ action: 'end', disabled: false }),
    ])

    wrapper.unmount()
  })

  it('orders Review actions and toggles TTS amplification without replaying', async () => {
    const active = {
      ...runningSession(),
      speechEnabled: true,
      frontLanguage: 'en-CA',
    }
    mocks.route.params = { sessionId: active.id }
    mocks.store.sessions = reactive([active])
    mocks.store.loadSession.mockResolvedValue(active)

    const wrapper = mountRunner()
    await flushPromises()
    mocks.speakFlashcardText.mockClear()

    const actions = wrapper.get('.runner-header__actions').findAll('button')
    expect(actions.map(button => button.attributes('aria-label'))).toEqual(['Review actions'])

    await actions[0]!.trigger('click')
    const menuItems = wrapper.findAll('.runner-session-actions button')
    expect(menuItems.map(button => button.text())).toEqual([
      'Card options',
      'Enable TTS amplification',
      'Eject current card',
      'Restart review',
      'End review',
    ])
    expect(menuItems[1]!.attributes('aria-pressed')).toBe('false')

    await menuItems[1]!.trigger('click')
    await flushPromises()

    expect(mocks.toggleSpeechOverAmplification).toHaveBeenCalledOnce()
    expect(mocks.speakFlashcardText).not.toHaveBeenCalled()

    await actions[0]!.trigger('click')
    expect(wrapper.get('[data-action="amplification"]').text()).toBe('Disable TTS amplification')
    expect(wrapper.get('[data-action="amplification"]').attributes('aria-pressed')).toBe('true')

    await wrapper.get('[data-action="options"]').trigger('click')
    expect(wrapper.find('.flashcard-context-actions').exists()).toBe(true)

    wrapper.unmount()
  })

  it('restarts the Review set session from the actions menu', async () => {
    const active = {
      ...runningSession(),
      elapsedSeconds: 42,
      viewedCount: 3,
      successCount: 2,
      errorCount: 1,
    }
    mocks.route.params = { sessionId: active.id }
    mocks.store.sessions = reactive([active])
    mocks.store.loadSession.mockResolvedValue(active)
    mocks.store.act.mockImplementation(async (_id, action) => {
      if (action !== 'restart') return active
      Object.assign(active, {
        status: 'running',
        elapsedSeconds: 0,
        viewedCount: 0,
        successCount: 0,
        errorCount: 0,
        ejectedCount: 0,
      })
      return active
    })

    const wrapper = mountRunner()
    await flushPromises()

    await wrapper.get('[aria-label="Review actions"]').trigger('click')
    await wrapper.get('[data-action="restart"]').trigger('click')
    await flushPromises()

    expect(mocks.store.act).toHaveBeenCalledWith('session-1', 'restart', expect.any(Number))
    expect(active.elapsedSeconds).toBe(0)
    expect(active.viewedCount).toBe(0)

    wrapper.unmount()
  })
})
