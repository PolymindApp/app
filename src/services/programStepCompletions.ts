import { createLocalRecordId } from '@/lib/localDatabase'
import type {
  ProgramStepCompletion,
  ProgramStepCompletionType,
  TargetOperator,
} from '@/types/domain'

const COMPLETION_TYPES = new Set<ProgramStepCompletionType>([
  'check',
  'quantity',
  'interval',
  'flashcards',
])

export function createProgramStepCompletion(
  type: ProgramStepCompletionType = 'check',
): ProgramStepCompletion {
  return {
    id: createLocalRecordId(),
    type,
    targetValue: type === 'quantity' ? 1 : undefined,
    targetOperator: type === 'quantity' ? 'gte' : undefined,
    unit: type === 'quantity' ? 'count' : undefined,
  }
}

function normalizedCompletion(value: unknown): ProgramStepCompletion | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const type = record.type
  if (typeof type !== 'string' || !COMPLETION_TYPES.has(type as ProgramStepCompletionType)) {
    return undefined
  }
  const id = typeof record.id === 'string' && record.id ? record.id : createLocalRecordId()
  const completion: ProgramStepCompletion = { id, type: type as ProgramStepCompletionType }
  if (completion.type === 'quantity') {
    completion.targetValue = Number(record.targetValue ?? record.target_value ?? 0)
    completion.targetOperator = String(
      record.targetOperator ?? record.target_operator ?? 'gte',
    ) as TargetOperator
    completion.unit = String(record.unit || 'count')
    completion.customUnit = String(record.customUnit ?? record.custom_unit ?? '') || undefined
  } else if (completion.type === 'interval') {
    completion.intervalTemplate = String(
      record.intervalTemplate ?? record.interval_template ?? '',
    ) || undefined
  } else if (completion.type === 'flashcards') {
    completion.flashcardReviewSet = String(
      record.flashcardReviewSet ?? record.flashcard_review_set ?? '',
    ) || undefined
  }
  return completion
}

export function normalizeProgramStepCompletions(record: Record<string, any>) {
  const stored = Array.isArray(record.completions)
    ? record.completions.map(normalizedCompletion).filter(Boolean) as ProgramStepCompletion[]
    : []
  if (stored.length || record.completion_type === 'day_off') return stored

  const legacy = normalizedCompletion({
    id: 'completion-legacy',
    type: record.completion_type || 'check',
    target_value: record.target_value,
    target_operator: record.target_operator,
    unit: record.unit,
    custom_unit: record.custom_unit,
    interval_template: record.interval_template,
    flashcard_review_set: record.flashcard_review_set,
  })
  return legacy ? [legacy] : []
}

export function programStepCompletionPayload(completions: ProgramStepCompletion[]) {
  return completions.map((completion) => ({
    id: completion.id,
    type: completion.type,
    ...(completion.type === 'quantity' ? {
      targetValue: completion.targetValue ?? 0,
      targetOperator: completion.targetOperator || 'gte',
      unit: completion.unit || '',
      customUnit: completion.customUnit || '',
    } : {}),
    ...(completion.type === 'interval' ? {
      intervalTemplate: completion.intervalTemplate || '',
    } : {}),
    ...(completion.type === 'flashcards' ? {
      flashcardReviewSet: completion.flashcardReviewSet || '',
    } : {}),
  }))
}

export function programStepPrimaryCompletion(completions: ProgramStepCompletion[]) {
  return completions[0]
}
