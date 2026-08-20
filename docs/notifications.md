# Task notifications

Daily reminders can be configured from Android and supported desktop browsers. Android schedules dated local notifications with Capacitor. Desktop uses standards-based Web Push so reminders can arrive while BackOnTrack is closed.

On authenticated desktop startup, BackOnTrack loads the complete task list and checks for an active task with daily reminders enabled. If one exists, the app requests browser notification permission when needed and synchronizes that browser's Push API subscription with the authenticated account. Enabling reminders in the task form performs the same permission and subscription setup without delaying the offline-first task save when the server is temporarily unavailable.

Browsers do not show the permission prompt again after a user blocks notifications. In that case, notification access must be restored through the browser's site settings.

The PHP reminder dispatcher must run every minute. It calculates each reminder in the account's timezone, applies the task recurrence or program cycle, skips completed tasks, and records one delivery per browser, task, date, and reminder time. Push messages have a five-minute lifetime and notification clicks open Tasks.

Desktop Web Push requires HTTPS, the production service worker, persistent VAPID configuration, and a scheduler invoking `php server/push-reminders.php`. Android continues to use Capacitor Local Notifications and its existing notification and exact-alarm permission flow.
