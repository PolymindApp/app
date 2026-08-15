import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Task } from '@/types/domain'

const mocks = vi.hoisted(() => ({
  addListener: vi.fn(),
  areEnabled: vi.fn(),
  cancel: vi.fn(),
  changeExactNotificationSetting: vi.fn(),
  checkExactNotificationSetting: vi.fn(),
  checkPermissions: vi.fn(),
  createChannel: vi.fn(),
  getPending: vi.fn(),
  getReminderStatus: vi.fn(),
  isNativePlatform: vi.fn(),
  getPlatform: vi.fn(),
  openDoNotDisturbSettings: vi.fn(),
  openNotificationSettings: vi.fn(),
  requestPermissions: vi.fn(),
  schedule: vi.fn(),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: mocks.isNativePlatform,
    getPlatform: mocks.getPlatform,
  },
  registerPlugin: () => ({
    getStatus: mocks.getReminderStatus,
    openDoNotDisturbSettings: mocks.openDoNotDisturbSettings,
    openNotificationSettings: mocks.openNotificationSettings,
  }),
}))

vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    addListener: mocks.addListener,
    areEnabled: mocks.areEnabled,
    cancel: mocks.cancel,
    changeExactNotificationSetting: mocks.changeExactNotificationSetting,
    checkExactNotificationSetting: mocks.checkExactNotificationSetting,
    checkPermissions: mocks.checkPermissions,
    createChannel: mocks.createChannel,
    getPending: mocks.getPending,
    requestPermissions: mocks.requestPermissions,
    schedule: mocks.schedule,
  },
}))

import {
  checkTaskReminderCapabilities,
  installTaskNotificationRouting,
  openTaskReminderCapabilitySettings,
  reconcileTaskReminders,
  requestTaskReminderPermission,
  taskReminderNotificationId,
} from './taskReminders'

const task = (overrides: Partial<Task> = {}): Task => ({
  id: 'task-1',
  name: 'Evening review',
  description: '',
  type: 'check',
  mandatory: true,
  reviewWhenMissed: false,
  active: true,
  startDate: '2026-08-09',
  recurrenceType: 'daily',
  weekdays: [],
  intervalWeeks: 1,
  entryNotesEnabled: false,
  entryNoteSuggestionsEnabled: false,
  reminderEnabled: true,
  reminderTimes: ['09:15', '20:30'],
  sortOrder: 0,
  ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.isNativePlatform.mockReturnValue(true)
  mocks.getPlatform.mockReturnValue('android')
  mocks.checkPermissions.mockResolvedValue({ display: 'granted' })
  mocks.areEnabled.mockResolvedValue({ value: true })
  mocks.checkExactNotificationSetting.mockResolvedValue({ exact_alarm: 'granted' })
  mocks.requestPermissions.mockResolvedValue({ display: 'granted' })
  mocks.getReminderStatus.mockResolvedValue({
    notificationsEnabled: true,
    channelEnabled: true,
    doNotDisturbActive: false,
    bypassesDoNotDisturb: false,
  })
  mocks.getPending.mockResolvedValue({
    notifications: [
      { id: 1, extra: { kind: 'backontrack-tracking-reminder' } },
      { id: 2, extra: { kind: 'backontrack-task-reminder' } },
      { id: 3, extra: { kind: 'another-feature' } },
    ],
  })
  mocks.addListener.mockResolvedValue({ remove: vi.fn() })
})

