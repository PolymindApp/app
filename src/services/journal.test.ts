import { describe, expect, it } from 'vitest'
import { filterJournalEntries, groupJournalEntriesByContext, groupJournalEntriesByMonth, journalEntryColors, journalEntryHeading } from './journal'
import type { JournalEntry } from '@/types/domain'

function entry(id: string, date: string, context: Partial<JournalEntry> = {}): JournalEntry {
  return {
    id,
    title: '',
    body: `Reflection ${id}`,
    color: '#C7F464',
    image: '',
    occurredAt: `${date}T12:00:00.000Z`,
    localDate: date,
    timezoneOffset: 240,
    trackers: [],
    taskSnapshot: '',
    trackerSnapshots: {},
    createdAt: `${date}T12:00:00.000Z`,
    updatedAt: `${date}T12:00:00.000Z`,
    ...context,
  }
}

describe('journal timeline helpers', () => {
  const entries = [
    entry('task', '2026-08-01', { task: 'task-1' }),
    entry('tracker', '2026-08-02', { trackers: ['tracker-1', 'tracker-2'] }),
    entry('both', '2026-08-02', { task: 'task-1', trackers: ['tracker-1'], occurredAt: '2026-08-02T18:00:00.000Z' }),
    entry('detached-task', '2026-08-02', { taskSnapshot: 'Deleted task' }),
    entry('detached-tracker', '2026-08-03', { trackerSnapshots: { 'deleted-tracker': 'Deleted tracker' } }),
    entry('unlinked', '2026-08-03'),
  ]

  it('filters by context type and a specific source', () => {
    expect(filterJournalEntries(entries, 'tasks').map(item => item.id)).toEqual(['task', 'both', 'detached-task'])
    expect(filterJournalEntries(entries, 'unlinked').map(item => item.id)).toEqual(['unlinked'])
    expect(filterJournalEntries(entries, 'all', 'task-1').map(item => item.id)).toEqual(['task', 'both'])
    expect(filterJournalEntries(entries, 'all', '', 'tracker-2').map(item => item.id)).toEqual(['tracker'])
  })

  it('searches reflection content, tags, and dates while filtering colors case-insensitively', () => {
    const searchableEntries = [
      entry('title-match', '2026-08-01', { title: 'Morning planning', color: '#D4A5FF' }),
      entry('body-match', '2026-08-02', { body: 'A useful MORNING reset', color: '#c7f464' }),
      entry('context-match', '2026-08-03', { taskSnapshot: 'Morning routine', color: '#D4A5FF' }),
    ]

    expect(filterJournalEntries(searchableEntries, 'all', '', '', 'morning').map(item => item.id)).toEqual([
      'title-match',
      'body-match',
      'context-match',
    ])
    expect(filterJournalEntries(searchableEntries, 'all', '', '', 'morning', '#d4a5ff').map(item => item.id)).toEqual([
      'title-match',
      'context-match',
    ])
    expect(filterJournalEntries(searchableEntries, 'all', '', '', 'morning aug 3').map(item => item.id)).toEqual([
      'context-match',
    ])
    expect(filterJournalEntries(searchableEntries, 'all', '', '', '2026-08-02').map(item => item.id)).toEqual([
      'body-match',
    ])
    expect(filterJournalEntries(
      searchableEntries,
      'all',
      '',
      '',
      'energy',
      '',
      item => item.id === 'body-match' ? ['Energy'] : [],
    ).map(item => item.id)).toEqual(['body-match'])
  })

  it('lists each available reflection color once in timeline order', () => {
    expect(journalEntryColors([
      entry('first', '2026-08-03', { color: '#D4A5FF' }),
      entry('duplicate', '2026-08-02', { color: '#d4a5ff' }),
      entry('second', '2026-08-01', { color: '#C7F464' }),
    ])).toEqual(['#D4A5FF', '#C7F464'])
  })

  it('groups entries by month in reverse chronological order', () => {
    expect(groupJournalEntriesByMonth([
      ...entries,
      entry('july', '2026-07-31'),
      entry('june', '2026-06-15'),
    ]).map(group => ({
      month: group.month,
      entries: group.entries.map(item => item.id),
    }))).toEqual([
      { month: '2026-08', entries: ['detached-tracker', 'unlinked', 'both', 'tracker', 'detached-task', 'task'] },
      { month: '2026-07', entries: ['july'] },
      { month: '2026-06', entries: ['june'] },
    ])
  })

  it('groups reflections by context without duplicating connected entries', () => {
    expect(groupJournalEntriesByContext(entries).map(group => ({
      context: group.context,
      entries: group.entries.map(item => item.id),
    }))).toEqual([
      { context: 'tasks', entries: ['detached-task', 'task'] },
      { context: 'tracking', entries: ['detached-tracker', 'tracker'] },
      { context: 'connected', entries: ['both'] },
      { context: 'general', entries: ['unlinked'] },
    ])
  })

  it('uses the first body line when a title is omitted', () => {
    expect(journalEntryHeading({ title: '', body: '\n A useful first line\nMore' })).toBe('A useful first line')
  })
})
