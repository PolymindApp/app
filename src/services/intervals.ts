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
const GLOBAL_REPETITION_GROUP_ID = 'interval-global-repetition'
export const MIN_GLOBAL_REPETITIONS = 1
export const MAX_GLOBAL_REPETITIONS = 15
export const INTERVAL_FLASHCARD_REVIEW_EDGE_PAUSE_MS = 4_000

function clampGlobalRepetitions(value: number) {
  return Math.min(
    MAX_GLOBAL_REPETITIONS,
    Math.max(MIN_GLOBAL_REPETITIONS, Math.round(Number(value) || MIN_GLOBAL_REPETITIONS)),
  )
}

export function intervalGlobalRepetitionSettings(definition: IntervalDefinition) {
  return {
    enabled: definition.globalRepetition?.enabled === true,
    defaultCount: clampGlobalRepetitions(
      definition.globalRepetition?.defaultCount ?? MIN_GLOBAL_REPETITIONS,
    ),
  }
}

export function intervalDefinitionWithRepetitions(
  definition: IntervalDefinition,
  repetitions: number,
): IntervalDefinition {
  const settings = intervalGlobalRepetitionSettings(definition)
  return {
    ...definition,
    globalRepetition: {
      enabled: settings.enabled,
      defaultCount: clampGlobalRepetitions(repetitions),
    },
  }
}

function intervalRootNodes(definition: IntervalDefinition): IntervalNode[] {
  const settings = intervalGlobalRepetitionSettings(definition)
  if (!settings.enabled) return definition.children
  return [{
    id: GLOBAL_REPETITION_GROUP_ID,
    type: 'group',
    name: 'Repetitions',
    repeatCount: settings.defaultCount,
    children: definition.children,
  }]
}

export function intervalStepDurationSeconds(step: IntervalStepNode) {
  if (step.kind === 'confirmation') return 0
  return Number.isFinite(step.durationSeconds) ? Math.max(0, step.durationSeconds) : 0
}

export function intervalStepPlaysFlashcardReviewByDefault(kind: IntervalStepNode['kind']) {
  return !['train', 'prepare', 'meditation', 'confirmation'].includes(kind)
}

export function intervalStepPlaysFlashcardReview(step: IntervalStepNode) {
  if (typeof step.flashcardReviewEnabled === 'boolean') return step.flashcardReviewEnabled
  return intervalStepPlaysFlashcardReviewByDefault(step.kind)
}

function intervalStepFlashcardReviewDurationSeconds(step: IntervalStepNode) {
  if (!intervalStepPlaysFlashcardReview(step)) return 0
  return Math.max(
    0,
    intervalStepDurationSeconds(step) - ((INTERVAL_FLASHCARD_REVIEW_EDGE_PAUSE_MS * 2) / 1000),
  )
}

function normalizedIntervalStepRemainingMs(step: IntervalStepNode, remainingMs: number) {
  const durationMs = intervalStepDurationSeconds(step) * 1000
  const safeRemainingMs = Number.isFinite(remainingMs) ? remainingMs : durationMs
  return Math.min(durationMs, Math.max(0, safeRemainingMs))
}

export function intervalStepFlashcardReviewPlaybackIsActive(
  step: IntervalStepNode,
  remainingMs: number,
) {
  if (!intervalStepPlaysFlashcardReview(step)) return false
  const durationMs = intervalStepDurationSeconds(step) * 1000
  const normalizedRemainingMs = normalizedIntervalStepRemainingMs(step, remainingMs)
  const elapsedMs = durationMs - normalizedRemainingMs
  return elapsedMs >= INTERVAL_FLASHCARD_REVIEW_EDGE_PAUSE_MS
    && normalizedRemainingMs > INTERVAL_FLASHCARD_REVIEW_EDGE_PAUSE_MS
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

interface IntervalNodeLocation {
  nodes: IntervalNode[]
  index: number
}

function findIntervalNodeLocation(
  nodes: IntervalNode[],
  id: string,
): IntervalNodeLocation | undefined {
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]
    if (!node) continue
    if (node.id === id) return { nodes, index }
    if (node.type === 'group') {
      const nested = findIntervalNodeLocation(node.children, id)
      if (nested) return nested
    }
  }
  return undefined
}

