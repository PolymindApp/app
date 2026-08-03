import { reactive } from 'vue'
import { describe, expect, it } from 'vitest'
import {
  cloneIntervalTemplateDraft,
  createIntervalGroup,
  createIntervalStep,
  createRuntimeState,
  duplicateIntervalNode,
  intervalDefinitionWithRepetitions,
  intervalDuration,
  intervalGlobalRepetitionSettings,
  intervalRunProgress,
  intervalStepCount,
  moveIntervalNodeToGroup,
  normalizeQuickIntervalSettings,
  quickIntervalDefinition,
  reconcileIntervalRuntime,
  resolveIntervalStep,
  validateIntervalDefinition,
} from './intervals'
import type {
  IntervalDefinition,
  IntervalGroupNode,
  IntervalTemplate,
  QuickIntervalDraft,
} from '@/types/domain'

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
  it('copies a reactive interval template into an editable plain draft', () => {
    const template = reactive<IntervalTemplate>({
      id: 'template-1',
      name: 'Morning rounds',
      description: 'Start the day',
      color: '#C7F464',
      definition: {
        ...nestedDefinition(),
        globalRepetition: { enabled: true, defaultCount: 3 },
      },
      cues: { soundEnabled: true, vibrationEnabled: false },
      sortOrder: 2,
    })

    const draft = cloneIntervalTemplateDraft(template)

    expect(draft).toMatchObject({
      id: 'template-1',
      name: 'Morning rounds',
      description: 'Start the day',
      color: '#C7F464',
      cues: { soundEnabled: true, vibrationEnabled: false },
      sortOrder: 2,
    })
    expect(draft.definition).toEqual(template.definition)
    expect(draft.definition).not.toBe(template.definition)
    expect(draft.definition.children[1]).not.toBe(template.definition.children[1])
  })

  it('repeats the full definition and supports a per-run repetition count', () => {
    const definition: IntervalDefinition = {
      version: 1,
      children: [
        createIntervalStep('Work', 'work', 30),
        createIntervalStep('Rest', 'rest', 10),
      ],
      globalRepetition: { enabled: true, defaultCount: 3 },
    }

    expect(intervalGlobalRepetitionSettings(definition)).toEqual({
      enabled: true,
      defaultCount: 3,
    })
    expect(intervalStepCount(definition)).toBe(6)
    expect(intervalDuration(definition)).toBe(120)
    expect(resolveIntervalStep(definition, 4)?.groups[0]).toEqual({
      name: 'Repetitions',
      iteration: 3,
      total: 3,
    })

    const fiveRepetitions = intervalDefinitionWithRepetitions(definition, 5)
    expect(intervalStepCount(fiveRepetitions)).toBe(10)
    expect(intervalDuration(fiveRepetitions)).toBe(200)
    expect(definition.globalRepetition?.defaultCount).toBe(3)
  })

  it('skips the final root step on the last global repetition', () => {
    const work = createIntervalStep('Work', 'work', 30)
    const rest = createIntervalStep('Rest', 'rest', 10)
    rest.skipOnLastRound = true
    const definition: IntervalDefinition = {
      version: 1,
      children: [work, rest],
      globalRepetition: { enabled: true, defaultCount: 3 },
    }

    expect(intervalStepCount(definition)).toBe(5)
    expect(intervalDuration(definition)).toBe(110)
    expect(Array.from({ length: 5 }, (_, index) => resolveIntervalStep(definition, index)?.step.name))
      .toEqual(['Work', 'Rest', 'Work', 'Rest', 'Work'])
  })

  it('validates the global repetition default', () => {
    const definition: IntervalDefinition = {
      version: 1,
      children: [createIntervalStep('Work', 'work', 30)],
      globalRepetition: { enabled: true, defaultCount: 1 },
    }

    expect(validateIntervalDefinition(definition))
      .toContain('Default repetitions must be from 2 to 15.')
  })

  it('duplicates a reactive interval group with fresh IDs for every nested node', () => {
    const group = reactive(createIntervalGroup('Rounds', 3))
    const nested = createIntervalGroup('Pair', 2)
    nested.children = [
      createIntervalStep('Work', 'work', 30),
      createIntervalStep('Rest', 'rest', 10),
    ]
    group.children = [nested]

    const duplicate = duplicateIntervalNode(group)

    expect(duplicate.type).toBe('group')
    if (duplicate.type !== 'group') throw new Error('Expected a duplicated interval group.')
    expect(duplicate).toMatchObject({
      type: 'group',
      name: 'Rounds',
      repeatCount: 3,
      children: [{
        type: 'group',
        name: 'Pair',
        repeatCount: 2,
        children: [
          { type: 'step', name: 'Work', kind: 'work', durationSeconds: 30 },
          { type: 'step', name: 'Rest', kind: 'rest', durationSeconds: 10 },
        ],
      }],
    })

    const originalNested = group.children[0]
    const duplicateNested = duplicate.children[0]
    expect(duplicate.id).not.toBe(group.id)
    expect(duplicateNested?.id).not.toBe(originalNested?.id)
    if (originalNested?.type !== 'group' || duplicateNested?.type !== 'group') {
      throw new Error('Expected nested interval groups.')
    }
    expect(duplicateNested.children[0]?.id).not.toBe(originalNested.children[0]?.id)
    expect(duplicateNested.children[1]?.id).not.toBe(originalNested.children[1]?.id)

    duplicateNested.children[0]!.name = 'Changed copy'
    expect(originalNested.children[0]?.name).toBe('Work')
  })

  it('creates new intervals without a selected type and requires one before saving', () => {
    const step = createIntervalStep()

    expect(step.kind).toBe('')
    expect(validateIntervalDefinition({ version: 1, children: [step] }))
      .toContain('Item 1 needs a type.')
  })

  it('supports Train intervals as timed steps', () => {
    const train = createIntervalStep('Cardio', 'train', 90)
    const definition: IntervalDefinition = { version: 1, children: [train] }

    expect(validateIntervalDefinition(definition)).toEqual([])
    expect(intervalDuration(definition)).toBe(90)
  })

  it('allows confirmation intervals without a duration', () => {
    const confirmation = createIntervalStep('Drink water', 'confirmation', 0)
    const definition: IntervalDefinition = { version: 1, children: [confirmation] }

    expect(validateIntervalDefinition(definition)).toEqual([])
    expect(intervalStepCount(definition)).toBe(1)
    expect(intervalDuration(definition)).toBe(0)
  })

  it('moves an interval from a group to the root order', () => {
    const rootStep = createIntervalStep('Root', 'work', 30)
    const nestedStep = createIntervalStep('Nested', 'rest', 15)
    const group = createIntervalGroup('Rounds', 2)
    group.children = [nestedStep]
    const definition: IntervalDefinition = {
      version: 1,
      children: [rootStep, group],
    }

    expect(moveIntervalNodeToGroup(
      definition,
      nestedStep.id,
      undefined,
      [rootStep.id, group.id, nestedStep.id],
    )).toBe(true)

    expect(group.children).toEqual([])
    expect(definition.children.map((node) => node.id)).toEqual([
      rootStep.id,
      group.id,
      nestedStep.id,
    ])
  })

  it('keeps final-round skipping when an interval moves from a group to the root', () => {
    const group = createIntervalGroup('Rounds', 2)
    const work = createIntervalStep('Work', 'work', 30)
    const rest = createIntervalStep('Rest', 'rest', 10)
    rest.skipOnLastRound = true
    group.children = [work, rest]
    const definition: IntervalDefinition = {
      version: 1,
      children: [group],
      globalRepetition: { enabled: true, defaultCount: 3 },
    }

    expect(moveIntervalNodeToGroup(
      definition,
      rest.id,
      undefined,
      [group.id, rest.id],
    )).toBe(true)

    expect(rest.skipOnLastRound).toBe(true)
    expect(intervalStepCount(definition)).toBe(8)
    expect(intervalDuration(definition)).toBe(200)
    expect(Array.from({ length: 8 }, (_, index) => resolveIntervalStep(definition, index)?.step.name))
      .toEqual(['Work', 'Work', 'Rest', 'Work', 'Work', 'Rest', 'Work', 'Work'])
  })

  it('moves a complete group into another group', () => {
    const sourceGroup = createIntervalGroup('Source', 2)
    sourceGroup.children = [createIntervalStep('Work', 'work', 30)]
    const targetGroup = createIntervalGroup('Target', 2)
    const targetStep = createIntervalStep('Rest', 'rest', 15)
    targetGroup.children = [targetStep]
    const definition: IntervalDefinition = {
      version: 1,
      children: [sourceGroup, targetGroup],
    }

    expect(moveIntervalNodeToGroup(
      definition,
      sourceGroup.id,
      targetGroup.id,
      [targetStep.id, sourceGroup.id],
    )).toBe(true)

    expect(definition.children).toEqual([targetGroup])
    expect(targetGroup.children.map((node) => node.id)).toEqual([
      targetStep.id,
      sourceGroup.id,
    ])
  })

  it('rejects moving a group into one of its descendants', () => {
    const outerGroup = createIntervalGroup('Outer', 2)
    const innerGroup = createIntervalGroup('Inner', 2)
    outerGroup.children = [innerGroup]
    const definition: IntervalDefinition = {
      version: 1,
      children: [outerGroup],
    }

    expect(moveIntervalNodeToGroup(
      definition,
      outerGroup.id,
      innerGroup.id,
      [outerGroup.id],
    )).toBe(false)
    expect(definition.children).toEqual([outerGroup])
    expect((definition.children[0] as IntervalGroupNode).children).toEqual([innerGroup])
  })

  it('defaults groups to one repeat and limits repeats to fifteen', () => {
    expect(createIntervalGroup().repeatCount).toBe(1)

    const group = createIntervalGroup('Too many', 16)
    group.children = [createIntervalStep('Work', 'work', 30)]
    const errors = validateIntervalDefinition({ version: 1, children: [group] })

    expect(errors.some((error) => error.includes('repeat count from 1 to 15'))).toBe(true)
  })

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

  it('weights total progress by each interval duration', () => {
    const definition: IntervalDefinition = {
      version: 1,
      children: [
        createIntervalStep('Short', 'prepare', 10),
        createIntervalStep('Long', 'work', 90),
      ],
    }

    expect(intervalRunProgress(definition, 1, 90_000)).toMatchObject({
      total: 10,
      item: 0,
    })
    const halfwayThroughLongItem = intervalRunProgress(definition, 1, 45_000)
    expect(halfwayThroughLongItem.total).toBeCloseTo(55)
    expect(halfwayThroughLongItem.item).toBe(50)
  })

  it('weights progress within the current repeated round', () => {
    const rounds = createIntervalGroup('Rounds', 2)
    rounds.children = [
      createIntervalStep('Work', 'work', 30),
      createIntervalStep('Rest', 'rest', 10),
    ]
    const definition: IntervalDefinition = { version: 1, children: [rounds] }

    expect(intervalRunProgress(definition, 1, 5_000)).toEqual({
      total: 43.75,
      item: 50,
      round: 87.5,
      roundIteration: 1,
      roundTotal: 2,
    })
    expect(intervalRunProgress(definition, 2, 15_000)).toEqual({
      total: 68.75,
      item: 50,
      round: 37.5,
      roundIteration: 2,
      roundTotal: 2,
    })
  })

  it('uses the shortened final round when its last interval is skipped', () => {
    const rounds = createIntervalGroup('Rounds', 2)
    const rest = createIntervalStep('Rest', 'rest', 10)
    rest.skipOnLastRound = true
    rounds.children = [
      createIntervalStep('Work', 'work', 30),
      rest,
    ]
    const definition: IntervalDefinition = { version: 1, children: [rounds] }

    expect(intervalRunProgress(definition, 2, 15_000)).toEqual({
      total: 78.57142857142857,
      item: 50,
    })
  })

  it('skips only the last step of the final round when selected', () => {
    const rounds = createIntervalGroup('Rounds', 3)
    const work = createIntervalStep('Work', 'work', 30)
    const rest = createIntervalStep('Rest', 'rest', 10)
    rest.skipOnLastRound = true
    rounds.children = [work, rest]
    const definition: IntervalDefinition = { version: 1, children: [rounds] }

    expect(intervalStepCount(definition)).toBe(5)
    expect(intervalDuration(definition)).toBe(110)
    expect(Array.from({ length: 5 }, (_, index) => resolveIntervalStep(definition, index)?.step.name))
      .toEqual(['Work', 'Rest', 'Work', 'Rest', 'Work'])
    expect(resolveIntervalStep(definition, 4)?.groups)
      .toEqual([{ name: 'Rounds', iteration: 3, total: 3 }])
    expect(resolveIntervalStep(definition, 5)).toBeUndefined()
  })

  it('ignores the final-round flag unless it is on the last step', () => {
    const rounds = createIntervalGroup('Rounds', 3)
    const work = createIntervalStep('Work', 'work', 30)
    work.skipOnLastRound = true
    rounds.children = [work, createIntervalStep('Rest', 'rest', 10)]
    const definition: IntervalDefinition = { version: 1, children: [rounds] }

    expect(intervalStepCount(definition)).toBe(6)
    expect(intervalDuration(definition)).toBe(120)
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
    cues: { soundEnabled: true, vibrationEnabled: true },
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

  it('normalizes persisted quick interval settings', () => {
    expect(normalizeQuickIntervalSettings({
      warmupSeconds: 0,
      workSeconds: 30,
      restSeconds: 15,
      rounds: 4,
      cooldownSeconds: 0,
      restAfterLastRound: true,
      includeRest: true,
      cues: { soundEnabled: true, vibrationEnabled: false },
    })).toEqual({
      warmupSeconds: 0,
      workSeconds: 30,
      restSeconds: 15,
      rounds: 4,
      cooldownSeconds: 0,
      restAfterLastRound: true,
      includeRest: true,
      cues: { soundEnabled: true, vibrationEnabled: false },
    })
    expect(normalizeQuickIntervalSettings({ workSeconds: 30, rounds: 99 }))
      .toBeUndefined()
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

  it('waits at a confirmation without counting the time spent waiting', () => {
    const definition: IntervalDefinition = {
      version: 1,
      children: [
        createIntervalStep('Work', 'work', 5),
        createIntervalStep('Confirm', 'confirmation', 0),
        createIntervalStep('Rest', 'rest', 5),
      ],
    }
    const runtime = createRuntimeState(definition, new Date('2026-07-28T12:00:00.000Z'))
    const arrived = reconcileIntervalRuntime(
      definition,
      runtime,
      new Date('2026-07-28T12:00:20.000Z'),
    )

    expect(arrived.completed).toBe(false)
    expect(arrived.transitions).toBe(1)
    expect(arrived.runtime).toMatchObject({
      stepIndex: 1,
      remainingMs: 0,
      accumulatedMs: 5000,
      stepStartedAt: undefined,
    })

    const stillWaiting = reconcileIntervalRuntime(
      definition,
      arrived.runtime,
      new Date('2026-07-28T12:10:00.000Z'),
    )
    expect(stillWaiting.transitions).toBe(0)
    expect(stillWaiting.runtime.accumulatedMs).toBe(5000)
  })

  it('starts on a confirmation without starting the clock', () => {
    const definition: IntervalDefinition = {
      version: 1,
      children: [createIntervalStep('Ready?', 'confirmation', 0)],
    }
    const runtime = createRuntimeState(definition, new Date('2026-07-28T12:00:00.000Z'))

    expect(runtime.remainingMs).toBe(0)
    expect(runtime.stepStartedAt).toBeUndefined()
  })
})
