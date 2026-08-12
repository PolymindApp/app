import { defineComponent, h, reactive } from 'vue'
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
  backgroundFlashcardReviewState: vi.fn(),
  nativeFlashcardBackgroundIsAvailable: vi.fn(),
  stopBackgroundFlashcardReview: vi.fn(),
  syncBackgroundFlashcardReview: vi.fn(),
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
    saveReviewSet: vi.fn(),
    saveReviewSetPreferences: vi.fn(),
    startReview: vi.fn(),
    updateSessionSettings: vi.fn(),
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
  backgroundFlashcardReviewState: mocks.backgroundFlashcardReviewState,
  flashcardSpeechOverAmplificationIsEnabled: mocks.speechOverAmplificationIsEnabled,
  loadFlashcardSpeechSupport: vi.fn().mockResolvedValue({ available: false, languages: [] }),
  nativeFlashcardBackgroundIsAvailable: mocks.nativeFlashcardBackgroundIsAvailable,
  speakFlashcardText: mocks.speakFlashcardText,
  stopBackgroundFlashcardReview: mocks.stopBackgroundFlashcardReview,
  stopFlashcardSpeech: vi.fn().mockResolvedValue(undefined),
  syncBackgroundFlashcardReview: mocks.syncBackgroundFlashcardReview,
  toggleFlashcardSpeechOverAmplification: mocks.toggleSpeechOverAmplification,
}))
vi.mock('@/services/intervalCues', () => ({
  playFlashcardEjectCue: vi.fn(),
  playReviewCompleteCue: vi.fn(),
  prepareFlashcardEjectCue: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/services/screenWakeLock', () => ({
  requestScreenWakeLock: vi.fn().mockResolvedValue(undefined),
}))

const ButtonStub = defineComponent({
  inheritAttrs: false,
  props: { ariaLabel: String, ariaPressed: [Boolean, String], disabled: Boolean, loading: Boolean },
  emits: ['click'],
  template: `
    <button
      v-bind="$attrs"
      :aria-label="ariaLabel"
      :aria-pressed="ariaPressed"
      :disabled="disabled || loading"
      @click="$emit('click', $event)"
    ><slot /></button>
  `,
})

const FlashcardContextActionsStub = defineComponent({
  props: {
    modelValue: Boolean,
    showUndoEject: Boolean,
    canUndoEject: Boolean,
  },
  emits: ['update:modelValue', 'action'],
  template: `
    <div v-if="modelValue" class="flashcard-context-actions">
      <button
        type="button"
        data-context-action="settings"
        @click="$emit('update:modelValue', false); $emit('action', 'settings')"
      >Settings</button>
      <button
        v-if="showUndoEject"
        type="button"
        data-context-action="undo_eject"
        :disabled="!canUndoEject"
        @click="$emit('update:modelValue', false); $emit('action', 'undo_eject')"
      >Undo last eject</button>
    </div>
  `,
})

const AppFormStub = defineComponent({
  setup(_, { expose, slots }) {
    expose({ validate: async () => ({ valid: true }) })
    return () => h('form', slots.default?.())
  },
})

const FlashcardReviewSettingsFieldsStub = defineComponent({
  props: { modelValue: { type: Object, required: true } },
  setup(props) {
    return () => h('button', {
      class: 'change-session-settings',
      type: 'button',
      onClick: () => { props.modelValue.frontSeconds = 9 },
    }, 'Change settings')
  },
})

const ActionBottomSheetStub = defineComponent({
  props: { modelValue: Boolean },
  emits: ['update:modelValue'],
  setup(props, { slots }) {
    return () => props.modelValue
      ? h('div', { class: 'action-bottom-sheet-stub' }, slots.default?.())
      : undefined
  },
})

