export const TASK_IMAGE_LOG_ACTIONS = [
  { id: 'edit', title: 'Edit', icon: 'mdi-pencil-outline' },
  { id: 'archive', title: 'Archive', icon: 'mdi-archive-arrow-down-outline' },
] as const

export type TaskImageLogActionId = typeof TASK_IMAGE_LOG_ACTIONS[number]['id']
