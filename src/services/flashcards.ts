import type {
  Flashcard,
  FlashcardBulkAction,
  FlashcardReviewSession,
  FlashcardReviewSet,
  FlashcardReviewCardSides,
  FlashcardReviewSettings,
  FlashcardReviewSide,
  FlashcardReviewSort,
  FlashcardSelectionAction,
  FlashcardSettingsApplyTarget,
  IntervalFlashcardReviewSnapshot,
} from '@/types/domain'

export const MIN_FLASHCARD_SESSION_CARDS = 1
export const MAX_FLASHCARD_SESSION_CARDS = 100
export const DEFAULT_FLASHCARD_SESSION_CARDS = 20
export const MIN_FLASHCARD_BACK_SPEECH_REPEATS = 1
export const MAX_FLASHCARD_BACK_SPEECH_REPEATS = 5
export const DEFAULT_FLASHCARD_BACK_SPEECH_REPEATS = 1
export const DEFAULT_FLASHCARD_REVIEW_CARD_SIDES: FlashcardReviewCardSides = 'both'

export const INTERVAL_FLASHCARD_QUICK_TAGS = [
  { name: 'easy', color: 'success' },
  { name: 'hard', color: 'error' },
] as const

export const FLASHCARD_REVIEW_CARD_SIDE_OPTIONS: Array<{
  title: string
  value: FlashcardReviewCardSides
  icon: string
  hint: string
}> = [
  {
    title: 'Both',
    value: 'both',
    icon: 'mdi-card-multiple-outline',
    hint: 'Show the front first, then the back.',
  },
  {
    title: 'Front',
    value: 'front',
    icon: 'mdi-card-outline',
    hint: 'Show only the front of each card.',
  },
  {
    title: 'Back',
    value: 'back',
    icon: 'mdi-card-text-outline',
    hint: 'Show only the back of each card.',
  },
]

export const FLASHCARD_REVIEW_SESSION_MENU_ITEMS = [
  { action: 'add', title: 'Add card', icon: 'mdi-card-plus-outline', permission: 'add' },
  { action: 'edit', title: 'Edit card', icon: 'mdi-pencil-outline', permission: 'manage' },
  {
    action: 'eject',
    title: 'Eject card',
    icon: 'mdi-eject-outline',
    color: 'warning',
    permission: 'eject',
  },
  {
    action: 'undo_eject',
    title: 'Undo last eject',
    icon: 'mdi-undo-variant',
    permission: 'undo_eject',
  },
  {
    action: 'remove',
    title: 'Remove card',
    icon: 'mdi-delete-outline',
    color: 'error',
    permission: 'manage',
  },
  {
    action: 'settings',
    title: 'Settings',
    icon: 'mdi-tune-variant',
    divider: true,
  },
] as const

export function flashcardReviewSessionMenuItems(options: {
  showUndoEject: boolean
  showTtsToggle: boolean
  ttsPaused: boolean
}) {
  const settingsItem = FLASHCARD_REVIEW_SESSION_MENU_ITEMS.find(item => item.action === 'settings')!
  const cardItems = FLASHCARD_REVIEW_SESSION_MENU_ITEMS.filter(item => (
    item.action !== 'settings'
    && (item.action !== 'undo_eject' || options.showUndoEject)
  ))

  return [
    ...cardItems,
    ...(options.showTtsToggle ? [{
      action: 'toggle_tts' as const,
      title: options.ttsPaused ? 'Resume' : 'Pause',
      icon: options.ttsPaused ? 'mdi-play-circle-outline' : 'mdi-pause-circle-outline',
      divider: true,
    }] : []),
    {
      ...settingsItem,
      divider: !options.showTtsToggle,
    },
  ]
}

export const FLASHCARD_SETTINGS_APPLY_MENU_ITEMS: Array<{
  target: FlashcardSettingsApplyTarget
  title: string
  icon: string
}> = [
  { target: 'session', title: 'Current session', icon: 'mdi-timer-outline' },
  { target: 'review-set', title: 'Review set', icon: 'mdi-cards-outline' },
]

