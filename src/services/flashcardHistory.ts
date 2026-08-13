import { completedIntervalFlashcardReviewSeconds } from '@/services/intervals'
import { sessionAccuracy } from '@/services/flashcards'
import { intervalRunProgressPercent } from '@/services/intervalHistory'
import type {
  FlashcardReviewHistoryItem,
  FlashcardReviewSession,
  IntervalSession,
} from '@/types/domain'

export function flashcardReviewProgressPercent(session: FlashcardReviewSession) {
  if (session.status === 'completed') return 100
  if (!Number.isFinite(session.totalCards) || session.totalCards <= 0) return 0
  const accomplishedCards = session.viewedCount + session.ejectedCount
  return Math.min(100, Math.max(0, Math.round(
    accomplishedCards / session.totalCards * 100,
  )))
}

export function flashcardReviewHistoryItems(
  reviewSessions: FlashcardReviewSession[],
  intervalSessions: IntervalSession[],
): FlashcardReviewHistoryItem[] {
  const directReviews = reviewSessions
    .filter((session): session is FlashcardReviewSession & { status: 'completed' | 'ended' } =>
      session.status === 'completed' || session.status === 'ended',
    )
    .map(session => ({
      id: `flashcards-${session.id}`,
      source: 'flashcards' as const,
      status: session.status,
      name: session.name,
      startedAt: session.startedAt,
      sourceLabel: session.mode === 'passive' ? 'Passive' as const : 'Manual' as const,
      elapsedSeconds: session.elapsedSeconds,
      progressPercent: flashcardReviewProgressPercent(session),
      viewedCount: session.viewedCount,
      successCount: session.successCount,
      errorCount: session.errorCount,
      ejectedCount: session.ejectedCount,
      accuracy: sessionAccuracy(session),
    }))

  const intervalReviews = intervalSessions.flatMap((session): FlashcardReviewHistoryItem[] => {
    if (
      (session.status !== 'completed' && session.status !== 'ended')
      || !session.flashcardReview
    ) return []

    const elapsedSeconds = completedIntervalFlashcardReviewSeconds(
      session.definition,
      session.runtime,
      session.elapsedSeconds,
    )
    if (elapsedSeconds <= 0) return []

    return [{
      id: `interval-${session.id}`,
      source: 'interval',
      status: session.status,
      name: session.flashcardReview.name,
      startedAt: session.startedAt,
      sourceLabel: 'Interval',
      elapsedSeconds,
      progressPercent: intervalRunProgressPercent(session),
    }]
  })

  return [...directReviews, ...intervalReviews]
}
