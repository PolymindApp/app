import { describe, expect, it } from 'vitest'
import { filterJournalEntries, groupJournalEntries, groupJournalEntriesByContext, journalEntryHeading } from './journal'
import type { JournalEntry } from '@/types/domain'

function entry(id: string, date: string, context: Partial<JournalEntry> = {}): JournalEntry {
  return {
    id,
    title: '',
    body: `Reflection ${id}`,
    occurredAt: `${date}T12:00:00.000Z`,
    localDate: date,
    timezoneOffset: 240,
    taskSnapshot: '',
    trackerSnapshot: '',
    createdAt: `${date}T12:00:00.000Z`,
    updatedAt: `${date}T12:00:00.000Z`,
    ...context,
  }
}

describe('journal timeline helpers', () => {
  const entries = [
    entry('task', '2026-08-01', { task: 'task-1' }),
    entry('tracker', '2026-08-02', { tracker: 'tracker-1' }),
    entry('both', '2026-08-02', { task: 'task-1', tracker: 'tracker-1', occurredAt: '2026-08-02T18:00:00.000Z' }),
    entry('detached-task', '2026-08-02', { taskSnapshot: 'Deleted task' }),
    entry('unlinked', '2026-08-03'),
  ]

  it('filters by context type and a specific source', () => {
    expect(filterJournalEntries(entries, 'tasks').map(item => item.id)).toEqual(['task', 'both', 'detached-task'])
    expect(filterJournalEntries(entries, 'unlinked').map(item => item.id)).toEqual(['unlinked'])
    expect(filterJournalEntries(entries, 'all', 'task-1').map(item => item.id)).toEqual(['task', 'both'])
  })

  it('groups entries by day in reverse chronological order', () => {
    expect(groupJournalEntries(entries).map(group => ({
      date: group.date,
      entries: group.entries.map(item => item.id),
    }))).toEqual([
      { date: '2026-08-03', entries: ['unlinked'] },
      { date: '2026-08-02', entries: ['both', 'tracker', 'detached-task'] },
      { date: '2026-08-01', entries: ['task'] },
    ])
  })

  it('groups reflections by context without duplicating connected entries', () => {
    expect(groupJournalEntriesByContext(entries).map(group => ({
      context: group.context,
      entries: group.entries.map(item => item.id),
    }))).toEqual([
      { context: 'tasks', entries: ['detached-task', 'task'] },
      { context: 'tracking', entries: ['tracker'] },
      { context: 'connected', entries: ['both'] },
      { context: 'general', entries: ['unlinked'] },
    ])
  })

  it('uses the first body line when a title is omitted', () => {
    expect(journalEntryHeading({ title: '', body: '\n A useful first line\nMore' })).toBe('A useful first line')
  })
})
