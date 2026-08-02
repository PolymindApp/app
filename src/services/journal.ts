import type { JournalEntry } from '@/types/domain'

export type JournalContextFilter = 'all' | 'tasks' | 'tracking' | 'unlinked'

export function filterJournalEntries(
  entries: JournalEntry[],
  filter: JournalContextFilter,
  taskId = '',
  trackerId = '',
) {
  return entries.filter((entry) => {
    if (taskId && entry.task !== taskId) return false
    if (trackerId && entry.tracker !== trackerId) return false
    const hasTaskContext = Boolean(entry.task || entry.taskSnapshot)
    const hasTrackerContext = Boolean(entry.tracker || entry.trackerSnapshot)
    if (filter === 'tasks' && !hasTaskContext) return false
    if (filter === 'tracking' && !hasTrackerContext) return false
    if (filter === 'unlinked' && (hasTaskContext || hasTrackerContext)) return false
    return true
  })
}

export function groupJournalEntries(entries: JournalEntry[]) {
  const groups = new Map<string, JournalEntry[]>()
  const sorted = [...entries].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
  for (const entry of sorted) {
    const group = groups.get(entry.localDate) || []
    group.push(entry)
    groups.set(entry.localDate, group)
  }
  return [...groups].map(([date, items]) => ({ date, entries: items }))
}

export function journalEntryHeading(entry: Pick<JournalEntry, 'title' | 'body'>) {
  if (entry.title.trim()) return entry.title.trim()
  return entry.body.split(/\r?\n/).find((line) => line.trim())?.trim() || 'Untitled reflection'
}
