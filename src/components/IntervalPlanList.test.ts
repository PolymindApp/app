import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import IntervalPlanList from '@/components/IntervalPlanList.vue'
import type { IntervalTemplate } from '@/types/domain'

const mocks = vi.hoisted(() => ({
  router: { push: vi.fn() },
  store: {
    templates: [] as IntervalTemplate[],
    loaded: true,
    load: vi.fn(),
    deleteTemplate: vi.fn(),
    duplicateTemplate: vi.fn(),
    reorderTemplates: vi.fn(),
  },
}))

vi.mock('vue-router', () => ({ useRouter: () => mocks.router }))
vi.mock('@/stores/intervals', () => ({ useIntervalStore: () => mocks.store }))

const ActionBottomSheetStub = defineComponent({
  setup(_, { slots }) {
    return () => h('section', slots.default?.())
  },
})

const CardStub = defineComponent({
  inheritAttrs: false,
  setup(_, { attrs, slots }) {
    return () => h('article', attrs, slots.default?.())
  },
})

const ButtonStub = defineComponent({
  inheritAttrs: false,
  props: { ariaLabel: String },
  emits: ['click'],
  setup(props, { attrs, emit }) {
    return () => h('button', {
      ...attrs,
      'aria-label': props.ariaLabel,
      onClick: (event: MouseEvent) => emit('click', event),
    })
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

const template: IntervalTemplate = {
  id: 'morning-hiit',
  name: 'Morning HIIT',
  description: 'A quick workout',
  color: '#C7F464',
  definition: {
    version: 1,
    children: [{
      id: 'work',
      type: 'step',
      name: 'Work',
      kind: 'work',
      durationSeconds: 30,
    }],
  },
  cues: { soundEnabled: true, vibrationEnabled: true },
  sortOrder: 0,
}

function mountList() {
  return mount(IntervalPlanList, {
    global: {
      directives: { longPressDrag: {} },
      stubs: {
        ActionBottomSheet: ActionBottomSheetStub,
        ConfirmDialog: true,
        VBtn: ButtonStub,
        VCard: CardStub,
        VIcon: true,
        VListItem: ListItemStub,
      },
    },
  })
}

describe('IntervalPlanList actions', () => {
  beforeEach(() => {
    mocks.store.templates = [template]
    mocks.router.push.mockReset()
  })

  it('plays an interval directly when its card is clicked', async () => {
    const wrapper = mountList()

    await wrapper.get('.interval-plan-card').trigger('click')

    expect(mocks.router.push).toHaveBeenCalledWith('/intervals/run/template/morning-hiit')
  })

  it('shows only Edit, Duplicate, and Delete in the three-dot menu', async () => {
    const wrapper = mountList()

    await wrapper.get('button[aria-label="Morning HIIT more actions"]').trigger('click')

    const actions = wrapper.findAll('section button').map(button => button.text())
    expect(actions).toEqual(['Edit', 'Duplicate', 'Delete'])

    await wrapper.findAll('section button')[0]!.trigger('click')
    expect(mocks.router.push).toHaveBeenCalledWith('/intervals/morning-hiit/edit')
  })
})
