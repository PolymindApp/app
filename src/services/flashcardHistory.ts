import type { FlashcardReviewSession } from '@/types/domain'

export function flashcardReviewProgressPercent(session: FlashcardReviewSession) {
  if (session.status === 'completed') return 100
  if (!Number.isFinite(session.totalCards) || session.totalCards <= 0) return 0
  const accomplishedCards = session.viewedCount + session.ejectedCount
  return Math.min(100, Math.max(0, Math.round(
    accomplishedCards / session.totalCards * 100,
  )))
}
