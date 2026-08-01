import type { IntervalStepKind } from '@/types/domain'

export type IntervalTypeAnimation = 'pulse' | 'charge' | 'breathe' | 'turn' | 'focus' | 'confirm' | 'tune'

export interface IntervalTypePresentation {
  title: string
  value: IntervalStepKind
  icon: string
  color: string
  animation: IntervalTypeAnimation
}

export const INTERVAL_STEP_TYPES: IntervalTypePresentation[] = [
  { title: 'Train', value: 'train', icon: 'mdi-heart', color: '#FF5C6C', animation: 'pulse' },
  { title: 'Work', value: 'work', icon: 'mdi-lightning-bolt', color: '#FFB86B', animation: 'charge' },
  { title: 'Rest', value: 'rest', icon: 'mdi-coffee-outline', color: '#8FB8FF', animation: 'breathe' },
  { title: 'Prepare', value: 'prepare', icon: 'mdi-timer-sand', color: '#C7F464', animation: 'turn' },
  { title: 'Meditation', value: 'meditation', icon: 'mdi-meditation', color: '#D4A5FF', animation: 'focus' },
  { title: 'Confirmation', value: 'confirmation', icon: 'mdi-check-circle-outline', color: '#69D7C5', animation: 'confirm' },
  { title: 'Custom', value: 'custom', icon: 'mdi-tune-variant', color: '#79C174', animation: 'tune' },
]

export const INTERVAL_TYPE_PRESENTATION = Object.fromEntries(
  INTERVAL_STEP_TYPES.map((type) => [type.value, type]),
) as Record<IntervalStepKind, IntervalTypePresentation>
