import {
  cardMatchesTags,
  flashcardAccuracy,
  flashcardDifficulty,
  formatReviewDuration,
  sessionAccuracy,
} from '@/services/flashcards'

describe('flashcard review helpers', () => {
  it('matches any selected tag and treats an empty filter as all cards', () => {
    const card = { tags: ['math', 'algebra'] }

    expect(cardMatchesTags(card, [])).toBe(true)
    expect(cardMatchesTags(card, ['history', 'math'])).toBe(true)
    expect(cardMatchesTags(card, ['history'])).toBe(false)
  })

  it('derives difficulty and accuracy only from graded attempts', () => {
    expect(flashcardDifficulty({ successCount: 3, errorCount: 1 })).toBe(.25)
    expect(flashcardAccuracy({ successCount: 3, errorCount: 1 })).toBe(75)
    expect(flashcardDifficulty({ successCount: 0, errorCount: 0 })).toBeUndefined()
    expect(sessionAccuracy({ successCount: 2, errorCount: 2 })).toBe(50)
  })

  it('formats compact active review time', () => {
    expect(formatReviewDuration(9)).toBe('9s')
    expect(formatReviewDuration(120)).toBe('2m')
    expect(formatReviewDuration(125)).toBe('2m 5s')
  })
})