const VListItemStub = defineComponent({
  inheritAttrs: false,
  props: { title: String },
  emits: ['click'],
  setup(props, { attrs, emit }) {
    return () => h('button', {
      ...attrs,
      type: 'button',
      onClick: () => emit('click'),
    }, props.title)
  },
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

const SnackbarStub = defineComponent({
  props: { modelValue: Boolean },
  emits: ['update:modelValue'],
  template: `
    <div v-if="modelValue" class="test-snackbar">
      <slot />
      <slot name="actions" />
    </div>
  `,
})

const reviewSet: FlashcardReviewSet = {
  id: 'set-1',
  name: 'Vocabulary',
  tags: [],
  tagDetails: [],
  owner: 'user-1',
  ownerName: 'Polymind User',
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
        ActionBottomSheet: ActionBottomSheetStub,
        AppForm: AppFormStub,
        ConfirmDialog: true,
        FlashcardCardDialog: true,
        FlashcardContextActions: FlashcardContextActionsStub,
        FlashcardResponseText: true,
        FlashcardReviewSettingsFields: FlashcardReviewSettingsFieldsStub,
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
        VListItem: VListItemStub,
        VProgressCircular: true,
        VProgressLinear: true,
        VSnackbar: SnackbarStub,
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
    mocks.backgroundFlashcardReviewState.mockReset().mockResolvedValue(undefined)
    mocks.nativeFlashcardBackgroundIsAvailable.mockReset().mockReturnValue(false)
    mocks.stopBackgroundFlashcardReview.mockReset().mockResolvedValue(undefined)
    mocks.syncBackgroundFlashcardReview.mockReset().mockResolvedValue(false)
    mocks.toggleSpeechOverAmplification.mockReset().mockResolvedValue(true)
    mocks.store.reviewSets = [reviewSet]
    mocks.store.cards = [card]
    mocks.store.sessions = reactive<FlashcardReviewSession[]>([])
    mocks.store.load.mockReset().mockResolvedValue(undefined)
    mocks.store.loadSession.mockReset()
    mocks.store.loadReviewSetCards.mockReset()
    mocks.store.saveReviewSet.mockReset().mockImplementation(async value => value)
    mocks.store.saveReviewSetPreferences.mockReset().mockImplementation(async (_id, value) => value)
    mocks.store.act.mockReset()
    mocks.store.updateSessionSettings.mockReset().mockImplementation(async (_id, settings) => {
      const session = runningSession()
      Object.assign(session, settings)
      return session
    })
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
    expect(wrapper.get('.runner-start-screen__title').text()).toBe('Vocabulary.')
    expect(wrapper.get('.runner-start-screen__summary').text()).toBe('1 card')
    expect(wrapper.get('.runner-start-screen__icon').getComponent({ name: 'VIcon' }).attributes('icon'))
      .toBe('mdi-cards-playing-outline')
    expect(wrapper.get('.runner-start-screen').classes()).toContain('px-4')
    expect(wrapper.get('[aria-label="Start review"]').text()).toBe('Start review')
    expect(wrapper.get('[aria-label="Cancel review"]').text()).toBe('Cancel')
    expect(wrapper.find('.runner-header').exists()).toBe(false)
    expect(wrapper.find('.review-card').exists()).toBe(false)
    expect(wrapper.find('.review-navigation').exists()).toBe(false)
    expect(wrapper.findComponent(RunnerSessionActionsStub).exists()).toBe(false)
    expect(wrapper.findComponent(FlashcardContextActionsStub).exists()).toBe(false)

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
    expect(wrapper.get('[aria-label="Eject current card"]').text()).toBe('Eject card')
    expect(wrapper.findAll('button').find(button => button.text() === 'Options')?.attributes('disabled'))
      .toBeUndefined()
    expect(wrapper.getComponent(RunnerSessionActionsStub).props('items')).toEqual([
      expect.objectContaining({ action: 'restart', disabled: false }),
      expect.objectContaining({ action: 'end', disabled: false }),
    ])

    wrapper.unmount()
  })

  it('returns to Flashcards when the start screen is cancelled', async () => {
    const wrapper = mountRunner()
    await flushPromises()

    await wrapper.get('[aria-label="Cancel review"]').trigger('click')
    await flushPromises()

    expect(mocks.store.startReview).not.toHaveBeenCalled()
    expect(mocks.router.replace).toHaveBeenCalledWith('/flashcards')

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
      'Enable TTS amplification',
      'Restart review',
      'End review',
    ])
    expect(menuItems[0]!.attributes('aria-pressed')).toBe('false')

    await menuItems[0]!.trigger('click')
    await flushPromises()

    expect(mocks.toggleSpeechOverAmplification).toHaveBeenCalledOnce()
    expect(mocks.speakFlashcardText).not.toHaveBeenCalled()

    await actions[0]!.trigger('click')
    expect(wrapper.get('[data-action="amplification"]').text()).toBe('Disable TTS amplification')
    expect(wrapper.get('[data-action="amplification"]').attributes('aria-pressed')).toBe('true')

    await wrapper.findAll('button').find(button => button.text() === 'Options')!.trigger('click')
    expect(wrapper.find('.flashcard-context-actions').exists()).toBe(true)

    wrapper.unmount()
  })

  it('applies Session settings to either the current session or Review set', async () => {
    const active = runningSession()
    mocks.route.params = { sessionId: active.id }
    mocks.store.sessions = reactive([active])
    mocks.store.loadSession.mockResolvedValue(active)

    const wrapper = mountRunner()
    await flushPromises()

    await wrapper.findAll('button').find(button => button.text() === 'Options')!.trigger('click')
    await wrapper.get('[data-context-action="settings"]').trigger('click')
    await flushPromises()
    await wrapper.get('.change-session-settings').trigger('click')

    expect(wrapper.get('.session-settings-actions__cancel').text()).toBe('Cancel')
    expect(wrapper.get('.session-settings-actions__primary').text()).toBe('Apply to...')
    await wrapper.get('.apply-settings-menu').trigger('click')
    expect(wrapper.get('.action-bottom-sheet-stub').findAll('button').map(item => item.text()))
      .toEqual(['Current session', 'Review set'])

    await wrapper.get('.apply-settings-target--session').trigger('click')
    await flushPromises()
    expect(mocks.store.updateSessionSettings).toHaveBeenCalledWith(
      active.id,
      expect.objectContaining({ frontSeconds: 9 }),
    )
    expect(mocks.store.saveReviewSet).not.toHaveBeenCalled()

    await wrapper.findAll('button').find(button => button.text() === 'Options')!.trigger('click')
    await wrapper.get('[data-context-action="settings"]').trigger('click')
    await flushPromises()
    await wrapper.get('.change-session-settings').trigger('click')
    await wrapper.get('.apply-settings-menu').trigger('click')
    await wrapper.get('.apply-settings-target--review-set').trigger('click')
    await flushPromises()

    expect(mocks.store.saveReviewSet).toHaveBeenCalledWith(
      expect.objectContaining({ id: reviewSet.id, frontSeconds: 9 }),
    )
    expect(mocks.store.updateSessionSettings).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it.each([
    { mode: 'manual' as const, selector: '.review-card' },
    { mode: 'passive' as const, selector: '.passive-card' },
  ])('replays paused $mode card speech without resuming the session', async ({ mode, selector }) => {
    const active = {
      ...runningSession(),
      mode,
      status: 'paused' as const,
      speechEnabled: true,
      frontLanguage: 'en-CA',
    }
    mocks.route.params = { sessionId: active.id }
    mocks.store.sessions = reactive([active])
    mocks.store.loadSession.mockResolvedValue(active)

    const wrapper = mountRunner()
    await flushPromises()
    mocks.speakFlashcardText.mockClear()

    const reviewCard = wrapper.get(selector)
    expect(reviewCard.attributes('disabled')).toBeUndefined()
    expect(reviewCard.attributes('aria-disabled')).not.toBe('true')

    await reviewCard.trigger('click')
    await flushPromises()

    expect(mocks.speakFlashcardText).toHaveBeenCalledWith('House', 'en-CA')
    expect(active.status).toBe('paused')
    expect(mocks.store.act).not.toHaveBeenCalled()

    wrapper.unmount()
  })

  it('shows a card speech failure as a warning snackbar only once per session', async () => {
    const active = {
      ...runningSession(),
      speechEnabled: true,
      frontLanguage: 'en-CA',
    }
    mocks.route.params = { sessionId: active.id }
    mocks.store.sessions = reactive([active])
    mocks.store.loadSession.mockResolvedValue(active)
    mocks.speakFlashcardText.mockRejectedValue(new Error('Speech unavailable'))

    const wrapper = mountRunner()
    await flushPromises()

    expect(wrapper.find('.runner-alert--speech').exists()).toBe(false)
    expect(wrapper.get('.test-snackbar').text())
      .toContain('This card could not be spoken in the selected language.')

    await wrapper.get('[aria-label="Dismiss speech warning"]').trigger('click')
    await wrapper.get('.review-card').trigger('click')
    await flushPromises()

    expect(mocks.speakFlashcardText).toHaveBeenCalledTimes(2)
    expect(wrapper.find('.test-snackbar').exists()).toBe(false)

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

  it('reconciles background playback with one atomic card update', async () => {
    const active = {
      ...runningSession(),
      mode: 'passive' as const,
      indefinite: true,
      speechEnabled: true,
      frontLanguage: 'en-CA',
      backLanguage: 'fr-CA',
      queue: [
        { id: 'card-1', front: 'House', back: 'Maison', note: '', image: '', tags: [] },
        { id: 'card-2', front: 'Tree', back: 'Arbre', note: '', image: '', tags: [] },
        { id: 'card-3', front: 'Book', back: 'Livre', note: '', image: '', tags: [] },
      ],
      totalCards: 3,
    }
    mocks.route.params = { sessionId: active.id }
    mocks.store.sessions = reactive([active])
    mocks.store.loadSession.mockResolvedValue(active)
    mocks.nativeFlashcardBackgroundIsAvailable.mockReturnValue(true)
    mocks.backgroundFlashcardReviewState.mockResolvedValue({
      sessionId: active.id,
      running: true,
      finished: false,
      completedCards: 8,
      side: 'back',
      remainingMs: 3200,
      elapsedMs: 83_000,
    })
    mocks.store.act.mockImplementation(async (_id, action, elapsed, viewCount = 1) => {
      const stored = mocks.store.sessions[0]!
      if (action !== 'view') return stored
      const offset = viewCount % stored.queue.length
      stored.queue.push(...stored.queue.splice(0, offset))
      stored.viewedCount += viewCount
      stored.elapsedSeconds = elapsed
      return stored
    })

    const wrapper = mountRunner()
    await flushPromises()

    expect(mocks.store.act).toHaveBeenCalledOnce()
    expect(mocks.store.act).toHaveBeenCalledWith(active.id, 'view', 83, 8)
    expect(mocks.store.sessions[0]?.queue[0]?.id).toBe('card-3')
    expect(mocks.store.sessions[0]?.viewedCount).toBe(8)
    expect(wrapper.get('.review-card__front-reference').text()).toBe('Book')
    expect(wrapper.get('flashcard-response-text-stub').attributes('back')).toBe('Livre')

    wrapper.unmount()
  })

  it('ejects immediately and can undo the most recent eject from Options', async () => {
    const active = runningSession()
    const secondCard = {
      id: 'card-2',
      front: 'Tree',
      back: 'Arbre',
      note: '',
      image: '',
      tags: [],
    }
    active.queue.push(secondCard)
    active.totalCards = 2
    const ejectedCard = active.queue[0]!
    mocks.route.params = { sessionId: active.id }
    mocks.store.sessions = reactive([active])
    mocks.store.loadSession.mockResolvedValue(active)
    mocks.store.act.mockImplementation(async (_id, action) => {
      if (action === 'eject') {
        active.queue.shift()
        active.ejectedCount += 1
      } else if (action === 'undo_eject') {
        active.queue.unshift(ejectedCard)
        active.ejectedCount -= 1
      }
      return active
    })

    const wrapper = mountRunner()
    await flushPromises()

    await wrapper.findAll('button').find(button => button.text() === 'Options')!.trigger('click')
    expect(wrapper.get('[data-context-action="undo_eject"]').attributes('disabled')).toBeDefined()
    wrapper.getComponent(FlashcardContextActionsStub).vm.$emit('update:modelValue', false)
    await wrapper.vm.$nextTick()

    await wrapper.get('[aria-label="Eject current card"]').trigger('click')
    await flushPromises()

    expect(mocks.store.act).toHaveBeenCalledWith('session-1', 'eject', expect.any(Number))
    expect(active.ejectedCount).toBe(1)
    expect(active.queue[0]?.id).toBe(secondCard.id)

    await wrapper.findAll('button').find(button => button.text() === 'Options')!.trigger('click')
    expect(wrapper.get('[data-context-action="undo_eject"]').attributes('disabled')).toBeUndefined()
    await wrapper.get('[data-context-action="undo_eject"]').trigger('click')
    await flushPromises()

    expect(mocks.store.act).toHaveBeenCalledWith('session-1', 'undo_eject', expect.any(Number))
    expect(active.ejectedCount).toBe(0)
    expect(active.queue[0]?.id).toBe(ejectedCard.id)

    await wrapper.findAll('button').find(button => button.text() === 'Options')!.trigger('click')
    expect(wrapper.get('[data-context-action="undo_eject"]').attributes('disabled')).toBeDefined()

    wrapper.unmount()
  })
})
