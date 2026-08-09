import { describe, expect, it } from 'vitest'
import { INTERVAL_INSIGHT_PROFILE, intervalInsightDailyValues } from './intervalInsights'
import type { IntervalSession } from '@/types/domain'

type IntervalInsightSession = Pick<
  IntervalSession,
  'template' | 'taskDate' | 'status' | 'elapsedSeconds'
>

const session = (
  template: string,
  taskDate: string,
  status: IntervalSession['status'],
  elapsedSeconds: number,
): IntervalInsightSession => ({ template, taskDate, status, elapsedSeconds })

describe('Interval insight factors', () => {
  it('totals finished session time in minutes per day and fills days without sessions', () => {
    expect(intervalInsightDailyValues(
      'interval-1',
      [
        session('interval-1', '2026-07-01', 'completed', 600),
        session('interval-1', '2026-07-01', 'ended', 150),
        session('interval-1', '2026-07-01', 'paused', 300),
        session('interval-1', '2026-07-03', 'completed', 30),
        session('interval-2', '2026-07-01', 'completed', 1200),
      ],
      '2026-07-01',
      '2026-07-03',
    )).toEqual([
      { date: '2026-07-01', value: 12.5 },
      { date: '2026-07-02', value: 0 },
      { date: '2026-07-03', value: 0.5 },
    ])
  })

  it('ignores out-of-range time and treats invalid elapsed values as zero', () => {
    expect(intervalInsightDailyValues(
      'interval-1',
      [
        session('interval-1', '2026-06-30', 'completed', 600),
        session('interval-1', '2026-07-01', 'completed', -60),
        session('interval-1', '2026-07-01', 'ended', Number.NaN),
      ],
      '2026-07-01',
      '2026-07-01',
    )).toEqual([{ date: '2026-07-01', value: 0 }])
  })

  it('uses a quantitative minutes profile', () => {
    expect(INTERVAL_INSIGHT_PROFILE).toEqual({
      factorMode: 'quantity',
      unit: 'minutes',
      scaleMin: 0,
    })
  })
})
