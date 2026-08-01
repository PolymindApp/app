import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import IntervalTypeIcon from '@/components/IntervalTypeIcon.vue'
import { INTERVAL_STEP_TYPES } from '@/services/intervalTypes'
import type { IntervalStepKind } from '@/types/domain'

const VIconStub = defineComponent({
  props: { icon: String },
  template: '<i :data-icon="icon" />',
})

function mountIcon(kind: IntervalStepKind, animated = false) {
  return mount(IntervalTypeIcon, {
    props: { kind, animated },
    global: { stubs: { VIcon: VIconStub } },
  })
}

describe('IntervalTypeIcon', () => {
  it('renders every interval type statically by default', () => {
    for (const type of INTERVAL_STEP_TYPES) {
      const wrapper = mountIcon(type.value)

      expect(wrapper.classes()).not.toContain('interval-type-icon--animated')
      expect(wrapper.classes()).not.toContain(`interval-type-icon--${type.animation}`)
      expect(wrapper.attributes('style')).toContain(`--interval-type-color: ${type.color}`)
      expect(wrapper.find('[data-icon]').attributes('data-icon')).toBe(type.icon)
    }
  })

  it('adds the semantic animation only when active', () => {
    for (const type of INTERVAL_STEP_TYPES) {
      const wrapper = mountIcon(type.value, true)

      expect(wrapper.classes()).toContain('interval-type-icon--animated')
      expect(wrapper.classes()).toContain(`interval-type-icon--${type.animation}`)
    }
  })

  it('uses a red pulsing heart for Train', () => {
    const wrapper = mountIcon('train', true)

    expect(wrapper.classes()).toContain('interval-type-icon--pulse')
    expect(wrapper.attributes('style')).toContain('--interval-type-color: #FF5C6C')
    expect(wrapper.find('[data-icon]').attributes('data-icon')).toBe('mdi-heart')
  })

  it('layers two converging icons for Meditation', () => {
    const wrapper = mountIcon('meditation', true)

    expect(wrapper.classes()).toContain('interval-type-icon--focus')
    expect(wrapper.findAll('[data-icon="mdi-meditation"]')).toHaveLength(2)
    expect(wrapper.find('.interval-type-icon__echo').exists()).toBe(true)
  })

  it('keeps the Meditation icon single and static while inactive', () => {
    const wrapper = mountIcon('meditation')

    expect(wrapper.findAll('[data-icon="mdi-meditation"]')).toHaveLength(1)
    expect(wrapper.find('.interval-type-icon__echo').exists()).toBe(false)
  })
})
