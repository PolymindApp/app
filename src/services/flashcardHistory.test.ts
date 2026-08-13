import { describe, expect, it } from 'vitest'
import { flashcardReviewHistoryItems, flashcardReviewProgressPercent } from '@/services/flashcardHistory'
import { groupSessionsByDate } from '@/services/sessionHistory'
import type { FlashcardReviewSession, IntervalSession } from '@/types/domain'

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

  it('includes measured Review set time from completed interval sessions', () => {
    const intervalSession: IntervalSession = {
      id: 'interval-1',
      source: 'template',
      status: 'completed',
      name: 'Focus interval',
      taskDate: '',
      definition: {
        version: 1,
        children: [
          { id: 'review', type: 'step', name: 'Review', kind: 'work', durationSeconds: 20 },
          {
            id: 'rest',
            type: 'step',
            name: 'Rest',
            kind: 'rest',
            durationSeconds: 40,
            flashcardReviewEnabled: false,
          },
        ],
      },
      cues: { soundEnabled: true, vibrationEnabled: true },
      flashcardReview: {
        reviewSet: 'spanish',
        name: 'Spanish vocabulary',
        tags: [],
        sortMode: 'random',
        cardSides: 'both',
        frontSeconds: 5,
        backSeconds: 5,
        backSpeechRepeatCount: 1,
        noteBeforeBack: false,
        speechEnabled: false,
        frontLanguage: '',
        backLanguage: '',
        cards: [],
      },
      startedAt: '2026-08-13T12:00:00.000Z',
      endedAt: '2026-08-13T12:01:00.000Z',
      plannedSeconds: 60,
      elapsedSeconds: 60,
      runtime: {
        stepIndex: 2,
        remainingMs: 0,
        accumulatedMs: 60_000,
        flashcardReviewAccumulatedMs: 12_000,
        updatedAt: '2026-08-13T12:01:00.000Z',
      },
      updated: '2026-08-13T12:01:00.000Z',
    }

    expect(flashcardReviewHistoryItems([], [intervalSession])).toEqual([{
      id: 'interval-interval-1',
      source: 'interval',
      status: 'completed',
      name: 'Spanish vocabulary',
      startedAt: '2026-08-13T12:00:00.000Z',
      sourceLabel: 'Interval',
      elapsedSeconds: 12,
      progressPercent: 100,
    }])
  })

  it('omits interval sessions where no Review set playback occurred', () => {
    const finishedInterval = {
      id: 'interval-1',
      status: 'ended',
      elapsedSeconds: 3,
      definition: { version: 1, children: [] },
      runtime: {
        stepIndex: 0,
        remainingMs: 0,
        accumulatedMs: 3_000,
        flashcardReviewAccumulatedMs: 0,
      },
      flashcardReview: { name: 'Spanish vocabulary' },
    } as unknown as IntervalSession

    expect(flashcardReviewHistoryItems([], [finishedInterval])).toEqual([])
  })
})
