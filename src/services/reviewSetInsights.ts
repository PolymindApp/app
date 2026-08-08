import { addDays, format, isValid, parseISO } from 'date-fns'
import { dateRangeKeys } from '@/services/tracking'
import type { FlashcardReviewSession, TrackingDailyValue } from '@/types/domain'

type ReviewSessionInsightFields = Pick<
  FlashcardReviewSession,
  'reviewSet' | 'startedAt' | 'viewedCount'
>

export function reviewSetInsightRangeBounds(start: string, end: string) {
  return {
    startAt: parseISO(start).toISOString(),
    endAt: addDays(parseISO(end), 1).toISOString(),
  }
}

export function reviewSetInsightDailyValues(
  reviewSetId: string,
  sessions: ReviewSessionInsightFields[],
  start: string,
  end: string,
): TrackingDailyValue[] {
  const totals = new Map<string, number>()

  sessions
    .filter((session) => session.reviewSet === reviewSetId)
    .forEach((session) => {
      const startedAt = parseISO(session.startedAt)
      if (!isValid(startedAt)) return
      const date = format(startedAt, 'yyyy-MM-dd')
      if (date < start || date > end) return
      const viewedCount = Number.isFinite(session.viewedCount)
        ? Math.max(0, session.viewedCount)
        : 0
      totals.set(date, (totals.get(date) || 0) + viewedCount)
    })

  return dateRangeKeys(start, end)
    .map((date) => ({ date, value: totals.get(date) || 0 }))
}
