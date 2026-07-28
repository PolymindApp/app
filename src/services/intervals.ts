import type {
  IntervalDefinition,
  IntervalGroupNode,
  IntervalNode,
  IntervalRuntimeState,
  IntervalStepNode,
  QuickIntervalDraft,
  ResolvedIntervalStep,
} from '@/types/domain'

const safeAdd = (left: number, right: number) => Math.min(Number.MAX_SAFE_INTEGER, left + right)
const safeMultiply = (left: number, right: number) => Math.min(Number.MAX_SAFE_INTEGER, left * right)

export function createIntervalId() {
  return globalThis.crypto?.randomUUID?.() || `interval-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function createIntervalStep(
  name = '',
  kind: IntervalStepNode['kind'] = 'work',
  durationSeconds = 30,
): IntervalStepNode {
  return { id: createIntervalId(), type: 'step', name, kind, durationSeconds }
}

export function createIntervalGroup(name = '', repeatCount = 2): IntervalGroupNode {
  return { id: createIntervalId(), type: 'group', name, repeatCount, children: [] }
}

export function intervalNodeStepCount(node: IntervalNode): number {
  if (node.type === 'step') return 1
  const childCount = node.children.reduce((sum, child) => safeAdd(sum, intervalNodeStepCount(child)), 0)
  return safeMultiply(childCount, Math.max(0, Math.floor(node.repeatCount)))
}

export function intervalStepCount(definition: IntervalDefinition): number {
  return definition.children.reduce((sum, node) => safeAdd(sum, intervalNodeStepCount(node)), 0)
}

export function intervalNodeDuration(node: IntervalNode): number {
  if (node.type === 'step') return Math.max(0, node.durationSeconds)
  const childDuration = node.children.reduce((sum, child) => safeAdd(sum, intervalNodeDuration(child)), 0)
  return safeMultiply(childDuration, Math.max(0, Math.floor(node.repeatCount)))
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
    const iteration = Math.floor(index / childCount)
    return resolveInNodes(
      node.children,
      index % childCount,
      [...groups, { name: node.name || 'Group', iteration: iteration + 1, total: node.repeatCount }],
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

export function validateIntervalDefinition(definition: IntervalDefinition): string[] {
  const errors: string[] = []
  let timedSteps = 0

  function visit(nodes: IntervalNode[], location: string) {
    nodes.forEach((node, index) => {
      const path = `${location} ${index + 1}`
      if (node.type === 'step') {
        timedSteps += 1
        if (!node.name.trim()) errors.push(`${path} needs a name.`)
        if (!Number.isFinite(node.durationSeconds) || node.durationSeconds <= 0) {
          errors.push(`${path} needs a positive duration.`)
        }
        return
      }
      if (!Number.isInteger(node.repeatCount) || node.repeatCount <= 0) {
        errors.push(`${path} needs a positive whole-number repeat count.`)
      }
      if (!node.children.length) errors.push(`${path} cannot be empty.`)
      visit(node.children, `${path}, item`)
    })
  }

  visit(definition.children, 'Item')
  if (!timedSteps) errors.unshift('Add at least one timed interval.')
  return errors
}

export function createRuntimeState(definition: IntervalDefinition, now = new Date()): IntervalRuntimeState {
  const first = resolveIntervalStep(definition, 0)
  return {
    stepIndex: 0,
    remainingMs: (first?.step.durationSeconds || 0) * 1000,
    stepStartedAt: now.toISOString(),
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
    remainingMs = next.step.durationSeconds * 1000
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
