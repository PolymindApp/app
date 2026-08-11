import type { Entry } from '@/types/domain'

export const TASK_ENTRY_NOTE_MAX_LENGTH = 255

export function sanitizeTaskEntryNote(value: unknown) {
  return String(value ?? '')
    .replace(/\r\n?|\n/g, ' ')
    .slice(0, TASK_ENTRY_NOTE_MAX_LENGTH)
}

function newestEntries(entries: Entry[]) {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => {
      const timestampOrder = (right.entry.createdAt || `${right.entry.entryDate}T00:00:00Z`)
        .localeCompare(left.entry.createdAt || `${left.entry.entryDate}T00:00:00Z`)
      return timestampOrder || left.index - right.index
    })
    .map(({ entry }) => entry)
}

export function taskEntryNoteOptions(entries: Entry[], taskId: string) {
  const notes = new Set<string>()
  for (const entry of newestEntries(entries)) {
    if (entry.task !== taskId) continue
    const note = sanitizeTaskEntryNote(entry.note).trim()
    if (note) notes.add(note)
  }
  return [...notes]
}
