import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import MainNavigationIcon from '@/components/MainNavigationIcon.vue'

const VBadgeStub = defineComponent({
  props: {
    modelValue: Boolean,
    color: String,
    location: String,
  },
  template: `
    <span
      class="badge-stub"
      :data-active="modelValue"
      :data-color="color"
      :data-location="location"
    ><slot /></span>
  `,
})

describe('MainNavigationIcon', () => {
  it('places a secondary running badge at the icon top-right', () => {
    const wrapper = mount(MainNavigationIcon, {
      props: {
        icon: 'mdi-timer-outline',
        running: true,
        badgeSurface: 'background',
      },
      global: {
        stubs: {
          VBadge: VBadgeStub,
          VIcon: true,
        },
      },
    })

    const badge = wrapper.get('.badge-stub')
    expect(badge.attributes('data-active')).toBe('true')
    expect(badge.attributes('data-color')).toBe('secondary')
    expect(badge.attributes('data-location')).toBe('top end')
    expect(badge.classes()).toContain('main-navigation-icon--background')
  })
})
