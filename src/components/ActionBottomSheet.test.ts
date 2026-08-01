import { defineComponent, Fragment, h, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import ActionBottomSheet from '@/components/ActionBottomSheet.vue'

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
      }, slots.default?.()),
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
})
