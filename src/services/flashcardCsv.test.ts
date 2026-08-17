import { formatFlashcardsCsv, parseFlashcardCsv } from '@/services/flashcardCsv'

describe('flashcard CSV parsing', () => {
  it('formats cards as importer-compatible CSV with tag names and escaped fields', () => {
    const csv = formatFlashcardsCsv([{
      id: 'card-1',
      front: 'What is "grain, raising"?',
      back: 'Wet the wood\nbefore sanding.',
      note: '',
      image: '',
      imageSource: 'none',
      tags: ['tag-1', 'tag-2'],
      tagDetails: [{ id: 'tag-2', name: 'Finishing' }],
      createdAt: '2026-08-17T12:00:00.000Z',
      updatedAt: '2026-08-17T12:00:00.000Z',
      passiveViews: 0,
      successCount: 0,
      errorCount: 0,
    }], [{ id: 'tag-1', name: 'Woodworking' }])

    expect(parseFlashcardCsv(csv)).toEqual({
      rows: [{
        front: 'What is "grain, raising"?',
        back: 'Wet the wood\nbefore sanding.',
        note: '',
        tags: ['Woodworking', 'Finishing'],
      }],
      errors: [],
    })
  })

  it('parses required columns and optional pipe-separated tags', () => {
    const result = parseFlashcardCsv([
      'front,back,tags',
      'chisel,formón,woodworking|tools',
      'grain,veta,woodworking|materials',
    ].join('\n'))

    expect(result.errors).toEqual([])
    expect(result.rows).toEqual([
      { front: 'chisel', back: 'formón', note: '', tags: ['woodworking', 'tools'] },
      { front: 'grain', back: 'veta', note: '', tags: ['woodworking', 'materials'] },
    ])
  })

  it('accepts quoted commas, escaped quotes, and AI code fences', () => {
    const result = parseFlashcardCsv([
      '```csv',
      'front,back',
      '"plane, hand tool","cepillo ""manual"""',
      '```',
    ].join('\n'))

    expect(result.errors).toEqual([])
    expect(result.rows[0]).toEqual({
      front: 'plane, hand tool',
      back: 'cepillo "manual"',
      note: '',
      tags: [],
    })
  })

  it.each([
    ['carriage returns', '\r'],
    ['next-line characters', '\u0085'],
    ['Unicode line separators', '\u2028'],
    ['Unicode paragraph separators', '\u2029'],
  ])('accepts Android clipboard text using %s', (_label, lineBreak) => {
    const result = parseFlashcardCsv([
      'front,back,tags',
      'chisel,formón,woodworking|tools',
      'grain,veta,woodworking|materials',
    ].join(lineBreak))

    expect(result.errors).toEqual([])
    expect(result.rows).toHaveLength(2)
    expect(result.rows[0]).toEqual({
      front: 'chisel',
      back: 'formón',
      note: '',
      tags: ['woodworking', 'tools'],
    })
  })

  it('removes invisible Android clipboard marks from headers', () => {
    const result = parseFlashcardCsv('\u200Bfront,back,\u200Etags\nchisel,formón,tools')

    expect(result.errors).toEqual([])
    expect(result.rows).toEqual([
      { front: 'chisel', back: 'formón', note: '', tags: ['tools'] },
    ])
  })

  it('accepts Unicode line separators around an AI code fence', () => {
    const result = parseFlashcardCsv('```csv\u2028front,back,tags\u2028chisel,formón,tools\u2028```')

    expect(result.errors).toEqual([])
    expect(result.rows).toHaveLength(1)
  })

  it.each([
    ['tabs', '\t'],
    ['semicolons', ';'],
    ['unit separators', '\u001F'],
    ['full-width commas', '，'],
  ])('detects Android clipboard tables separated with %s', (_label, delimiter) => {
    const result = parseFlashcardCsv([
      ['front', 'back', 'tags'].join(delimiter),
      ['chisel', 'formón', 'woodworking|tools'].join(delimiter),
    ].join('\n'))

    expect(result.errors).toEqual([])
    expect(result.rows).toEqual([
      { front: 'chisel', back: 'formón', note: '', tags: ['woodworking', 'tools'] },
    ])
  })

  it('parses an optional note column', () => {
    const result = parseFlashcardCsv([
      'front,back,note,tags',
      'chisel,formón,Hand tool for carving wood,tools',
      'grain,veta,,materials',
    ].join('\n'))

    expect(result.errors).toEqual([])
    expect(result.rows).toEqual([
      { front: 'chisel', back: 'formón', note: 'Hand tool for carving wood', tags: ['tools'] },
      { front: 'grain', back: 'veta', note: '', tags: ['materials'] },
    ])
  })

  it('finds the CSV header after an Android clipboard label or AI preamble', () => {
    const result = parseFlashcardCsv([
      'CSV',
      'Here is the requested table:',
      'front\tback\ttags',
      'chisel\tformón\twoodworking|tools',
    ].join('\n'))

    expect(result.errors).toEqual([])
    expect(result.rows).toHaveLength(1)
  })

  it('accepts an opening code fence when Android omits the closing fence', () => {
    const result = parseFlashcardCsv('```csv\nfront,back,tags\nchisel,formón,tools')

    expect(result.errors).toEqual([])
    expect(result.rows).toHaveLength(1)
  })

  it('reports malformed rows and missing required headers', () => {
    expect(parseFlashcardCsv('term,tags\nchisel,tools').errors).toContain('The front header is required.')
    expect(parseFlashcardCsv('front,back\nchisel').errors).toContain('Line 2: front and back are required.')
    expect(parseFlashcardCsv('front,back\nchisel,formón,tools').errors[0]).toContain('more values than headers')
  })
})