export const FLASHCARD_REVIEW_SELECTION_MENU_ITEMS = [
  {
    action: 'exclude',
    title: 'Exclude',
    icon: 'mdi-minus-circle-outline',
    color: 'warning',
  },
  {
    action: 'include',
    title: 'Include',
    icon: 'mdi-check-circle-outline',
    color: 'success',
  },
] as const

export function updateFlashcardReviewExclusions(
  excludedCards: readonly string[],
  action: FlashcardSelectionAction,
  cardIds: readonly string[],
) {
  const exclusions = new Set(excludedCards)
  cardIds.forEach(id => action === 'exclude' ? exclusions.add(id) : exclusions.delete(id))
  return [...exclusions]
}

export function flashcardReviewSettingsSignature(settings: FlashcardReviewSettings) {
  return JSON.stringify({
    mode: settings.mode,
    cardSides: settings.cardSides,
    indefinite: settings.indefinite,
    maxCards: settings.maxCards,
    frontSeconds: settings.frontSeconds,
    backSeconds: settings.backSeconds,
    backSpeechRepeatCount: settings.backSpeechRepeatCount,
    noteBeforeBack: settings.noteBeforeBack,
    speechEnabled: settings.speechEnabled,
    frontLanguage: settings.frontLanguage,
    backLanguage: settings.backLanguage,
    sortMode: settings.sortMode,
  })
}

export function flashcardReviewSettingsAreValid(
  settings: FlashcardReviewSettings,
  minCards = MIN_FLASHCARD_SESSION_CARDS,
) {
  return Number.isInteger(settings.maxCards)
    && settings.maxCards >= minCards
    && settings.maxCards <= MAX_FLASHCARD_SESSION_CARDS
    && Number.isInteger(settings.backSpeechRepeatCount)
    && settings.backSpeechRepeatCount >= MIN_FLASHCARD_BACK_SPEECH_REPEATS
    && settings.backSpeechRepeatCount <= MAX_FLASHCARD_BACK_SPEECH_REPEATS
    && (!settings.speechEnabled || Boolean(
      (settings.cardSides === 'back' || settings.frontLanguage)
      && (settings.cardSides === 'front' || settings.backLanguage),
    ))
}

export const FLASHCARD_BULK_MENU_ITEMS = [
  { action: 'swap_front_back', title: 'Swap front and back', icon: 'mdi-swap-horizontal' },
  { action: 'swap_note_back', title: 'Swap note and back', icon: 'mdi-swap-horizontal' },
  { action: 'add_tags', title: 'Add tags', icon: 'mdi-tag-plus-outline', divider: true },
  { action: 'set_tags', title: 'Set tags', icon: 'mdi-tag-check-outline' },
  { action: 'remove_tags', title: 'Remove tags', icon: 'mdi-tag-minus-outline', requiresTags: true },
  { action: 'clear_tags', title: 'Clear tags', icon: 'mdi-tag-off-outline', requiresTags: true },
  { action: 'delete', title: 'Delete cards', icon: 'mdi-delete-outline', color: 'error', divider: true },
] as const satisfies ReadonlyArray<{
  action: FlashcardBulkAction
  title: string
  icon: string
  requiresTags?: boolean
  color?: 'error'
  divider?: boolean
}>

const MIN_FLASHCARD_SWIPE_DISTANCE = 56
const FLASHCARD_SWIPE_AXIS_RATIO = 1.2

export const FLASHCARD_REVIEW_SORT_OPTIONS: Array<{
  title: string
  value: FlashcardReviewSort
  subtitle: string
}> = [
  { title: 'Most difficult', value: 'difficult', subtitle: 'Cards with the highest error rate first' },
  { title: 'Never reviewed first', value: 'never_reviewed', subtitle: 'Start with cards you have not seen yet' },
  { title: 'Least recently reviewed', value: 'least_recent', subtitle: 'Return to the cards waiting longest' },
  { title: 'Recently added', value: 'recently_added', subtitle: 'Newest cards first' },
  { title: 'Random', value: 'random', subtitle: 'Shuffle once when the review starts' },
]

