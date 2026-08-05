export type TaskType = 'check' | 'duration' | 'daily_total' | 'step_counter' | 'program' | 'interval' | 'flashcards'
export type StepSource = 'health_connect'
export type RecurrenceType = 'daily' | 'weekdays' | 'interval_weeks'
export type GoalPeriod = 'occurrence' | 'week'
export type TargetOperator = 'gte' | 'lte' | 'eq'
export type OccurrenceStatus = 'pending' | 'completed' | 'missed' | 'carried' | 'rescheduled'

export interface WeekDateMarker {
  date: string
  color: string
  label: string
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
  cycleLength?: number
  programRepeat?: boolean
  programStrict?: boolean
  entryNotesEnabled: boolean
  entryNoteSuggestionsEnabled: boolean
  sortOrder: number
  intervalTemplate?: string
  flashcardReviewSet?: string
}

export interface ProgramStep {
  id: string
  task: string
  name: string
  description: string
  sortOrder: number
  cycleDays: number[]
  completionType: 'check' | 'quantity' | 'interval' | 'flashcards'
  targetValue?: number
  targetOperator?: TargetOperator
  unit?: string
  customUnit?: string
  active: boolean
  intervalTemplate?: string
  flashcardReviewSet?: string
}

export interface Occurrence {
  id: string
  task: string
  programStep?: string
  scheduledDate: string
  status: OccurrenceStatus
  sealed: boolean
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
  createdAt: string
  value: number
  kind: 'duration' | 'quantity' | 'adjustment'
  unit: string
  note?: string
}

export interface TaskProgress {
  task: Task
  scheduledDate: string
  occurrence?: Occurrence
  value: number
  percent: number
  complete: boolean
  sealed?: boolean
  status: OccurrenceStatus
  programStep?: ProgramStep
  locked?: boolean
}

export interface ProgramStepDraft extends Omit<ProgramStep, 'id' | 'task'> {
  id?: string
}

export interface TaskDraft extends Omit<Task, 'id'> {
  id?: string
  steps: ProgramStepDraft[]
}

export type IntervalStepKind = 'train' | 'work' | 'rest' | 'prepare' | 'meditation' | 'confirmation' | 'custom'
export type IntervalSessionStatus = 'running' | 'paused' | 'completed' | 'ended'

export interface IntervalStepNode {
  id: string
  type: 'step'
  name: string
  kind: IntervalStepKind | ''
  durationSeconds: number
  color?: string
  skipOnLastRound?: boolean
}

export interface IntervalGroupNode {
  id: string
  type: 'group'
  name: string
  repeatCount: number
  children: IntervalNode[]
}

export type IntervalNode = IntervalStepNode | IntervalGroupNode

export interface IntervalGlobalRepetitionSettings {
  enabled: boolean
  defaultCount: number
}

export interface IntervalDefinition {
  version: 1
  children: IntervalNode[]
  globalRepetition?: IntervalGlobalRepetitionSettings
}

export interface IntervalCueSettings {
  soundEnabled: boolean
  vibrationEnabled: boolean
}

export interface IntervalFlashcardReviewSnapshot {
  reviewSet: string
  name: string
  tags: string[]
  sortMode: FlashcardReviewSort
  frontSeconds: number
  backSeconds: number
  speechEnabled: boolean
  frontLanguage: string
  backLanguage: string
  cards: FlashcardReviewQueueCard[]
}

