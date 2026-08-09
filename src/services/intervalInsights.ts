import { dateRangeKeys } from '@/services/tracking'
import type { IntervalSession, TrackingDailyValue } from '@/types/domain'

type IntervalInsightSession = Pick<
  IntervalSession,
  'template' | 'taskDate' | 'status' | 'elapsedSeconds'
>

export const INTERVAL_INSIGHT_PROFILE = {
  factorMode: 'quantity',
  unit: 'minutes',
  scaleMin: 0,
} as const

export function intervalInsightDailyValues(
  templateId: string,
  sessions: IntervalInsightSession[],
  start: string,
  end: string,
): TrackingDailyValue[] {
  const elapsedSecondsByDate = new Map<string, number>()

  sessions
    .filter((session) =>
      session.template === templateId
      && ['completed', 'ended'].includes(session.status)
      && session.taskDate >= start
      && session.taskDate <= end,
    )
    .forEach((session) => {
      const elapsedSeconds = Number.isFinite(session.elapsedSeconds)
        ? Math.max(0, session.elapsedSeconds)
        : 0
      elapsedSecondsByDate.set(
        session.taskDate,
        (elapsedSecondsByDate.get(session.taskDate) || 0) + elapsedSeconds,
      )
    })

  return dateRangeKeys(start, end).map((date) => ({
    date,
    value: (elapsedSecondsByDate.get(date) || 0) / 60,
  }))
}
