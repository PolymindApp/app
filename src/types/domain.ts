export type TaskType = 'check' | 'duration' | 'daily_total' | 'step_counter' | 'program' | 'interval' | 'flashcards' | 'tracking' | 'journal'
export type StepSource = 'health_connect'

export interface ChatGPTConnectionStatus {
  available: boolean
  connected: boolean
  pending?: boolean
  email?: string
  planType?: string
  verificationUrl?: string
  userCode?: string
  loginError?: string
}

export type RecurrenceType = 'daily' | 'weekdays' | 'interval_weeks'
export type GoalPeriod = 'occurrence' | 'week'
export type TargetOperator = 'gte' | 'lte' | 'eq'
export type OccurrenceStatus = 'pending' | 'completed' | 'missed' | 'carried' | 'rescheduled'
export type SessionCountMode = 'task' | 'linked'
export type SessionGoalType = 'complete' | 'duration'

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
  sessionCountMode?: SessionCountMode
  sessionGoalType?: SessionGoalType
  sessionTargetSeconds?: number
  trackingTrackers?: string[]
  reminderEnabled: boolean
  reminderTimes: string[]
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
  sourceType?: 'interval' | 'flashcards'
  sourceSession?: string
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
export type IntervalCueSound =
  | 'cash'
  | 'celestial'
  | 'chime'
  | 'cine-boom'
  | 'cine-hit'
  | 'confirm'
  | 'gong'
  | 'harp'
  | 'magic'
  | 'notification'
  | 'go'
  | 'complete'
  | 'count'
  | 'none'
export type IntervalTypeSoundSettings = Record<IntervalStepKind, IntervalCueSound>

export interface IntervalStepNode {
  id: string
  type: 'step'
  name: string
  kind: IntervalStepKind | ''
  durationSeconds: number
  color?: string
  skipOnLastRound?: boolean
  flashcardReviewEnabled?: boolean
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
  typeSounds?: IntervalTypeSoundSettings
}

export interface IntervalFlashcardReviewSnapshot {
  reviewSet: string
  name: string
  tags: string[]
  sortMode: FlashcardReviewSort
  cardSides: FlashcardReviewCardSides
  frontSeconds: number
  backSeconds: number
  backSpeechRepeatCount: number
  noteBeforeBack: boolean
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
export type FlashcardReviewCardSides = 'both' | FlashcardReviewSide
export type FlashcardReviewSort = 'difficult' | 'never_reviewed' | 'least_recent' | 'recently_added' | 'random'
export type FlashcardReviewStatus = 'running' | 'paused' | 'completed' | 'ended'
export type FlashcardReviewOutcome = 'success' | 'error' | 'passive' | 'ejected'
export type FlashcardReviewAction = 'success' | 'error' | 'view' | 'previous' | 'next' | 'push' | 'eject' | 'undo_eject' | 'pause' | 'resume' | 'restart' | 'end'
export type FlashcardContextAction = 'add' | 'edit' | 'eject' | 'undo_eject' | 'remove' | 'settings'
export type RunnerSessionAction = 'options' | 'amplification' | 'eject' | 'restart' | 'end'

export interface RunnerSessionMenuItem {
  action: RunnerSessionAction
  title: string
  icon: string
  color?: string
  active?: boolean
  disabled?: boolean
  divider?: boolean
  toggle?: boolean
}

export type FlashcardBulkAction =
  | 'assign_images'
  | 'swap_front_back'
  | 'swap_note_back'
  | 'add_tags'
  | 'set_tags'
  | 'remove_tags'
  | 'clear_tags'
  | 'delete'
export type FlashcardBulkRecordAction = Exclude<FlashcardBulkAction, 'assign_images'>
export type FlashcardReviewSetAccessRole = 'owner' | 'readonly' | 'editor'
export type SquareImageSource = 'none' | 'url' | 'upload' | 'library'

export interface ImageLibraryConcept {
  id: number
  name: string
  partOfSpeech: string
  definition: string
}

export interface ImageLibraryAsset {
  id: number
  imageUrl: string
  alt: string
  photographer: string
  photographerUrl: string
  sourceUrl: string
  licenseName: string
  licenseUrl: string
  concept?: ImageLibraryConcept
}

export interface SquareImageSourceValue {
  source: SquareImageSource
  url: string
  existingUrl: string
  existingSource: SquareImageSource
  existingLibraryImageId?: number
  upload?: Blob
  libraryImage?: ImageLibraryAsset
}

export interface FlashcardTag {
  id: string
  name: string
}

export interface Flashcard {
  id: string
  front: string
  back: string
  note: string
  image: string
  imageSource: SquareImageSource
  libraryImage?: ImageLibraryAsset
  tags: string[]
  tagDetails?: FlashcardTag[]
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
  note: string
  tags: string[]
}

export interface FlashcardImportRow {
  front: string
  back: string
  note: string
  tags: string[]
}

export interface FlashcardCsvParseResult {
  rows: FlashcardImportRow[]
  errors: string[]
}

export interface FlashcardReviewSettings {
  mode: FlashcardReviewMode
  cardSides: FlashcardReviewCardSides
  indefinite: boolean
  maxCards: number
  frontSeconds: number
  backSeconds: number
  backSpeechRepeatCount: number
  noteBeforeBack: boolean
  speechEnabled: boolean
  frontLanguage: string
  backLanguage: string
  sortMode: FlashcardReviewSort
}

export interface FlashcardReviewSet extends FlashcardReviewSettings {
  id: string
  name: string
  tags: string[]
  tagDetails: FlashcardTag[]
  owner: string
  ownerName: string
  ownerAvatar: string
  accessRole: FlashcardReviewSetAccessRole
  shareId?: string
  matchingCardCount: number
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface FlashcardReviewSetDraft extends Omit<
  FlashcardReviewSet,
  | 'id'
  | 'createdAt'
  | 'updatedAt'
  | 'tagDetails'
  | 'owner'
  | 'ownerName'
  | 'ownerAvatar'
  | 'accessRole'
  | 'shareId'
  | 'matchingCardCount'
> {
  id?: string
}

export interface FlashcardReviewSetShare {
  id: string
  reviewSet: string
  role: Exclude<FlashcardReviewSetAccessRole, 'owner'>
  email: string
  createdAt: string
  updatedAt: string
}

export type FlashcardReviewSetAction =
  | 'review'
  | 'edit'
  | 'settings'
  | 'cards'
  | 'share'
  | 'copy'
  | 'leave'

export interface FlashcardReviewSetActionItem {
  action: FlashcardReviewSetAction
  title: string
  icon: string
  color?: string
  divider?: boolean
}

export interface FlashcardReviewQueueCard {
  id: string
  front: string
  back: string
  note: string
  image: string
  tags: string[]
}

export interface FlashcardReviewSession extends FlashcardReviewSettings {
  id: string
  reviewSet?: string
  status: FlashcardReviewStatus
  name: string
  tags: string[]
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
}

export interface TrackingTaskTracker extends Pick<TrackingTracker, 'id' | 'name' | 'kind' | 'icon' | 'color'> {
  logged: boolean
  loggedValue?: string
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
  trackers: string[]
  taskSnapshot: string
  trackerSnapshots: Record<string, string>
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
  trackers: string[]
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
