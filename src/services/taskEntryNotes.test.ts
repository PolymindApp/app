import { describe, expect, it } from 'vitest'
import {
  sanitizeTaskEntryNote,
  taskEntryNoteForAmount,
  taskEntryNoteOptions,
} from './taskEntryNotes'
import type { Entry } from '@/types/domain'

function entry(
  id: string,
  task: string,
  value: number,
  note: string,
  createdAt: string,
): Entry {
  return {
    id,
    task,
    entryDate: createdAt.slice(0, 10),
    createdAt,
    value,
    kind: 'quantity',
    unit: '',
    note,
  }
}

describe('task entry note references', () => {
  const entries = [
    entry('older', 'task-1', 12, 'Trail run', '2026-08-01T10:00:00.000Z'),
    entry('other-task', 'task-2', 12, 'Not for this task', '2026-08-02T12:00:00.000Z'),
    entry('newer', 'task-1', 12, 'Track run', '2026-08-02T11:00:00.000Z'),
    entry('duplicate', 'task-1', 5, 'Trail run', '2026-08-02T09:00:00.000Z'),
  ]

  it('returns distinct notes for the task in most-recent order', () => {
    expect(taskEntryNoteOptions(entries, 'task-1')).toEqual(['Track run', 'Trail run'])
  })

  it('finds the newest note associated with the entered amount', () => {
    expect(taskEntryNoteForAmount(entries, 'task-1', 12)).toBe('Track run')
    expect(taskEntryNoteForAmount(entries, 'task-1', 5)).toBe('Trail run')
  })

  it('matches a previously subtracted amount entered without a sign', () => {
    const subtraction = entry('subtract', 'task-1', -3, 'Correction', '2026-08-02T13:00:00.000Z')
    expect(taskEntryNoteForAmount([subtraction], 'task-1', 3)).toBe('Correction')
  })

  it('removes line breaks and limits notes to 255 characters', () => {
    expect(sanitizeTaskEntryNote(`First\r\nSecond\n${'x'.repeat(300)}`)).toBe(
      `First Second ${'x'.repeat(242)}`,
    )
  })
})
