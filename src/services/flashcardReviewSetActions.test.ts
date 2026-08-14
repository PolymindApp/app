import { FLASHCARD_REVIEW_SET_ACTIONS } from '@/services/flashcardReviewSetActions'

describe('Review set role actions', () => {
  it('keeps owner-only and recipient-only actions separated by access role', () => {
    expect(FLASHCARD_REVIEW_SET_ACTIONS.owner.map(item => item.action)).toEqual([
      'review', 'edit', 'share',
    ])
    expect(FLASHCARD_REVIEW_SET_ACTIONS.readonly.map(item => item.action)).toEqual([
      'review', 'settings', 'copy', 'leave',
    ])
    expect(FLASHCARD_REVIEW_SET_ACTIONS.editor.map(item => item.action)).toEqual([
      'review', 'settings', 'copy', 'leave',
    ])
  })
})
