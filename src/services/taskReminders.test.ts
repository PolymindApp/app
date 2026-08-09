import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Task } from '@/types/domain'

const mocks = vi.hoisted(() => ({
  addListener: vi.fn(),
  cancel: vi.fn(),
  checkPermissions: vi.fn(),
  createChannel: vi.fn(),
  getPending: vi.fn(),
  isNativePlatform: vi.fn(),
  getPlatform: vi.fn(),
  requestPermissions: vi.fn(),
  schedule: vi.fn(),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: mocks.isNativePlatform,
    getPlatform: mocks.getPlatform,
  },
}))

vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    addListener: mocks.addListener,
    cancel: mocks.cancel,
    checkPermissions: mocks.checkPermissions,
    createChannel: mocks.createChannel,
    getPending: mocks.getPending,
    requestPermissions: mocks.requestPermissions,
    schedule: mocks.schedule,
  },
}))

import {
  installTaskNotificationRouting,
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
  mocks.requestPermissions.mockResolvedValue({ display: 'granted' })
  mocks.getPending.mockResolvedValue({
    notifications: [
      { id: 1, extra: { kind: 'mom-tracking-reminder' } },
      { id: 2, extra: { kind: 'mom-task-reminder' } },
      { id: 3, extra: { kind: 'another-feature' } },
    ],
  })
  mocks.addListener.mockResolvedValue({ remove: vi.fn() })
})

describe('task reminders', () => {
  it('replaces task and legacy tracker notifications with every active task time', async () => {
    await reconcileTaskReminders([
      task(),
      task({ id: 'paused', active: false }),
      task({ id: 'disabled', reminderEnabled: false }),
    ])

    expect(mocks.cancel).toHaveBeenCalledWith({ notifications: [{ id: 1 }, { id: 2 }] })
    expect(mocks.createChannel).toHaveBeenCalledWith(expect.objectContaining({ id: 'task-reminders' }))
    const notifications = mocks.schedule.mock.calls[0]?.[0].notifications
    expect(notifications).toHaveLength(2)
    expect(notifications).toEqual(expect.arrayContaining([
      expect.objectContaining({
        body: 'Evening review',
        schedule: { on: { hour: 9, minute: 15 }, repeats: true },
      }),
      expect.objectContaining({
        schedule: { on: { hour: 20, minute: 30 }, repeats: true },
      }),
    ]))
    expect(new Set(notifications.map((notification: { id: number }) => notification.id)).size).toBe(2)
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

  it('opens tasks from a task notification and ignores other notification kinds', async () => {
    const push = vi.fn()
    let listener: ((event: any) => void) | undefined
    mocks.addListener.mockImplementation(async (_event, callback) => {
      listener = callback
      return { remove: vi.fn() }
    })

    await installTaskNotificationRouting({ push } as never)
    listener?.({ notification: { extra: { kind: 'mom-task-reminder', route: '/tasks' } } })
    listener?.({ notification: { extra: { kind: 'another-feature', route: '/tasks' } } })

    expect(push).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledWith('/tasks')
  })

  it('creates stable IDs per task and time', () => {
    expect(taskReminderNotificationId('task-1', '09:15')).toBe(taskReminderNotificationId('task-1', '09:15'))
    expect(taskReminderNotificationId('task-1', '09:15')).not.toBe(taskReminderNotificationId('task-1', '20:30'))
  })
})
