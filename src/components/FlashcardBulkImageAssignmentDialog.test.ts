import { defineComponent, nextTick } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import FlashcardBulkImageAssignmentDialog from '@/components/FlashcardBulkImageAssignmentDialog.vue'
import type { Flashcard, ImageLibraryAsset } from '@/types/domain'

const assignLibraryImage = vi.hoisted(() => vi.fn())

vi.mock('@/stores/flashcards', () => ({
  useFlashcardStore: () => ({ cards: [], assignLibraryImage }),
}))

const proposedImage: ImageLibraryAsset = {
  id: 42,
  imageUrl: '/api/flashcard-images/proposed.jpg',
  alt: 'A proposed image',
  photographer: 'Pexels Person',
  photographerUrl: 'https://www.pexels.com/@person',
  sourceUrl: 'https://www.pexels.com/photo/42/',
  licenseName: 'Pexels License',
  licenseUrl: 'https://www.pexels.com/license/',
}

const SearchPanelStub = defineComponent({
  emits: ['select', 'search'],
  setup(_props, { emit }) {
    return { select: () => emit('select', proposedImage) }
  },
  template: '<button class="select-proposal" @click="select">Select proposed image</button>',
})

const DialogStub = defineComponent({
  props: { modelValue: Boolean, fullscreen: Boolean },
  template: '<div v-if="modelValue" class="dialog-stub" :data-fullscreen="fullscreen"><slot /></div>',
})

const ButtonStub = defineComponent({
  props: { disabled: Boolean, loading: Boolean },
  template: '<button :disabled="disabled || loading"><slot /></button>',
})

function card(id: string, front: string, back: string): Flashcard {
  return {
    id,
    front,
    back,
    note: '',
    image: '',
    imageSource: 'none',
    tags: [],
    createdAt: '2026-08-07T12:00:00.000Z',
    updatedAt: '2026-08-07T12:00:00.000Z',
    passiveViews: 0,
    successCount: 0,
    errorCount: 0,
  }
}

function mountDialog(
  cards: Flashcard[],
  assignImage?: (cardId: string, imageId: number) => Promise<unknown>,
) {
  return mount(FlashcardBulkImageAssignmentDialog, {
    props: { modelValue: true, cards, assignImage },
    global: {
      stubs: {
        ImageLibrarySearchPanel: SearchPanelStub,
        VAlert: { template: '<div><slot /></div>' },
        VBtn: ButtonStub,
        VCard: { template: '<div><slot /></div>' },
        VCardText: { template: '<div><slot /></div>' },
        VChip: { template: '<span><slot /></span>' },
        VCol: { template: '<div><slot /></div>' },
        VDialog: DialogStub,
        VIcon: true,
        VImg: { template: '<img />' },
        VProgressLinear: true,
        VRow: { template: '<div><slot /></div>' },
      },
    },
  })
}

describe('FlashcardBulkImageAssignmentDialog', () => {
  beforeEach(() => {
    assignLibraryImage.mockReset()
    assignLibraryImage.mockResolvedValue(undefined)
  })

  it('reviews each card through assignment or skip before completing', async () => {
    const cards = [
      card('card-1', 'Bicycle', 'Vélo'),
      card('card-2', 'Hammer', 'Marteau'),
    ]
    const wrapper = mountDialog(cards)
    await nextTick()

    expect(wrapper.get('.dialog-stub').attributes('data-fullscreen')).toBe('true')
    expect(wrapper.text()).toContain('Bicycle')

    await wrapper.get('.select-proposal').trigger('click')
    const assignButton = wrapper.findAll('button').find(button => button.text().includes('Assign & next'))
    expect(assignButton).toBeTruthy()
    await assignButton!.trigger('click')
    await flushPromises()

    expect(assignLibraryImage).toHaveBeenCalledWith('card-1', 42)
    expect(wrapper.text()).toContain('Hammer')

    const skipButton = wrapper.findAll('button').find(button => button.text().trim() === 'Skip')
    await skipButton!.trigger('click')
    await nextTick()

    expect(wrapper.text()).toContain('Every selected card was reviewed')
    expect(wrapper.text()).toContain('Assigned 1 · Skipped 1')

    const doneButton = wrapper.findAll('button').find(button => button.text().trim() === 'Done')
    await doneButton!.trigger('click')
    expect(wrapper.emitted('complete')).toEqual([[1, 1]])
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([false])
  })

  it('uses a scoped image assignment handler when provided', async () => {
    const assignImage = vi.fn().mockResolvedValue(undefined)
    const wrapper = mountDialog([card('shared-card', 'Shared', 'Card')], assignImage)
    await nextTick()

    await wrapper.get('.select-proposal').trigger('click')
    const assignButton = wrapper.findAll('button').find(button => button.text().includes('Assign & next'))
    await assignButton!.trigger('click')
    await flushPromises()

    expect(assignImage).toHaveBeenCalledWith('shared-card', 42)
    expect(assignLibraryImage).not.toHaveBeenCalled()
  })
})
