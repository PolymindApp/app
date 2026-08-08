export const TASK_FILTER_ITEMS = [
  {
    id: 'completed',
    title: 'Completed',
    ariaLabel: 'Show completed tasks',
  },
] as const

export type TaskFilterId = typeof TASK_FILTER_ITEMS[number]['id']
