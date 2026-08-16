import { describe, expect, it } from 'vitest'
import { formatTaskScheduleTime, groupTaskProgressBySchedule, tasksWithoutProgress } from './taskScheduleLayout'
import type { Task, TaskProgress } from '@/types/domain'

function task(id: string, sortOrder: number, scheduledTime?: string): Task {
  return {
    id,
    name: id,
    description: '',
    type: 'check',
    mandatory: false,
    reviewWhenMissed: false,
    active: true,
    scheduleMode: scheduledTime ? 'time_based' : 'all_day',
    scheduledTime,
    startDate: '2026-08-16',
    recurrenceType: 'daily',
    weekdays: [],
    intervalWeeks: 1,
    entryNotesEnabled: false,
    entryNoteSuggestionsEnabled: false,
    sortOrder,
    reminderEnabled: false,
    reminderTimes: [],
  }
}

function progress(task: Task, stepOrder = 0): TaskProgress {
  return {
    task,
    scheduledDate: '2026-08-16',
    value: 0,
    percent: 0,
    complete: false,
    status: 'pending',
    ...(stepOrder ? { programStep: { sortOrder: stepOrder } as TaskProgress['programStep'] } : {}),
  }
}

describe('task schedule layout', () => {
  it('keeps all-day work first and groups timed work by hour rather than minute', () => {
    const layout = groupTaskProgressBySchedule([
      progress(task('late', 4, '20:45')),
      progress(task('all-day-second', 2)),
      progress(task('early-later-minute', 3, '08:50')),
      progress(task('all-day-first', 1)),
      progress(task('early-first-minute', 5, '08:05')),
    ])

    expect(layout.allDay.map(item => item.task.id)).toEqual(['all-day-first', 'all-day-second'])
    expect(layout.timed.map(group => ({
      hour: group.hour,
      label: group.label,
      tasks: group.tasks.map(item => item.task.id),
    }))).toEqual([
      { hour: '08', label: '8 AM', tasks: ['early-first-minute', 'early-later-minute'] },
      { hour: '20', label: '8 PM', tasks: ['late'] },
    ])
  })

  it('treats missing or invalid timed values as all day for legacy local records', () => {
    const invalid = { ...task('invalid', 0), scheduleMode: 'time_based' as const, scheduledTime: '25:00' }
    expect(groupTaskProgressBySchedule([progress(invalid)]).allDay).toHaveLength(1)
  })

  it('formats full scheduled times and returns only tasks without progress', () => {
    const first = task('first', 2)
    const second = task('second', 1)
    expect(formatTaskScheduleTime('00:05')).toBe('12:05 AM')
    expect(formatTaskScheduleTime('13:30')).toBe('1:30 PM')
    expect(tasksWithoutProgress([first, second], [progress(first)]).map(item => item.id)).toEqual(['second'])
  })
})
