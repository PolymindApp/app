import { computed, defineComponent, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { vi } from 'vitest'
import IntervalNodeEditor from '@/components/IntervalNodeEditor.vue'
import type { IntervalStepNode } from '@/types/domain'

vi.mock('vuetify', () => ({
  useDisplay: () => ({ smAndDown: ref(true) }),
}))

const VIconStub = defineComponent({
  props: { icon: String },
  template: '<i :data-icon="icon" />',
})

const VListItemStub = defineComponent({
  props: { title: String },
  template: '<div class="stub-list-item"><slot name="prepend" /><span>{{ title }}</span></div>',
})

const VCheckboxStub = defineComponent({
  props: { label: String, modelValue: Boolean },
  template: '<label class="stub-checkbox">{{ label }}</label>',
})

const VSelectStub = defineComponent({
  props: {
    items: { type: Array, default: () => [] },
    modelValue: String,
  },
  emits: ['update:modelValue'],
  setup(props) {
    const selection = computed(() => props.items.find((item: any) => item.value === props.modelValue))
    return { selection }
  },
  template: `
    <div class="stub-select">
      <div class="stub-selection">
        <slot v-if="selection" name="selection" :item="{ raw: selection }" />
      </div>
      <div class="stub-items">
        <slot
          v-for="item in items"
          :key="item.value"
          name="item"
          :item="{ raw: item }"
          :props="{ title: item.title }"
        />
      </div>
    </div>
  `,
})

function editorProps(node: IntervalStepNode, overrides: Record<string, unknown> = {}) {
  return {
    node,
    index: 0,
    siblingCount: 1,
    depth: 0,
    canIndent: false,
    canOutdent: false,
    canSkipOnLastRound: false,
    expandedNodeId: node.id,
    actions: {
      add: vi.fn(),
      move: vi.fn(),
      indent: vi.fn(),
      outdent: vi.fn(),
      duplicate: vi.fn(),
      remove: vi.fn(),
      open: vi.fn(),
      toggle: vi.fn(),
      reorder: vi.fn(),
    },
    ...overrides,
  }
}

describe('IntervalNodeEditor interval type select', () => {
  it('keeps a newly added interval unselected until a type is chosen', () => {
    const node: IntervalStepNode = {
      id: 'step-new',
      type: 'step',
      name: '',
      kind: '',
      durationSeconds: 30,
    }
    const wrapper = mount(IntervalNodeEditor, {
      props: editorProps(node),
      global: {
        directives: { longPressDrag: {}, longPressDrop: {} },
        stubs: {
          ExpandTransition: { template: '<div><slot /></div>' },
          VBtn: true,
          VCard: { template: '<div><slot /></div>' },
          VCheckbox: true,
          VIcon: VIconStub,
          VListItem: VListItemStub,
          VSelect: VSelectStub,
          VTextField: true,
          TimerWheelPicker: true,
        },
      },
    })

    expect(wrapper.findComponent(VSelectStub).props('modelValue')).toBeNull()
    expect(wrapper.find('.stub-selection .interval-type-icon').exists()).toBe(false)
  })

  it('renders colored type icons in the selection and every item slot', async () => {
    const node: IntervalStepNode = {
      id: 'step-1',
      type: 'step',
      name: 'Work',
      kind: 'work',
      durationSeconds: 30,
    }
    const wrapper = mount(IntervalNodeEditor, {
      props: editorProps(node),
      global: {
        directives: { longPressDrag: {}, longPressDrop: {} },
        stubs: {
          ExpandTransition: { template: '<div><slot /></div>' },
          VBtn: true,
          VCard: { template: '<div><slot /></div>' },
          VCheckbox: true,
          VIcon: VIconStub,
          VListItem: VListItemStub,
          VSelect: VSelectStub,
          VTextField: true,
          TimerWheelPicker: true,
        },
      },
    })

    expect(wrapper.find('.stub-selection [data-icon="mdi-lightning-bolt"]').exists()).toBe(true)
    expect(wrapper.findAll('.stub-items .interval-type-icon')).toHaveLength(7)
    expect(wrapper.find('.stub-items [data-icon="mdi-heart"]').exists()).toBe(true)

    wrapper.findComponent(VSelectStub).vm.$emit('update:modelValue', 'train')
    await wrapper.vm.$nextTick()

    expect(node.kind).toBe('train')
    expect(node.name).toBe('Train')
    expect(wrapper.find('.stub-selection [data-icon="mdi-heart"]').exists()).toBe(true)
  })

  it('shows the final-round skip option when the parent sequence allows it', async () => {
    const node: IntervalStepNode = {
      id: 'step-final',
      type: 'step',
      name: 'Rest',
      kind: 'rest',
      durationSeconds: 10,
    }
    const wrapper = mount(IntervalNodeEditor, {
      props: editorProps(node, { canSkipOnLastRound: true }),
      global: {
        directives: { longPressDrag: {}, longPressDrop: {} },
        stubs: {
          ExpandTransition: { template: '<div><slot /></div>' },
          VBtn: true,
          VCard: { template: '<div><slot /></div>' },
          VCheckbox: VCheckboxStub,
          VIcon: VIconStub,
          VListItem: VListItemStub,
          VSelect: VSelectStub,
          VTextField: true,
          TimerWheelPicker: true,
        },
      },
    })

    expect(wrapper.find('.stub-checkbox').text()).toBe('Skip this step on the final round')

    await wrapper.setProps({ canSkipOnLastRound: false })
    expect(wrapper.find('.stub-checkbox').exists()).toBe(false)
  })
})
