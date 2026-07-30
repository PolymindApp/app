import type {
  IntervalDefinition,
  IntervalGroupNode,
  IntervalNode,
  IntervalRuntimeState,
  IntervalStepNode,
  IntervalTemplate,
  IntervalTemplateDraft,
  QuickIntervalDraft,
  QuickIntervalSettings,
  ResolvedIntervalStep,
} from '@/types/domain'

const safeAdd = (left: number, right: number) => Math.min(Number.MAX_SAFE_INTEGER, left + right)
const safeMultiply = (left: number, right: number) => Math.min(Number.MAX_SAFE_INTEGER, left * right)

export function intervalStepDurationSeconds(step: IntervalStepNode) {
  if (step.kind === 'confirmation') return 0
  return Number.isFinite(step.durationSeconds) ? Math.max(0, step.durationSeconds) : 0
}

export function normalizeQuickIntervalSettings(value: unknown): QuickIntervalSettings | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const settings = value as Record<string, unknown>
  const cues = settings.cues
  if (!cues || typeof cues !== 'object' || Array.isArray(cues)) return undefined
  const cueSettings = cues as Record<string, unknown>
  const integer = (field: string, minimum: number, maximum: number) => {
    const candidate = settings[field]
    return Number.isInteger(candidate) && Number(candidate) >= minimum && Number(candidate) <= maximum
      ? Number(candidate)
      : undefined
  }
  const warmupSeconds = integer('warmupSeconds', 0, 3599)
  const workSeconds = integer('workSeconds', 1, 3599)
  const restSeconds = integer('restSeconds', 0, 3599)
  const rounds = integer('rounds', 1, 15)
  const cooldownSeconds = integer('cooldownSeconds', 0, 3599)
  if (
    warmupSeconds === undefined
    || workSeconds === undefined
    || restSeconds === undefined
    || rounds === undefined
    || cooldownSeconds === undefined
    || typeof settings.restAfterLastRound !== 'boolean'
    || typeof settings.includeRest !== 'boolean'
    || typeof cueSettings.soundEnabled !== 'boolean'
    || typeof cueSettings.vibrationEnabled !== 'boolean'
  ) return undefined

  return {
    warmupSeconds,
    workSeconds,
    restSeconds,
    rounds,
    cooldownSeconds,
    restAfterLastRound: settings.restAfterLastRound,
    includeRest: settings.includeRest,
    cues: {
      soundEnabled: cueSettings.soundEnabled,
      vibrationEnabled: cueSettings.vibrationEnabled,
    },
  }
}

