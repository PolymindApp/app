import { describe, expect, it } from 'vitest'
import {
  createTaskTimer,
  formatTaskTimer,
  pauseTaskTimer,
  resetTaskTimer,
  resumeTaskTimer,
  shouldPlayTaskTimerCompleteCue,
  taskTimerElapsedMs,
} from './taskTimer'

describe('task time logger', () => {
  it('accumulates only while running', () => {
    const created = createTaskTimer('task-1', '2026-07-30', new Date('2026-07-30T12:00:00Z'))
    const running = resumeTaskTimer(created, new Date('2026-07-30T12:01:00Z'))

    expect(taskTimerElapsedMs(running, new Date('2026-07-30T12:02:30Z'))).toBe(90_000)

    const paused = pauseTaskTimer(running, new Date('2026-07-30T12:03:00Z'))
    expect(taskTimerElapsedMs(paused, new Date('2026-07-30T13:00:00Z'))).toBe(120_000)
  })

  it('restarts a running timer from zero', () => {
    const created = createTaskTimer('task-1', '2026-07-30', new Date('2026-07-30T12:00:00Z'))
    const running = resumeTaskTimer(created, new Date('2026-07-30T12:01:00Z'))
    const restarted = resetTaskTimer(running, new Date('2026-07-30T12:03:00Z'))

    expect(taskTimerElapsedMs(restarted, new Date('2026-07-30T12:03:05Z'))).toBe(5_000)
  })

  it('formats minute and hour durations', () => {
    expect(formatTaskTimer(0)).toBe('00:00')
    expect(formatTaskTimer(65_900)).toBe('01:05')
    expect(formatTaskTimer(3_665_000)).toBe('01:01:05')
  })

  it('plays completion only when the live total first reaches a previously unmet target', () => {
    expect(shouldPlayTaskTimerCompleteCue(2, 4, 4, false)).toBe(true)
    expect(shouldPlayTaskTimerCompleteCue(4, 5, 4, false)).toBe(false)
    expect(shouldPlayTaskTimerCompleteCue(2, 5, 4, true)).toBe(false)
    expect(shouldPlayTaskTimerCompleteCue(2, 3.99, 4, false)).toBe(false)
  })
})
