import { describe, expect, it } from 'vitest'
import {
  aggregateTrackingEntries,
  buildTrackingInsight,
  compareDateRanges,
  comparePresentAbsent,
  defaultTrackingInsightRangePreset,
  linearTrend,
  formatTrackingValue,
  trackerDraftFromPreset,
  trackingDailyValuesForRange,
  TRACKING_PRESETS,
} from './tracking'
import type { TrackingEntry, TrackingTracker } from '@/types/domain'

const tracker: TrackingTracker = {
  id: 'mood', name: 'Mood', description: '', role: 'outcome', kind: 'rating',
  category: 'mood', unit: '/ 10', scaleMin: 1, scaleMax: 10,
  favorableDirection: 'higher', dailyAggregation: 'average', active: true,
  sortOrder: 0, color: '#fff', icon: '',
}

const entry = (date: string, value: number, suffix = value): TrackingEntry => ({
  id: `${date}-${suffix}`, tracker: 'mood', occurredAt: `${date}T12:00:00.000Z`,
  localDate: date, timezoneOffset: 240, value, note: '',
})

describe('tracking analysis', () => {
  it('chooses a compact default insight range from the amount of data', () => {
    expect(defaultTrackingInsightRangePreset(0)).toBe('7')
    expect(defaultTrackingInsightRangePreset(6)).toBe('7')
    expect(defaultTrackingInsightRangePreset(7)).toBe('14')
    expect(defaultTrackingInsightRangePreset(13)).toBe('14')
    expect(defaultTrackingInsightRangePreset(14)).toBe('1-month')
    expect(defaultTrackingInsightRangePreset(29)).toBe('1-month')
    expect(defaultTrackingInsightRangePreset(30)).toBe('3-months')
    expect(defaultTrackingInsightRangePreset(89)).toBe('3-months')
    expect(defaultTrackingInsightRangePreset(90)).toBe('6-months')
    expect(defaultTrackingInsightRangePreset(180)).toBe('6-months')
  })

  it('aggregates repeated daily ratings using the tracker rule', () => {
    const result = aggregateTrackingEntries(tracker, [
      entry('2026-07-01', 4, 1), entry('2026-07-01', 8, 2), entry('2026-07-02', 7),
    ])
    expect(result).toEqual([
      { date: '2026-07-01', value: 6 },
      { date: '2026-07-02', value: 7 },
    ])
  })

  it('counts event logs and treats missing range dates as not occurred', () => {
    const eventTracker: TrackingTracker = {
      ...tracker,
      id: 'migraine',
      name: 'Migraine',
      role: 'factor',
      kind: 'event',
      unit: 'times',
      scaleMin: 0,
      scaleMax: 0,
      favorableDirection: 'neutral',
      dailyAggregation: 'count',
    }
    const eventEntry = (date: string, value: number, suffix: number): TrackingEntry => ({
      ...entry(date, value, suffix),
      tracker: eventTracker.id,
    })

    expect(trackingDailyValuesForRange(eventTracker, [
      eventEntry('2026-07-01', 1, 1),
      eventEntry('2026-07-01', 1, 2),
      eventEntry('2026-07-02', 0, 3),
    ], '2026-07-01', '2026-07-03')).toEqual([
      { date: '2026-07-01', value: 2 },
      { date: '2026-07-02', value: 0 },
      { date: '2026-07-03', value: 0 },
    ])
    expect(formatTrackingValue(eventTracker, 0)).toBe('Not occurred')
  })

  it('requires five explicitly observed days in each present/absent cohort', () => {
    const outcome = Array.from({ length: 10 }, (_, index) => ({
      date: `2026-07-${String(index + 1).padStart(2, '0')}`,
      value: index < 5 ? 8 : 5,
    }))
    const factor = outcome.map((item, index) => ({ date: item.date, value: index < 5 ? 1 : 0 }))
    const result = comparePresentAbsent(factor, outcome, 'higher')
    expect(result.ready).toBe(true)
    expect(result.earlySignal).toBe(true)
    expect(result.first.count).toBe(5)
    expect(result.second.count).toBe(5)
    expect(result.direction).toBe('better')
    expect(result.caution).toContain('not proof')
  })

  it('does not invent absent days from missing data', () => {
    const outcome = Array.from({ length: 10 }, (_, index) => ({ date: `2026-07-${index + 1}`, value: 6 }))
    const result = comparePresentAbsent([{ date: '2026-07-1', value: 1 }], outcome, 'higher')
    expect(result.second.count).toBe(0)
    expect(result.ready).toBe(false)
  })

  it('compares two user-selected date ranges', () => {
    const outcome = Array.from({ length: 10 }, (_, index) => ({
      date: `2026-07-${String(index + 1).padStart(2, '0')}`,
      value: index < 5 ? 3 : 7,
    }))
    const result = compareDateRanges(
      outcome,
      { start: '2026-07-01', end: '2026-07-05' },
      { start: '2026-07-06', end: '2026-07-10' },
      'higher',
    )
    expect(result.ready).toBe(true)
    expect(result.first.mean).toBe(3)
    expect(result.second.mean).toBe(7)
  })

  it('aligns insight series without turning missing tracker logs into zeroes', () => {
    const result = buildTrackingInsight(
      [{ date: '2026-07-01', value: 1 }, { date: '2026-07-03', value: 0 }],
      [{ date: '2026-07-01', value: 8 }, { date: '2026-07-02', value: 6 }],
      { start: '2026-07-01', end: '2026-07-03' },
      'presence',
      'higher',
      { factor: 'Meditation', outcome: 'Mood' },
    )

    expect(result.points).toEqual([
      { date: '2026-07-01', factorValue: 1, outcomeValue: 8 },
      { date: '2026-07-02', factorValue: null, outcomeValue: 6 },
      { date: '2026-07-03', factorValue: 0, outcomeValue: null },
    ])
    expect(result.matched).toEqual([
      { date: '2026-07-01', factorValue: 1, outcomeValue: 8 },
    ])
  })

  it('explains implicit event absence without asking for negative logs', () => {
    const result = buildTrackingInsight(
      [
        { date: '2026-07-01', value: 1 },
        { date: '2026-07-02', value: 0 },
      ],
      [
        { date: '2026-07-01', value: 8 },
        { date: '2026-07-02', value: 6 },
      ],
      { start: '2026-07-01', end: '2026-07-02' },
      'presence',
      'higher',
      { factor: 'Migraine', outcome: 'Energy' },
      { missingMeansAbsent: true },
    )

    expect(result.summary).toContain('Days without an event log count as absent')
    expect(result.summary).not.toContain('when it does not')
  })

  it('uses actual factor amounts for quantitative trends', () => {
    const matched = Array.from({ length: 6 }, (_, index) => ({
      date: `2026-07-${String(index + 1).padStart(2, '0')}`,
      factorValue: index + 1,
      outcomeValue: (index + 1) * 2,
    }))
    const trend = linearTrend(matched)
    expect(trend.slope).toBe(2)
    expect(trend.intercept).toBe(0)
    expect(trend.correlation).toBeCloseTo(1)

    const result = buildTrackingInsight(
      matched.map(({ date, factorValue }) => ({ date, value: factorValue })),
      matched.map(({ date, outcomeValue }) => ({ date, value: outcomeValue })),
      { start: '2026-07-01', end: '2026-07-06' },
      'quantity',
      'higher',
      { factor: 'Exercise minutes', outcome: 'Energy' },
    )
    expect(result.ready).toBe(true)
    expect(result.direction).toBe('better')
    expect(result.summary).toContain('tended to be higher')
  })

  it('does not infer a quantitative trend when the factor does not vary', () => {
    const factor = Array.from({ length: 5 }, (_, index) => ({
      date: `2026-07-0${index + 1}`,
      value: 3,
    }))
    const outcome = factor.map((item, index) => ({ date: item.date, value: index + 1 }))
    const result = buildTrackingInsight(
      factor,
      outcome,
      { start: '2026-07-01', end: '2026-07-05' },
      'quantity',
      'higher',
      { factor: 'Medication dose', outcome: 'Pain' },
    )
    expect(result.ready).toBe(false)
    expect(result.summary).toContain('did not vary enough')
  })

  it('creates safe editable drafts from starter presets', () => {
    const preset = TRACKING_PRESETS.find((item) => item.id === 'medication')!
    const draft = trackerDraftFromPreset(preset, 4)
    expect(draft.kind).toBe('yes_no')
    expect(draft.sortOrder).toBe(4)
  })
})