export function createIntervalId() {
  return globalThis.crypto?.randomUUID?.() || `interval-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function createIntervalStep(
  name = '',
  kind: IntervalStepNode['kind'] = '',
  durationSeconds = 30,
): IntervalStepNode {
  return { id: createIntervalId(), type: 'step', name, kind, durationSeconds }
}

export function createIntervalGroup(name = '', repeatCount = 1): IntervalGroupNode {
  return { id: createIntervalId(), type: 'group', name, repeatCount, children: [] }
}

export function duplicateIntervalNode(node: IntervalNode): IntervalNode {
  if (node.type === 'step') {
    return {
      ...node,
      id: createIntervalId(),
    }
  }

  return {
    ...node,
    id: createIntervalId(),
    children: node.children.map(duplicateIntervalNode),
  }
}

function cloneIntervalNode(node: IntervalNode): IntervalNode {
  if (node.type === 'step') return { ...node }
  return {
    ...node,
    children: node.children.map(cloneIntervalNode),
  }
}

export function cloneIntervalTemplateDraft(template: IntervalTemplate): IntervalTemplateDraft {
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    color: template.color,
    definition: {
      version: template.definition.version,
      children: template.definition.children.map(cloneIntervalNode),
    },
    cues: { ...template.cues },
    sortOrder: template.sortOrder,
  }
}

function skippedLastRoundStep(node: IntervalGroupNode): IntervalStepNode | undefined {
  if (Math.floor(node.repeatCount) <= 1) return undefined
  const lastChild = node.children.at(-1)
  return lastChild?.type === 'step' && lastChild.skipOnLastRound
    ? lastChild
    : undefined
}

export function intervalNodeStepCount(node: IntervalNode): number {
  if (node.type === 'step') return 1
  const childCount = node.children.reduce((sum, child) => safeAdd(sum, intervalNodeStepCount(child)), 0)
  const total = safeMultiply(childCount, Math.max(0, Math.floor(node.repeatCount)))
  return skippedLastRoundStep(node) ? Math.max(0, total - 1) : total
}

export function intervalStepCount(definition: IntervalDefinition): number {
  return definition.children.reduce((sum, node) => safeAdd(sum, intervalNodeStepCount(node)), 0)
}

export function intervalNodeDuration(node: IntervalNode): number {
  if (node.type === 'step') return intervalStepDurationSeconds(node)
  const childDuration = node.children.reduce((sum, child) => safeAdd(sum, intervalNodeDuration(child)), 0)
  const total = safeMultiply(childDuration, Math.max(0, Math.floor(node.repeatCount)))
  const skippedStep = skippedLastRoundStep(node)
  return skippedStep ? Math.max(0, total - intervalStepDurationSeconds(skippedStep)) : total
}

export function intervalDuration(definition: IntervalDefinition): number {
  return definition.children.reduce((sum, node) => safeAdd(sum, intervalNodeDuration(node)), 0)
}

function resolveInNodes(
  nodes: IntervalNode[],
  requestedIndex: number,
  groups: ResolvedIntervalStep['groups'],
): { step: IntervalStepNode; groups: ResolvedIntervalStep['groups'] } | undefined {
  let index = requestedIndex
  for (const node of nodes) {
    const count = intervalNodeStepCount(node)
    if (index >= count) {
      index -= count
      continue
    }
    if (node.type === 'step') return { step: node, groups }
    const childCount = node.children.reduce((sum, child) => safeAdd(sum, intervalNodeStepCount(child)), 0)
    if (!childCount) return undefined
    const repeatCount = Math.max(0, Math.floor(node.repeatCount))
    const skippedStep = skippedLastRoundStep(node)
    const fullIterationsCount = skippedStep
      ? safeMultiply(childCount, Math.max(0, repeatCount - 1))
      : 0
    const iteration = skippedStep && index >= fullIterationsCount
      ? repeatCount - 1
      : Math.floor(index / childCount)
    const childIndex = skippedStep && index >= fullIterationsCount
      ? index - fullIterationsCount
      : index % childCount
    return resolveInNodes(
      node.children,
      childIndex,
      [...groups, { name: node.name || 'Group', iteration: iteration + 1, total: repeatCount }],
    )
  }
  return undefined
}

export function resolveIntervalStep(
  definition: IntervalDefinition,
  index: number,
): ResolvedIntervalStep | undefined {
  const totalSteps = intervalStepCount(definition)
  if (!Number.isInteger(index) || index < 0 || index >= totalSteps) return undefined
  const resolved = resolveInNodes(definition.children, index, [])
  return resolved ? { ...resolved, index, totalSteps } : undefined
}

interface IntervalProgressGroup {
  iteration: number
  total: number
  startSeconds: number
  durationSeconds: number
  stepOffset: number
  stepCount: number
}

interface IntervalProgressContext {
  step: IntervalStepNode
  elapsedBeforeSeconds: number
  groups: IntervalProgressGroup[]
}

export interface IntervalRunProgress {
  total: number
  item: number
  round?: number
  roundIteration?: number
  roundTotal?: number
}

function resolveIntervalProgressContext(
  nodes: IntervalNode[],
  requestedIndex: number,
  elapsedBeforeSeconds: number,
  groups: IntervalProgressGroup[],
): IntervalProgressContext | undefined {
  let index = requestedIndex
  let elapsed = elapsedBeforeSeconds

  for (const node of nodes) {
    const count = intervalNodeStepCount(node)
    if (index >= count) {
      index -= count
      elapsed = safeAdd(elapsed, intervalNodeDuration(node))
      continue
    }
    if (node.type === 'step') {
      return {
        step: node,
        elapsedBeforeSeconds: elapsed,
        groups,
      }
    }

    const childCount = node.children.reduce(
      (sum, child) => safeAdd(sum, intervalNodeStepCount(child)),
      0,
    )
    if (!childCount) return undefined

    const repeatCount = Math.max(0, Math.floor(node.repeatCount))
    const skippedStep = skippedLastRoundStep(node)
    const fullIterationsCount = skippedStep
      ? safeMultiply(childCount, Math.max(0, repeatCount - 1))
      : 0
    const iteration = skippedStep && index >= fullIterationsCount
      ? repeatCount - 1
      : Math.floor(index / childCount)
    const childIndex = skippedStep && index >= fullIterationsCount
      ? index - fullIterationsCount
      : index % childCount
    const childDuration = node.children.reduce(
      (sum, child) => safeAdd(sum, intervalNodeDuration(child)),
      0,
    )
    const skipsThisIteration = Boolean(skippedStep && iteration === repeatCount - 1)
    const iterationDuration = skipsThisIteration
      ? Math.max(0, childDuration - intervalStepDurationSeconds(skippedStep!))
      : childDuration
    const iterationStart = safeAdd(elapsed, safeMultiply(childDuration, iteration))

    return resolveIntervalProgressContext(
      node.children,
      childIndex,
      iterationStart,
      [
        ...groups,
        {
          iteration: iteration + 1,
          total: repeatCount,
          startSeconds: iterationStart,
          durationSeconds: iterationDuration,
          stepOffset: childIndex,
          stepCount: Math.max(0, childCount - (skipsThisIteration ? 1 : 0)),
        },
      ],
    )
  }

  return undefined
}

function progressPercent(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, value * 100))
}

export function intervalRunProgress(
  definition: IntervalDefinition,
  stepIndex: number,
  remainingMs: number,
): IntervalRunProgress {
  const totalSteps = intervalStepCount(definition)
  const context = resolveIntervalProgressContext(definition.children, stepIndex, 0, [])
  if (!context) {
    return {
      total: stepIndex >= totalSteps && totalSteps > 0 ? 100 : 0,
      item: stepIndex >= totalSteps && totalSteps > 0 ? 100 : 0,
    }
  }

  const itemDuration = intervalStepDurationSeconds(context.step)
  const itemProgress = itemDuration > 0
    ? 1 - (Math.max(0, remainingMs) / (itemDuration * 1000))
    : 0
  const elapsedThroughItem = safeAdd(
    context.elapsedBeforeSeconds,
    itemDuration * Math.min(1, Math.max(0, itemProgress)),
  )
  const totalDuration = intervalDuration(definition)
  const totalProgress = totalDuration > 0
    ? elapsedThroughItem / totalDuration
    : (stepIndex + itemProgress) / Math.max(1, totalSteps)
  const currentRound = context.groups
    .filter((group) => group.total > 1 && group.stepCount > 1)
    .at(-1)

  if (!currentRound) {
    return {
      total: progressPercent(totalProgress),
      item: progressPercent(itemProgress),
    }
  }

  const roundProgress = currentRound.durationSeconds > 0
    ? (elapsedThroughItem - currentRound.startSeconds) / currentRound.durationSeconds
    : (currentRound.stepOffset + itemProgress) / Math.max(1, currentRound.stepCount)

  return {
    total: progressPercent(totalProgress),
    item: progressPercent(itemProgress),
    round: progressPercent(roundProgress),
    roundIteration: currentRound.iteration,
    roundTotal: currentRound.total,
  }
}

export function validateIntervalDefinition(definition: IntervalDefinition): string[] {
  const errors: string[] = []
  let steps = 0

  function visit(nodes: IntervalNode[], location: string) {
    nodes.forEach((node, index) => {
      const path = `${location} ${index + 1}`
      if (node.type === 'step') {
        steps += 1
        if (!node.name.trim()) errors.push(`${path} needs a name.`)
        if (!node.kind) errors.push(`${path} needs a type.`)
        if (
          node.kind !== 'confirmation'
          && (!Number.isFinite(node.durationSeconds) || node.durationSeconds <= 0)
        ) {
          errors.push(`${path} needs a positive duration.`)
        }
        return
      }
      if (!Number.isInteger(node.repeatCount) || node.repeatCount < 1 || node.repeatCount > 15) {
        errors.push(`${path} needs a repeat count from 1 to 15.`)
      }
      if (!node.children.length) errors.push(`${path} cannot be empty.`)
      visit(node.children, `${path}, item`)
    })
  }

  visit(definition.children, 'Item')
  if (!steps) errors.unshift('Add at least one interval.')
  return errors
}

export function createRuntimeState(definition: IntervalDefinition, now = new Date()): IntervalRuntimeState {
  const first = resolveIntervalStep(definition, 0)
  const waitsForConfirmation = first?.step.kind === 'confirmation'
  return {
    stepIndex: 0,
    remainingMs: first ? intervalStepDurationSeconds(first.step) * 1000 : 0,
    stepStartedAt: first && !waitsForConfirmation ? now.toISOString() : undefined,
    accumulatedMs: 0,
    updatedAt: now.toISOString(),
  }
}

export function reconcileIntervalRuntime(
  definition: IntervalDefinition,
  runtime: IntervalRuntimeState,
  now = new Date(),
): { runtime: IntervalRuntimeState; completed: boolean; transitions: number } {
  if (!runtime.stepStartedAt) return { runtime: { ...runtime }, completed: false, transitions: 0 }
  const current = resolveIntervalStep(definition, runtime.stepIndex)
  if (current?.step.kind === 'confirmation') {
    return {
      runtime: {
        ...runtime,
        remainingMs: 0,
        stepStartedAt: undefined,
        updatedAt: now.toISOString(),
      },
      completed: false,
      transitions: 0,
    }
  }
  let elapsedMs = Math.max(0, now.getTime() - new Date(runtime.stepStartedAt).getTime())
  const activeElapsed = elapsedMs
  let remainingMs = runtime.remainingMs
  let stepIndex = runtime.stepIndex
  let transitions = 0

  while (elapsedMs >= remainingMs && resolveIntervalStep(definition, stepIndex)) {
    elapsedMs -= remainingMs
    stepIndex += 1
    transitions += 1
    const next = resolveIntervalStep(definition, stepIndex)
    if (!next) {
      return {
        runtime: {
          stepIndex,
          remainingMs: 0,
          accumulatedMs: runtime.accumulatedMs + (activeElapsed - elapsedMs),
          updatedAt: now.toISOString(),
        },
        completed: true,
        transitions,
      }
    }
    if (next.step.kind === 'confirmation') {
      return {
        runtime: {
          stepIndex,
          remainingMs: 0,
          stepStartedAt: undefined,
          accumulatedMs: runtime.accumulatedMs + (activeElapsed - elapsedMs),
          updatedAt: now.toISOString(),
        },
        completed: false,
        transitions,
      }
    }
    remainingMs = intervalStepDurationSeconds(next.step) * 1000
  }

  return {
    runtime: {
      stepIndex,
      remainingMs: Math.max(0, remainingMs - elapsedMs),
      stepStartedAt: now.toISOString(),
      accumulatedMs: runtime.accumulatedMs + activeElapsed,
      updatedAt: now.toISOString(),
    },
    completed: false,
    transitions,
  }
}

export function quickIntervalDefinition(draft: QuickIntervalDraft): IntervalDefinition {
  const children: IntervalNode[] = []
  if (draft.warmupSeconds > 0) children.push(createIntervalStep('Warm up', 'prepare', draft.warmupSeconds))

  const work = () => createIntervalStep('Work', 'work', draft.workSeconds)
  const rest = () => createIntervalStep('Rest', 'rest', draft.restSeconds)
  if (draft.restAfterLastRound) {
    const group = createIntervalGroup('Rounds', draft.rounds)
    group.children = draft.restSeconds > 0 ? [work(), rest()] : [work()]
    children.push(group)
  } else {
    if (draft.rounds > 1) {
      const group = createIntervalGroup('Rounds', draft.rounds - 1)
      group.children = draft.restSeconds > 0 ? [work(), rest()] : [work()]
      children.push(group)
    }
    children.push(work())
  }

  if (draft.cooldownSeconds > 0) children.push(createIntervalStep('Cool down', 'meditation', draft.cooldownSeconds))
  return { version: 1, children }
}

export function formatIntervalDuration(seconds: number) {
  const safeSeconds = Math.max(0, Math.round(seconds))
  const hours = Math.floor(safeSeconds / 3600)
  const minutes = Math.floor((safeSeconds % 3600) / 60)
  const remainder = safeSeconds % 60
  if (hours) return `${hours}h ${minutes}m`
  if (minutes) return `${minutes}m ${remainder ? `${remainder}s` : ''}`.trim()
  return `${remainder}s`
}
