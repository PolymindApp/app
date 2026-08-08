import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import TagSelectionChip from '@/components/TagSelectionChip.vue'

const VChipStub = defineComponent({
  inheritAttrs: true,
  emits: ['click', 'click:close'],
  template: `
    <button class="chip-stub" type="button">
      <slot />
      <span class="chip-close" @click="$emit('click:close', $event)">×</span>
    </button>
  `,
})

function mountChip(onClose = vi.fn()) {
  return {
    onClose,
    wrapper: mount(TagSelectionChip, {
      props: {
        chipProps: {
          closable: true,
          'onClick:close': onClose,
        },
        label: 'Vocabulary',
      },
      global: {
        stubs: {
          VChip: VChipStub,
        },
      },
    }),
  }
}

describe('TagSelectionChip', () => {
  it('preserves the supplied close handler while stopping the close click', async () => {
    const { wrapper, onClose } = mountChip()
    const event = new MouseEvent('click', { bubbles: true })
    const stopPropagation = vi.spyOn(event, 'stopPropagation')

    wrapper.get('.chip-close').element.dispatchEvent(event)
    await wrapper.vm.$nextTick()

    expect(onClose).toHaveBeenCalledWith(event)
    expect(stopPropagation).toHaveBeenCalled()
  })

  it.each(['pointerdown', 'touchstart'])('stops %s before it reaches a parent interaction', (type) => {
    const { wrapper } = mountChip()
    const event = new Event(type, { bubbles: true })
    const stopPropagation = vi.spyOn(event, 'stopPropagation')

    wrapper.get('.chip-stub').element.dispatchEvent(event)

    expect(stopPropagation).toHaveBeenCalled()
  })
})
