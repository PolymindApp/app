import { eachDayOfInterval, format, parseISO } from 'date-fns'
import type {
  DailyAggregation,
  FavorableDirection,
  TrackerCategory,
  TrackerKind,
  TrackerRole,
  TrackingDailyValue,
  TrackingEntry,
  TrackingTracker,
  TrackingTrackerDraft,
} from '@/types/domain'

export interface TrackingPreset {
  id: string
  name: string
  description: string
  role: TrackerRole
  kind: TrackerKind
  category: TrackerCategory
  unit: string
  scaleMin: number
  scaleMax: number
  favorableDirection: FavorableDirection
  color: string
  icon: string
}

export interface TrackingCohortStats {
  label: string
  count: number
  mean: number
  median: number
}

export interface TrackingComparisonResult {
  ready: boolean
  earlySignal: boolean
  first: TrackingCohortStats
  second: TrackingCohortStats
  absoluteDifference: number
  direction: 'better' | 'worse' | 'mixed'
  summary: string
  caution: string
}

export const TRACKING_PRESETS: TrackingPreset[] = [
  { id: 'meditation', name: 'Meditation', description: 'Record each meditation session.', role: 'factor', kind: 'event', category: 'mindfulness', unit: 'sessions', scaleMin: 0, scaleMax: 0, favorableDirection: 'neutral', color: '#66D9C8', icon: 'mdi-meditation' },
  { id: 'medication', name: 'Medication taken', description: 'Record whether you took a medication. This is a log, not medical advice.', role: 'factor', kind: 'yes_no', category: 'medication', unit: '', scaleMin: 0, scaleMax: 1, favorableDirection: 'neutral', color: '#8FB8FF', icon: 'mdi-pill' },
  { id: 'reduced-sugar', name: 'Reduced sugar', description: 'Record whether you intentionally reduced added sugar.', role: 'factor', kind: 'yes_no', category: 'nutrition', unit: '', scaleMin: 0, scaleMax: 1, favorableDirection: 'neutral', color: '#FFB86B', icon: 'mdi-cube-outline' },
  { id: 'reduced-sodium', name: 'Reduced sodium', description: 'Record whether you intentionally reduced sodium.', role: 'factor', kind: 'yes_no', category: 'nutrition', unit: '', scaleMin: 0, scaleMax: 1, favorableDirection: 'neutral', color: '#F0D264', icon: 'mdi-shaker-outline' },
  { id: 'mood', name: 'Mood', description: 'Rate your overall mood.', role: 'outcome', kind: 'rating', category: 'mood', unit: '/ 10', scaleMin: 1, scaleMax: 10, favorableDirection: 'higher', color: '#D4A5FF', icon: 'mdi-emoticon-outline' },
  { id: 'anxiety', name: 'Anxiety', description: 'Rate how anxious you feel.', role: 'outcome', kind: 'rating', category: 'mood', unit: '/ 10', scaleMin: 1, scaleMax: 10, favorableDirection: 'lower', color: '#FF8FA3', icon: 'mdi-head-heart-outline' },
  { id: 'energy', name: 'Energy', description: 'Rate your energy level.', role: 'outcome', kind: 'rating', category: 'mood', unit: '/ 10', scaleMin: 1, scaleMax: 10, favorableDirection: 'higher', color: '#C7F464', icon: 'mdi-lightning-bolt-outline' },
  { id: 'sleep', name: 'Sleep quality', description: 'Rate the quality of your sleep.', role: 'outcome', kind: 'rating', category: 'sleep', unit: '/ 10', scaleMin: 1, scaleMax: 10, favorableDirection: 'higher', color: '#7E9CFF', icon: 'mdi-sleep' },
  { id: 'pain', name: 'Pain', description: 'Rate your pain level.', role: 'outcome', kind: 'rating', category: 'symptom', unit: '/ 10', scaleMin: 0, scaleMax: 10, favorableDirection: 'lower', color: '#FF7A7A', icon: 'mdi-bandage' },
]

export function defaultAggregation(kind: TrackerKind): DailyAggregation {
  if (kind === 'event') return 'count'
  if (kind === 'duration') return 'sum'
  if (kind === 'rating') return 'average'
  return 'last'
}

export function trackerDraftFromPreset(
  preset: TrackingPreset,
  sortOrder = 0,
): TrackingTrackerDraft {
  return {
    name: preset.name,
    description: preset.description,
    role: preset.role,
    kind: preset.kind,
    category: preset.category,
    unit: preset.unit,
    scaleMin: preset.scaleMin,
    scaleMax: preset.scaleMax,
    favorableDirection: preset.favorableDirection,
    dailyAggregation: defaultAggregation(preset.kind),
    active: true,
    sortOrder,
    color: preset.color,
    icon: preset.icon,
    reminderEnabled: false,
    reminderTime: '20:00',
    reminderShowName: false,
  }
}