export function flashcardSideFromSwipe(
  start: { x: number; y: number },
  end: { x: number; y: number },
): FlashcardReviewSide | undefined {
  const horizontalDistance = end.x - start.x
  const verticalDistance = end.y - start.y
  if (
    Math.abs(horizontalDistance) < MIN_FLASHCARD_SWIPE_DISTANCE
    || Math.abs(horizontalDistance) < Math.abs(verticalDistance) * FLASHCARD_SWIPE_AXIS_RATIO
  ) return undefined
  return horizontalDistance < 0 ? 'back' : 'front'
}

export function flashcardTextFontSize(
  value: string,
  role: 'face' | 'note' = 'face',
  density: 'full' | 'compact' = 'full',
) {
  const length = [...value.trim().replace(/\s+/g, ' ')].length
  const settings = role === 'note'
    ? density === 'compact'
      ? { maximum: .9, minimum: .68, startsShrinkingAt: 24, reachesMinimumAt: 360 }
      : { maximum: 1.25, minimum: .72, startsShrinkingAt: 24, reachesMinimumAt: 420 }
    : density === 'compact'
      ? { maximum: 2, minimum: 1, startsShrinkingAt: 8, reachesMinimumAt: 240 }
      : { maximum: 3.6, minimum: 1.1, startsShrinkingAt: 8, reachesMinimumAt: 280 }
  const range = settings.reachesMinimumAt - settings.startsShrinkingAt
  const progress = Math.max(0, Math.min(1, (length - settings.startsShrinkingAt) / range))
  const size = settings.maximum - (settings.maximum - settings.minimum) * Math.sqrt(progress)
  return `${Number(size.toFixed(3))}rem`
}

export function flashcardDifficulty(card: Pick<Flashcard, 'successCount' | 'errorCount'>) {
  const attempts = card.successCount + card.errorCount
  return attempts ? card.errorCount / attempts : undefined
}

export function flashcardAccuracy(card: Pick<Flashcard, 'successCount' | 'errorCount'>) {
  const attempts = card.successCount + card.errorCount
  return attempts ? Math.round(card.successCount / attempts * 100) : undefined
}

export function sessionAccuracy(
  session: Pick<FlashcardReviewSession, 'successCount' | 'errorCount'>,
) {
  const attempts = session.successCount + session.errorCount
  return attempts ? Math.round(session.successCount / attempts * 100) : undefined
}

export function cardMatchesTags(card: Pick<Flashcard, 'tags'>, selectedTags: string[]) {
  return !selectedTags.length || card.tags.some(tag => selectedTags.includes(tag))
}

export function cardMatchesSearch(
  card: Pick<Flashcard, 'front' | 'back' | 'note'>,
  tagNames: readonly string[],
  query: string,
) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return true
  const searchableText = [card.front, card.back, card.note, ...tagNames]
    .join('\n')
    .toLocaleLowerCase()
  return terms.every(term => searchableText.includes(term))
}

export function formatReviewDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.round(totalSeconds))
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  if (!minutes) return `${remainder}s`
  if (!remainder) return `${minutes}m`
  return `${minutes}m ${remainder}s`
}

export function reviewSortTitle(value: FlashcardReviewSort) {
  return FLASHCARD_REVIEW_SORT_OPTIONS.find(option => option.value === value)?.title || value
}

export function reviewSetCardCount(
  reviewSet: Pick<FlashcardReviewSet, 'matchingCardCount' | 'maxCards'>,
) {
  return Math.min(reviewSet.matchingCardCount, reviewSet.maxCards)
}

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0
}

