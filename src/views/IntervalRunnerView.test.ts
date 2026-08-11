import { defineComponent, reactive } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { speakFlashcardText } from '@/services/flashcardSpeech'
import IntervalRunnerView from '@/views/IntervalRunnerView.vue'
import type { IntervalSession } from '@/types/domain'

const mocks = vi.hoisted(() => ({
  route: {
    params: { sessionId: 'session-1' } as Record<string, string>,
    query: {} as Record<string, string>,
  },
  router: { replace: vi.fn() },
  speechOverAmplificationIsEnabled: vi.fn(),
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
  speakFlashcardText: vi.fn(),
  stopFlashcardSpeech: vi.fn(),
  toggleSpeechOverAmplification: vi.fn(),
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
  flashcardSpeechOverAmplificationIsEnabled: mocks.speechOverAmplificationIsEnabled,
  loadFlashcardSpeechSupport: vi.fn().mockResolvedValue({ available: false, languages: [] }),
  speakFlashcardText: mocks.speakFlashcardText,
  stopFlashcardSpeech: mocks.stopFlashcardSpeech,
  toggleFlashcardSpeechOverAmplification: mocks.toggleSpeechOverAmplification,
}))
vi.mock('@/services/intervalCues', () => ({
  notifyIntervalTransition: vi.fn().mockResolvedValue(undefined),
  playFlashcardEjectCue: vi.fn(),
  playIntervalCompleteCue: vi.fn(),
  playIntervalCountCue: vi.fn(),
  playIntervalGoCue: vi.fn(),
  prepareIntervalCues: vi.fn().mockResolvedValue(undefined),
  prepareFlashcardEjectCue: vi.fn().mockResolvedValue(undefined),
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
        RunnerSessionActions: RunnerSessionActionsStub,
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
    mocks.speechOverAmplificationIsEnabled.mockReset().mockReturnValue(false)
    mocks.speakFlashcardText.mockReset().mockResolvedValue(undefined)
    mocks.stopFlashcardSpeech.mockReset().mockResolvedValue(undefined)
    mocks.toggleSpeechOverAmplification.mockReset().mockResolvedValue(true)
  })

  it('orders session actions and toggles TTS amplification without replaying', async () => {
    const active = intervalSession('running')
    if (!active.flashcardReview) throw new Error('Expected a Review set snapshot')
    active.flashcardReview.speechEnabled = true
    active.flashcardReview.frontLanguage = 'en-CA'
    mocks.intervalStore.sessions = reactive([active])

    const wrapper = mountRunner()
    await flushPromises()
    vi.mocked(speakFlashcardText).mockClear()

    const actions = wrapper.get('.runner-header__actions').findAllComponents({ name: 'VBtn' })
    expect(actions.map(button => button.attributes('aria-label'))).toEqual(['Interval actions'])

    await actions[0]!.trigger('click')
    const menuItems = wrapper.findAll('.runner-session-actions button')
    expect(menuItems.map(button => button.text())).toEqual([
      'Enable TTS amplification',
      'Restart interval',
      'End session',
    ])
    expect(menuItems[0]!.attributes('aria-pressed')).toBe('false')

    await menuItems[0]!.trigger('click')
    await flushPromises()

    expect(mocks.toggleSpeechOverAmplification).toHaveBeenCalledOnce()
    expect(speakFlashcardText).not.toHaveBeenCalled()

    await actions[0]!.trigger('click')
    expect(wrapper.get('[data-action="amplification"]').text()).toBe('Disable TTS amplification')
    expect(wrapper.get('[data-action="amplification"]').attributes('aria-pressed')).toBe('true')

    wrapper.unmount()
  })

  it('places the mini Review set card below the portrait controls without a Restart button', async () => {
    const wrapper = mountRunner()
    await flushPromises()

    const portraitControls = wrapper.get('.runner-controls--portrait').element
    expect(portraitControls.nextElementSibling).toBe(wrapper.get('.interval-review-card').element)
    expect(wrapper.find('.restart-button').exists()).toBe(false)
    expect(wrapper.findAll('[aria-label="Interval actions"]')).toHaveLength(2)
    expect(wrapper.get('.interval-review-card__meta').text()).toBe('Front')
    expect(wrapper.get('.interval-review-card').text()).not.toContain('1/1')
    expect(wrapper.get('.interval-review-card__faces strong').classes())
      .not.toContain('interval-review-card__face--hidden')
    expect(wrapper.getComponent({ name: 'FlashcardResponseText' }).classes())
      .toContain('interval-review-card__face--hidden')

    wrapper.unmount()
  })

  it('reserves response height on the card content without requesting an empty note', async () => {
    const active = intervalSession('running')
    active.runtime.accumulatedMs = 6_000
    mocks.intervalStore.sessions = reactive([active])

    const wrapper = mountRunner()
    await flushPromises()

    const response = wrapper.getComponent({ name: 'FlashcardResponseText' })
    expect(wrapper.get('.interval-review-card__faces strong').classes())
      .toContain('interval-review-card__face--hidden')
    expect(response.classes()).not.toContain('interval-review-card__face--hidden')
    expect(response.props()).not.toHaveProperty('reserveNoteSpace')

    wrapper.unmount()
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

  it('pauses an aloud Review set with the current step while keeping its context menu available', async () => {
    const active = intervalSession('running')
    if (!active.flashcardReview) throw new Error('Expected a Review set snapshot')
    active.flashcardReview.speechEnabled = true
    active.flashcardReview.frontLanguage = 'en-US'
    active.flashcardReview.backLanguage = 'fr-FR'
    active.definition.children = [
      {
        id: 'read-first',
        type: 'step',
        name: 'Read first',
        kind: 'work',
        durationSeconds: 10,
      },
      {
        id: 'silent',
        type: 'step',
        name: 'Silent',
        kind: 'rest',
        durationSeconds: 20,
        flashcardReviewEnabled: false,
      },
      {
        id: 'read-again',
        type: 'step',
        name: 'Read again',
        kind: 'work',
        durationSeconds: 10,
      },
    ]
    active.runtime.remainingMs = 6_500
    mocks.intervalStore.sessions = reactive([active])

    const wrapper = mountRunner()
    await flushPromises()

    const activeCard = wrapper.get('.interval-review-card')
    expect(wrapper.get('.interval-review-card__meta small').text()).toBe('Front')
    expect(activeCard.attributes('disabled')).toBeUndefined()
    expect(activeCard.classes()).not.toContain('interval-review-card--playback-paused')

    const stored = mocks.intervalStore.sessions[0]!
    stored.runtime.stepIndex = 1
    stored.runtime.accumulatedMs = 10_000
    stored.runtime.remainingMs = 6_500
    await wrapper.vm.$nextTick()
    await flushPromises()

    const pausedCard = wrapper.get('.interval-review-card')
    expect(wrapper.get('.interval-review-card__meta small').text()).toBe('Paused')
    expect(pausedCard.attributes('disabled')).toBeUndefined()
    expect(pausedCard.classes()).toContain('interval-review-card--playback-paused')
    expect(wrapper.get('.interval-review-card__meta small')
      .getComponent({ name: 'VIcon' }).attributes('icon')).toBe('mdi-pause-circle-outline')
    expect(mocks.stopFlashcardSpeech).toHaveBeenCalled()

    mocks.intervalStore.updateSession.mockClear()
    await pausedCard.trigger('click')
    await flushPromises()

    expect(wrapper.get('.flashcard-context-actions').exists()).toBe(true)
    expect(mocks.intervalStore.sessions[0]?.status).toBe('paused')

    await wrapper.get('.flashcard-context-actions button').trigger('click')
    await flushPromises()

    expect(mocks.intervalStore.sessions[0]?.status).toBe('running')

    mocks.speakFlashcardText.mockClear()
    stored.runtime.stepIndex = 2
    stored.runtime.accumulatedMs = 30_000
    stored.runtime.remainingMs = 6_500
    await wrapper.vm.$nextTick()
    await flushPromises()

    expect(wrapper.get('.interval-review-card__meta small').text()).toBe('Front')
    expect(wrapper.get('.interval-review-card').attributes('disabled')).toBeUndefined()
    expect(wrapper.get('.interval-review-card').classes()).not.toContain('interval-review-card--playback-paused')
    expect(mocks.speakFlashcardText).toHaveBeenCalledWith('House', 'en-US')

    wrapper.unmount()
  })

  it('waits at the start of an enabled step before speaking the Review set', async () => {
    const active = intervalSession('running')
    if (!active.flashcardReview) throw new Error('Expected a Review set snapshot')
    active.flashcardReview.speechEnabled = true
    active.flashcardReview.frontLanguage = 'en-US'
    active.definition.children = [{
      id: 'read',
      type: 'step',
      name: 'Read',
      kind: 'work',
      durationSeconds: 10,
    }]
    active.runtime.remainingMs = 10_000
    mocks.intervalStore.sessions = reactive([active])

    const wrapper = mountRunner()
    await flushPromises()

    expect(wrapper.get('.interval-review-card__meta small').text()).toBe('Paused')
    expect(wrapper.get('.interval-review-card').classes())
      .toContain('interval-review-card--playback-paused')
    expect(mocks.speakFlashcardText).not.toHaveBeenCalled()

    wrapper.unmount()
  })

})