export function moveIntervalNodeToGroup(
  definition: IntervalDefinition,
  nodeId: string,
  targetGroupId: string | undefined,
  orderedIds: string[],
) {
  const source = findIntervalNodeLocation(definition.children, nodeId)
  const node = source?.nodes[source.index]
  if (!source || !node) return false

  let targetNodes = definition.children
  if (targetGroupId) {
    if (
      node.type === 'group'
      && (
        targetGroupId === node.id
        || Boolean(findIntervalNodeLocation(node.children, targetGroupId))
      )
    ) return false
    const targetLocation = findIntervalNodeLocation(definition.children, targetGroupId)
    const targetGroup = targetLocation?.nodes[targetLocation.index]
    if (!targetGroup || targetGroup.type !== 'group') return false
    targetNodes = targetGroup.children
  }

  source.nodes.splice(source.index, 1)
  const expectedNodes = [...targetNodes, node]
  const nodesById = new Map(expectedNodes.map((item) => [item.id, item]))
  const ordered = orderedIds
    .map((id) => nodesById.get(id))
    .filter((item): item is IntervalNode => Boolean(item))
  if (
    ordered.length !== expectedNodes.length
    || new Set(orderedIds).size !== expectedNodes.length
  ) {
    source.nodes.splice(source.index, 0, node)
    return false
  }

  targetNodes.splice(0, targetNodes.length, ...ordered)
  return true
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
    flashcardReviewSet: template.flashcardReviewSet,
    definition: {
      version: template.definition.version,
      children: template.definition.children.map(cloneIntervalNode),
      globalRepetition: intervalGlobalRepetitionSettings(template.definition),
    },
    cues: { ...template.cues },
    sortOrder: template.sortOrder,
  }
}

export function duplicateIntervalTemplateDraft(
  template: IntervalTemplate,
  sortOrder: number,
): IntervalTemplateDraft {
  const draft = cloneIntervalTemplateDraft(template)
  return {
    ...draft,
    id: undefined,
    name: `${draft.name} copy`,
    sortOrder,
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
  return intervalRootNodes(definition)
    .reduce((sum, node) => safeAdd(sum, intervalNodeStepCount(node)), 0)
}

export function intervalNodeDuration(node: IntervalNode): number {
  if (node.type === 'step') return intervalStepDurationSeconds(node)
  const childDuration = node.children.reduce((sum, child) => safeAdd(sum, intervalNodeDuration(child)), 0)
  const total = safeMultiply(childDuration, Math.max(0, Math.floor(node.repeatCount)))
  const skippedStep = skippedLastRoundStep(node)
  return skippedStep ? Math.max(0, total - intervalStepDurationSeconds(skippedStep)) : total
}

function intervalNodeFlashcardReviewDuration(node: IntervalNode): number {
  if (node.type === 'step') {
    return intervalStepFlashcardReviewDurationSeconds(node)
  }
  const childDuration = node.children.reduce(
    (sum, child) => safeAdd(sum, intervalNodeFlashcardReviewDuration(child)),
    0,
  )
  const total = safeMultiply(childDuration, Math.max(0, Math.floor(node.repeatCount)))
  const skippedStep = skippedLastRoundStep(node)
  return skippedStep
    ? Math.max(0, total - intervalNodeFlashcardReviewDuration(skippedStep))
    : total
}

export function intervalDuration(definition: IntervalDefinition): number {
  return intervalRootNodes(definition)
    .reduce((sum, node) => safeAdd(sum, intervalNodeDuration(node)), 0)
}

interface IntervalFlashcardReviewContext {
  step: IntervalStepNode
  elapsedBeforeSeconds: number
}

function resolveIntervalFlashcardReviewContext(
  nodes: IntervalNode[],
  requestedIndex: number,
  elapsedBeforeSeconds: number,
): IntervalFlashcardReviewContext | undefined {
  let index = requestedIndex
  let elapsed = elapsedBeforeSeconds

  for (const node of nodes) {
    const count = intervalNodeStepCount(node)
    if (index >= count) {
      index -= count
      elapsed = safeAdd(elapsed, intervalNodeFlashcardReviewDuration(node))
      continue
    }
    if (node.type === 'step') return { step: node, elapsedBeforeSeconds: elapsed }

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
      (sum, child) => safeAdd(sum, intervalNodeFlashcardReviewDuration(child)),
      0,
    )

    return resolveIntervalFlashcardReviewContext(
      node.children,
      childIndex,
      safeAdd(elapsed, safeMultiply(childDuration, iteration)),
    )
  }

  return undefined
}

