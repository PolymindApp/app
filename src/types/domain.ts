export type TaskType = 'check' | 'duration' | 'daily_total' | 'program'
export type RecurrenceType = 'daily' | 'weekdays' | 'interval_weeks'
export type GoalPeriod = 'occurrence' | 'week'
export type TargetOperator = 'gte' | 'lte' | 'eq'
export type OccurrenceStatus = 'pending' | 'completed' | 'missed' | 'carried' | 'rescheduled'

export interface Area {
  id: string
  name: string
  color: string
  icon: string
}

export interface Tag {
  id: string
  name: string
}

export interface Task {
  id: string
  name: string
  description: string
  type: TaskType
  area?: string
  areaName?: string
  areaColor?: string
  color?: string
  mandatory: boolean
  reviewWhenMissed: boolean
  active: boolean
  startDate: string
  endDate?: string
  recurrenceType: RecurrenceType
  weekdays: number[]
  intervalWeeks: number
  targetValue?: number
  targetOperator?: TargetOperator
  unit?: string
  customUnit?: string
  goalPeriod?: GoalPeriod
  quickAmounts: number[]
  cycleLength?: number
  programRepeat?: boolean
  programStrict?: boolean
  sortOrder: number
}

export interface ProgramStep {
  id: string
  task: string
  name: string
  description: string
  sortOrder: number
  cycleDays: number[]
  completionType: 'check' | 'quantity'
  targetValue?: number
  targetOperator?: TargetOperator
  unit?: string
  customUnit?: string
  quickAmounts: number[]
  active: boolean
}

export interface Occurrence {
  id: string
  task: string
  programStep?: string
  scheduledDate: string
  status: OccurrenceStatus
  completedAt?: string
  snapshotName: string
  snapshotTarget?: number
  snapshotUnit?: string
}

export interface Entry {
  id: string
  task: string
  occurrence?: string
  programStep?: string
  entryDate: string
  value: number
  kind: 'duration' | 'quantity' | 'adjustment'
  unit: string
  note?: string
}

export interface TaskProgress {
  task: Task
  occurrence?: Occurrence
  value: number
  percent: number
  complete: boolean
  status: OccurrenceStatus
  programStep?: ProgramStep
  locked?: boolean
}

export interface ProgramStepDraft extends Omit<ProgramStep, 'id' | 'task'> {
  id?: string
}

export interface TaskDraft extends Omit<Task, 'id' | 'areaName' | 'areaColor'> {
  id?: string
  steps: ProgramStepDraft[]
}

export type IntervalStepKind = 'work' | 'rest' | 'prepare' | 'meditation' | 'custom'
export type IntervalCueSound = 'beep' | 'bell' | 'soft'
export type IntervalSessionStatus = 'running' | 'paused' | 'completed' | 'ended'

export interface IntervalStepNode {
  id: string
  type: 'step'
  name: string
  kind: IntervalStepKind
  durationSeconds: number
  color?: string
}

export interface IntervalGroupNode {
  id: string
  type: 'group'
  name: string
  repeatCount: number
  children: IntervalNode[]
}

export type IntervalNode = IntervalStepNode | IntervalGroupNode

export interface IntervalDefinition {
  version: 1
  children: IntervalNode[]
}

export interface IntervalCueSettings {
  soundEnabled: boolean
  vibrationEnabled: boolean
  sound: IntervalCueSound
}

export interface IntervalTemplate {
  id: string
  name: string
  description: string
  color: string
  definition: IntervalDefinition
  cues: IntervalCueSettings
  sortOrder: number
}

export interface IntervalTemplateDraft extends Omit<IntervalTemplate, 'id'> {
  id?: string
}

export interface IntervalRuntimeState {
  stepIndex: number
  remainingMs: number
  stepStartedAt?: string
  accumulatedMs: number
  updatedAt: string
}

export interface IntervalSession {
  id: string
  template?: string
  source: 'template' | 'quick'
  status: IntervalSessionStatus
  name: string
  definition: IntervalDefinition
  cues: IntervalCueSettings
  startedAt: string
  endedAt?: string
  plannedSeconds: number
  elapsedSeconds: number
  runtime: IntervalRuntimeState
  updated: string
}

export interface ResolvedIntervalStep {
  step: IntervalStepNode
  index: number
  totalSteps: number
  groups: Array<{ name: string; iteration: number; total: number }>
}

export interface QuickIntervalDraft {
  warmupSeconds: number
  workSeconds: number
  restSeconds: number
  rounds: number
  cooldownSeconds: number
  restAfterLastRound: boolean
  cues: IntervalCueSettings
}
