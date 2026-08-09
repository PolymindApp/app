import { Capacitor, registerPlugin } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'
import type { Router } from 'vue-router'
import type { Task } from '@/types/domain'

const CHANNEL_ID = 'task-reminders'
const TASK_EXTRA_KIND = 'mom-task-reminder'
const LEGACY_TRACKING_EXTRA_KIND = 'mom-tracking-reminder'

interface NativeTaskReminderStatus {
  notificationsEnabled: boolean
  channelEnabled: boolean
  doNotDisturbActive: boolean
  bypassesDoNotDisturb: boolean
}

interface NativeTaskReminderSettingsPlugin {
  getStatus(): Promise<NativeTaskReminderStatus>
  openNotificationSettings(): Promise<void>
  openDoNotDisturbSettings(): Promise<void>
}

export type TaskReminderCapability = 'notifications' | 'exact_alarms' | 'do_not_disturb'

export interface TaskReminderCapabilityIssue {
  code: TaskReminderCapability
  message: string
  action: string
}

const NativeTaskReminderSettings = registerPlugin<NativeTaskReminderSettingsPlugin>(
  'TaskReminderSettings',
)

const CHANNEL = {
  id: CHANNEL_ID,
  name: 'Task reminders',
  description: 'Daily reminders for active tasks.',
  importance: 3 as const,
  visibility: 1 as const,
  vibration: true,
}

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

export async function checkTaskReminderCapabilities(): Promise<TaskReminderCapabilityIssue[]> {
  if (!taskRemindersAvailable()) return []
  await LocalNotifications.createChannel(CHANNEL)
  const [permission, enabled, exactAlarm, nativeStatus] = await Promise.all([
    LocalNotifications.checkPermissions(),
    LocalNotifications.areEnabled(),
    LocalNotifications.checkExactNotificationSetting(),
    NativeTaskReminderSettings.getStatus(),
  ])

  const issues: TaskReminderCapabilityIssue[] = []
  if (
    permission.display !== 'granted'
    || !enabled.value
    || !nativeStatus.notificationsEnabled
    || !nativeStatus.channelEnabled
  ) {
    issues.push({
      code: 'notifications',
      message: 'Android is blocking task notifications.',
      action: 'Allow notifications',
    })
  }
  if (exactAlarm.exact_alarm !== 'granted') {
    issues.push({
      code: 'exact_alarms',
      message: 'Precise reminders are off, so notifications may arrive late.',
      action: 'Allow precise reminders',
    })
  }
  if (nativeStatus.doNotDisturbActive && !nativeStatus.bypassesDoNotDisturb) {
    issues.push({
      code: 'do_not_disturb',
      message: 'Do Not Disturb is silencing task reminders. Allow Polymind under Apps.',
      action: 'Allow during Do Not Disturb',
    })
  }
  return issues
}

export async function openTaskReminderCapabilitySettings(capability: TaskReminderCapability) {
  if (!taskRemindersAvailable()) return
  if (capability === 'exact_alarms') {
    await LocalNotifications.changeExactNotificationSetting()
    return
  }
  if (capability === 'do_not_disturb') {
    await NativeTaskReminderSettings.openDoNotDisturbSettings()
    return
  }

  await LocalNotifications.createChannel(CHANNEL)
  const permissionGranted = await requestTaskReminderPermission()
  const enabled = await LocalNotifications.areEnabled()
  const nativeStatus = await NativeTaskReminderSettings.getStatus()
  if (
    !permissionGranted
    || !enabled.value
    || !nativeStatus.notificationsEnabled
    || !nativeStatus.channelEnabled
  ) {
    await NativeTaskReminderSettings.openNotificationSettings()
  }
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

  await LocalNotifications.createChannel(CHANNEL)
  await LocalNotifications.schedule({
    notifications: enabled.map(({ task, time }) => {
      const [hour = 20, minute = 0] = time.split(':').map(Number)
      return {
        id: taskReminderNotificationId(task.id, time),
        title: 'Task reminder',
        body: task.name,
        channelId: CHANNEL_ID,
        autoCancel: true,
        schedule: { on: { hour, minute }, repeats: true, allowWhileIdle: true },
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
