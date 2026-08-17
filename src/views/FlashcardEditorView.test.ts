import { defineComponent, h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import FlashcardEditorView from './FlashcardEditorView.vue'

const mocks = vi.hoisted(() => ({
  route: {
    params: {} as Record<string, string>,
    query: {} as Record<string, string>,
  },
  router: { back: vi.fn(), replace: vi.fn() },
  store: {
    loaded: true,
    cards: [] as Record<string, unknown>[],
    reviewSets: [] as Record<string, unknown>[],
    reviewSetCards: {} as Record<string, Record<string, unknown>[]>,
    load: vi.fn(),
    loadReviewSetCards: vi.fn(),
    saveCard: vi.fn(),
    saveReviewSetCard: vi.fn(),
    deleteCard: vi.fn(),
    deleteReviewSetCard: vi.fn(),
  },
}))

vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => 'web' } }))
vi.mock('vue-router', () => ({
  useRoute: () => mocks.route,
  useRouter: () => mocks.router,
}))
vi.mock('@/stores/flashcards', () => ({ useFlashcardStore: () => mocks.store }))

const AppFormStub = defineComponent({
  setup(_, { expose, slots }) {
    expose({
      validate: vi.fn().mockResolvedValue({ valid: true }),
      resetValidation: vi.fn(),
    })
    return () => h('form', slots.default?.())
  },
})

const TextareaStub = defineComponent({
  props: { modelValue: { type: String, default: '' } },
  emits: ['update:modelValue'],
  template: `
    <div class="textarea-stub">
      <textarea
        :value="modelValue"
        @input="$emit('update:modelValue', $event.target.value)"
      />
      <slot name="label" />
    </div>
  `,
})

const FormActionBarStub = defineComponent({
  props: { primaryDisabled: Boolean },
  emits: ['submit'],
  template: `
    <button class="save-card" :disabled="primaryDisabled" @click="$emit('submit')">
      Create
    </button>
  `,
})

function mountEditor() {
  return mount(FlashcardEditorView, {
    global: {
      stubs: {
        FlashcardAudioSection: true,
        AppForm: AppFormStub,
        ConfirmDialog: true,
        FlashcardTagCombobox: true,
        FormActionBar: FormActionBarStub,
        VAlert: { template: '<div><slot /></div>' },
        VCard: { template: '<div><slot /></div>' },
        VProgressCircular: true,
        VTextarea: TextareaStub,
      },
    },
  })
}

async function saveNewCard(wrapper: ReturnType<typeof mountEditor>) {
  await flushPromises()
  const fields = wrapper.findAll('textarea')
  await fields[0]!.setValue('Question')
  await fields[1]!.setValue('Answer')
  await wrapper.get('.save-card').trigger('click')
  await flushPromises()
}

describe('FlashcardEditorView new card flow', () => {
  beforeEach(() => {
    mocks.route.params = {}
    mocks.route.query = {}
    mocks.router.replace.mockReset()
    mocks.store.saveCard.mockReset().mockResolvedValue({ id: 'card-1' })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('smoothly scrolls to the form top after creating a card', async () => {
    const scrollTo = vi.fn()
    vi.stubGlobal('scrollTo', scrollTo)
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false } as MediaQueryList))
    const wrapper = mountEditor()

    await saveNewCard(wrapper)

    expect(mocks.store.saveCard).toHaveBeenCalledOnce()
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'smooth' })
    expect(wrapper.findAll('textarea').map(field => field.element.value)).toEqual(['', '', ''])
  })

  it('uses immediate scrolling when reduced motion is requested', async () => {
    const scrollTo = vi.fn()
    vi.stubGlobal('scrollTo', scrollTo)
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true } as MediaQueryList))
    const wrapper = mountEditor()

    await saveNewCard(wrapper)

    expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'auto' })
  })
})
