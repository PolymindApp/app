import { groupSessionsByDate } from '@/services/sessionHistory'
import type { IntervalSession } from '@/types/domain'

export function intervalRunProgressPercent(session: IntervalSession) {
  if (session.status === 'completed') return 100
  if (!Number.isFinite(session.plannedSeconds) || session.plannedSeconds <= 0) return 0
  return Math.min(100, Math.max(0, Math.round(
    session.elapsedSeconds / session.plannedSeconds * 100,
  )))
}

export function groupIntervalSessionsByDate(sessions: IntervalSession[], today = new Date()) {
  return groupSessionsByDate(sessions, today)
}
