import { mount } from '@vue/test-utils'
import FlashcardResponseText from '@/components/FlashcardResponseText.vue'
import { flashcardTextFontSize } from '@/services/flashcards'

function mountResponse(noteBeforeBack: boolean) {
  return mount(FlashcardResponseText, {
    props: {
      back: 'Answer',
      note: 'Supporting note',
      noteBeforeBack,
    },
  })
}

function responseOrder(noteBeforeBack: boolean) {
  return mountResponse(noteBeforeBack)
    .findAll('[data-response-part]')
    .map(part => part.attributes('data-response-part'))
}

describe('FlashcardResponseText', () => {
  it('shows the answer before the note by default', () => {
    expect(responseOrder(false)).toEqual(['back', 'note'])
  })

  it('can show the note before the answer', () => {
    expect(responseOrder(true)).toEqual(['note', 'back'])
  })

  it('swaps color and font-size emphasis with the inverted order', () => {
    const wrapper = mountResponse(true)
    const note = wrapper.get('[data-response-part="note"]')
    const back = wrapper.get('[data-response-part="back"]')

    expect(note.attributes('data-response-presentation')).toBe('primary')
    expect(note.classes()).toContain('text-secondary')
    expect(note.element.tagName).toBe('STRONG')
    expect((note.element as HTMLElement).style.fontSize)
      .toBe(flashcardTextFontSize('Supporting note', 'face'))

    expect(back.attributes('data-response-presentation')).toBe('supporting')
    expect(back.classes()).not.toContain('text-secondary')
    expect(back.element.tagName).toBe('SPAN')
    expect((back.element as HTMLElement).style.fontSize)
      .toBe(flashcardTextFontSize('Answer', 'note'))
  })
})
