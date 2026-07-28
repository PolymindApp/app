import { describe, expect, it } from 'vitest'
import {
  createIntervalGroup,
  createIntervalStep,
  createRuntimeState,
  intervalDuration,
  intervalStepCount,
  quickIntervalDefinition,
  reconcileIntervalRuntime,
  resolveIntervalStep,
  validateIntervalDefinition,
} from './intervals'
import type { IntervalDefinition, QuickIntervalDraft } from '@/types/domain'

function nestedDefinition(): IntervalDefinition {
  const rounds = createIntervalGroup('Rounds', 3)
  rounds.children = [
    createIntervalStep('Work', 'work', 30),
    createIntervalStep('Rest', 'rest', 10),
  ]
  const sets = createIntervalGroup('Sets', 2)
  sets.children = [rounds, createIntervalStep('Set rest', 'rest', 60)]
  return {
    version: 1,
    children: [
      createIntervalStep('Prepare', 'prepare', 20),
      sets,
      createIntervalStep('Cool down', 'meditation', 40),
    ],
  }
}

describe('interval definitions', () => {
  it('calculates nested repeated duration and step count without expanding a timeline', () => {
    const definition = nestedDefinition()
    expect(intervalStepCount(definition)).toBe(16)
    expect(intervalDuration(definition)).toBe(420)
  })

  it('resolves a step and its nested group iterations by expanded index', () => {
    const step = resolveIntervalStep(nestedDefinition(), 7)
    expect(step?.step.name).toBe('Set rest')
    expect(step?.groups).toEqual([{ name: 'Sets', iteration: 1, total: 2 }])
    expect(resolveIntervalStep(nestedDefinition(), 15)?.step.name).toBe('Cool down')
  })

  it('validates empty groups, names, durations, and repeat counts', () => {
    const group = createIntervalGroup('', 0)
    const definition: IntervalDefinition = {
      version: 1,
      children: [createIntervalStep('', 'work', 0), group],
    }
    const errors = validateIntervalDefinition(definition)
    expect(errors.some((error) => error.includes('needs a name'))).toBe(true)
    expect(errors.some((error) => error.includes('positive duration'))).toBe(true)
    expect(errors.some((error) => error.includes('repeat count'))).toBe(true)
    expect(errors.some((error) => error.includes('cannot be empty'))).toBe(true)
  })

  it('supports deeply nested groups without imposing a product depth limit', () => {
    let node = createIntervalStep('Center', 'meditation', 1)
    for (let index = 0; index < 40; index += 1) {
      const group = createIntervalGroup(`Level ${index}`, 1)
      group.children = [node]
      node = group
    }
    const definition: IntervalDefinition = { version: 1, children: [node] }
    expect(intervalStepCount(definition)).toBe(1)
    expect(resolveIntervalStep(definition, 0)?.step.name).toBe('Center')
  })
})

describe('quick intervals', () => {
  const quick = (overrides: Partial<QuickIntervalDraft> = {}): QuickIntervalDraft => ({
    warmupSeconds: 10,
    workSeconds: 30,
    restSeconds: 15,
    rounds: 3,
    cooldownSeconds: 20,
    restAfterLastRound: false,
    cues: { soundEnabled: true, vibrationEnabled: true, sound: 'beep' },
    ...overrides,
  })

  it('omits the final rest by default', () => {
    const definition = quickIntervalDefinition(quick())
    expect(intervalDuration(definition)).toBe(150)
    expect(resolveIntervalStep(definition, intervalStepCount(definition) - 2)?.step.name).toBe('Work')
    expect(resolveIntervalStep(definition, intervalStepCount(definition) - 1)?.step.name).toBe('Cool down')
  })

  it('can include rest after the final round', () => {
    const definition = quickIntervalDefinition(quick({ restAfterLastRound: true }))
    expect(intervalDuration(definition)).toBe(165)
  })
})

describe('interval runtime recovery', () => {
  it('catches up across multiple transitions using timestamps', () => {
    const definition: IntervalDefinition = {
      version: 1,
      children: [
        createIntervalStep('One', 'work', 5),
        createIntervalStep('Two', 'rest', 5),
        createIntervalStep('Three', 'work', 5),
      ],
    }
    const started = new Date('2026-07-28T12:00:00.000Z')
    const runtime = createRuntimeState(definition, started)
    const result = reconcileIntervalRuntime(definition, runtime, new Date('2026-07-28T12:00:12.000Z'))
    expect(result.completed).toBe(false)
    expect(result.transitions).toBe(2)
    expect(result.runtime.stepIndex).toBe(2)
    expect(result.runtime.remainingMs).toBe(3000)
    expect(result.runtime.accumulatedMs).toBe(12000)
  })

  it('marks a session complete without counting time after its planned end', () => {
    const definition: IntervalDefinition = {
      version: 1,
      children: [createIntervalStep('One', 'work', 5)],
    }
    const runtime = createRuntimeState(definition, new Date('2026-07-28T12:00:00.000Z'))
    const result = reconcileIntervalRuntime(definition, runtime, new Date('2026-07-28T12:00:20.000Z'))
    expect(result.completed).toBe(true)
    expect(result.runtime.accumulatedMs).toBe(5000)
  })
})
