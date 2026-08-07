import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'
import type { Router } from 'vue-router'
import type { TrackingTracker } from '@/types/domain'

const CHANNEL_ID = 'tracking-reminders'
const EXTRA_KIND = 'mom-tracking-reminder'

export function trackingRemindersAvailable() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
}

export async function requestTrackingReminderPermission() {
  if (!trackingRemindersAvailable()) return false
  let status = await LocalNotifications.checkPermissions()
  if (status.display === 'prompt' || status.display === 'prompt-with-rationale') {
    status = await LocalNotifications.requestPermissions()
  }
  return status.display === 'granted'
}

export async function reconcileTrackingReminders(
  trackers: TrackingTracker[],
  requestPermission = false,
) {
  if (!trackingRemindersAvailable()) return
  const enabled = trackers.filter((tracker) => tracker.active && tracker.reminderEnabled)
  let status = await LocalNotifications.checkPermissions()
  if (enabled.length && requestPermission && status.display !== 'granted') {
    status = await LocalNotifications.requestPermissions()
  }
  if (enabled.length && status.display !== 'granted') {
    throw new Error('Allow notifications in Android settings to use tracking reminders.')
  }

  await LocalNotifications.createChannel({
    id: CHANNEL_ID,
    name: 'Tracking reminders',
    description: 'Daily reminders to log personal trackers.',
    importance: 3,
    visibility: 0,
    vibration: true,
  })

  const pending = await LocalNotifications.getPending()
  const ours = pending.notifications.filter((notification) => notification.extra?.kind === EXTRA_KIND)
  if (ours.length) {
    await LocalNotifications.cancel({ notifications: ours.map(({ id }) => ({ id })) })
  }
  if (!enabled.length) return

  await LocalNotifications.schedule({
    notifications: enabled.map((tracker) => {
      const [hour = 20, minute = 0] = tracker.reminderTime.split(':').map(Number)
      return {
        id: notificationId(tracker.id),
        title: 'Polymind check-in',
        body: tracker.reminderShowName
          ? `Time to log ${tracker.name}.`
          : 'Time to check in with your tracking.',
        channelId: CHANNEL_ID,
        autoCancel: true,
        schedule: { on: { hour, minute }, repeats: true },
        extra: {
          kind: EXTRA_KIND,
          trackerId: tracker.id,
          route: `/tracking?log=${encodeURIComponent(tracker.id)}`,
        },
      }
    }),
  })
}

export async function installTrackingNotificationRouting(router: Router) {
  if (!trackingRemindersAvailable()) return
  await LocalNotifications.addListener('localNotificationActionPerformed', ({ notification }) => {
    const route = notification.extra?.route
    if (typeof route === 'string' && route.startsWith('/tracking')) {
      void router.push(route)
    }
  })
}

function notificationId(id: string) {
  let hash = 5381
  for (let index = 0; index < id.length; index += 1) {
    hash = ((hash * 33) ^ id.charCodeAt(index)) >>> 0
  }
  return 1_000_000 + (hash % 1_000_000_000)
}
