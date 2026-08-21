export const RECENT_SESSION_ACTIONS = [
  {
    action: 'details',
    title: 'See details',
    icon: 'mdi-eye-outline',
    color: undefined,
    divider: false,
  },
  {
    action: 'delete',
    title: 'Delete',
    icon: 'mdi-delete-outline',
    color: 'error',
    divider: true,
  },
] as const

export type RecentSessionAction = typeof RECENT_SESSION_ACTIONS[number]['action']