export function aggregateTrackingEntries(
  tracker: TrackingTracker,
  entries: TrackingEntry[],
): TrackingDailyValue[] {
  const groups = new Map<string, TrackingEntry[]>()
  entries
    .filter((entry) => entry.tracker === tracker.id)
    .forEach((entry) => {
      const group = groups.get(entry.localDate) || []
      group.push(entry)
      groups.set(entry.localDate, group)
    })

  return [...groups.entries()]
    .map(([date, dayEntries]) => ({
      date,
      value: aggregateValues(
        [...dayEntries].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)),
        tracker.dailyAggregation,
      ),
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

function aggregateValues(entries: TrackingEntry[], aggregation: DailyAggregation) {
  const values = entries.map((entry) => entry.value)
  if (aggregation === 'count') return values.reduce((sum, value) => sum + (value > 0 ? 1 : 0), 0)
  if (aggregation === 'sum') return values.reduce((sum, value) => sum + value, 0)
  if (aggregation === 'average') return values.reduce((sum, value) => sum + value, 0) / values.length
  return values.at(-1) ?? 0
}

export function comparePresentAbsent(
  factor: TrackingDailyValue[],
  outcome: TrackingDailyValue[],
  favorableDirection: FavorableDirection,
): TrackingComparisonResult {
  const outcomeByDate = new Map(outcome.map((item) => [item.date, item.value]))
  const present: number[] = []
  const absent: number[] = []
  for (const observation of factor) {
    const outcomeValue = outcomeByDate.get(observation.date)
    if (outcomeValue === undefined) continue
    ;(observation.value > 0 ? present : absent).push(outcomeValue)
  }
  return buildComparison('Factor present', present, 'Factor absent', absent, favorableDirection)
}

export function compareDateRanges(
  outcome: TrackingDailyValue[],
  firstRange: { start: string; end: string },
  secondRange: { start: string; end: string },
  favorableDirection: FavorableDirection,
): TrackingComparisonResult {
  const inRange = (value: TrackingDailyValue, range: { start: string; end: string }) =>
    value.date >= range.start && value.date <= range.end
  return buildComparison(
    formatRange(firstRange),
    outcome.filter((item) => inRange(item, firstRange)).map((item) => item.value),
    formatRange(secondRange),
    outcome.filter((item) => inRange(item, secondRange)).map((item) => item.value),
    favorableDirection,
  )
}

export function dateRangeKeys(start: string, end: string): string[] {
  if (!start || !end || start > end) return []
  return eachDayOfInterval({ start: parseISO(start), end: parseISO(end) })
    .map((date) => format(date, 'yyyy-MM-dd'))
}

function formatRange(range: { start: string; end: string }) {
  return `${range.start} to ${range.end}`
}

function buildComparison(
  firstLabel: string,
  firstValues: number[],
  secondLabel: string,
  secondValues: number[],
  favorableDirection: FavorableDirection,
): TrackingComparisonResult {
  const first = stats(firstLabel, firstValues)
  const second = stats(secondLabel, secondValues)
  const ready = first.count >= 5 && second.count >= 5
  const earlySignal = ready && (first.count < 14 || second.count < 14)
  const difference = first.mean - second.mean
  const direction = favorableDirection === 'neutral' || Math.abs(difference) < 0.000001
    ? 'mixed'
    : favorableDirection === 'higher'
      ? difference > 0 ? 'better' : 'worse'
      : difference < 0 ? 'better' : 'worse'
  const summary = !ready
    ? 'More observations are needed before comparing these groups.'
    : `${first.label} averaged ${formatNumber(first.mean)}, ${formatNumber(Math.abs(difference))} ${direction === 'mixed' ? 'different from' : direction === 'better' ? 'more favorable than' : 'less favorable than'} ${second.label}.`
  return {
    ready,
    earlySignal,
    first,
    second,
    absoluteDifference: Math.abs(difference),
    direction,
    summary,
    caution: ready
      ? 'This is an association in your logs, not proof that the factor caused the outcome.'
      : 'Each group needs at least 5 outcome observations. Missing logs are not treated as “no”.',
  }
}

function stats(label: string, values: number[]): TrackingCohortStats {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  const median = sorted.length === 0
    ? 0
    : sorted.length % 2
      ? sorted[middle] ?? 0
      : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
  return {
    label,
    count: values.length,
    mean: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0,
    median,
  }
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value)
}

export function formatTrackingValue(tracker: TrackingTracker, value: number) {
  if (tracker.kind === 'yes_no') return value > 0 ? 'Yes' : 'No'
  if (tracker.kind === 'event') return value === 0 ? 'None' : `${formatNumber(value)} ${value === 1 ? 'time' : 'times'}`
  if (tracker.kind === 'duration') {
    const hours = Math.floor(value / 3600)
    const minutes = Math.round((value % 3600) / 60)
    return hours ? `${hours}h ${minutes}m` : `${minutes}m`
  }
  return `${formatNumber(value)}${tracker.unit ? ` ${tracker.unit}` : ''}`
}
