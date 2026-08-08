import { describe, expect, it } from 'vitest'
import {
  reviewSetInsightDailyValues,
  reviewSetInsightRangeBounds,
} from './reviewSetInsights'
import type { FlashcardReviewSession } from '@/types/domain'

type ReviewSessionInsightFields = Pick<
  FlashcardReviewSession,
  'reviewSet' | 'startedAt' | 'viewedCount'
>

const session = (
  reviewSet: string,
  startedAt: string,
  viewedCount: number,
): ReviewSessionInsightFields => ({ reviewSet, startedAt, viewedCount })

describe('Review set insight factors', () => {
  it('totals reviewed cards by local session date and fills days without reviews', () => {
    expect(reviewSetInsightDailyValues(
      'set-1',
      [
        session('set-1', '2026-07-01T09:00:00', 4),
        session('set-1', '2026-07-01T18:00:00', 3),
        session('set-1', '2026-07-03T12:00:00', 5),
        session('set-2', '2026-07-01T12:00:00', 20),
      ],
      '2026-07-01',
      '2026-07-03',
    )).toEqual([
      { date: '2026-07-01', value: 7 },
      { date: '2026-07-02', value: 0 },
      { date: '2026-07-03', value: 5 },
    ])
  })

  it('ignores invalid, out-of-range, and negative session values', () => {
    expect(reviewSetInsightDailyValues(
      'set-1',
      [
        session('set-1', 'invalid', 10),
        session('set-1', '2026-06-30T23:59:59', 8),
        session('set-1', '2026-07-01T12:00:00', -4),
        session('set-1', '2026-07-01T13:00:00', Number.NaN),
      ],
      '2026-07-01',
      '2026-07-01',
    )).toEqual([{ date: '2026-07-01', value: 0 }])
  })

  it('builds an exclusive UTC range from local date boundaries', () => {
    expect(reviewSetInsightRangeBounds('2026-07-01', '2026-07-03')).toEqual({
      startAt: new Date(2026, 6, 1).toISOString(),
      endAt: new Date(2026, 6, 4).toISOString(),
    })
  })
})
