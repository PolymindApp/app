import {
  cardMatchesTags,
  createIntervalFlashcardReviewSnapshot,
  flashcardAccuracy,
  flashcardDifficulty,
  formatReviewDuration,
  intervalFlashcardPhase,
  sessionAccuracy,
  sortFlashcardsForReview,
} from '@/services/flashcards'
import type { Flashcard, FlashcardReviewSet } from '@/types/domain'

const cards: Flashcard[] = [
  {
    id: 'new',
    front: 'New front',
    back: 'New back',
    tags: ['math'],
    createdAt: '2026-08-05T12:00:00Z',
    updatedAt: '2026-08-05T12:00:00Z',
    passiveViews: 0,
    successCount: 0,
    errorCount: 0,
  },
  {
    id: 'difficult',
    front: 'Hard front',
    back: 'Hard back',
    tags: ['math'],
    createdAt: '2026-08-01T12:00:00Z',
    updatedAt: '2026-08-04T12:00:00Z',
    lastReviewedAt: '2026-08-04T12:00:00Z',
    passiveViews: 0,
    successCount: 1,
    errorCount: 3,
  },
]

const reviewSet: FlashcardReviewSet = {
  id: 'set-1',
  name: 'Math',
  tags: ['math'],
  mode: 'passive',
  frontSeconds: 3,
  backSeconds: 4,
  speechEnabled: true,
  frontLanguage: 'en-US',
  backLanguage: 'fr-CA',
  sortMode: 'recently_added',
  sortOrder: 0,
  createdAt: '2026-08-05T12:00:00Z',
  updatedAt: '2026-08-05T12:00:00Z',
}

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

  it('sorts a Review set using the configured card order', () => {
    expect(sortFlashcardsForReview(cards, 'recently_added').map(card => card.id))
      .toEqual(['new', 'difficult'])
    expect(sortFlashcardsForReview(cards, 'difficult').map(card => card.id))
      .toEqual(['difficult', 'new'])
  })

  it('creates an effective passive snapshot and uses five seconds per side for manual sets', () => {
    const passive = createIntervalFlashcardReviewSnapshot(reviewSet, cards)
    const manual = createIntervalFlashcardReviewSnapshot({ ...reviewSet, mode: 'manual' }, cards)

    expect(passive).toMatchObject({ frontSeconds: 3, backSeconds: 4, speechEnabled: true })
    expect(manual).toMatchObject({ frontSeconds: 5, backSeconds: 5, speechEnabled: true })
  })

  it('loops attached cards indefinitely based on interval elapsed time', () => {
    const review = createIntervalFlashcardReviewSnapshot(reviewSet, cards)!

    expect(intervalFlashcardPhase(review, 0)).toMatchObject({
      cardIndex: 0,
      cycle: 0,
      side: 'front',
      progress: 0,
    })
    expect(intervalFlashcardPhase(review, 3000)).toMatchObject({ cardIndex: 0, side: 'back' })
    expect(intervalFlashcardPhase(review, 7000)).toMatchObject({ cardIndex: 1, side: 'front' })
    expect(intervalFlashcardPhase(review, 14000)).toMatchObject({
      cardIndex: 0,
      cycle: 1,
      side: 'front',
    })
  })
})
