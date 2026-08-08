import { defineComponent, h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import FlashcardsView from '@/views/FlashcardsView.vue'
import type { FlashcardReviewSet } from '@/types/domain'

const mocks = vi.hoisted(() => ({
  router: { push: vi.fn() },
  store: {
    reviewSets: [] as FlashcardReviewSet[],
    sessions: [],
    tags: [],
    activeSession: undefined,
    loaded: true,
    error: '',
    load: vi.fn().mockResolvedValue(undefined),
    startReview: vi.fn(),
    copyReviewSet: vi.fn(),
    removeReviewSetShare: vi.fn(),
  },
}))

vi.mock('vue-router', () => ({ useRouter: () => mocks.router }))
vi.mock('@/stores/flashcards', () => ({ useFlashcardStore: () => mocks.store }))

const reviewSet = (
  id: string,
  name: string,
  overrides: Partial<FlashcardReviewSet> = {},
): FlashcardReviewSet => ({
  id,
  name,
  tags: [],
  tagDetails: [],
  owner: 'user-1',
  ownerName: 'Mom User',
  ownerAvatar: '',
  accessRole: 'owner',
  matchingCardCount: 12,
  mode: 'manual',
  cardSides: 'front_back',
  indefinite: false,
  maxCards: 12,
  frontSeconds: 5,
  backSeconds: 5,
  backSpeechRepeatCount: 1,
  speechEnabled: false,
  frontLanguage: '',
  backLanguage: '',
  sortMode: 'random',
  sortOrder: 0,
  createdAt: '2026-08-01T12:00:00.000Z',
  updatedAt: '2026-08-01T12:00:00.000Z',
  ...overrides,
})

const CardStub = defineComponent({
  inheritAttrs: false,
  setup(_, { attrs, slots }) {
    return () => h('article', attrs, slots.default?.())
  },
})

const ButtonStub = defineComponent({
  inheritAttrs: false,
  props: { ariaLabel: String, disabled: Boolean },
  emits: ['click'],
  setup(props, { attrs, emit, slots }) {
    return () => h('button', {
      ...attrs,
      'aria-label': props.ariaLabel,
      disabled: props.disabled,
      onClick: (event: MouseEvent) => emit('click', event),
    }, slots.default?.())
  },
})

const ActionBottomSheetStub = defineComponent({
  props: { modelValue: Boolean },
  setup(props, { slots }) {
    return () => props.modelValue
      ? h('section', { class: 'review-set-action-sheet' }, slots.default?.())
      : null
  },
})

const ListItemStub = defineComponent({
  props: { title: String, disabled: Boolean },
  emits: ['click'],
  setup(props, { emit }) {
    return () => h('button', {
      disabled: props.disabled,
      onClick: () => emit('click'),
    }, props.title)
  },
})

function mountView() {
  return mount(FlashcardsView, {
    global: {
      stubs: {
        ActionBottomSheet: ActionBottomSheetStub,
        ConfirmDialog: true,
        WeekNavigator: true,
        VAlert: true,
        VBtn: ButtonStub,
        VCard: CardStub,
        VChip: true,
        VDivider: true,
        VIcon: true,
        VList: true,
        VListItem: ListItemStub,
        VProgressLinear: true,
      },
    },
  })
}

describe('Flashcards Review set cards', () => {
  beforeEach(() => {
    mocks.store.reviewSets = [
      reviewSet('owned-set', 'Vocabulary'),
      reviewSet('shared-set', 'Shared Spanish', {
        accessRole: 'readonly',
        owner: 'user-2',
        ownerName: 'Alex',
        shareId: 'share-1',
      }),
    ]
    mocks.store.startReview.mockReset().mockResolvedValue({ id: 'session-1' })
    mocks.router.push.mockReset()
  })

  it.each([
    ['Vocabulary', 'owned-set'],
    ['Shared Spanish', 'shared-set'],
  ])('starts %s directly when its card is clicked', async (name, id) => {
    const wrapper = mountView()

    await wrapper.get(`[aria-label="Review ${name}"]`).trigger('click')
    await flushPromises()

    expect(mocks.store.startReview).toHaveBeenCalledWith(id)
    expect(mocks.router.push).toHaveBeenCalledWith({
      name: 'flashcard-review-runner',
      params: { sessionId: 'session-1' },
    })
  })

  it('opens management actions from the three-dot button without starting a review', async () => {
    const wrapper = mountView()

    await wrapper.get('button[aria-label="More actions for Vocabulary"]').trigger('click')

    expect(mocks.store.startReview).not.toHaveBeenCalled()
    expect(wrapper.findAll('.review-set-action-sheet button').map(item => item.text())).toEqual([
      'Edit',
      'Share',
      'Manage cards',
    ])
  })
})