export interface IntervalTemplate {
  id: string
  name: string
  description: string
  color: string
  flashcardReviewSet?: string
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
  task?: string
  programStep?: string
  taskDate: string
  source: 'template' | 'quick'
  status: IntervalSessionStatus
  name: string
  definition: IntervalDefinition
  cues: IntervalCueSettings
  flashcardReview?: IntervalFlashcardReviewSnapshot
  startedAt: string
  endedAt?: string
  note?: string
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

export interface QuickIntervalSettings extends QuickIntervalDraft {
  includeRest: boolean
}

export type FlashcardReviewMode = 'manual' | 'passive'
export type FlashcardReviewSide = 'front' | 'back'
export type FlashcardReviewSort = 'difficult' | 'never_reviewed' | 'least_recent' | 'recently_added' | 'random'
export type FlashcardReviewStatus = 'running' | 'paused' | 'completed' | 'ended'
export type FlashcardReviewOutcome = 'success' | 'error' | 'passive'
export type FlashcardReviewAction = 'success' | 'error' | 'view' | 'previous' | 'next' | 'push' | 'eject' | 'pause' | 'resume' | 'end'
export type FlashcardBulkAction = 'add_tags' | 'set_tags' | 'remove_tags' | 'clear_tags' | 'delete'

export interface FlashcardTag {
  id: string
  name: string
}

export interface Flashcard {
  id: string
  front: string
  back: string
  tags: string[]
  createdAt: string
  updatedAt: string
  lastReviewedAt?: string
  passiveViews: number
  successCount: number
  errorCount: number
}

export interface FlashcardDraft {
  id?: string
  front: string
  back: string
  tags: string[]
}

export interface FlashcardImportRow {
  front: string
  back: string
  tags: string[]
}

export interface FlashcardCsvParseResult {
  rows: FlashcardImportRow[]
  errors: string[]
}

export interface FlashcardReviewSet {
  id: string
  name: string
  tags: string[]
  mode: FlashcardReviewMode
  frontSeconds: number
  backSeconds: number
  speechEnabled: boolean
  frontLanguage: string
  backLanguage: string
  sortMode: FlashcardReviewSort
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface FlashcardReviewSetDraft extends Omit<FlashcardReviewSet, 'id' | 'createdAt' | 'updatedAt'> {
  id?: string
}

export interface FlashcardReviewQueueCard {
  id: string
  front: string
  back: string
  tags: string[]
}

export interface FlashcardReviewSession {
  id: string
  reviewSet?: string
  status: FlashcardReviewStatus
  name: string
  mode: FlashcardReviewMode
  sortMode: FlashcardReviewSort
  tags: string[]
  frontSeconds: number
  backSeconds: number
  speechEnabled: boolean
  frontLanguage: string
  backLanguage: string
  queue: FlashcardReviewQueueCard[]
  startedAt: string
  endedAt?: string
  updatedAt: string
  elapsedSeconds: number
  totalCards: number
  viewedCount: number
  successCount: number
  errorCount: number
  ejectedCount: number
  task?: string
  programStep?: string
  taskDate?: string
}

export interface FlashcardSpeechLanguage {
  tag: string
  title: string
}

export interface FlashcardSpeechSupport {
  available: boolean
  languages: FlashcardSpeechLanguage[]
}

export interface BackgroundFlashcardReviewState {
  sessionId: string
  running: boolean
  finished: boolean
  completedCards: number
  side: FlashcardReviewSide
  remainingMs: number
  elapsedMs: number
}

export interface FlashcardReviewEvent {
  id: string
  session: string
  card?: string
  outcome: FlashcardReviewOutcome
  reviewedAt: string
  front: string
  back: string
  tags: string[]
}

export type TrackerRole = 'factor' | 'outcome'
export type TrackerKind = 'yes_no' | 'event' | 'number' | 'rating' | 'duration'
export type TrackerCategory = 'mindfulness' | 'medication' | 'nutrition' | 'mood' | 'symptom' | 'sleep' | 'activity' | 'other'
export type DailyAggregation = 'last' | 'average' | 'sum' | 'count'
export type FavorableDirection = 'higher' | 'lower' | 'neutral'

export interface TrackingTracker {
  id: string
  name: string
  description: string
  role: TrackerRole
  kind: TrackerKind
  category: TrackerCategory
  unit: string
  scaleMin: number
  scaleMax: number
  favorableDirection: FavorableDirection
  dailyAggregation: DailyAggregation
  active: boolean
  sortOrder: number
  color: string
  icon: string
  reminderEnabled: boolean
  reminderTime: string
  reminderShowName: boolean
}

export interface TrackingTrackerDraft extends Omit<TrackingTracker, 'id'> {
  id?: string
}

export interface TrackingEntry {
  id: string
  tracker: string
  occurredAt: string
  localDate: string
  timezoneOffset: number
  value: number
  note: string
}

export interface TrackingEntryDraft extends Omit<TrackingEntry, 'id'> {
  id?: string
}

export interface JournalEntry {
  id: string
  title: string
  body: string
  occurredAt: string
  localDate: string
  timezoneOffset: number
  task?: string
  tracker?: string
  taskSnapshot: string
  trackerSnapshot: string
  createdAt: string
  updatedAt: string
}

export interface JournalEntryDraft {
  id?: string
  title: string
  body: string
  occurredAt: string
  localDate: string
  timezoneOffset: number
  task?: string
  tracker?: string
}

export type TrackingSourceKind = 'tracker' | 'task' | 'interval'
export type TrackingFactorMode = 'presence' | 'quantity'

export interface TrackingAnalysisSource {
  id: string
  source: TrackingSourceKind
  name: string
  role: TrackerRole
  favorableDirection: FavorableDirection
  unit: string
  color: string
  factorMode: TrackingFactorMode
  scaleMin?: number
  scaleMax?: number
}

export interface TrackingDailyValue {
  date: string
  value: number
}

export interface TrackingInsightPoint {
  date: string
  factorValue: number | null
  outcomeValue: number | null
}

export interface TrackingRelationshipPoint {
  date: string
  factorValue: number
  outcomeValue: number
}
