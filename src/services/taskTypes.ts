import type { TaskType } from '@/types/domain'

export interface TaskTypePresentation {
  type: TaskType
  title: string
  subtitle: string
  icon: string
  color: string
}

export const TASK_TYPE_OPTIONS: TaskTypePresentation[] = [
  { type: 'check', title: 'Check-off', subtitle: 'One action, one tap', icon: 'mdi-check-bold', color: '#8FB8FF' },
  { type: 'duration', title: 'Duration', subtitle: 'Track time toward a goal', icon: 'mdi-timer-outline', color: '#D4A5FF' },
  { type: 'daily_total', title: 'Daily total', subtitle: 'Protein, calories, water…', icon: 'mdi-chart-donut', color: '#FFB86B' },
  { type: 'step_counter', title: 'Step counter', subtitle: 'Sync progress from Health Connect', icon: 'mdi-shoe-print', color: '#7ED6A5' },
  { type: 'program', title: 'Program', subtitle: 'A flexible sequence', icon: 'mdi-repeat-variant', color: '#C7F464' },
  { type: 'interval', title: 'Interval', subtitle: 'Complete a saved interval', icon: 'mdi-timer-play-outline', color: '#66D9C8' },
  { type: 'flashcards', title: 'Flashcards', subtitle: 'Complete a saved Review set', icon: 'mdi-cards-outline', color: '#C7F464' },
  { type: 'tracking', title: 'Tracking', subtitle: 'Log one or more trackers', icon: 'mdi-chart-box-plus-outline', color: '#FF9EAE' },
  { type: 'journal', title: 'Journaling', subtitle: 'Write a reflection', icon: 'mdi-notebook-edit-outline', color: '#F4B8E4' },
]

export const TASK_TYPE_PRESENTATION = Object.fromEntries(
  TASK_TYPE_OPTIONS.map(option => [option.type, option]),
) as Record<TaskType, TaskTypePresentation>
