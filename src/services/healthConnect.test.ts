import { describe, expect, it } from 'vitest'
import {
  DEFAULT_STEP_SOURCE,
  healthConnectDayRange,
  normalizeStepSource,
} from './healthConnect'

describe('Health Connect step settings', () => {
  it('falls back to Health Connect for missing or unsupported values', () => {
    expect(normalizeStepSource(undefined)).toBe(DEFAULT_STEP_SOURCE)
    expect(normalizeStepSource('phone')).toBe(DEFAULT_STEP_SOURCE)
    expect(normalizeStepSource('health_connect')).toBe('health_connect')
  })

  it('uses the selected local calendar day as the aggregation range', () => {
    const date = new Date(2026, 7, 2, 14, 30)
    const { start, end } = healthConnectDayRange(date)

    expect(start.getFullYear()).toBe(2026)
    expect(start.getMonth()).toBe(7)
    expect(start.getDate()).toBe(2)
    expect(start.getHours()).toBe(0)
    expect(end.getFullYear()).toBe(2026)
    expect(end.getMonth()).toBe(7)
    expect(end.getDate()).toBe(3)
    expect(end.getHours()).toBe(0)
  })
})