export function sortFlashcardsForReview(
  cards: Flashcard[],
  sortMode: FlashcardReviewSort,
  random = Math.random,
) {
  const sorted = [...cards]
  if (sortMode === 'random') {
    for (let index = sorted.length - 1; index > 0; index -= 1) {
      const target = Math.floor(random() * (index + 1))
      const current = sorted[index]
      const replacement = sorted[target]
      if (current && replacement) [sorted[index], sorted[target]] = [replacement, current]
    }
    return sorted
  }

  return sorted.sort((left, right) => {
    if (sortMode === 'recently_added') {
      return compareText(right.createdAt, left.createdAt) || compareText(left.id, right.id)
    }
    if (sortMode === 'least_recent') {
      if (Boolean(left.lastReviewedAt) !== Boolean(right.lastReviewedAt)) {
        return left.lastReviewedAt ? 1 : -1
      }
      return compareText(left.lastReviewedAt || '', right.lastReviewedAt || '')
        || compareText(right.createdAt, left.createdAt)
    }
    if (sortMode === 'never_reviewed') {
      if (Boolean(left.lastReviewedAt) !== Boolean(right.lastReviewedAt)) {
        return left.lastReviewedAt ? 1 : -1
      }
      return !left.lastReviewedAt
        ? compareText(right.createdAt, left.createdAt)
        : compareText(left.lastReviewedAt, right.lastReviewedAt || '')
    }

    const leftDifficulty = flashcardDifficulty(left) ?? -1
    const rightDifficulty = flashcardDifficulty(right) ?? -1
    return rightDifficulty - leftDifficulty
      || right.errorCount - left.errorCount
      || compareText(left.lastReviewedAt || '', right.lastReviewedAt || '')
      || compareText(left.id, right.id)
  })
}

export function flashcardReviewQueue(
  reviewSet: FlashcardReviewSet,
  cards: Flashcard[],
  random = Math.random,
) {
  return sortFlashcardsForReview(
    cards.filter(card => (
      cardMatchesTags(card, reviewSet.tags)
      && !(reviewSet.excludedCards || []).includes(card.id)
    )),
    reviewSet.sortMode,
    random,
  )
    .slice(0, reviewSet.maxCards)
    .map(card => ({
      id: card.id,
      front: card.front,
      back: card.back,
      note: card.note,
      frontAudio: card.frontAudio,
      backAudio: card.backAudio,
      image: card.image,
      tags: [...card.tags],
    }))
}

export function createFlashcardReviewPreviewSession(
  reviewSet: FlashcardReviewSet,
  cards: Flashcard[],
  random = Math.random,
  startedAt = new Date(),
): FlashcardReviewSession | undefined {
  const queue = flashcardReviewQueue(reviewSet, cards, random)
  if (!queue.length) return undefined

  const timestamp = startedAt.toISOString()
  return {
    id: `review-set-preview-${reviewSet.id}`,
    reviewSet: reviewSet.id,
    status: 'paused',
    name: reviewSet.name,
    mode: reviewSet.mode,
    cardSides: reviewSet.cardSides,
    indefinite: reviewSet.mode === 'passive' && reviewSet.indefinite,
    maxCards: reviewSet.maxCards,
    sortMode: reviewSet.sortMode,
    tags: [...reviewSet.tags],
    excludedCards: [...(reviewSet.excludedCards || [])],
    frontSeconds: reviewSet.frontSeconds,
    backSeconds: reviewSet.backSeconds,
    backSpeechRepeatCount: reviewSet.mode === 'passive' && reviewSet.speechEnabled
      ? normalizeFlashcardBackSpeechRepeatCount(reviewSet.backSpeechRepeatCount)
      : DEFAULT_FLASHCARD_BACK_SPEECH_REPEATS,
    noteBeforeBack: reviewSet.noteBeforeBack,
    speechEnabled: reviewSet.speechEnabled,
    frontLanguage: reviewSet.frontLanguage,
    backLanguage: reviewSet.backLanguage,
    queue,
    startedAt: timestamp,
    updatedAt: timestamp,
    elapsedSeconds: 0,
    totalCards: queue.length,
    viewedCount: 0,
    successCount: 0,
    errorCount: 0,
    ejectedCount: 0,
  }
}

