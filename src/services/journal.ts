import { format, parseISO } from 'date-fns'
import type { JournalEntry } from '@/types/domain'

export type JournalContextFilter = 'all' | 'tasks' | 'tracking' | 'unlinked'
export type JournalContextGroup = 'tasks' | 'tracking' | 'connected' | 'general'

export function filterJournalEntries(
  entries: JournalEntry[],
  filter: JournalContextFilter,
  taskId = '',
  trackerId = '',
  search = '',
  color = '',
  searchTags: (entry: JournalEntry) => string[] = () => [],
) {
  const normalizedSearch = search.trim().toLocaleLowerCase()
  const normalizedColor = color.trim().toLocaleLowerCase()

  return entries.filter((entry) => {
    if (taskId && entry.task !== taskId) return false
    if (trackerId && !entry.trackers.includes(trackerId)) return false
    if (normalizedColor && entry.color.trim().toLocaleLowerCase() !== normalizedColor) return false
    if (normalizedSearch) {
      const searchableText = [
        entry.title,
        entry.body,
        entry.taskSnapshot,
        ...Object.values(entry.trackerSnapshots),
        ...searchTags(entry),
        ...journalEntryDateSearchTerms(entry.localDate),
      ].join('\n').toLocaleLowerCase()
      const searchTerms = normalizedSearch.split(/\s+/)
      if (!searchTerms.every(term => searchableText.includes(term))) return false
    }
    const hasTaskContext = Boolean(entry.task || entry.taskSnapshot)
    const hasTrackerContext = Boolean(entry.trackers.length || Object.keys(entry.trackerSnapshots).length)
    if (filter === 'tasks' && !hasTaskContext) return false
    if (filter === 'tracking' && !hasTrackerContext) return false
    if (filter === 'unlinked' && (hasTaskContext || hasTrackerContext)) return false
    return true
  })
}

function journalEntryDateSearchTerms(localDate: string) {
  const date = parseISO(localDate)
  return [
    localDate,
    format(date, 'yyyy-MM'),
    format(date, 'MMMM yyyy'),
    format(date, 'MMM d'),
    format(date, 'MMMM d, yyyy'),
    format(date, 'EEEE'),
    format(date, 'M/d/yyyy'),
  ]
}

export function journalEntryColors(entries: JournalEntry[]) {
  const colors = new Map<string, string>()
  for (const entry of entries) {
    const color = entry.color.trim()
    if (color && !colors.has(color.toLocaleLowerCase())) colors.set(color.toLocaleLowerCase(), color)
  }
  return [...colors.values()]
}

export function groupJournalEntriesByMonth(entries: JournalEntry[]) {
  const groups = new Map<string, JournalEntry[]>()
  const sorted = [...entries].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
  for (const entry of sorted) {
    const month = entry.localDate.slice(0, 7)
    const group = groups.get(month) || []
    group.push(entry)
    groups.set(month, group)
  }
  return [...groups].map(([month, items]) => ({ month, entries: items }))
}

export function groupJournalEntriesByContext(entries: JournalEntry[]) {
  const groups = new Map<JournalContextGroup, JournalEntry[]>([
    ['tasks', []],
    ['tracking', []],
    ['connected', []],
    ['general', []],
  ])
  const sorted = [...entries].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))

  for (const entry of sorted) {
    const hasTaskContext = Boolean(entry.task || entry.taskSnapshot)
    const hasTrackerContext = Boolean(entry.trackers.length || Object.keys(entry.trackerSnapshots).length)
    const context: JournalContextGroup = hasTaskContext && hasTrackerContext
      ? 'connected'
      : hasTaskContext
        ? 'tasks'
        : hasTrackerContext
          ? 'tracking'
          : 'general'
    groups.get(context)?.push(entry)
  }

  return [...groups]
    .filter(([, items]) => items.length)
    .map(([context, items]) => ({ context, entries: items }))
}

export function journalEntryHeading(entry: Pick<JournalEntry, 'title' | 'body'>) {
  if (entry.title.trim()) return entry.title.trim()
  return entry.body.split(/\r?\n/).find((line) => line.trim())?.trim() || 'Untitled reflection'
}
