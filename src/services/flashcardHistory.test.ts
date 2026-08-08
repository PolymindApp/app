import { describe, expect, it } from 'vitest'
import { flashcardReviewProgressPercent } from '@/services/flashcardHistory'
import { groupSessionsByDate } from '@/services/sessionHistory'
import type { FlashcardReviewSession } from '@/types/domain'

function session(overrides: Partial<FlashcardReviewSession> = {}): FlashcardReviewSession {
  return {
    id: 'review',
    status: 'ended',
    name: 'French vocabulary',
    mode: 'manual',
    cardSides: 'both',
    indefinite: false,
    maxCards: 20,
    sortMode: 'difficult',
    tags: [],
    frontSeconds: 5,
    backSeconds: 5,
    backSpeechRepeatCount: 1,
    noteBeforeBack: false,
    speechEnabled: false,
    frontLanguage: '',
    backLanguage: '',
    queue: [],
    startedAt: '2026-08-01T12:00:00.000Z',
    updatedAt: '2026-08-01T12:05:00.000Z',
    elapsedSeconds: 300,
    totalCards: 10,
    viewedCount: 4,
    successCount: 3,
    errorCount: 1,
    ejectedCount: 1,
    ...overrides,
  }
}

describe('flashcard review history', () => {
  it('calculates progress from viewed and ejected cards', () => {
    expect(flashcardReviewProgressPercent(session())).toBe(50)
    expect(flashcardReviewProgressPercent(session({ status: 'completed', viewedCount: 4 }))).toBe(100)
    expect(flashcardReviewProgressPercent(session({ totalCards: 0 }))).toBe(0)
    expect(flashcardReviewProgressPercent(session({ viewedCount: 20 }))).toBe(100)
  })

  it('uses the same newest-first date grouping as interval runs', () => {
    const groups = groupSessionsByDate([
      session({ id: 'yesterday', startedAt: '2026-08-01T14:00:00-04:00' }),
      session({ id: 'today-later', startedAt: '2026-08-02T15:00:00-04:00' }),
      session({ id: 'today-earlier', startedAt: '2026-08-02T09:00:00-04:00' }),
    ], new Date('2026-08-02T18:00:00-04:00'))

    expect(groups.map(group => group.label)).toEqual(['Today', 'Yesterday'])
    expect(groups[0]?.sessions.map(item => item.id)).toEqual(['today-later', 'today-earlier'])
  })
})
