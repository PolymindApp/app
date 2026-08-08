import { mount } from '@vue/test-utils'
import FlashcardResponseText from '@/components/FlashcardResponseText.vue'

function responseOrder(noteBeforeBack: boolean) {
  return mount(FlashcardResponseText, {
    props: {
      back: 'Answer',
      note: 'Supporting note',
      noteBeforeBack,
    },
  }).findAll('[data-response-part]').map(part => part.attributes('data-response-part'))
}

describe('FlashcardResponseText', () => {
  it('shows the answer before the note by default', () => {
    expect(responseOrder(false)).toEqual(['back', 'note'])
  })

  it('can show the note before the answer', () => {
    expect(responseOrder(true)).toEqual(['note', 'back'])
  })
})
