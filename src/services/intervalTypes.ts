import type {
  IntervalCueSound,
  IntervalStepKind,
  IntervalTypeSoundSettings,
} from '@/types/domain'

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

export const INTERVAL_CUE_SOUND_OPTIONS: Array<{
  title: string
  value: IntervalCueSound
}> = [
  { title: 'Cash Register', value: 'cash' },
  { title: 'Celestial Tone', value: 'celestial' },
  { title: 'Classic Chime', value: 'chime' },
  { title: 'Cinematic Boom', value: 'cine-boom' },
  { title: 'Cinematic Hit', value: 'cine-hit' },
  { title: 'Gentle Confirmation', value: 'confirm' },
  { title: 'Meditation Gong', value: 'gong' },
  { title: 'Harp Flourish', value: 'harp' },
  { title: 'Magic Sparkle', value: 'magic' },
  { title: 'Soft Notification', value: 'notification' },
  { title: 'Go Signal', value: 'go' },
  { title: 'Completion Signal', value: 'complete' },
  { title: 'Countdown Tick', value: 'count' },
  { title: 'None', value: 'none' },
]

const INTERVAL_CUE_SOUNDS = new Set<IntervalCueSound>(
  INTERVAL_CUE_SOUND_OPTIONS.map(option => option.value),
)

export function defaultIntervalTypeSounds(): IntervalTypeSoundSettings {
  return {
    train: 'cine-hit',
    work: 'cash',
    rest: 'harp',
    prepare: 'go',
    meditation: 'gong',
    confirmation: 'confirm',
    custom: 'go',
  }
}

export function normalizeIntervalTypeSounds(value: unknown): IntervalTypeSoundSettings {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  const defaults = defaultIntervalTypeSounds()
  return Object.fromEntries(
    INTERVAL_STEP_TYPES.map((type) => {
      const sound = record[type.value]
      return [type.value, INTERVAL_CUE_SOUNDS.has(sound as IntervalCueSound) ? sound : defaults[type.value]]
    }),
  ) as IntervalTypeSoundSettings
}

export function intervalTypeSound(
  settings: IntervalTypeSoundSettings | undefined,
  kind: IntervalStepKind | '' | undefined,
): IntervalCueSound {
  if (!kind) return 'go'
  const sound = settings?.[kind]
  return INTERVAL_CUE_SOUNDS.has(sound as IntervalCueSound)
    ? sound as IntervalCueSound
    : defaultIntervalTypeSounds()[kind]
}