describe('task reminders', () => {
  it('replaces repeating reminders with dated notifications for every active task time', async () => {
    const now = new Date(2026, 7, 10, 8)
    await reconcileTaskReminders([
      task(),
      task({ id: 'paused', active: false }),
      task({ id: 'disabled', reminderEnabled: false }),
    ], { now, lookaheadDays: 1 })

    expect(mocks.cancel).toHaveBeenCalledWith({ notifications: [{ id: 1 }, { id: 2 }] })
    expect(mocks.createChannel).toHaveBeenCalledWith(expect.objectContaining({ id: 'task-reminders' }))
    const notifications = mocks.schedule.mock.calls[0]?.[0].notifications
    expect(notifications).toHaveLength(2)
    expect(notifications).toEqual(expect.arrayContaining([
      expect.objectContaining({
        body: 'Evening review',
        schedule: { at: new Date(2026, 7, 10, 9, 15), allowWhileIdle: true },
        extra: expect.objectContaining({ scheduledDate: '2026-08-10' }),
      }),
      expect.objectContaining({
        schedule: { at: new Date(2026, 7, 10, 20, 30), allowWhileIdle: true },
      }),
    ]))
    expect(new Set(notifications.map((notification: { id: number }) => notification.id)).size).toBe(2)
  })

  it('does not leave a notification programmed for a completed task occurrence', async () => {
    const now = new Date(2026, 7, 10, 8)

    await reconcileTaskReminders([task()], {
      now,
      lookaheadDays: 2,
      isTaskIncomplete: (_task, date) => date.getDate() !== 10,
    })

    const notifications = mocks.schedule.mock.calls[0]?.[0].notifications
    expect(notifications).toHaveLength(2)
    expect(notifications.every((notification: any) => (
      notification.extra.scheduledDate === '2026-08-11'
    ))).toBe(true)
  })

  it('keeps matching reminders and cancels only alarms that became stale', async () => {
    const now = new Date(2026, 7, 10, 8)
    const pendingReminder = (date: Date, time: string, scheduledDate: string) => ({
      id: taskReminderNotificationId(task().id, time, scheduledDate),
      title: 'Task reminder',
      body: task().name,
      schedule: { at: date.toISOString() },
      extra: {
        kind: 'backontrack-task-reminder',
        taskId: task().id,
        scheduledDate,
        route: '/tasks',
      },
    })
    const todayMorning = pendingReminder(new Date(2026, 7, 10, 9, 15), '09:15', '2026-08-10')
    const todayEvening = pendingReminder(new Date(2026, 7, 10, 20, 30), '20:30', '2026-08-10')
    const tomorrowMorning = pendingReminder(new Date(2026, 7, 11, 9, 15), '09:15', '2026-08-11')
    const tomorrowEvening = pendingReminder(new Date(2026, 7, 11, 20, 30), '20:30', '2026-08-11')
    mocks.getPending.mockResolvedValue({
      notifications: [todayMorning, todayEvening, tomorrowMorning, tomorrowEvening],
    })

    await reconcileTaskReminders([task()], {
      now,
      lookaheadDays: 2,
      isTaskIncomplete: (_task, date) => date.getDate() !== 10,
    })

    expect(mocks.cancel).toHaveBeenCalledWith({
      notifications: [{ id: todayMorning.id }, { id: todayEvening.id }],
    })
    expect(mocks.schedule).not.toHaveBeenCalled()
  })

  it('does no native writes when every task reminder is already current', async () => {
    const now = new Date(2026, 7, 10, 8)
    mocks.getPending.mockResolvedValue({
      notifications: ['09:15', '20:30'].map(time => {
        const [hour, minute] = time.split(':').map(Number)
        const at = new Date(2026, 7, 10, hour, minute)
        return {
          id: taskReminderNotificationId(task().id, time, '2026-08-10'),
          title: 'Task reminder',
          body: task().name,
          schedule: { at },
          extra: {
            kind: 'backontrack-task-reminder',
            taskId: task().id,
            scheduledDate: '2026-08-10',
            route: '/tasks',
          },
        }
      }),
    })

    await reconcileTaskReminders([task()], { now, lookaheadDays: 1 })

    expect(mocks.cancel).not.toHaveBeenCalled()
    expect(mocks.schedule).not.toHaveBeenCalled()
  })

  it('cancels stale notifications without scheduling while permission is denied', async () => {
    mocks.checkPermissions.mockResolvedValue({ display: 'denied' })

    await reconcileTaskReminders([task()])

    expect(mocks.cancel).toHaveBeenCalled()
    expect(mocks.schedule).not.toHaveBeenCalled()
  })

  it('requests prompted permission and returns the final decision', async () => {
    mocks.checkPermissions.mockResolvedValue({ display: 'prompt' })

    await expect(requestTaskReminderPermission()).resolves.toBe(true)
    expect(mocks.requestPermissions).toHaveBeenCalled()
  })

  it('reports blocked notifications, imprecise alarms, and Do Not Disturb', async () => {
    mocks.areEnabled.mockResolvedValue({ value: false })
    mocks.checkExactNotificationSetting.mockResolvedValue({ exact_alarm: 'denied' })
    mocks.getReminderStatus.mockResolvedValue({
      notificationsEnabled: false,
      channelEnabled: false,
      doNotDisturbActive: true,
      bypassesDoNotDisturb: false,
    })

    await expect(checkTaskReminderCapabilities()).resolves.toEqual([
      expect.objectContaining({ code: 'notifications' }),
      expect.objectContaining({ code: 'exact_alarms' }),
      expect.objectContaining({ code: 'do_not_disturb' }),
    ])
    expect(mocks.createChannel).toHaveBeenCalledWith(expect.objectContaining({ id: 'task-reminders' }))
  })

  it('opens the Android setting that matches each missing capability', async () => {
    mocks.checkPermissions.mockResolvedValue({ display: 'denied' })

    await openTaskReminderCapabilitySettings('notifications')
    await openTaskReminderCapabilitySettings('exact_alarms')
    await openTaskReminderCapabilitySettings('do_not_disturb')

    expect(mocks.openNotificationSettings).toHaveBeenCalledOnce()
    expect(mocks.changeExactNotificationSetting).toHaveBeenCalledOnce()
    expect(mocks.openDoNotDisturbSettings).toHaveBeenCalledOnce()
  })

  it('opens notification settings when only the reminder channel is blocked', async () => {
    mocks.getReminderStatus.mockResolvedValue({
      notificationsEnabled: true,
      channelEnabled: false,
      doNotDisturbActive: false,
      bypassesDoNotDisturb: false,
    })

    await openTaskReminderCapabilitySettings('notifications')

    expect(mocks.openNotificationSettings).toHaveBeenCalledOnce()
  })

  it('opens tasks from a task notification and ignores other notification kinds', async () => {
    const push = vi.fn()
    let listener: ((event: any) => void) | undefined
    mocks.addListener.mockImplementation(async (_event, callback) => {
      listener = callback
      return { remove: vi.fn() }
    })

    await installTaskNotificationRouting({ push } as never)
    listener?.({ notification: { extra: { kind: 'backontrack-task-reminder', route: '/tasks' } } })
    listener?.({ notification: { extra: { kind: 'another-feature', route: '/tasks' } } })

    expect(push).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledWith('/tasks')
  })

  it('creates stable IDs per task and time', () => {
    expect(taskReminderNotificationId('task-1', '09:15', '2026-08-10')).toBe(
      taskReminderNotificationId('task-1', '09:15', '2026-08-10'),
    )
    expect(taskReminderNotificationId('task-1', '09:15', '2026-08-10')).not.toBe(
      taskReminderNotificationId('task-1', '09:15', '2026-08-11'),
    )
  })
})
