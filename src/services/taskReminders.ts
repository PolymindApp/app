import { Capacitor, registerPlugin } from '@capacitor/core'
import {
  LocalNotifications,
  type LocalNotificationSchema,
  type PendingLocalNotificationSchema,
} from '@capacitor/local-notifications'
import { addDays, startOfDay } from 'date-fns'
import type { Router } from 'vue-router'
import { isTaskScheduled, toDateKey } from '@/services/schedule'
import type { Task } from '@/types/domain'

const CHANNEL_ID = 'task-reminders'
const TASK_EXTRA_KIND = 'polymind-task-reminder'
const LEGACY_TRACKING_EXTRA_KIND = 'polymind-tracking-reminder'
const TASK_REMINDER_LOOKAHEAD_DAYS = 30
const MAX_SCHEDULED_TASK_REMINDERS = 400

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

export interface TaskReminderReconcileOptions {
  now?: Date
  lookaheadDays?: number
  isTaskIncomplete?: (task: Task, date: Date) => boolean
}

const NativeTaskReminderSettings = registerPlugin<NativeTaskReminderSettingsPlugin>(
  'TaskReminderSettings',
)

const CHANNEL = {
  id: CHANNEL_ID,
  name: 'Task reminders',
  description: 'Reminders for incomplete scheduled tasks.',
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

export async function reconcileTaskReminders(
  tasks: Task[],
  options: TaskReminderReconcileOptions = {},
) {
  if (!taskRemindersAvailable()) return
  const now = options.now ?? new Date()
  const lookaheadDays = Math.max(1, options.lookaheadDays ?? TASK_REMINDER_LOOKAHEAD_DAYS)
  const enabledTasks = tasks.filter(task => task.active && task.reminderEnabled)
  const notifications: LocalNotificationSchema[] = enabledTasks
    .flatMap(task => {
      const times = [...new Set(task.reminderTimes)]
      return Array.from({ length: lookaheadDays }, (_, offset) => addDays(startOfDay(now), offset))
        .filter(date => (
          isTaskScheduled(task, date)
          && (options.isTaskIncomplete?.(task, date) ?? true)
        ))
        .flatMap(date => times.map(time => {
          const [hour = 20, minute = 0] = time.split(':').map(Number)
          const at = new Date(date)
          at.setHours(hour, minute, 0, 0)
          return { task, time, at }
        }))
    })
    .filter(({ at }) => at.getTime() > now.getTime())
    .sort((left, right) => (
      left.at.getTime() - right.at.getTime()
      || left.task.sortOrder - right.task.sortOrder
      || left.time.localeCompare(right.time)
    ))
    .slice(0, MAX_SCHEDULED_TASK_REMINDERS)
    .map(({ task, time, at }) => ({
      id: taskReminderNotificationId(task.id, time, toDateKey(at)),
      title: 'Task reminder',
      body: task.name,
      channelId: CHANNEL_ID,
      autoCancel: true,
      schedule: { at, allowWhileIdle: true },
      extra: {
        kind: TASK_EXTRA_KIND,
        taskId: task.id,
        scheduledDate: toDateKey(at),
        route: '/tasks',
      },
    }))

  const pending = await LocalNotifications.getPending()
  const replaceable = pending.notifications.filter(notification => (
    notification.extra?.kind === TASK_EXTRA_KIND
    || notification.extra?.kind === LEGACY_TRACKING_EXTRA_KIND
  ))
  const pendingById = new Map(replaceable.map(notification => [notification.id, notification]))
  const unchangedIds = new Set(notifications
    .filter(notification => taskReminderMatches(pendingById.get(notification.id), notification))
    .map(notification => notification.id))
  const stale = replaceable.filter(notification => !unchangedIds.has(notification.id))
  if (stale.length) {
    await LocalNotifications.cancel({ notifications: stale.map(({ id }) => ({ id })) })
  }

  const missing = notifications.filter(notification => !unchangedIds.has(notification.id))
  if (!missing.length) return

  const status = await LocalNotifications.checkPermissions()
  if (status.display !== 'granted') return

  await LocalNotifications.createChannel(CHANNEL)
  await LocalNotifications.schedule({ notifications: missing })
}

function taskReminderMatches(
  pending: PendingLocalNotificationSchema | undefined,
  desired: LocalNotificationSchema,
) {
  if (!pending) return false
  return pending.title === desired.title
    && pending.body === desired.body
    && pending.extra?.kind === desired.extra?.kind
    && pending.extra?.taskId === desired.extra?.taskId
    && pending.extra?.scheduledDate === desired.extra?.scheduledDate
    && pending.extra?.route === desired.extra?.route
    && scheduleTime(pending.schedule?.at) === scheduleTime(desired.schedule?.at)
}

function scheduleTime(value: unknown) {
  if (!(value instanceof Date) && typeof value !== 'string' && typeof value !== 'number') {
    return undefined
  }
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : undefined
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

export function taskReminderNotificationId(taskId: string, time: string, date = '') {
  const value = `${taskId}:${time}:${date}`
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
