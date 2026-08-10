import { vi } from 'vitest'
import { syncBackgroundInterval } from '@/services/backgroundInterval'
import type { IntervalSession, IntervalStepNode } from '@/types/domain'

const nativeMocks = vi.hoisted(() => ({
  platform: vi.fn(() => 'android'),
  plugin: {
    start: vi.fn().mockResolvedValue(undefined),
    playCue: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: nativeMocks.platform },
  registerPlugin: () => nativeMocks.plugin,
}))

function session(): IntervalSession {
  const read: IntervalStepNode = {
    id: 'read',
    type: 'step',
    name: 'Read',
    kind: 'work',
    durationSeconds: 10,
  }
  const silent: IntervalStepNode = {
    id: 'silent',
    type: 'step',
    name: 'Silent',
    kind: 'rest',
    durationSeconds: 20,
    flashcardReviewEnabled: false,
  }
  return {
    id: 'session-1',
    taskDate: '2026-08-10',
    source: 'template',
    status: 'running',
    name: 'Study intervals',
    definition: { version: 1, children: [read, silent] },
    cues: { soundEnabled: true, vibrationEnabled: true },
    flashcardReview: {
      reviewSet: 'set-1',
      name: 'Vocabulary',
      tags: [],
      sortMode: 'difficult',
      cardSides: 'both',
      frontSeconds: 5,
      backSeconds: 5,
      backSpeechRepeatCount: 1,
      noteBeforeBack: false,
      speechEnabled: true,
      frontLanguage: 'en-US',
      backLanguage: 'fr-FR',
      cards: [{ id: 'card-1', front: 'House', back: 'Maison', note: '', image: '', tags: [] }],
    },
    startedAt: '2026-08-10T12:00:00.000Z',
    plannedSeconds: 30,
    elapsedSeconds: 20,
    runtime: {
      stepIndex: 1,
      remainingMs: 10_000,
      accumulatedMs: 20_000,
      updatedAt: '2026-08-10T12:00:20.000Z',
    },
    updated: '2026-08-10T12:00:20.000Z',
  }
}

describe('background interval Review set playback', () => {
  beforeEach(() => {
    nativeMocks.platform.mockReturnValue('android')
    nativeMocks.plugin.start.mockClear()
  })

  it('sends per-step playback settings and filtered Review set elapsed time', async () => {
    await syncBackgroundInterval(session())

    expect(nativeMocks.plugin.start).toHaveBeenCalledWith(expect.objectContaining({
      elapsedMs: 10_000,
      stepIndex: 1,
      remainingMs: 10_000,
      steps: [
        expect.objectContaining({ name: 'Read', flashcardReviewEnabled: true }),
        expect.objectContaining({ name: 'Silent', flashcardReviewEnabled: false }),
      ],
      flashcardReview: expect.objectContaining({ overAmplified: false }),
    }))
  })
})
