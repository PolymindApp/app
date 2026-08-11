import {
  cardMatchesTags,
  createFlashcardReviewPreviewSession,
  createIntervalFlashcardReviewSnapshot,
  flashcardAccuracy,
  flashcardSideFromSwipe,
  flashcardTextFontSize,
  flashcardDifficulty,
  formatReviewDuration,
  intervalFlashcardPhase,
  reviewSetCardCount,
  sessionAccuracy,
  sortFlashcardsForReview,
  updateFlashcardReviewExclusions,
} from '@/services/flashcards'
import type { Flashcard, FlashcardReviewSet } from '@/types/domain'

const cards: Flashcard[] = [
  {
    id: 'new',
    front: 'New front',
    back: 'New back',
    note: 'Newest card note',
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
    note: '',
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
  cardSides: 'both',
  indefinite: false,
  maxCards: 20,
  frontSeconds: 3,
  backSeconds: 4,
  backSpeechRepeatCount: 3,
  noteBeforeBack: true,
  speechEnabled: true,
  frontLanguage: 'en-US',
  backLanguage: 'fr-CA',
  sortMode: 'recently_added',
  sortOrder: 0,
  createdAt: '2026-08-05T12:00:00Z',
  updatedAt: '2026-08-05T12:00:00Z',
}

describe('flashcard review helpers', () => {
  it('maps horizontal swipes to card sides without intercepting short or vertical gestures', () => {
    expect(flashcardSideFromSwipe({ x: 120, y: 100 }, { x: 40, y: 105 })).toBe('back')
    expect(flashcardSideFromSwipe({ x: 40, y: 100 }, { x: 120, y: 95 })).toBe('front')
    expect(flashcardSideFromSwipe({ x: 100, y: 100 }, { x: 70, y: 100 })).toBeUndefined()
    expect(flashcardSideFromSwipe({ x: 100, y: 40 }, { x: 160, y: 140 })).toBeUndefined()
  })

  it('scales flashcard faces and notes down as their text becomes longer', () => {
    const shortFace = parseFloat(flashcardTextFontSize('Wood'))
    const mediumFace = parseFloat(flashcardTextFontSize('A moderately detailed flashcard answer'))
    const longFace = parseFloat(flashcardTextFontSize('A'.repeat(500)))
    const shortNote = parseFloat(flashcardTextFontSize('Remember this', 'note'))
    const longNote = parseFloat(flashcardTextFontSize('N'.repeat(500), 'note'))

    expect(shortFace).toBeGreaterThan(mediumFace)
    expect(mediumFace).toBeGreaterThan(longFace)
    expect(shortNote).toBeGreaterThan(longNote)
    expect(shortNote).toBeLessThan(shortFace)
    expect(parseFloat(flashcardTextFontSize('Wood', 'face', 'compact'))).toBeLessThan(shortFace)
  })

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

  it('reflects the current Review set session limit in attached summaries', () => {
    expect(reviewSetCardCount({ matchingCardCount: 12, maxCards: 20 })).toBe(12)
    expect(reviewSetCardCount({ matchingCardCount: 50, maxCards: 20 })).toBe(20)
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

    expect(passive).toMatchObject({
      cardSides: 'both',
      frontSeconds: 3,
      backSeconds: 4,
      backSpeechRepeatCount: 3,
      noteBeforeBack: true,
      speechEnabled: true,
    })
    expect(manual).toMatchObject({
      frontSeconds: 5,
      backSeconds: 5,
      backSpeechRepeatCount: 1,
      noteBeforeBack: true,
      speechEnabled: true,
    })
  })

  it('limits interval Review set snapshots after sorting the matching cards', () => {
    const snapshot = createIntervalFlashcardReviewSnapshot(
      { ...reviewSet, maxCards: 1 },
      cards,
    )

    expect(snapshot?.cards.map(card => card.id)).toEqual(['new'])
    expect(snapshot?.cards[0]?.note).toBe('Newest card note')
  })

  it('excludes selected cards before applying ordering and the card limit', () => {
    const snapshot = createIntervalFlashcardReviewSnapshot(
      { ...reviewSet, excludedCards: ['new'], maxCards: 1 },
      cards,
    )

    expect(snapshot?.cards.map(card => card.id)).toEqual(['difficult'])
  })

  it('keeps unrelated exclusions while card filters and ordering change', () => {
    const afterExclude = updateFlashcardReviewExclusions(
      ['card-hidden-by-current-filter'],
      'exclude',
      ['card-visible'],
    )
    const afterInclude = updateFlashcardReviewExclusions(
      afterExclude,
      'include',
      ['card-visible'],
    )

    expect(afterExclude).toEqual(['card-hidden-by-current-filter', 'card-visible'])
    expect(afterInclude).toEqual(['card-hidden-by-current-filter'])
  })

  it('prepares a paused Review set preview without recording progress', () => {
    const preview = createFlashcardReviewPreviewSession(
      { ...reviewSet, maxCards: 1 },
      cards,
      Math.random,
      new Date('2026-08-08T12:00:00Z'),
    )

    expect(preview).toMatchObject({
      id: 'review-set-preview-set-1',
      reviewSet: 'set-1',
      status: 'paused',
      startedAt: '2026-08-08T12:00:00.000Z',
      elapsedSeconds: 0,
      totalCards: 1,
      viewedCount: 0,
    })
    expect(preview?.queue.map(card => card.id)).toEqual(['new'])
  })

  it('loops attached cards indefinitely based on interval elapsed time', () => {
    const review = createIntervalFlashcardReviewSnapshot(reviewSet, cards)!

    expect(intervalFlashcardPhase(review, 0)).toMatchObject({
      cardIndex: 0,
      cycle: 0,
      side: 'front',
      progress: 0,
    })
    expect(intervalFlashcardPhase(review, 3000)).toMatchObject({
      cardIndex: 0,
      side: 'back',
      key: '0:back:0',
    })
    expect(intervalFlashcardPhase(review, 7000)).toMatchObject({
      cardIndex: 0,
      side: 'back',
      key: '0:back:1',
    })
    expect(intervalFlashcardPhase(review, 11000)).toMatchObject({
      cardIndex: 0,
      side: 'back',
      key: '0:back:2',
    })
    expect(intervalFlashcardPhase(review, 15000)).toMatchObject({ cardIndex: 1, side: 'front' })
    expect(intervalFlashcardPhase(review, 30000)).toMatchObject({
      cardIndex: 0,
      cycle: 1,
      side: 'front',
    })
  })

  it('skips hidden card faces in attached interval reviews', () => {
    const frontOnly = createIntervalFlashcardReviewSnapshot(
      { ...reviewSet, cardSides: 'front' },
      cards,
    )!
    const backOnly = createIntervalFlashcardReviewSnapshot(
      { ...reviewSet, cardSides: 'back' },
      cards,
    )!

    expect(intervalFlashcardPhase(frontOnly, 0)).toMatchObject({ side: 'front', cardIndex: 0 })
    expect(intervalFlashcardPhase(frontOnly, 3000)).toMatchObject({ side: 'front', cardIndex: 1 })
    expect(intervalFlashcardPhase(backOnly, 0)).toMatchObject({ side: 'back', cardIndex: 0 })
    expect(intervalFlashcardPhase(backOnly, 4000)).toMatchObject({
      side: 'back',
      cardIndex: 0,
      key: '0:back:1',
    })
    expect(intervalFlashcardPhase(backOnly, 12000)).toMatchObject({ side: 'back', cardIndex: 1 })
  })
})
