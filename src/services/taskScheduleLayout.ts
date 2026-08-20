import type { Task, TaskProgress } from '@/types/domain'

export interface TaskHourGroup {
  hour: string
  label: string
  tasks: TaskProgress[]
}

export interface TaskScheduleLayout {
  allDay: TaskProgress[]
  timed: TaskHourGroup[]
}

const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/

function progressOrder(left: TaskProgress, right: TaskProgress) {
  return left.task.sortOrder - right.task.sortOrder
    || (left.programStep?.sortOrder ?? 0) - (right.programStep?.sortOrder ?? 0)
}

export function taskScheduledTime(task: Task) {
  if (task.scheduleMode !== 'time_based' || !task.scheduledTime || !TIME_PATTERN.test(task.scheduledTime)) {
    return undefined
  }
  return task.scheduledTime
}

export function formatTaskScheduleTime(time: string, includeMinutes = true) {
  const [hour = 0, minute = 0] = time.split(':').map(Number)
  const period = hour >= 12 ? 'PM' : 'AM'
  const displayHour = hour % 12 || 12
  return includeMinutes
    ? `${displayHour}:${String(minute).padStart(2, '0')} ${period}`
    : `${displayHour} ${period}`
}

export function groupTaskProgressBySchedule(progressItems: TaskProgress[]): TaskScheduleLayout {
  const allDay: TaskProgress[] = []
  const timed = new Map<string, TaskProgress[]>()

  for (const progress of progressItems) {
    const time = taskScheduledTime(progress.task)
    if (!time) {
      allDay.push(progress)
      continue
    }
    const hour = time.slice(0, 2)
    timed.set(hour, [...(timed.get(hour) ?? []), progress])
  }

  allDay.sort(progressOrder)
  return {
    allDay,
    timed: [...timed.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([hour, tasks]) => ({
        hour,
        label: formatTaskScheduleTime(`${hour}:00`, false),
        tasks: tasks.sort((left, right) => (
          taskScheduledTime(left.task)!.localeCompare(taskScheduledTime(right.task)!)
          || progressOrder(left, right)
        )),
      })),
  }
}

export function tasksWithoutProgress(tasks: Task[], progressItems: TaskProgress[]) {
  const taskIdsWithProgress = new Set(progressItems.map(progress => progress.task.id))
  return tasks
    .filter(task => !task.archived && !taskIdsWithProgress.has(task.id))
    .sort((left, right) => left.sortOrder - right.sortOrder)
}