export function intervalFlashcardReviewElapsedMs(
  definition: IntervalDefinition,
  stepIndex: number,
  remainingMs: number,
) {
  const roots = intervalRootNodes(definition)
  const context = resolveIntervalFlashcardReviewContext(roots, stepIndex, 0)
  if (!context) {
    if (stepIndex < intervalStepCount(definition)) return 0
    return roots.reduce(
      (sum, node) => safeAdd(sum, intervalNodeFlashcardReviewDuration(node) * 1000),
      0,
    )
  }

  const elapsedBeforeMs = context.elapsedBeforeSeconds * 1000
  if (!intervalStepPlaysFlashcardReview(context.step)) return elapsedBeforeMs
  const durationMs = intervalStepDurationSeconds(context.step) * 1000
  const reviewDurationMs = intervalStepFlashcardReviewDurationSeconds(context.step) * 1000
  const elapsedInStep = Math.min(
    reviewDurationMs,
    Math.max(
      0,
      durationMs
        - normalizedIntervalStepRemainingMs(context.step, remainingMs)
        - INTERVAL_FLASHCARD_REVIEW_EDGE_PAUSE_MS,
    ),
  )
  return safeAdd(elapsedBeforeMs, elapsedInStep)
}

export function completedIntervalFlashcardReviewSeconds(
  definition: IntervalDefinition,
  runtime: Pick<IntervalRuntimeState, 'stepIndex' | 'remainingMs' | 'flashcardReviewAccumulatedMs'>,
  elapsedSeconds: number,
) {
  const measuredReviewMs = runtime.flashcardReviewAccumulatedMs
  const reviewSeconds = Number.isFinite(measuredReviewMs)
    ? Math.round(Math.max(0, measuredReviewMs!) / 1000)
    : Math.round(intervalFlashcardReviewElapsedMs(
        definition,
        runtime.stepIndex,
        runtime.remainingMs,
      ) / 1000)
  return Math.min(
    Math.max(0, Math.round(Number(elapsedSeconds) || 0)),
    Math.max(0, reviewSeconds),
  )
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
  const resolved = resolveInNodes(intervalRootNodes(definition), index, [])
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
  const context = resolveIntervalProgressContext(intervalRootNodes(definition), stepIndex, 0, [])
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

  if (
    definition.globalRepetition?.enabled
    && (
      !Number.isInteger(definition.globalRepetition.defaultCount)
      || definition.globalRepetition.defaultCount < MIN_GLOBAL_REPETITIONS
      || definition.globalRepetition.defaultCount > MAX_GLOBAL_REPETITIONS
    )
  ) {
    errors.push(
      `Default repetitions must be from ${MIN_GLOBAL_REPETITIONS} to ${MAX_GLOBAL_REPETITIONS}.`,
    )
  }

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
    flashcardReviewAccumulatedMs: 0,
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
  const startingReviewElapsedMs = intervalFlashcardReviewElapsedMs(
    definition,
    runtime.stepIndex,
    runtime.remainingMs,
  )
  const reviewAccumulatedMs = Number.isFinite(runtime.flashcardReviewAccumulatedMs)
    ? Math.max(0, runtime.flashcardReviewAccumulatedMs!)
    : startingReviewElapsedMs
  let remainingMs = runtime.remainingMs
  let stepIndex = runtime.stepIndex
  let transitions = 0

  while (elapsedMs >= remainingMs && resolveIntervalStep(definition, stepIndex)) {
    elapsedMs -= remainingMs
    stepIndex += 1
    transitions += 1
    const next = resolveIntervalStep(definition, stepIndex)
    if (!next) {
      const endingReviewElapsedMs = intervalFlashcardReviewElapsedMs(definition, stepIndex, 0)
      return {
        runtime: {
          stepIndex,
          remainingMs: 0,
          accumulatedMs: runtime.accumulatedMs + (activeElapsed - elapsedMs),
          flashcardReviewAccumulatedMs: safeAdd(
            reviewAccumulatedMs,
            Math.max(0, endingReviewElapsedMs - startingReviewElapsedMs),
          ),
          updatedAt: now.toISOString(),
        },
        completed: true,
        transitions,
      }
    }
    if (next.step.kind === 'confirmation') {
      const endingReviewElapsedMs = intervalFlashcardReviewElapsedMs(definition, stepIndex, 0)
      return {
        runtime: {
          stepIndex,
          remainingMs: 0,
          stepStartedAt: undefined,
          accumulatedMs: runtime.accumulatedMs + (activeElapsed - elapsedMs),
          flashcardReviewAccumulatedMs: safeAdd(
            reviewAccumulatedMs,
            Math.max(0, endingReviewElapsedMs - startingReviewElapsedMs),
          ),
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
      flashcardReviewAccumulatedMs: safeAdd(
        reviewAccumulatedMs,
        Math.max(
          0,
          intervalFlashcardReviewElapsedMs(definition, stepIndex, Math.max(0, remainingMs - elapsedMs))
            - startingReviewElapsedMs,
        ),
      ),
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
