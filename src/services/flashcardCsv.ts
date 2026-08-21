import type {
  Flashcard,
  FlashcardCsvParseResult,
  FlashcardImportRow,
  FlashcardTag,
} from '@/types/domain'

export const MAX_FLASHCARD_IMPORT_ROWS = 500

interface CsvRecord {
  fields: string[]
  line: number
}

type CsvDelimiter = ',' | '\t' | ';' | '\u001F' | '，'

const CSV_DELIMITERS: CsvDelimiter[] = [',', '\t', ';', '\u001F', '，']

function formatCsvField(value: string) {
  return /[",\r\n]/.test(value)
    ? `"${value.replace(/"/g, '""')}"`
    : value
}

export function formatFlashcardsCsv(cards: readonly Flashcard[], tags: readonly FlashcardTag[]) {
  const tagNameById = new Map(tags.map(tag => [tag.id, tag.name]))
  cards.forEach(card => card.tagDetails?.forEach(tag => tagNameById.set(tag.id, tag.name)))
  const rows = cards.map(card => [
    card.front,
    card.back,
    card.transliteration || '',
    card.note,
    card.tags.flatMap(tag => tagNameById.get(tag) || []).join('|'),
  ].map(formatCsvField).join(','))
  return ['front,back,transliteration,note,tags', ...rows].join('\n')
}

function normalizeClipboardText(value: string) {
  return value
    .replace(/\r\n|[\n\v\f\r\u001C-\u001E\u0085\u2028\u2029]/g, '\n')
    .replace(/^\uFEFF/, '')
}

function normalizeHeader(value: string) {
  return value
    .replace(/[\u061C\u200B-\u200F\u2060\uFEFF]/g, '')
    .trim()
    .toLocaleLowerCase()
}

function removeCodeFence(value: string) {
  const lines = value.trim().split('\n')
  if (/^```(?:csv)?\s*$/i.test(lines[0] || '')) lines.shift()
  if (/^```\s*$/.test(lines.at(-1) || '')) lines.pop()
  return lines.join('\n')
}

function parseRecords(value: string, delimiter: CsvDelimiter): { records: CsvRecord[]; error?: string } {
  const records: CsvRecord[] = []
  let fields: string[] = []
  let field = ''
  let line = 1
  let recordLine = 1
  let quoted = false
  let closedQuote = false

  function finishField() {
    fields.push(field)
    field = ''
    closedQuote = false
  }

  function finishRecord() {
    finishField()
    if (fields.some(item => item.trim() !== '')) records.push({ fields, line: recordLine })
    fields = []
    recordLine = line + 1
  }

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (quoted) {
      if (character === '"') {
        if (value[index + 1] === '"') {
          field += '"'
          index += 1
        } else {
          quoted = false
          closedQuote = true
        }
      } else {
        field += character
        if (character === '\n') line += 1
      }
      continue
    }

    if (character === '"') {
      if (field !== '') return { records, error: `Line ${line}: a quote must start at the beginning of a value.` }
      quoted = true
      continue
    }
    if (character === delimiter) {
      finishField()
      continue
    }
    if (character === '\r' || character === '\n') {
      if (character === '\r' && value[index + 1] === '\n') index += 1
      finishRecord()
      line += 1
      continue
    }
    if (closedQuote && !/\s/.test(character)) {
      return { records, error: `Line ${line}: unexpected text follows a quoted value.` }
    }
    if (!closedQuote) field += character
  }

  if (quoted) return { records, error: `Line ${recordLine}: a quoted value is not closed.` }
  finishRecord()
  return { records }
}

function recordHeaders(record: CsvRecord) {
  return record.fields.map(normalizeHeader)
}

function findHeaderIndex(records: CsvRecord[]) {
  return records.findIndex((record) => {
    const headers = recordHeaders(record)
    return headers.includes('front') && headers.includes('back')
  })
}

