import { format, isSameDay, subDays } from 'date-fns'

function sessionDateLabel(date: Date, today: Date) {
  if (isSameDay(date, today)) return 'Today'
  if (isSameDay(date, subDays(today, 1))) return 'Yesterday'
  return format(date, date.getFullYear() === today.getFullYear()
    ? 'EEEE, MMMM d'
    : 'EEEE, MMMM d, yyyy')
}

export function groupSessionsByDate<T extends { startedAt: string }>(sessions: T[], today = new Date()) {
  const groups = new Map<string, { key: string; label: string; sessions: T[] }>()
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
      label: sessionDateLabel(startedAt, today),
      sessions: [session],
    })
  })

  return [...groups.values()]
}
