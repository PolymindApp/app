import { defineComponent, Fragment, h, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import ActionBottomSheet from '@/components/ActionBottomSheet.vue'

const displayState = vi.hoisted(() => ({ mobile: true }))

vi.mock('vuetify', async () => {
  const { computed } = await import('vue')
  return {
    useDisplay: () => ({ smAndDown: computed(() => displayState.mobile) }),
  }
})

const NavigationDrawerStub = defineComponent({
  inheritAttrs: false,
  props: {
    modelValue: Boolean,
  },
  setup(props, { attrs, slots }) {
    return () => h(Fragment, [
      h('aside', {
        ...attrs,
        style: { transform: props.modelValue ? 'translateY(0px)' : 'translateY(100%)' },
      }, h('div', { class: 'v-navigation-drawer__content' }, slots.default?.())),
      h('div', {
        class: [
          'drawer-scrim',
          'v-navigation-drawer__scrim',
          { 'fade-transition-leave-active': !props.modelValue },
        ],
      }),
    ])
  },
})

const MenuStub = defineComponent({
  inheritAttrs: false,
  props: {
    modelValue: Boolean,
    target: [String, Object],
  },
  setup(props, { attrs, slots }) {
    return () => props.modelValue
      ? h('section', { ...attrs, class: 'desktop-action-menu' }, slots.default?.())
      : null
  },
})

function pointerEvent(type: string, clientY: number) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: 20,
    clientY,
  })
  Object.defineProperties(event, {
    isPrimary: { value: true },
    pointerId: { value: 1 },
    pointerType: { value: 'mouse' },
  })
  return event
}

describe('ActionBottomSheet', () => {
  beforeEach(() => {
    displayState.mobile = true
  })

  it('moves with a downward drag and closes after crossing the threshold', async () => {
    const Harness = defineComponent({
      components: { ActionBottomSheet },
      setup() {
        const open = ref(true)
        return { open }
      },
      template: `
        <ActionBottomSheet v-model="open" title="Actions">
          <div>Option</div>
        </ActionBottomSheet>
      `,
    })
    const wrapper = mount(Harness, {
      attachTo: document.body,
      global: {
        stubs: {
          VList: { template: '<div><slot /></div>' },
          VNavigationDrawer: NavigationDrawerStub,
        },
      },
    })
    await nextTick()

    const sheet = document.querySelector<HTMLElement>('.action-bottom-sheet')!
    const header = sheet.querySelector<HTMLElement>('.action-bottom-sheet__header')!
    vi.spyOn(sheet, 'getBoundingClientRect').mockReturnValue({
      bottom: 300,
      height: 300,
      left: 0,
      right: 360,
      top: 0,
      width: 360,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })

    header.dispatchEvent(pointerEvent('pointerdown', 20))
    window.dispatchEvent(pointerEvent('pointermove', 120))
    expect(sheet.style.transform).toBe('translateY(100px)')

    window.dispatchEvent(pointerEvent('pointerup', 120))
    expect(sheet.style.transform).toBe('translateY(100%)')
    expect(wrapper.vm.open).toBe(false)

    await nextTick()
    expect(sheet.style.transform).toBe('translateY(100%)')
    const leavingScrim = document.querySelector<HTMLElement>('.drawer-scrim')!
    expect(leavingScrim.classList.contains('fade-transition-leave-active')).toBe(true)
    expect(getComputedStyle(leavingScrim).pointerEvents).toBe('none')
    wrapper.unmount()
  })

  it('keeps oversized mobile content inside a dedicated scroll region', async () => {
    const wrapper = mount(ActionBottomSheet, {
      attachTo: document.body,
      props: {
        modelValue: true,
        title: 'Actions',
      },
      slots: {
        content: '<div class="oversized-content">Content</div>',
      },
      global: {
        stubs: {
          VNavigationDrawer: NavigationDrawerStub,
        },
      },
    })

    const scroll = wrapper.get('.action-bottom-sheet__scroll')

    expect(scroll.element.parentElement?.classList.contains('v-navigation-drawer__content')).toBe(true)
    expect(scroll.find('.oversized-content').exists()).toBe(true)
    wrapper.unmount()
  })

  it('uses an anchored menu instead of a bottom drawer on desktop', async () => {
    displayState.mobile = false
    const Harness = defineComponent({
      components: { ActionBottomSheet },
      setup() {
        const open = ref(false)
        return { open }
      },
      template: `
        <button class="actions-trigger" @click="open = true">Open</button>
        <ActionBottomSheet v-model="open" title="Actions" hide-title>
          <div class="menu-option">Option</div>
        </ActionBottomSheet>
      `,
    })
    const wrapper = mount(Harness, {
      attachTo: document.body,
      global: {
        stubs: {
          VCard: { template: '<div><slot /></div>' },
          VList: { template: '<div><slot /></div>' },
          VMenu: MenuStub,
          VNavigationDrawer: NavigationDrawerStub,
        },
      },
    })

    const trigger = wrapper.get('.actions-trigger')
    trigger.element.dispatchEvent(pointerEvent('pointerdown', 20))
    await trigger.trigger('click')
    await nextTick()

    expect(wrapper.find('.desktop-action-menu').exists()).toBe(true)
    expect(wrapper.find('.action-bottom-sheet').exists()).toBe(false)
    expect(wrapper.find('.menu-option').text()).toBe('Option')
    expect(wrapper.findComponent(MenuStub).props('target')).toBe(trigger.element)
    wrapper.unmount()
  })
})
