import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'
import type { Router } from 'vue-router'
import type { Task } from '@/types/domain'

const CHANNEL_ID = 'task-reminders'
const TASK_EXTRA_KIND = 'mom-task-reminder'
const LEGACY_TRACKING_EXTRA_KIND = 'mom-tracking-reminder'

export function taskRemindersAvailable() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
}

export async function requestTaskReminderPermission() {
  if (!taskRemindersAvailable()) return false
  let status = await LocalNotifications.checkPermissions()
  if (status.display === 'prompt' || status.display === 'prompt-with-rationale') {
    status = await LocalNotifications.requestPermissions()
  }
  return status.display === 'granted'
}

export async function reconcileTaskReminders(tasks: Task[]) {
  if (!taskRemindersAvailable()) return
  const pending = await LocalNotifications.getPending()
  const replaceable = pending.notifications.filter(notification => (
    notification.extra?.kind === TASK_EXTRA_KIND
    || notification.extra?.kind === LEGACY_TRACKING_EXTRA_KIND
  ))
  if (replaceable.length) {
    await LocalNotifications.cancel({ notifications: replaceable.map(({ id }) => ({ id })) })
  }

  const enabled = tasks.flatMap(task => (
    task.active && task.reminderEnabled
      ? [...new Set(task.reminderTimes)].map(time => ({ task, time }))
      : []
  ))
  if (!enabled.length) return

  const status = await LocalNotifications.checkPermissions()
  if (status.display !== 'granted') return

  await LocalNotifications.createChannel({
    id: CHANNEL_ID,
    name: 'Task reminders',
    description: 'Daily reminders for active tasks.',
    importance: 3,
    visibility: 1,
    vibration: true,
  })
  await LocalNotifications.schedule({
    notifications: enabled.map(({ task, time }) => {
      const [hour = 20, minute = 0] = time.split(':').map(Number)
      return {
        id: taskReminderNotificationId(task.id, time),
        title: 'Task reminder',
        body: task.name,
        channelId: CHANNEL_ID,
        autoCancel: true,
        schedule: { on: { hour, minute }, repeats: true },
        extra: {
          kind: TASK_EXTRA_KIND,
          taskId: task.id,
          route: '/tasks',
        },
      }
    }),
  })
}

export async function installTaskNotificationRouting(router: Router) {
  if (!taskRemindersAvailable()) return
  await clearLegacyTrackingReminders()
  await LocalNotifications.addListener('localNotificationActionPerformed', ({ notification }) => {
    if (notification.extra?.kind !== TASK_EXTRA_KIND) return
    const route = notification.extra?.route
    if (typeof route === 'string' && route.startsWith('/tasks')) {
      void router.push(route)
    }
  })
}

export function taskReminderNotificationId(taskId: string, time: string) {
  const value = `${taskId}:${time}`
  let hash = 5381
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash * 33) ^ value.charCodeAt(index)) >>> 0
  }
  return 1_000_000 + (hash % 2_000_000_000)
}

async function clearLegacyTrackingReminders() {
  const pending = await LocalNotifications.getPending()
  const legacy = pending.notifications.filter(notification => (
    notification.extra?.kind === LEGACY_TRACKING_EXTRA_KIND
  ))
  if (legacy.length) {
    await LocalNotifications.cancel({ notifications: legacy.map(({ id }) => ({ id })) })
  }
}
