import { describe, expect, it } from 'vitest'
import { groupIntervalSessionsByDate, intervalRunProgressPercent } from '@/services/intervalHistory'
import type { IntervalSession } from '@/types/domain'

function session(overrides: Partial<IntervalSession>): IntervalSession {
  return {
    id: 'session',
    source: 'template',
    status: 'ended',
    name: 'Morning intervals',
    definition: { version: 1, children: [] },
    cues: { soundEnabled: true, vibrationEnabled: true },
    startedAt: '2026-08-01T12:00:00.000Z',
    plannedSeconds: 600,
    elapsedSeconds: 300,
    runtime: {
      stepIndex: 0,
      remainingMs: 0,
      accumulatedMs: 300000,
      updatedAt: '2026-08-01T12:05:00.000Z',
    },
    ...overrides,
  }
}

describe('interval run history', () => {
  it('uses completion status or elapsed duration to calculate accomplishment', () => {
    expect(intervalRunProgressPercent(session({ status: 'completed', elapsedSeconds: 420 }))).toBe(100)
    expect(intervalRunProgressPercent(session({ elapsedSeconds: 300 }))).toBe(50)
    expect(intervalRunProgressPercent(session({ elapsedSeconds: 900 }))).toBe(100)
    expect(intervalRunProgressPercent(session({ plannedSeconds: 0 }))).toBe(0)
  })

  it('groups newest runs by local start date with readable labels', () => {
    const groups = groupIntervalSessionsByDate([
      session({ id: 'yesterday', startedAt: '2026-08-01T14:00:00-04:00' }),
      session({ id: 'today-later', startedAt: '2026-08-02T15:00:00-04:00' }),
      session({ id: 'today-earlier', startedAt: '2026-08-02T09:00:00-04:00' }),
    ], new Date('2026-08-02T18:00:00-04:00'))

    expect(groups.map((group) => group.label)).toEqual(['Today', 'Yesterday'])
    expect(groups[0]?.sessions.map((item) => item.id)).toEqual(['today-later', 'today-earlier'])
    expect(groups[1]?.sessions.map((item) => item.id)).toEqual(['yesterday'])
  })
})