function parseClipboardRecords(source: string) {
  for (const delimiter of CSV_DELIMITERS) {
    const parsed = parseRecords(source, delimiter)
    if (parsed.error) continue
    const headerIndex = findHeaderIndex(parsed.records)
    if (headerIndex >= 0) return { ...parsed, headerIndex }
  }
  return { ...parseRecords(source, ','), headerIndex: 0 }
}

function distinctTags(value: string) {
  const names: string[] = []
  const keys = new Set<string>()
  for (const part of value.split(/[|;]/)) {
    const name = part.trim()
    const key = name.toLocaleLowerCase()
    if (!name || keys.has(key)) continue
    keys.add(key)
    names.push(name)
  }
  return names
}

export function parseFlashcardCsv(input: string): FlashcardCsvParseResult {
  if (!input.trim()) return { rows: [], errors: [] }
  const source = removeCodeFence(normalizeClipboardText(input))
  const parsed = parseClipboardRecords(source)
  if (parsed.error) return { rows: [], errors: [parsed.error] }
  if (!parsed.records.length) return { rows: [], errors: ['Add a CSV header and at least one card.'] }

  const headers = recordHeaders(parsed.records[parsed.headerIndex])
  const allowedHeaders = new Set(['front', 'back', 'transliteration', 'note', 'tags'])
  const unknownHeaders = headers.filter(header => header && !allowedHeaders.has(header))
  const duplicateHeaders = headers.filter((header, index) => header && headers.indexOf(header) !== index)
  const errors: string[] = []
  if (unknownHeaders.length) errors.push(`Unknown header${unknownHeaders.length > 1 ? 's' : ''}: ${unknownHeaders.join(', ')}.`)
  if (duplicateHeaders.length) errors.push(`Duplicate header${duplicateHeaders.length > 1 ? 's' : ''}: ${[...new Set(duplicateHeaders)].join(', ')}.`)

  const frontIndex = headers.indexOf('front')
  const backIndex = headers.indexOf('back')
  const transliterationIndex = headers.indexOf('transliteration')
  const noteIndex = headers.indexOf('note')
  const tagsIndex = headers.indexOf('tags')
  if (frontIndex < 0) errors.push('The front header is required.')
  if (backIndex < 0) errors.push('The back header is required.')
  if (errors.length) return { rows: [], errors }

  const rows: FlashcardImportRow[] = []
  for (const record of parsed.records.slice(parsed.headerIndex + 1)) {
    if (record.fields.length > headers.length) {
      errors.push(`Line ${record.line}: found more values than headers. Quote values that contain the column separator.`)
      continue
    }
    const front = (record.fields[frontIndex] || '').trim()
    const back = (record.fields[backIndex] || '').trim()
    const transliteration = transliterationIndex >= 0
      ? (record.fields[transliterationIndex] || '').trim()
      : ''
    const note = noteIndex >= 0 ? (record.fields[noteIndex] || '').trim() : ''
    const tags = tagsIndex >= 0 ? distinctTags(record.fields[tagsIndex] || '') : []
    if (!front || !back) {
      errors.push(`Line ${record.line}: front and back are required.`)
      continue
    }
    if (front.length > 5000 || back.length > 5000) {
      errors.push(`Line ${record.line}: front and back must each be 5,000 characters or fewer.`)
      continue
    }
    if (transliteration.length > 5000) {
      errors.push(`Line ${record.line}: transliteration must be 5,000 characters or fewer.`)
      continue
    }
    if (note.length > 2000) {
      errors.push(`Line ${record.line}: note must be 2,000 characters or fewer.`)
      continue
    }
    if (tags.some(tag => tag.length > 50)) {
      errors.push(`Line ${record.line}: tag names must be 50 characters or fewer.`)
      continue
    }
    rows.push({
      front,
      back,
      ...(transliteration ? { transliteration } : {}),
      note,
      tags,
    })
  }

  if (rows.length > MAX_FLASHCARD_IMPORT_ROWS) {
    errors.push(`Import up to ${MAX_FLASHCARD_IMPORT_ROWS} cards at a time.`)
  }
  if (!rows.length && !errors.length) errors.push('Add at least one card below the header.')
  return { rows, errors }
}
