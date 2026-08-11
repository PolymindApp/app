import type { RunnerSessionMenuItem } from '@/types/domain'

interface IntervalRunnerSessionMenuState {
  speechAvailable: boolean
  amplified: boolean
  busy: boolean
  preview: boolean
}

interface ReviewRunnerSessionMenuState extends IntervalRunnerSessionMenuState {
  finished: boolean
  canRestart: boolean
}

function amplificationItem(amplified: boolean, disabled: boolean): RunnerSessionMenuItem {
  return {
    action: 'amplification',
    title: amplified ? 'Disable TTS amplification' : 'Enable TTS amplification',
    icon: amplified ? 'mdi-volume-plus' : 'mdi-volume-high',
    active: amplified,
    disabled,
    toggle: true,
  }
}

export function intervalRunnerSessionMenuItems(
  state: IntervalRunnerSessionMenuState,
): RunnerSessionMenuItem[] {
  return [
    ...(state.speechAvailable ? [amplificationItem(state.amplified, state.busy)] : []),
    {
      action: 'restart' as const,
      title: 'Restart interval',
      icon: 'mdi-restart',
      disabled: state.preview || state.busy,
      divider: state.speechAvailable,
    },
    {
      action: 'end' as const,
      title: 'End session',
      icon: 'mdi-stop-circle-outline',
      color: 'error',
      disabled: state.preview || state.busy,
    },
  ]
}

export function reviewRunnerSessionMenuItems(
  state: ReviewRunnerSessionMenuState,
): RunnerSessionMenuItem[] {
  const sessionUnavailable = state.preview || state.finished || state.busy
  return [
    ...(state.speechAvailable
      ? [amplificationItem(state.amplified, state.finished || state.busy)]
      : []),
    {
      action: 'restart',
      title: 'Restart review',
      icon: 'mdi-restart',
      disabled: sessionUnavailable || !state.canRestart,
      divider: state.speechAvailable,
    },
    {
      action: 'end',
      title: 'End review',
      icon: 'mdi-stop-circle-outline',
      color: 'error',
      disabled: sessionUnavailable,
    },
  ]
}
