import { format, isSameDay, subDays } from 'date-fns'
import type { IntervalSession } from '@/types/domain'

export function intervalRunProgressPercent(session: IntervalSession) {
  if (session.status === 'completed') return 100
  if (!Number.isFinite(session.plannedSeconds) || session.plannedSeconds <= 0) return 0
  return Math.min(100, Math.max(0, Math.round(
    session.elapsedSeconds / session.plannedSeconds * 100,
  )))
}

function intervalRunDateLabel(date: Date, today: Date) {
  if (isSameDay(date, today)) return 'Today'
  if (isSameDay(date, subDays(today, 1))) return 'Yesterday'
  return format(date, date.getFullYear() === today.getFullYear()
    ? 'EEEE, MMMM d'
    : 'EEEE, MMMM d, yyyy')
}

export function groupIntervalSessionsByDate(sessions: IntervalSession[], today = new Date()) {
  const groups = new Map<string, { key: string; label: string; sessions: IntervalSession[] }>()
  const orderedSessions = [...sessions].sort(
    (left, right) => new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime(),
  )

  orderedSessions.forEach((session) => {
    const startedAt = new Date(session.startedAt)
    const key = format(startedAt, 'yyyy-MM-dd')
    const group = groups.get(key)
    if (group) {
      group.sessions.push(session)
      return
    }
    groups.set(key, {
      key,
      label: intervalRunDateLabel(startedAt, today),
      sessions: [session],
    })
  })

  return [...groups.values()]
}