export function createIntervalFlashcardReviewSnapshot(
  reviewSet: FlashcardReviewSet,
  cards: Flashcard[],
  random = Math.random,
): IntervalFlashcardReviewSnapshot | undefined {
  const queue = flashcardReviewQueue(reviewSet, cards, random)
  if (!queue.length) return undefined
  const effectiveSeconds = reviewSet.mode === 'passive'
    ? { front: reviewSet.frontSeconds, back: reviewSet.backSeconds }
    : { front: 5, back: 5 }

  return {
    reviewSet: reviewSet.id,
    name: reviewSet.name,
    tags: [...reviewSet.tags],
    sortMode: reviewSet.sortMode,
    cardSides: reviewSet.cardSides,
    frontSeconds: effectiveSeconds.front,
    backSeconds: effectiveSeconds.back,
    backSpeechRepeatCount: reviewSet.mode === 'passive' && reviewSet.speechEnabled
      ? normalizeFlashcardBackSpeechRepeatCount(reviewSet.backSpeechRepeatCount)
      : DEFAULT_FLASHCARD_BACK_SPEECH_REPEATS,
    noteBeforeBack: reviewSet.noteBeforeBack,
    speechEnabled: reviewSet.speechEnabled,
    frontLanguage: reviewSet.frontLanguage,
    backLanguage: reviewSet.backLanguage,
    cards: queue,
  }
}

export interface IntervalFlashcardPhase {
  card: IntervalFlashcardReviewSnapshot['cards'][number]
  cardIndex: number
  cycle: number
  side: FlashcardReviewSide
  progress: number
  remainingMs: number
  key: string
}

export function normalizeFlashcardBackSpeechRepeatCount(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_FLASHCARD_BACK_SPEECH_REPEATS
  return Math.min(
    MAX_FLASHCARD_BACK_SPEECH_REPEATS,
    Math.max(MIN_FLASHCARD_BACK_SPEECH_REPEATS, Math.round(value)),
  )
}

export function flashcardBackDurationMs(backSeconds: number, repeatCount: number) {
  const durationMs = Math.max(1000, backSeconds * 1000)
  return durationMs * normalizeFlashcardBackSpeechRepeatCount(repeatCount)
}

export function flashcardReviewShowsSide(
  cardSides: FlashcardReviewCardSides,
  side: FlashcardReviewSide,
) {
  return cardSides === 'both' || cardSides === side
}

export function firstFlashcardReviewSide(cardSides: FlashcardReviewCardSides): FlashcardReviewSide {
  return cardSides === 'back' ? 'back' : 'front'
}

export function intervalFlashcardPhase(
  review: IntervalFlashcardReviewSnapshot,
  elapsedMs: number,
): IntervalFlashcardPhase | undefined {
  if (!review.cards.length) return undefined
  const showsFront = flashcardReviewShowsSide(review.cardSides, 'front')
  const showsBack = flashcardReviewShowsSide(review.cardSides, 'back')
  const frontMs = Math.max(1000, review.frontSeconds * 1000)
  const baseBackMs = Math.max(1000, review.backSeconds * 1000)
  const backMs = flashcardBackDurationMs(review.backSeconds, review.backSpeechRepeatCount)
  const cardDurationMs = (showsFront ? frontMs : 0) + (showsBack ? backMs : 0)
  const safeElapsedMs = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0
  const absoluteCardIndex = Math.floor(safeElapsedMs / cardDurationMs)
  const cardIndex = absoluteCardIndex % review.cards.length
  const elapsedInCard = safeElapsedMs % cardDurationMs
  const side: FlashcardReviewSide = showsFront && elapsedInCard < frontMs ? 'front' : 'back'
  const sideElapsedMs = side === 'front'
    ? elapsedInCard
    : elapsedInCard - (showsFront ? frontMs : 0)
  const sideDurationMs = side === 'front' ? frontMs : backMs
  const backSpeechRepeatIndex = side === 'back'
    ? Math.min(
        normalizeFlashcardBackSpeechRepeatCount(review.backSpeechRepeatCount) - 1,
        Math.floor(sideElapsedMs / baseBackMs),
      )
    : 0
  const card = review.cards[cardIndex]
  if (!card) return undefined

  return {
    card,
    cardIndex,
    cycle: Math.floor(absoluteCardIndex / review.cards.length),
    side,
    progress: Math.min(100, Math.max(0, sideElapsedMs / sideDurationMs * 100)),
    remainingMs: Math.max(0, sideDurationMs - sideElapsedMs),
    key: `${absoluteCardIndex}:${side}:${backSpeechRepeatIndex}`,
  }
}
