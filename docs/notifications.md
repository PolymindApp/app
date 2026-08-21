# Task notifications

Daily reminders can be configured from Android and supported desktop browsers. Android schedules dated local notifications with Capacitor. Desktop schedules browser notifications entirely in the open web app.

When daily reminders are enabled for a new time-based task, the form creates the first notification at the task's selected scheduled time. All-day tasks default their first notification to 20:00. Existing notification times are preserved when reminders are re-enabled.

On authenticated desktop startup, BackOnTrack loads the complete task list and checks for an active task with daily reminders enabled. If one exists, the app requests browser notification permission when needed. Enabling reminders in the task form performs the same permission check without delaying the offline-first task save.

Browsers do not show the permission prompt again after a user blocks notifications. In that case, notification access must be restored through the browser's site settings.

While the desktop app remains open, it schedules the next reminder in the browser, applies the task recurrence or program cycle, skips completed tasks, and opens Tasks when a notification is clicked. Desktop reminders stop when the tab or browser is closed and may be delayed when the browser suspends the tab or the computer sleeps. Android continues to use Capacitor Local Notifications and its existing notification and exact-alarm permission flow.
