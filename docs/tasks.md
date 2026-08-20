# Tasks

Opening the Tasks view selects the current day. Choosing another date remains in effect while working in that view, but returning to Tasks starts from today again.

When a Daily Total log exactly fills the positive amount remaining to its target, the Tasks view asks whether to lock in the total. Locking finishes the task and prevents more changes for that day; skipping leaves it unlocked so more values can still be logged.

Logged amounts update task progress immediately. Background persistence and synchronization refreshes preserve that optimistic value so totals do not temporarily revert while the save is in flight.

## Health Connect

Step Counter tasks can load daily step totals from Android Health Connect after the user connects it in Settings. Health Connect does not expose screen-time or app-usage records, so Screen time is not offered as an automatically populated Duration-task unit. Supporting device screen time would require a separate Android `UsageStatsManager` integration and usage-access permission.
