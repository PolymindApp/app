import type { Flashcard, FlashcardReviewSession, FlashcardReviewSort } from '@/types/domain'

export const FLASHCARD_REVIEW_SORT_OPTIONS: Array<{
  title: string
  value: FlashcardReviewSort
  subtitle: string
}> = [
  { title: 'Most difficult', value: 'difficult', subtitle: 'Cards with the highest error rate first' },
  { title: 'Never reviewed first', value: 'never_reviewed', subtitle: 'Start with cards you have not seen yet' },
  { title: 'Least recently reviewed', value: 'least_recent', subtitle: 'Return to the cards waiting longest' },
  { title: 'Recently added', value: 'recently_added', subtitle: 'Newest cards first' },
  { title: 'Random', value: 'random', subtitle: 'Shuffle once when the review starts' },
]

export function flashcardDifficulty(card: Pick<Flashcard, 'successCount' | 'errorCount'>) {
  const attempts = card.successCount + card.errorCount
  return attempts ? card.errorCount / attempts : undefined
}

export function flashcardAccuracy(card: Pick<Flashcard, 'successCount' | 'errorCount'>) {
  const attempts = card.successCount + card.errorCount
  return attempts ? Math.round(card.successCount / attempts * 100) : undefined
}

export function sessionAccuracy(
  session: Pick<FlashcardReviewSession, 'successCount' | 'errorCount'>,
) {
  const attempts = session.successCount + session.errorCount
  return attempts ? Math.round(session.successCount / attempts * 100) : undefined
}

export function cardMatchesTags(card: Pick<Flashcard, 'tags'>, selectedTags: string[]) {
  return !selectedTags.length || card.tags.some(tag => selectedTags.includes(tag))
}

export function formatReviewDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.round(totalSeconds))
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  if (!minutes) return `${remainder}s`
  if (!remainder) return `${minutes}m`
  return `${minutes}m ${remainder}s`
}

export function reviewSortTitle(value: FlashcardReviewSort) {
  return FLASHCARD_REVIEW_SORT_OPTIONS.find(option => option.value === value)?.title || value
}
