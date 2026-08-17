<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import ActionBottomSheet from '@/components/ActionBottomSheet.vue'
import AppForm from '@/components/AppForm.vue'
import AppDialog from '@/components/AppDialog.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import FlashcardCardDialog from '@/components/FlashcardCardDialog.vue'
import FlashcardContextActions from '@/components/FlashcardContextActions.vue'
import FlashcardResponseText from '@/components/FlashcardResponseText.vue'
import FlashcardReviewSettingsFields from '@/components/FlashcardReviewSettingsFields.vue'
import RunnerStartScreen from '@/components/RunnerStartScreen.vue'
import RunnerSessionActions from '@/components/RunnerSessionActions.vue'
import {
  backgroundFlashcardReviewState,
  flashcardSpeechOverAmplificationIsEnabled,
  loadFlashcardSpeechSupport,
  nativeFlashcardBackgroundIsAvailable,
  speakFlashcardText,
  stopBackgroundFlashcardReview,
  stopFlashcardSpeech,
  syncBackgroundFlashcardReview,
  toggleFlashcardSpeechOverAmplification,
} from '@/services/flashcardSpeech'
import {
  playFlashcardEjectCue,
  playReviewCompleteCue,
  prepareFlashcardEjectCue,
} from '@/services/intervalCues'
import { reviewRunnerSessionMenuItems } from '@/services/runnerSessionActions'
import { requestScreenWakeLock, type ScreenWakeLock } from '@/services/screenWakeLock'
import {
  createFlashcardReviewPreviewSession,
  FLASHCARD_SETTINGS_APPLY_MENU_ITEMS,
  firstFlashcardReviewSide,
  flashcardBackDurationMs,
  flashcardReviewShowsSide,
  flashcardReviewSettingsAreValid,
  flashcardReviewSettingsSignature,
  flashcardReviewActionFromSwipe,
  flashcardTextFontSize,
  formatReviewDuration,
  INTERVAL_FLASHCARD_QUICK_TAGS,
  normalizeFlashcardBackSpeechRepeatCount,
  sessionAccuracy,
} from '@/services/flashcards'
import { useFlashcardStore } from '@/stores/flashcards'
import type {
  BackgroundFlashcardReviewState,
  Flashcard,
  FlashcardContextAction,
  FlashcardReviewAction,
  FlashcardReviewSession,
  FlashcardReviewSettings,
  FlashcardReviewSide,
  FlashcardSettingsApplyTarget,
  FlashcardSpeechSupport,
  FlashcardTag,
  RunnerSessionAction,
} from '@/types/domain'

const route = useRoute()
const router = useRouter()
const store = useFlashcardStore()
type ReviewCardTransitionDirection = 'previous' | 'next' | 'front' | 'back' | 'flip-front' | 'flip-back'
const loading = ref(true)
const busy = ref(false)
const error = ref('')
const revealed = ref(false)
const reviewCardTransitionDirection = ref<ReviewCardTransitionDirection>()
const sessionActionsSheet = ref(false)
const endDialog = ref(false)
const cardMenuOpen = ref(false)
const cardTagSheet = ref(false)
const cardTagSaving = ref('')
const cardEditorDialog = ref(false)
const cardEditorCard = ref<Flashcard>()
const deleteCardDialog = ref(false)
const deleteCardId = ref('')
const deletingCard = ref(false)
const sessionSettingsDialog = ref(false)
const sessionSettingsApplyMenu = ref(false)
const sessionSettingsForm = ref()
const sessionSettingsSaving = ref(false)
const sessionSettingsError = ref('')
const sessionSettingsOriginal = ref('')
const sessionSpeechLoading = ref(false)
const sessionSpeechSupport = ref<FlashcardSpeechSupport>({ available: false, languages: [] })
const speechOverAmplified = ref(flashcardSpeechOverAmplificationIsEnabled())
const speechOverAmplificationBusy = ref(false)
const sessionSettingsDraft = reactive<FlashcardReviewSettings>({
  mode: 'manual',
  cardSides: 'both',
  indefinite: false,
  maxCards: 20,
  frontSeconds: 5,
  backSeconds: 5,
  backSpeechRepeatCount: 1,
  noteBeforeBack: false,
  speechEnabled: false,
  frontLanguage: '',
  backLanguage: '',
  sortMode: 'difficult',
  sortDirection: 'asc',
})
const tickVersion = ref(0)
const passiveSide = ref<'front' | 'back'>('front')
const passiveRemainingMs = ref(0)
const localElapsedMs = ref(0)
const visibilityPaused = ref(false)
const nativeBackgroundReady = ref(false)
const speechPlaybackWarning = ref('')
const backgroundSpeechWarning = ref('')
const speechFailureSnackbar = ref(false)
const reconcilingBackground = ref(false)
let animationFrame: number | undefined
let lastTickAt = 0
let mounted = true
let skipLeavePause = false
let passiveAdvancing = false
let continuePassiveTickWhileBusy = false
let visibilityWork: Promise<void> = Promise.resolve()
let lastSpokenKey = ''
let speechRequest = 0
let wakeLock: ScreenWakeLock | undefined
let acquiringWakeLock = false
let wakeLockRetryRequested = false
let manualSwipeStart: { pointerId: number; x: number; y: number } | undefined
let suppressManualCardTap = false
let manualCardTapResetTimer: number | undefined
let resumeAfterSessionSettings = false
let resumeAfterCardEditor = false
let resumeAfterCardTagSheet = false
const speechFailureWarnedSessionIds = new Set<string>()

const currentSessionId = ref('')
const previewSession = ref<FlashcardReviewSession>()
const persistedSession = computed(() => store.sessions.find(item => item.id === currentSessionId.value))
const session = computed(() => persistedSession.value || previewSession.value)
const isReviewSetPreview = computed(() => Boolean(previewSession.value))
const currentCard = computed(() => session.value?.queue[0])
const currentReviewSet = computed(() => store.reviewSets.find(item => item.id === session.value?.reviewSet))
const currentSourceCards = computed(() => {
  if (!currentReviewSet.value) return store.cards
  return currentReviewSet.value.accessRole === 'owner'
    ? store.cards
    : store.reviewSetCards[currentReviewSet.value.id] || []
})
const currentSourceCard = computed(() => currentSourceCards.value.find(card => card.id === currentCard.value?.id))
const canManageCurrentCard = computed(() => !currentReviewSet.value
  || currentReviewSet.value.accessRole !== 'readonly')
const canTagCurrentCard = computed(() => Boolean(
  !isReviewSetPreview.value
  && currentReviewSet.value?.accessRole === 'owner'
  && currentSourceCard.value,
))
const quickTagNames = new Set(
  INTERVAL_FLASHCARD_QUICK_TAGS.map(tag => tag.name.toLocaleLowerCase()),
)
const quickTags = computed(() => INTERVAL_FLASHCARD_QUICK_TAGS.map((quickTag) => {
  const tag = (store.tags || []).find(
    item => item.name.toLocaleLowerCase() === quickTag.name.toLocaleLowerCase(),
  )
  return {
    ...quickTag,
    selected: Boolean(tag && currentCard.value?.tags.includes(tag.id)),
  }
}))
const selectableTags = computed(() => (store.tags || []).filter(
  tag => !quickTagNames.has(tag.name.toLocaleLowerCase()),
))
const isFinished = computed(() => session.value?.status === 'completed' || session.value?.status === 'ended')
const isRunning = computed(() => session.value?.status === 'running')
const canReplayCurrentSide = computed(() => Boolean(
  session.value?.speechEnabled
  && currentCard.value
  && !isReviewSetPreview.value
  && !isFinished.value
  && !busy.value,
))
const shouldKeepScreenAwake = computed(() => Boolean(
  session.value && !isFinished.value && !isReviewSetPreview.value,
))
const elapsedSeconds = computed(() => {
  tickVersion.value
  return Math.max(session.value?.elapsedSeconds || 0, Math.floor(localElapsedMs.value / 1000))
})
const completedCards = computed(() => session.value
  ? session.value.totalCards - session.value.queue.length
  : 0)
const progressCards = computed(() => {
  if (!session.value?.totalCards) return 0
  return session.value.indefinite
    ? session.value.viewedCount % session.value.totalCards
    : completedCards.value
})
const progress = computed(() => session.value?.totalCards
  ? Math.round(progressCards.value / session.value.totalCards * 100)
  : 0)
const firstReviewSide = computed(() => firstFlashcardReviewSide(session.value?.cardSides || 'both'))
const manualShowingBack = computed(() => session.value?.cardSides === 'back'
  || (session.value?.cardSides === 'both' && revealed.value))
const backSpeechRepeatCount = computed(() => session.value?.mode === 'passive'
  && session.value.speechEnabled
  ? normalizeFlashcardBackSpeechRepeatCount(session.value.backSpeechRepeatCount)
  : 1)
const passiveDurationMs = computed(() => {
  if (!session.value) return 1000
  return passiveSide.value === 'front'
    ? session.value.frontSeconds * 1000
    : flashcardBackDurationMs(session.value.backSeconds, backSpeechRepeatCount.value)
})
const passiveSpeechRepeatIndex = computed(() => {
  if (
    session.value?.mode !== 'passive'
    || passiveSide.value !== 'back'
    || backSpeechRepeatCount.value === 1
  ) return 0
  const baseBackDurationMs = Math.max(1000, session.value.backSeconds * 1000)
  const elapsedBackMs = Math.max(0, passiveDurationMs.value - passiveRemainingMs.value)
  return Math.min(
    backSpeechRepeatCount.value - 1,
    Math.floor(elapsedBackMs / baseBackDurationMs),
  )
})
const passiveProgress = computed(() => {
  tickVersion.value
  if (session.value?.mode !== 'passive') return 0
  return Math.max(0, Math.min(100, (1 - passiveRemainingMs.value / passiveDurationMs.value) * 100))
})
const accuracy = computed(() => session.value ? sessionAccuracy(session.value) : undefined)
const exitDestination = computed(() => route.query.from === 'tasks' ? '/tasks' : '/flashcards')
const speechWarning = computed(() => speechPlaybackWarning.value || backgroundSpeechWarning.value)
const currentSpeechSide = computed<FlashcardReviewSide>(() => session.value?.mode === 'manual'
  ? (manualShowingBack.value ? 'back' : 'front')
  : passiveSide.value)
const reviewCardTransitionKey = computed(() => currentCard.value
  ? `${currentCard.value.id}:${currentSpeechSide.value}`
  : '')
const canUseNativeBackground = computed(() => Boolean(
  nativeFlashcardBackgroundIsAvailable()
  && session.value?.mode === 'passive'
  && session.value.speechEnabled
  && session.value.frontLanguage
  && session.value.backLanguage
  && session.value.status === 'running',
))
const canNavigateCards = computed(() => Boolean(
  session.value?.status === 'running'
  && session.value.queue.length > 1,
))
const sessionSettingsMinimumCards = computed(() => {
  if (sessionSettingsDraft.mode === 'passive' && sessionSettingsDraft.indefinite) return 1
  return Math.min(100, (session.value?.viewedCount || 0) + (session.value?.ejectedCount || 0) + 1)
})
const sessionSettingsAvailableCards = computed(() => store.reviewSets
  .find(reviewSet => reviewSet.id === session.value?.reviewSet)
  ?.matchingCardCount || 0)
const sessionSettingsChanged = computed(() => sessionSettingsDialog.value
  && flashcardReviewSettingsSignature(sessionSettingsDraft) !== sessionSettingsOriginal.value)
const canSaveSessionSettings = computed(() => sessionSettingsChanged.value
  && flashcardReviewSettingsAreValid(sessionSettingsDraft, sessionSettingsMinimumCards.value))
const sessionActionItems = computed(() => reviewRunnerSessionMenuItems({
  speechAvailable: Boolean(session.value?.speechEnabled && currentCard.value),
  amplified: speechOverAmplified.value,
  busy: busy.value || speechOverAmplificationBusy.value,
  preview: isReviewSetPreview.value,
  finished: isFinished.value,
  canRestart: Boolean(session.value?.reviewSet),
}))
const sessionActionsDisabled = computed(() => sessionActionItems.value.every(item => item.disabled))

watch([
  loading,
  () => session.value?.status,
  () => session.value?.speechEnabled,
  () => currentCard.value?.id,
  currentSpeechSide,
  passiveSpeechRepeatIndex,
], () => {
  void speakCurrentSide()
}, { flush: 'post' })

watch([
  () => currentCard.value?.id,
  currentSpeechSide,
], ([cardId, side], [previousCardId, previousSide]) => {
  if (!cardId || !side || !previousCardId || !previousSide) return
  if (reviewCardTransitionDirection.value) return

  if (cardId !== previousCardId) reviewCardTransitionDirection.value = 'next'
  else if (side !== previousSide) reviewCardTransitionDirection.value = side
})

watch(shouldKeepScreenAwake, (keepAwake) => {
  if (keepAwake && document.visibilityState === 'visible') void acquireWakeLock()
  else void releaseWakeLock()
})

onMounted(async () => {
  mounted = true
  try {
    if (!store.loaded) await store.load()
    if (typeof route.params.sessionId === 'string') {
      const loaded = await store.loadSession(route.params.sessionId)
      currentSessionId.value = loaded.id
      initializeLocalState(loaded)
    } else if (typeof route.params.reviewSetId === 'string') {
      const reviewSet = store.reviewSets.find(item => item.id === route.params.reviewSetId)
      if (!reviewSet) throw new Error('That Review set could not be found.')
      const cards = reviewSet.accessRole === 'owner'
        ? store.cards
        : await store.loadReviewSetCards(reviewSet.id)
      const prepared = createFlashcardReviewPreviewSession(reviewSet, cards)
      if (!prepared) throw new Error('No flashcards match this Review set.')
      previewSession.value = {
        ...prepared,
        task: typeof route.query.task === 'string' ? route.query.task : undefined,
        programStep: typeof route.query.step === 'string' ? route.query.step : undefined,
        taskDate: typeof route.query.date === 'string' ? route.query.date : undefined,
      }
      initializeLocalState(previewSession.value)
    } else {
      throw new Error('This review could not be found.')
    }
    const autoplay = route.query.autoplay === '1' && session.value?.status === 'paused'
    if (autoplay) {
      await resumeReview()
    } else {
      const restoredBackground = await reconcileBackgroundReview()
      if (!restoredBackground) await syncNativeBackground()
    }
    animationFrame = window.requestAnimationFrame(updateProgressFrame)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    if (shouldKeepScreenAwake.value && document.visibilityState === 'visible') void acquireWakeLock()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not start this review.'
  } finally {
    loading.value = false
  }
})

onBeforeRouteLeave(async () => {
  if (!skipLeavePause) {
    await pauseReview(false)
    await stopBackgroundFlashcardReview()
    await stopFlashcardSpeech()
  }
  return true
})

onBeforeUnmount(() => {
  mounted = false
  if (animationFrame !== undefined) window.cancelAnimationFrame(animationFrame)
  if (manualCardTapResetTimer) window.clearTimeout(manualCardTapResetTimer)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  void releaseWakeLock()
  void stopFlashcardSpeech()
})

async function acquireWakeLock() {
  if (acquiringWakeLock) {
    wakeLockRetryRequested = true
    return
  }
  if (
    wakeLock
    || !mounted
    || !shouldKeepScreenAwake.value
    || document.visibilityState !== 'visible'
  ) return
  acquiringWakeLock = true
  try {
    const lock = await requestScreenWakeLock()
    if (!lock) return
    if (!mounted || !shouldKeepScreenAwake.value || document.visibilityState !== 'visible') {
      await lock.release()
      return
    }
    wakeLock = lock
  } finally {
    acquiringWakeLock = false
    if (wakeLockRetryRequested) {
      wakeLockRetryRequested = false
      void acquireWakeLock()
    }
  }
}

async function releaseWakeLock() {
  const lock = wakeLock
  wakeLock = undefined
  await lock?.release()
}

function initializeLocalState(value: FlashcardReviewSession) {
  localElapsedMs.value = value.elapsedSeconds * 1000
  lastTickAt = Date.now()
  revealed.value = false
  restorePassiveState(value)
}

function passiveStorageKey(id: string) {
  return `backontrack-flashcard-passive:${id}`
}

function restorePassiveState(value: FlashcardReviewSession) {
  passiveSide.value = firstFlashcardReviewSide(value.cardSides)
  passiveRemainingMs.value = passiveDurationMs.value
  if (value.mode !== 'passive') return
  try {
    const saved = JSON.parse(localStorage.getItem(passiveStorageKey(value.id)) || '')
    if (
      saved?.cardId === value.queue[0]?.id
      && (saved.side === 'front' || saved.side === 'back')
      && flashcardReviewShowsSide(value.cardSides, saved.side)
    ) {
      passiveSide.value = saved.side
      passiveRemainingMs.value = Math.max(1, Number(saved.remainingMs) || passiveDurationMs.value)
      const restoredSpeechKey = speechKey(true)
      if (saved.spokenKey === restoredSpeechKey) lastSpokenKey = restoredSpeechKey
    }
  } catch {
    // Start the current card from its front when local recovery is unavailable.
  }
}

function savePassiveState() {
  if (!session.value || session.value.mode !== 'passive' || !currentCard.value) return
  try {
    localStorage.setItem(passiveStorageKey(session.value.id), JSON.stringify({
      cardId: currentCard.value.id,
      side: passiveSide.value,
      remainingMs: passiveRemainingMs.value,
      spokenKey: lastSpokenKey,
    }))
  } catch {
    // Server queue state remains recoverable even when local phase storage is unavailable.
  }
}

function clearPassiveState() {
  if (!session.value) return
  try {
    localStorage.removeItem(passiveStorageKey(session.value.id))
  } catch {
    // Nothing else is required.
  }
}

function tick() {
  const now = Date.now()
  const delta = lastTickAt ? Math.max(0, now - lastTickAt) : 0
  lastTickAt = now
  if (
    !isRunning.value
    || document.visibilityState !== 'visible'
    || (busy.value && !continuePassiveTickWhileBusy)
  ) return
  localElapsedMs.value += delta
  if (session.value?.mode === 'passive' && currentCard.value) {
    passiveRemainingMs.value = Math.max(0, passiveRemainingMs.value - delta)
    if (passiveRemainingMs.value === 0 && !passiveAdvancing) void advancePassive()
  }
  tickVersion.value++
}

function updateProgressFrame() {
  if (!mounted) return
  tick()
  animationFrame = window.requestAnimationFrame(updateProgressFrame)
}

async function advancePassive() {
  if (!session.value || session.value.mode !== 'passive' || passiveAdvancing) return
  if (session.value.cardSides === 'both' && passiveSide.value === 'front') {
    passiveSide.value = 'back'
    passiveRemainingMs.value = flashcardBackDurationMs(
      session.value.backSeconds,
      backSpeechRepeatCount.value,
    )
    savePassiveState()
    await syncNativeBackground()
    return
  }
  passiveAdvancing = true
  try {
    await performAction('view')
  } finally {
    passiveAdvancing = false
  }
}

function resetCurrentCardPhase() {
  revealed.value = false
  passiveSide.value = firstReviewSide.value
  passiveRemainingMs.value = passiveDurationMs.value
  if (isFinished.value) clearPassiveState()
  else savePassiveState()
}

async function navigateLeft(
  transitionDirection: ReviewCardTransitionDirection = 'previous',
) {
  if (!session.value || !canNavigateCards.value || busy.value) return
  reviewCardTransitionDirection.value = transitionDirection
  if (!await performAction('previous')) reviewCardTransitionDirection.value = undefined
}

async function navigateRight(
  transitionDirection: ReviewCardTransitionDirection = 'next',
) {
  if (!session.value || !canNavigateCards.value || busy.value) return
  reviewCardTransitionDirection.value = transitionDirection
  if (!await performAction('next')) reviewCardTransitionDirection.value = undefined
}

async function performAction(
  action: FlashcardReviewAction,
  options: { syncNative?: boolean; playCompletionCue?: boolean; viewCount?: number } = {},
) {
  if (!session.value || busy.value) return false
  const previousStatus = session.value.status
  tick()
  busy.value = true
  error.value = ''
  let succeeded = false
  if (action === 'eject') void prepareFlashcardEjectCue()
  try {
    const updated = options.viewCount === undefined
      ? await store.act(session.value.id, action, elapsedSeconds.value)
      : await store.act(session.value.id, action, elapsedSeconds.value, options.viewCount)
    localElapsedMs.value = updated.elapsedSeconds * 1000
    lastTickAt = Date.now()
    if (['success', 'error', 'view', 'previous', 'next', 'push', 'eject', 'undo_eject', 'restart'].includes(action)) resetCurrentCardPhase()
    continuePassiveTickWhileBusy = action === 'view'
      && updated.mode === 'passive'
      && updated.status === 'running'
    if (action === 'eject') playFlashcardEjectCue()
    if (
      action !== 'eject'
      && previousStatus === 'running'
      && updated.status === 'completed'
      && options.playCompletionCue !== false
      && document.visibilityState === 'visible'
    ) {
      playReviewCompleteCue()
    }
    if (updated.status === 'completed' || updated.status === 'ended') {
      clearPassiveState()
      await stopBackgroundFlashcardReview()
      await stopFlashcardSpeech()
    } else if (updated.status !== 'running') {
      await stopBackgroundFlashcardReview()
      await stopFlashcardSpeech()
    } else if (options.syncNative !== false) {
      await syncNativeBackground()
    }
    succeeded = true
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not update this review.'
    if (session.value?.mode === 'passive' && passiveRemainingMs.value === 0) {
      passiveRemainingMs.value = 500
    }
  } finally {
    continuePassiveTickWhileBusy = false
    busy.value = false
  }
  return succeeded
}

async function pauseReview(markVisibilityPause: boolean) {
  if (!session.value || session.value.status !== 'running' || busy.value) return
  tick()
  savePassiveState()
  if (markVisibilityPause) visibilityPaused.value = true
  await stopBackgroundFlashcardReview()
  await stopFlashcardSpeech()
  await performAction('pause')
}

async function startPreviewReview() {
  const preview = previewSession.value
  if (!preview?.reviewSet || busy.value) return
  sessionActionsSheet.value = false
  cardMenuOpen.value = false
  busy.value = true
  error.value = ''
  try {
    const started = await store.startReview(preview.reviewSet, {
      task: preview.task,
      programStep: preview.programStep,
      taskDate: preview.taskDate,
    })
    currentSessionId.value = started.id
    previewSession.value = undefined
    initializeLocalState(started)
    lastSpokenKey = ''
    skipLeavePause = true
    try {
      await router.replace({
        name: 'flashcard-review-runner',
        params: { sessionId: started.id },
        query: {
          ...(route.query.from ? { from: route.query.from } : {}),
        },
      })
    } finally {
      skipLeavePause = false
    }
    const restoredBackground = await reconcileBackgroundReview()
    if (!restoredBackground) await syncNativeBackground()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not start this review.'
  } finally {
    busy.value = false
  }
}

async function resumeReview() {
  if (!session.value || session.value.status !== 'paused' || busy.value) return
  await performAction('resume')
  lastTickAt = Date.now()
  visibilityPaused.value = false
}

async function restartReview() {
  const value = session.value
  if (!value?.reviewSet || isReviewSetPreview.value || isFinished.value || busy.value) return
  lastSpokenKey = ''
  speechPlaybackWarning.value = ''
  await stopBackgroundFlashcardReview()
  await stopFlashcardSpeech()
  const restarted = await performAction('restart')
  if (!restarted) await syncNativeBackground()
  await speakCurrentSide()
}

function handleVisibilityChange() {
  visibilityWork = visibilityWork.then(async () => {
    if (!mounted || isFinished.value) return
    if (document.visibilityState === 'hidden') {
      // Android's window flag is harmless in the background and becomes effective
      // again as soon as the Activity resumes. Keep its holder alive for the whole
      // review screen; browser wake-lock sentinels must be requested again instead.
      if (wakeLock?.kind !== 'native-android') await releaseWakeLock()
      lastSpokenKey = speechKey()
      await stopFlashcardSpeech()
      if (canUseNativeBackground.value && nativeBackgroundReady.value) {
        savePassiveState()
        return
      }
      await pauseReview(true)
      return
    }

    await acquireWakeLock()
    if (canUseNativeBackground.value) {
      const restored = await reconcileBackgroundReview()
      if (restored) return
    }
    if (visibilityPaused.value && session.value?.status === 'paused') {
      await resumeReview()
    }
    await speakCurrentSide()
  })
}

function speechKey(allowPaused = false) {
  if (
    !currentCard.value
    || !session.value?.speechEnabled
    || (
      session.value.status !== 'running'
      && !(allowPaused && session.value.status === 'paused')
    )
  ) return ''
  return `${currentCard.value.id}:${currentSpeechSide.value}:${passiveSpeechRepeatIndex.value}`
}

async function speakCurrentSide(allowPaused = false) {
  const request = ++speechRequest
  const value = session.value
  const card = currentCard.value
  const key = speechKey(allowPaused)
  if (
    loading.value
    || reconcilingBackground.value
    || document.visibilityState !== 'visible'
    || !value
    || !card
    || !key
  ) {
    if (!value || !card || !value.speechEnabled) lastSpokenKey = ''
    await stopFlashcardSpeech()
    return
  }
  if (key === lastSpokenKey) return

  lastSpokenKey = key
  const side = currentSpeechSide.value
  try {
    const text = side === 'front' ? card.front : card.back
    const language = side === 'front' ? value.frontLanguage : value.backLanguage
    const audio = (side === 'front' ? card.frontAudio : card.backAudio) || ''
    if (audio) await speakFlashcardText(text, language, '', audio)
    else await speakFlashcardText(text, language)
    if (request === speechRequest) speechPlaybackWarning.value = ''
  } catch {
    if (request === speechRequest && !speechFailureWarnedSessionIds.has(value.id)) {
      speechFailureWarnedSessionIds.add(value.id)
      speechFailureSnackbar.value = true
    }
  }
}

function retrySpeech() {
  lastSpokenKey = ''
  speechPlaybackWarning.value = ''
  void speakCurrentSide()
}

function replayCurrentSide() {
  if (
    !canReplayCurrentSide.value
    || document.visibilityState !== 'visible'
  ) return false

  lastSpokenKey = ''
  speechPlaybackWarning.value = ''
  void speakCurrentSide(true)
  return true
}

async function toggleSpeechOverAmplification() {
  if (speechOverAmplificationBusy.value) return
  speechOverAmplificationBusy.value = true
  try {
    speechOverAmplified.value = await toggleFlashcardSpeechOverAmplification()
    if (session.value?.status === 'running') await syncNativeBackground()
  } catch {
    speechPlaybackWarning.value = 'TTS over-amplification could not be changed.'
  } finally {
    speechOverAmplificationBusy.value = false
  }
}

function handleManualCardTap() {
  if (suppressManualCardTap) {
    suppressManualCardTap = false
    return
  }
  if (replayCurrentSide()) return
  if (
    session.value?.cardSides === 'both'
    && !revealed.value
    && session.value.status === 'running'
    && !busy.value
  ) revealed.value = true
}

function beginReviewCardSwipe(event: PointerEvent) {
  if (
    !session.value
    || session.value.status !== 'running'
    || (!canNavigateCards.value && session.value.cardSides !== 'both')
    || busy.value
    || (event.pointerType === 'mouse' && event.button !== 0)
  ) return

  manualSwipeStart = {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
  }
  try {
    const target = event.currentTarget as HTMLElement
    target.setPointerCapture(event.pointerId)
  } catch {
    // Pointer capture is optional; touch input still reports its final position without it.
  }
}

function finishReviewCardSwipe(event: PointerEvent) {
  const start = manualSwipeStart
  if (!start || start.pointerId !== event.pointerId) return
  manualSwipeStart = undefined

  const gesture = flashcardReviewActionFromSwipe(start, { x: event.clientX, y: event.clientY })
  if (!gesture) return

  suppressManualCardTap = true
  if (manualCardTapResetTimer) window.clearTimeout(manualCardTapResetTimer)
  manualCardTapResetTimer = window.setTimeout(() => {
    suppressManualCardTap = false
    manualCardTapResetTimer = undefined
  }, 250)
  if (gesture.action === 'previous') void navigateLeft(gesture.transition)
  else if (gesture.action === 'next') void navigateRight(gesture.transition)
  else void showReviewCardSide(gesture.action, `flip-${gesture.action}`)
}

function cancelReviewCardSwipe(event: PointerEvent) {
  if (manualSwipeStart?.pointerId === event.pointerId) manualSwipeStart = undefined
}

function showReviewCardSide(
  side: FlashcardReviewSide,
  transitionDirection: ReviewCardTransitionDirection = side,
) {
  const value = session.value
  if (
    !value
    || value.cardSides !== 'both'
    || currentSpeechSide.value === side
    || value.status !== 'running'
    || busy.value
  ) return

  reviewCardTransitionDirection.value = transitionDirection
  lastSpokenKey = ''
  if (value.mode === 'manual') {
    revealed.value = side === 'back'
    return
  }

  passiveSide.value = side
  passiveRemainingMs.value = passiveDurationMs.value
  savePassiveState()
  void syncNativeBackground()
}

function handlePassiveCardTap() {
  if (suppressManualCardTap) {
    suppressManualCardTap = false
    return
  }
  replayCurrentSide()
}

function finishReviewCardTransition() {
  reviewCardTransitionDirection.value = undefined
}

async function syncNativeBackground() {
  const value = session.value
  if (!value || !canUseNativeBackground.value) {
    nativeBackgroundReady.value = false
    backgroundSpeechWarning.value = ''
    return false
  }
  const started = await syncBackgroundFlashcardReview(
    value,
    passiveSide.value,
    passiveRemainingMs.value,
    localElapsedMs.value,
  )
  nativeBackgroundReady.value = started
  backgroundSpeechWarning.value = started
    ? ''
    : 'Speech will pause if BackOnTrack is sent to the background on this device.'
  return started
}

async function reconcileBackgroundReview(
  providedState?: BackgroundFlashcardReviewState,
) {
  const value = session.value
  if (!value || !nativeFlashcardBackgroundIsAvailable()) return false
  const state = providedState || await backgroundFlashcardReviewState()
  if (!state) return false
  if (state.sessionId !== value.id) {
    await stopBackgroundFlashcardReview()
    nativeBackgroundReady.value = false
    return false
  }
  if (value.mode !== 'passive' || !value.speechEnabled || value.status !== 'running') {
    await stopBackgroundFlashcardReview()
    nativeBackgroundReady.value = false
    return false
  }

  reconcilingBackground.value = true
  nativeBackgroundReady.value = false
  await stopFlashcardSpeech()
  await stopBackgroundFlashcardReview(false)
  localElapsedMs.value = Math.max(localElapsedMs.value, state.elapsedMs)
  lastTickAt = Date.now()

  const completed = value.indefinite
    ? Math.max(0, state.completedCards)
    : Math.min(Math.max(0, state.completedCards), value.queue.length)
  const previousViewedCount = value.viewedCount
  const replayedAll = completed === 0 || await performAction('view', {
    syncNative: false,
    playCompletionCue: false,
    viewCount: completed,
  })
  const reconciledAllViews = replayedAll
    && (session.value?.viewedCount || 0) >= previousViewedCount + completed

  if (reconciledAllViews && session.value?.status === 'running' && currentCard.value) {
    passiveSide.value = state.side
    passiveRemainingMs.value = Math.max(1, state.remainingMs)
    savePassiveState()
  }
  reconcilingBackground.value = false

  if (!reconciledAllViews) return true
  await stopBackgroundFlashcardReview()
  if (session.value?.status === 'running') {
    lastSpokenKey = speechKey()
    await syncNativeBackground()
  }
  return true
}

function copySessionSettings(value: FlashcardReviewSession) {
  Object.assign(sessionSettingsDraft, {
    mode: value.mode,
    cardSides: value.cardSides,
    indefinite: value.indefinite,
    maxCards: value.maxCards,
    frontSeconds: value.frontSeconds,
    backSeconds: value.backSeconds,
    backSpeechRepeatCount: value.backSpeechRepeatCount,
    noteBeforeBack: value.noteBeforeBack,
    speechEnabled: value.speechEnabled,
    frontLanguage: value.frontLanguage,
    backLanguage: value.backLanguage,
    sortMode: value.sortMode,
    sortDirection: value.sortDirection,
  })
}

async function openSessionSettings() {
  cardMenuOpen.value = false
  const value = session.value
  if (!value || busy.value) return
  resumeAfterSessionSettings = value.status === 'running'
  if (resumeAfterSessionSettings) await pauseReview(false)
  if (!session.value || isFinished.value) return
  copySessionSettings(session.value)
  sessionSettingsOriginal.value = flashcardReviewSettingsSignature(sessionSettingsDraft)
  sessionSettingsError.value = ''
  sessionSettingsDialog.value = true
  sessionSpeechLoading.value = true
  try {
    sessionSpeechSupport.value = await loadFlashcardSpeechSupport()
  } finally {
    sessionSpeechLoading.value = false
  }
}

async function closeSessionSettings() {
  sessionSettingsApplyMenu.value = false
  sessionSettingsDialog.value = false
  sessionSettingsError.value = ''
  if (resumeAfterSessionSettings && session.value?.status === 'paused') {
    await resumeReview()
  }
  resumeAfterSessionSettings = false
}

async function saveSessionSettings(target: FlashcardSettingsApplyTarget = 'session') {
  const result = await sessionSettingsForm.value?.validate()
  if (!result?.valid || !canSaveSessionSettings.value || !session.value) return
  sessionSettingsSaving.value = true
  sessionSettingsError.value = ''
  try {
    if (target === 'review-set') {
      const reviewSet = currentReviewSet.value
      if (!reviewSet) throw new Error('This review session is not linked to a Review set.')
      const settings = { ...reviewSet, ...sessionSettingsDraft }
      if (reviewSet.accessRole === 'owner') {
        await store.saveReviewSet(settings)
      } else {
        await store.saveReviewSetPreferences(reviewSet.id, settings)
      }
      await closeSessionSettings()
      return
    }

    const updated = await store.updateSessionSettings(session.value.id, sessionSettingsDraft)
    localElapsedMs.value = updated.elapsedSeconds * 1000
    lastTickAt = Date.now()
    lastSpokenKey = ''
    speechPlaybackWarning.value = ''
    resetCurrentCardPhase()
    await closeSessionSettings()
  } catch (cause) {
    sessionSettingsError.value = cause instanceof Error
      ? cause.message
      : 'Could not update this review session.'
  } finally {
    sessionSettingsSaving.value = false
  }
}

function applySessionSettingsTo(target: FlashcardSettingsApplyTarget) {
  sessionSettingsApplyMenu.value = false
  void saveSessionSettings(target)
}

async function openCardEditor(action: 'add' | 'edit') {
  cardMenuOpen.value = false
  if (!session.value || busy.value || !canManageCurrentCard.value) return
  resumeAfterCardEditor = session.value.status === 'running'
  if (resumeAfterCardEditor) await pauseReview(false)
  try {
    if (currentReviewSet.value && currentReviewSet.value.accessRole !== 'owner') {
      await store.loadReviewSetCards(currentReviewSet.value.id)
    }
    cardEditorCard.value = action === 'edit' ? currentSourceCard.value : undefined
    if (action === 'edit' && !cardEditorCard.value) throw new Error('That flashcard could not be found.')
    cardEditorDialog.value = true
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not open this flashcard.'
    await closeCardEditor(false)
  }
}

async function closeCardEditor(open: boolean) {
  cardEditorDialog.value = open
  if (!open && resumeAfterCardEditor && session.value?.status === 'paused') await resumeReview()
  if (!open) resumeAfterCardEditor = false
}

async function openCardTagSheet() {
  if (!canTagCurrentCard.value || cardTagSaving.value || !selectableTags.value.length || !session.value) return
  resumeAfterCardTagSheet = session.value.status === 'running'
  if (resumeAfterCardTagSheet) await pauseReview(false)
  if (session.value && !isFinished.value) cardTagSheet.value = true
  else await closeCardTagSheet(false)
}

async function closeCardTagSheet(open: boolean) {
  cardTagSheet.value = open
  if (!open && resumeAfterCardTagSheet && session.value?.status === 'paused') await resumeReview()
  if (!open) resumeAfterCardTagSheet = false
}

function currentCardHasTag(tagId: string) {
  return Boolean(currentCard.value?.tags.includes(tagId))
}

async function toggleCurrentCardTag(tag: FlashcardTag | { name: string }) {
  const cardId = currentCard.value?.id
  if (!cardId || !canTagCurrentCard.value || cardTagSaving.value) return
  cardTagSaving.value = 'id' in tag ? tag.id : tag.name
  try {
    const resolvedTag = 'id' in tag ? tag : await store.createTag(tag.name)
    const action = currentCardHasTag(resolvedTag.id) ? 'remove_tags' : 'add_tags'
    const updatedCards = await store.bulkUpdateCards(action, [cardId], [resolvedTag.id])
    const updatedCard = updatedCards.find(card => card.id === cardId)
    if (!updatedCard) throw new Error('The flashcard could not be updated.')
    handleCardSaved(updatedCard)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not update this flashcard tag.'
  } finally {
    cardTagSaving.value = ''
  }
}

function handleCardSaved(card: Flashcard) {
  const value = session.value
  if (!value) return
  const snapshot = {
    id: card.id,
    front: card.front,
    back: card.back,
    note: card.note,
    frontAudio: card.frontAudio,
    backAudio: card.backAudio,
    image: card.image,
    tags: [...card.tags],
  }
  const index = value.queue.findIndex(item => item.id === card.id)
  if (index >= 0) value.queue.splice(index, 1, snapshot)
  else if (value.queue.length < value.maxCards) {
    value.queue.push(snapshot)
    value.totalCards += 1
  }
}

function requestCurrentCardDeletion() {
  cardMenuOpen.value = false
  if (!canManageCurrentCard.value) return
  deleteCardId.value = currentCard.value?.id || ''
  deleteCardDialog.value = Boolean(deleteCardId.value)
}

async function deleteCurrentCard() {
  const cardId = deleteCardId.value
  if (!cardId || !session.value || deletingCard.value) return
  const restorePaused = session.value.status === 'paused'
  deletingCard.value = true
  try {
    if (restorePaused) await resumeReview()
    const removed = await performAction('eject')
    if (!removed) return
    if (currentReviewSet.value?.accessRole && currentReviewSet.value.accessRole !== 'owner') {
      await store.deleteReviewSetCard(currentReviewSet.value.id, cardId)
    } else {
      await store.deleteCard(cardId)
    }
    deleteCardDialog.value = false
    deleteCardId.value = ''
    if (restorePaused && session.value?.status === 'running') await pauseReview(false)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not delete this flashcard.'
  } finally {
    deletingCard.value = false
  }
}

function handleSessionMenuAction(action: FlashcardContextAction) {
  if (action === 'add' || action === 'edit') {
    void openCardEditor(action)
  } else if (action === 'settings') {
    void openSessionSettings()
  } else if (action === 'remove') {
    requestCurrentCardDeletion()
  } else if (action === 'eject') {
    void ejectCurrentCard()
  } else if (action === 'undo_eject') {
    void undoLastEject()
  }
}

function handleRunnerSessionAction(action: RunnerSessionAction) {
  if (action === 'options') cardMenuOpen.value = true
  else if (action === 'amplification') void toggleSpeechOverAmplification()
  else if (action === 'eject') void ejectCurrentCard()
  else if (action === 'restart') void restartReview()
  else if (action === 'end') endDialog.value = true
}

async function ejectCurrentCard() {
  cardMenuOpen.value = false
  if (!session.value || busy.value) return
  const restorePaused = session.value.status === 'paused'
  if (restorePaused) await resumeReview()
  await performAction('eject')
  if (restorePaused && session.value?.status === 'running') await pauseReview(false)
}

async function undoLastEject() {
  cardMenuOpen.value = false
  if (!session.value || session.value.ejectedCount <= 0 || busy.value) return
  const restorePaused = session.value.status === 'paused'
  if (restorePaused) await resumeReview()
  await performAction('undo_eject')
  if (restorePaused && session.value?.status === 'running') await pauseReview(false)
}

async function finishEarly() {
  endDialog.value = false
  await performAction('end')
}

async function leaveRunner() {
  await pauseReview(false)
  await router.replace(exitDestination.value)
}
</script>

<template>
  <main class="review-runner safe-bottom">
    <div v-if="loading" class="runner-state">
      <v-progress-circular indeterminate color="secondary" size="42" />
      <p>Preparing your cards…</p>
    </div>

    <div v-else-if="error && !session" class="runner-state px-5">
      <v-icon icon="mdi-alert-circle-outline" color="error" size="46" />
      <h1 class="text-h5 font-weight-black">Review unavailable</h1>
      <p class="muted text-center">{{ error }}</p>
      <v-btn color="secondary" @click="router.replace(exitDestination)">Back to Flashcards</v-btn>
    </div>

    <template v-else-if="session">
      <header v-if="!isReviewSetPreview" class="runner-header">
        <v-btn
          icon="mdi-chevron-down"
          variant="text"
          aria-label="Leave review"
          :disabled="busy"
          @click="leaveRunner"
        />
        <div class="runner-header__title min-width-0">
          <strong class="text-truncate">{{ session.name }}</strong>
          <span v-if="session.indefinite">{{ session.viewedCount }} viewed · looping</span>
          <span v-else>{{ completedCards }} of {{ session.totalCards }}</span>
        </div>
        <div class="runner-header__actions">
          <v-btn
            icon="mdi-dots-vertical"
            variant="text"
            class="runner-actions-button"
            aria-label="Review actions"
            :disabled="sessionActionsDisabled"
            @touchstart.stop
            @click.stop="sessionActionsSheet = true"
          />
        </div>
      </header>

      <v-progress-linear
        v-if="!isReviewSetPreview"
        class="review-progress"
        :model-value="progress"
        color="primary"
        bg-color="surface-variant"
        height="5"
        :aria-label="session.indefinite
          ? `${progress}% through the current loop`
          : `${progress}% of review complete`"
      />

      <v-alert v-if="error" type="error" variant="tonal" density="compact" class="runner-alert">
        {{ error }}
      </v-alert>
      <v-alert
        v-else-if="!isReviewSetPreview && speechWarning"
        type="warning"
        variant="tonal"
        density="compact"
        class="runner-alert runner-alert--speech"
      >
        {{ speechWarning }}
        <template v-if="speechPlaybackWarning" #append>
          <v-btn variant="text" @click="retrySpeech">Try again</v-btn>
        </template>
      </v-alert>

      <RunnerStartScreen
        v-if="isReviewSetPreview"
        class="px-4"
        :title="session.name"
        :summary="`${session.totalCards} ${session.totalCards === 1 ? 'card' : 'cards'}${session.indefinite ? ' · looping' : ''}`"
        icon="mdi-cards-playing-outline"
        primary-label="Start review"
        cancel-label="Cancel review"
        :busy="busy"
        @start="startPreviewReview"
        @cancel="leaveRunner"
      />

      <section v-else-if="isFinished" class="completion-panel">
        <div class="completion-panel__icon">
          <v-icon :icon="session.status === 'completed' ? 'mdi-check-bold' : 'mdi-stop'" size="48" />
        </div>
        <h1 class="display-title">{{ session.status === 'completed' ? 'Review complete' : 'Review ended' }}</h1>
        <p class="muted">
          {{ session.status === 'completed'
            ? session.indefinite
              ? 'Your looping review has been completed.'
              : 'You reached the end of the queue.'
            : 'Your partial progress has been saved.' }}
        </p>
        <div class="completion-stats">
          <div><strong>{{ formatReviewDuration(session.elapsedSeconds) }}</strong><span>Active time</span></div>
          <div><strong>{{ session.viewedCount }}</strong><span>Viewed</span></div>
          <div v-if="session.mode === 'manual'"><strong>{{ session.successCount }}</strong><span>Success</span></div>
          <div v-if="session.mode === 'manual'"><strong>{{ session.errorCount }}</strong><span>Errors</span></div>
          <div v-if="accuracy !== undefined"><strong>{{ accuracy }}%</strong><span>Accuracy</span></div>
          <div><strong>{{ session.ejectedCount }}</strong><span>Ejected</span></div>
        </div>
        <v-btn class="completion-panel__done" size="x-large" color="secondary" @click="router.replace(exitDestination)">Done</v-btn>
      </section>

      <section v-else-if="currentCard" class="runner-body">
        <div class="runner-meta">
          <div>
            <v-icon :icon="session.mode === 'passive' ? 'mdi-play-speed' : 'mdi-gesture-tap'" size="18" />
            <span>{{ session.mode === 'passive' ? 'Passive' : 'Manual' }}</span>
          </div>
          <span>{{ formatReviewDuration(elapsedSeconds) }}</span>
        </div>

        <div class="review-card-stack">
          <div class="review-card-window">
            <transition
              :name="reviewCardTransitionDirection
                ? `standalone-review-card-${reviewCardTransitionDirection}`
                : undefined"
              @after-enter="finishReviewCardTransition"
            >
              <button
                v-if="session.mode === 'manual'"
                v-ripple
                :key="reviewCardTransitionKey"
                type="button"
                class="review-card"
                :class="{ 'review-card--revealed': manualShowingBack }"
                :aria-label="session.speechEnabled
                  ? `Replay ${currentSpeechSide} speech`
                  : session.cardSides === 'both' && !revealed ? 'Show answer' : `${currentSpeechSide} shown`"
                :disabled="busy || (session.status !== 'running' && !canReplayCurrentSide)"
                @pointerdown="beginReviewCardSwipe"
                @pointerup="finishReviewCardSwipe"
                @pointercancel="cancelReviewCardSwipe"
                @click="handleManualCardTap"
              >
                <span class="review-card__inner">
              <span class="review-card__face review-card__front" :aria-hidden="manualShowingBack">
                <small>Front</small>
                <img
                  v-if="currentCard.image"
                  :src="currentCard.image"
                  alt=""
                  class="review-card__image"
                  width="256"
                  height="256"
                />
                <strong :style="{ fontSize: flashcardTextFontSize(currentCard.front) }">
                  {{ currentCard.front }}
                </strong>
                <span v-if="session.speechEnabled" class="review-card__hint">
                  <v-icon icon="mdi-volume-high" size="18" /> Tap to replay
                </span>
                <span v-else-if="session.cardSides === 'both' && !revealed" class="review-card__hint">
                  <v-icon icon="mdi-gesture-tap" size="18" /> Tap to reveal
                </span>
              </span>
              <span class="review-card__face review-card__back" :aria-hidden="!manualShowingBack">
                <small>Back</small>
                <img
                  v-if="currentCard.image"
                  :src="currentCard.image"
                  alt=""
                  class="review-card__image"
                  width="256"
                  height="256"
                />
                <span class="review-card__answer">
                  <span v-if="session.cardSides === 'both'" class="review-card__front-reference">
                    {{ currentCard.front }}
                  </span>
                  <FlashcardResponseText
                    :back="currentCard.back"
                    :note="currentCard.note"
                    :note-before-back="session.noteBeforeBack"
                  />
                </span>
                <span v-if="session.speechEnabled" class="review-card__hint">
                  <v-icon icon="mdi-volume-high" size="18" /> Tap to replay
                </span>
              </span>
                </span>
              </button>

              <div
                v-else
                v-ripple="canReplayCurrentSide"
                :key="reviewCardTransitionKey"
                class="passive-card"
                :class="{ 'passive-card--interactive': canReplayCurrentSide }"
                :role="session.speechEnabled ? 'button' : undefined"
                :tabindex="canReplayCurrentSide ? 0 : undefined"
                :aria-label="session.speechEnabled ? `Replay ${passiveSide} speech` : undefined"
                :aria-disabled="session.speechEnabled ? !canReplayCurrentSide : undefined"
                @pointerdown="beginReviewCardSwipe"
                @pointerup="finishReviewCardSwipe"
                @pointercancel="cancelReviewCardSwipe"
                @click="handlePassiveCardTap"
                @keydown.enter="replayCurrentSide"
                @keydown.space.prevent="replayCurrentSide"
              >
                <div class="passive-card__content">
              <small>{{ passiveSide === 'front' ? 'Front' : 'Back' }}</small>
              <img
                v-if="currentCard.image"
                :src="currentCard.image"
                alt=""
                class="review-card__image"
                width="256"
                height="256"
              />
              <span class="review-card__answer">
                <FlashcardResponseText
                  v-if="passiveSide === 'back'"
                  :back="currentCard.back"
                  :note="currentCard.note"
                  :note-before-back="session.noteBeforeBack"
                />
                <strong
                  v-else
                  :style="{
                    fontSize: flashcardTextFontSize(currentCard.front),
                  }"
                >
                  {{ currentCard.front }}
                </strong>
                <span
                  v-if="passiveSide === 'back' && session.cardSides === 'both'"
                  class="review-card__front-reference"
                >
                  {{ currentCard.front }}
                </span>
              </span>
              <span v-if="session.speechEnabled" class="review-card__hint">
                <v-icon icon="mdi-volume-high" size="18" /> Tap to replay
              </span>
                </div>
                <v-progress-linear
                  class="review-progress"
                  :model-value="passiveProgress"
                  color="secondary"
                  bg-color="surface-variant"
                  height="6"
                  rounded
                />
              </div>
            </transition>
          </div>

          <footer v-if="store.tags" class="review-card__tag-actions" aria-label="Flashcard tags" @click.stop>
            <div class="review-card__quick-tags">
              <v-chip
                v-for="tag in quickTags"
                :key="tag.name"
                class="review-card__tag-control review-card__quick-tag"
                :data-tag-name="tag.name"
                label
                :color="tag.selected ? tag.color : undefined"
                :variant="tag.selected ? 'flat' : 'outlined'"
                :prepend-icon="tag.selected ? 'mdi-check' : 'mdi-tag-outline'"
                :disabled="!canTagCurrentCard"
                :aria-pressed="tag.selected"
                :aria-label="`${tag.selected ? 'Remove' : 'Add'} ${tag.name} tag`"
                @click.stop="toggleCurrentCardTag({ name: tag.name })"
              >
                {{ tag.name }}
              </v-chip>
            </div>
            <v-btn
              class="review-card__tag-control review-card__tag-menu-button"
              variant="text"
              prepend-icon="mdi-tag-multiple-outline"
              :disabled="!canTagCurrentCard || !selectableTags.length"
              @click.stop="openCardTagSheet"
            >
              Tags
            </v-btn>
          </footer>
        </div>

        <div v-if="session.mode === 'manual'" class="grading-actions">
          <v-btn
            v-if="session.cardSides === 'both' && !revealed"
            size="large"
            color="secondary"
            prepend-icon="mdi-eye-outline"
            :disabled="busy || session.status === 'paused'"
            @click="revealed = true"
          >
            Show answer
          </v-btn>
          <template v-else>
            <v-btn
              size="large"
              color="error"
              variant="tonal"
              prepend-icon="mdi-close-thick"
              :loading="busy"
              :disabled="session.status !== 'running'"
              @click="performAction('error')"
            >
              Error
            </v-btn>
            <v-btn
              size="large"
              color="success"
              prepend-icon="mdi-check-bold"
              :loading="busy"
              :disabled="session.status !== 'running'"
              @click="performAction('success')"
            >
              Success
            </v-btn>
          </template>
        </div>

        <footer class="review-navigation" aria-label="Review navigation">
          <div class="review-navigation__control">
            <v-btn
              icon="mdi-skip-previous"
              variant="tonal"
              size="large"
              aria-label="Previous card"
              :disabled="!canNavigateCards || busy"
              @click="navigateLeft"
            />
          </div>
          <div class="review-navigation__control">
            <v-btn
              :icon="session.status === 'paused' ? 'mdi-play' : 'mdi-pause'"
              color="secondary"
              size="x-large"
              :loading="busy"
              :aria-label="isReviewSetPreview
                ? 'Start review'
                : session.status === 'paused' ? 'Resume review' : 'Pause review'"
              @touchstart.stop
              @click.stop="isReviewSetPreview
                ? startPreviewReview()
                : session.status === 'paused' ? resumeReview() : pauseReview(false)"
            />
          </div>
          <div class="review-navigation__control">
            <v-btn
              icon="mdi-skip-next"
              variant="tonal"
              size="large"
              aria-label="Next card"
              :disabled="!canNavigateCards || busy"
              @click="navigateRight"
            />
          </div>
        </footer>

        <div class="review-card-actions d-flex justify-center ga-2">
          <v-btn
            size="large"
            variant="text"
            color="warning"
            prepend-icon="mdi-eject-outline"
            aria-label="Eject current card"
            :disabled="isReviewSetPreview || busy || !currentCard"
            @click="ejectCurrentCard"
          >
            Eject card
          </v-btn>
          <v-btn
            size="large"
            variant="text"
            :disabled="isReviewSetPreview || busy"
            @click="cardMenuOpen = true"
          >
            <template #prepend>
              <v-icon icon="mdi-dots-horizontal" size="1.125rem" />
            </template>
            Options
          </v-btn>
        </div>

      </section>
    </template>

    <RunnerSessionActions
      v-if="session && !isReviewSetPreview && !loading"
      v-model="sessionActionsSheet"
      title="Review actions"
      aria-label="Review session actions"
      :items="sessionActionItems"
      @action="handleRunnerSessionAction"
    />

    <FlashcardContextActions
      v-if="session && !isReviewSetPreview && !loading"
      v-model="cardMenuOpen"
      :busy="busy"
      :can-manage-card="canManageCurrentCard && Boolean(currentCard)"
      :can-add-card="canManageCurrentCard"
      :can-eject-card="Boolean(currentCard)"
      show-undo-eject
      :can-undo-eject="Boolean(session?.ejectedCount)"
      @action="handleSessionMenuAction"
    />

    <ActionBottomSheet
      v-if="store.tags"
      :model-value="cardTagSheet"
      title="Tag flashcard"
      description="Choose any additional tags for this card. Easy and hard stay pinned on the card."
      aria-label="Choose flashcard tags"
      @update:model-value="closeCardTagSheet"
    >
      <v-list-item
        v-for="tag in selectableTags"
        :key="tag.id"
        :data-tag-id="tag.id"
        :title="tag.name"
        :prepend-icon="currentCardHasTag(tag.id) ? 'mdi-check-circle' : 'mdi-tag-outline'"
        :active="currentCardHasTag(tag.id)"
        :disabled="Boolean(cardTagSaving)"
        rounded="lg"
        @click="toggleCurrentCardTag(tag)"
      />
      <v-list-item
        v-if="!selectableTags.length"
        prepend-icon="mdi-tag-off-outline"
        title="No other tags available"
        disabled
        rounded="lg"
      />
    </ActionBottomSheet>

    <FlashcardCardDialog
      :model-value="cardEditorDialog"
      :card="cardEditorCard"
      :review-set-id="currentReviewSet?.accessRole === 'owner' ? undefined : currentReviewSet?.id"
      :initial-tags="session?.tags"
      @update:model-value="closeCardEditor"
      @saved="handleCardSaved"
    />

    <v-snackbar
      v-model="speechFailureSnackbar"
      class="runner-speech-snackbar"
      color="warning"
      location="bottom"
      :timeout="5000"
    >
      <div class="d-flex align-center ga-2">
        <v-icon icon="mdi-alert-outline" />
        <span>This card could not be spoken in the selected language.</span>
      </div>
      <template #actions>
        <v-btn
          icon="mdi-close"
          variant="text"
          aria-label="Dismiss speech warning"
          @click="speechFailureSnackbar = false"
        />
      </template>
    </v-snackbar>

    <AppDialog
      v-model="sessionSettingsDialog"
      persistent
      scrollable
      fullscreen
    >
      <v-card class="session-settings-card" rounded="0">
        <v-card-title class="session-settings-header d-flex align-center ga-3">
          <v-icon icon="mdi-tune-variant" color="secondary" />
          <span>Session settings</span>
        </v-card-title>
        <v-card-text class="px-5 py-4">
          <v-alert
            v-if="sessionSettingsError"
            type="error"
            variant="tonal"
            density="compact"
            class="mb-4"
          >
            {{ sessionSettingsError }}
          </v-alert>
          <AppForm ref="sessionSettingsForm" @submit.prevent="saveSessionSettings">
            <FlashcardReviewSettingsFields
              :model-value="sessionSettingsDraft"
              :speech-support="sessionSpeechSupport"
              :speech-loading="sessionSpeechLoading"
              :min-cards="sessionSettingsMinimumCards"
              :available-cards="sessionSettingsAvailableCards"
              session
            />
          </AppForm>
        </v-card-text>
        <v-divider />
        <v-card-actions class="session-settings-actions ga-2">
          <v-btn
            class="session-settings-actions__cancel"
            variant="text"
            :disabled="sessionSettingsSaving"
            @click="closeSessionSettings"
          >
            Cancel
          </v-btn>
          <v-btn
            class="session-settings-actions__primary apply-settings-menu"
            color="secondary"
            variant="flat"
            :loading="sessionSettingsSaving"
            :disabled="!canSaveSessionSettings || sessionSettingsSaving"
            @click="sessionSettingsApplyMenu = true"
          >
            Apply to...
          </v-btn>
        </v-card-actions>
        <ActionBottomSheet
          v-model="sessionSettingsApplyMenu"
          title="Apply to..."
          aria-label="Choose where to apply session settings"
        >
          <v-list-item
            v-for="item in FLASHCARD_SETTINGS_APPLY_MENU_ITEMS"
            :key="item.target"
            :class="`apply-settings-target--${item.target}`"
            :title="item.title"
            :prepend-icon="item.icon"
            rounded="lg"
            @click="applySessionSettingsTo(item.target)"
          />
        </ActionBottomSheet>
      </v-card>
    </AppDialog>

    <ConfirmDialog
      v-model="endDialog"
      title="End this review?"
      message="Partial statistics will be saved, but an attached task will remain incomplete."
      confirm-text="End review"
      confirm-color="error"
      icon="mdi-stop-circle-outline"
      :loading="busy"
      @confirm="finishEarly"
    />
    <ConfirmDialog
      v-model="deleteCardDialog"
      title="Delete this flashcard?"
      message="The current card will be removed from this session and from future reviews. Existing review history keeps its saved faces."
      confirm-text="Delete flashcard"
      confirm-color="error"
      icon="mdi-delete-outline"
      :loading="busy || deletingCard"
      @confirm="deleteCurrentCard"
    />
  </main>
</template>

<style scoped>
.review-runner { position: fixed; z-index: 1003; inset: 0; display: flex; width: 100%; max-width: 100vw; height: 100dvh; min-height: 0; flex-direction: column; overflow: hidden; background: radial-gradient(circle at 50% 26%, rgba(var(--v-theme-secondary), .08), transparent 34rem), rgb(var(--v-theme-background)); color: rgb(var(--v-theme-on-background)); }
.review-progress,
.review-progress :deep(.v-progress-linear__determinate) { transition: none; }
.runner-header { display: grid; min-height: calc(4rem + max(env(safe-area-inset-top), var(--safe-area-inset-top, 0rem))); padding: max(env(safe-area-inset-top), var(--safe-area-inset-top, 0rem)) 1rem 0; grid-template-columns: 2.75rem minmax(0, 1fr) auto; align-items: center; gap: .75rem; }
.runner-header__title { display: flex; flex-direction: column; align-items: center; }
.runner-header__title strong { max-width: 100%; font-size: .88rem; }
.runner-header__title span { color: rgba(var(--v-theme-on-surface), .52); font-size: .68rem; font-weight: 800; }
.runner-header__actions { display: flex; align-items: center; justify-content: flex-end; gap: .125rem; }
.runner-actions-button { min-width: 2.75rem; min-height: 2.75rem; }
.runner-state { display: flex; min-height: 100dvh; align-items: center; justify-content: center; flex-direction: column; gap: 1rem; }
.runner-alert { width: min(44rem, calc(100% - 2rem)); flex: 0 0 auto; margin: 1rem auto 0; }
.runner-alert--speech { width: fit-content; max-width: calc(100% - 2rem); margin-top: .5rem; padding: .25rem .5rem !important; font-size: .7rem; line-height: 1.35; }
.runner-alert--speech :deep(.v-alert__prepend) { min-height: 1rem; margin-inline-end: .4rem; }
.runner-alert--speech :deep(.v-alert__prepend > .v-icon) { width: 1rem; height: 1rem; font-size: 1rem; }
.runner-alert--speech :deep(.v-alert__append) { align-self: center; margin-inline-start: .5rem; }
.runner-speech-snackbar { z-index: 1004 !important; }
.runner-body { display: flex; width: 100%; max-width: 44rem; min-height: 0; margin: 0 auto; padding: 1rem 1rem .5rem; flex: 1 1 auto; flex-direction: column; gap: .875rem; overflow-y: auto; overscroll-behavior: contain; }
.runner-meta { display: flex; align-items: center; justify-content: space-between; gap: 1rem; color: rgba(var(--v-theme-on-surface), .68); font-size: .75rem; font-weight: 850; }
.runner-meta > div { display: flex; align-items: center; gap: .4rem; }
.review-card-stack { position: relative; display: flex; width: 100%; min-height: min(38dvh, 22rem); flex: 1 1 auto; flex-direction: column; }
.review-card-window { display: grid; width: 100%; min-height: min(38dvh, 22rem); flex: 1 1 auto; overflow: hidden; border-radius: 1.5rem; perspective: 80rem; }
.review-card-window > * { width: 100%; min-height: inherit; grid-area: 1 / 1; }
.review-card { position: relative; width: 100%; min-height: min(38dvh, 22rem); border: 0; border-radius: 1.5rem; flex: 1 1 auto; overflow: hidden; background: transparent; color: inherit; cursor: pointer; perspective: 80rem; touch-action: none; }
.review-card :deep(.v-ripple__container) { z-index: 2; }
.review-card:focus-visible { outline: .1875rem solid rgba(var(--v-theme-secondary), .72); outline-offset: .25rem; }
.review-card__inner { position: relative; display: grid; height: 100%; min-height: inherit; transform-style: preserve-3d; transition: transform 240ms cubic-bezier(.22, 1, .36, 1); }
.review-card--revealed .review-card__inner { transform: rotateY(180deg); }
.review-card__face { position: relative; display: flex; min-height: inherit; padding: 2rem 2rem 5.5rem; border: .0625rem solid rgba(var(--v-theme-on-surface), .1); border-radius: 1.5rem; grid-area: 1 / 1; align-items: center; justify-content: center; flex-direction: column; gap: 1.5rem; overflow: auto; background: rgb(var(--v-theme-surface)); box-shadow: 0 1rem 2.5rem rgba(0, 0, 0, .26); backface-visibility: hidden; }
.review-card__face > :not(.review-card__image),
.passive-card__content > :not(.review-card__image) { position: relative; z-index: 1; }
.review-card__face small,
.passive-card small { color: rgba(var(--v-theme-on-surface), .48); font-size: .68rem; font-weight: 900; letter-spacing: .12em; text-transform: uppercase; }
.review-card__face strong,
.passive-card strong { max-width: 34rem; overflow-wrap: anywhere; font-size: clamp(1.3rem, 5vw, 2.1rem); font-weight: 850; line-height: 1.35; white-space: pre-wrap; }
.review-card__answer { display: flex; align-items: center; flex-direction: column; gap: .45rem; }
.review-card__image { position: absolute; z-index: 0; inset: 0; width: 100%; height: 100%; max-height: none; border-radius: 1.5rem; object-fit: cover; opacity: .58; pointer-events: none; filter: brightness(.42) saturate(.82); }
.review-card__front-reference { max-width: 30rem; overflow-wrap: anywhere; color: rgba(var(--v-theme-on-surface), .48); font-size: clamp(.72rem, 2.2vw, .88rem); line-height: 1.4; white-space: pre-wrap; }
.review-card__back { border-color: rgba(var(--v-theme-secondary), .34); transform: rotateY(180deg); }
.review-card__hint { display: flex; align-items: center; gap: .4rem; color: rgba(var(--v-theme-on-surface), .48); font-size: .72rem; font-weight: 800; }
.passive-card { position: relative; display: flex; width: 100%; min-height: min(38dvh, 22rem); padding: 2rem 2rem 5.5rem; border: .0625rem solid rgba(var(--v-theme-secondary), .28); border-radius: 1.5rem; align-items: center; flex: 1 1 auto; flex-direction: column; gap: 1.5rem; overflow: hidden; background: rgb(var(--v-theme-surface)); color: inherit; font: inherit; text-align: center; touch-action: none; box-shadow: 0 1rem 2.5rem rgba(0, 0, 0, .26); }
.passive-card--interactive { cursor: pointer; }
.passive-card__content { display: flex; width: 100%; flex: 1 1 auto; align-items: center; justify-content: center; flex-direction: column; gap: 1.5rem; }
.passive-card .v-progress-linear { width: min(20rem, 100%); flex: 0 0 auto; }
.review-card__tag-actions { position: absolute; z-index: 3; right: 1.5rem; bottom: 1.25rem; left: 1.5rem; display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; gap: .5rem; }
.review-card__quick-tags { display: flex; grid-column: 1; justify-self: start; gap: .5rem; }
.review-card__quick-tag.v-chip--variant-outlined { border-color: rgba(var(--v-theme-on-surface), .18); }
.review-card__tag-menu-button { min-width: 0; grid-column: 3; justify-self: end; }
.standalone-review-card-next-enter-active,
.standalone-review-card-next-leave-active,
.standalone-review-card-previous-enter-active,
.standalone-review-card-previous-leave-active,
.standalone-review-card-front-enter-active,
.standalone-review-card-front-leave-active,
.standalone-review-card-back-enter-active,
.standalone-review-card-back-leave-active {
  transition: opacity 160ms ease, transform 180ms cubic-bezier(.22, 1, .36, 1);
}
.standalone-review-card-next-enter-from,
.standalone-review-card-previous-leave-to { opacity: 0; transform: translateX(1.5rem); }
.standalone-review-card-next-leave-to,
.standalone-review-card-previous-enter-from { opacity: 0; transform: translateX(-1.5rem); }
.standalone-review-card-back-enter-from,
.standalone-review-card-front-leave-to { opacity: 0; transform: translateY(1.5rem); }
.standalone-review-card-back-leave-to,
.standalone-review-card-front-enter-from { opacity: 0; transform: translateY(-1.5rem); }
.standalone-review-card-flip-front-enter-active,
.standalone-review-card-flip-front-leave-active,
.standalone-review-card-flip-back-enter-active,
.standalone-review-card-flip-back-leave-active {
  backface-visibility: hidden;
  transform-origin: center;
  transition: opacity 450ms ease, transform 450ms cubic-bezier(.22, 1, .36, 1);
  will-change: opacity, transform;
}
.standalone-review-card-flip-back-enter-from,
.standalone-review-card-flip-front-leave-to { opacity: .35; transform: rotateY(72deg); }
.standalone-review-card-flip-back-leave-to,
.standalone-review-card-flip-front-enter-from { opacity: .35; transform: rotateY(-72deg); }
.review-navigation { display: grid; margin-top: auto; padding-top: .25rem; grid-template-columns: repeat(3, minmax(0, 1fr)); align-items: center; justify-items: center; gap: 1rem; }
.review-navigation__control { display: flex; min-width: 0; align-items: center; }
.grading-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .75rem; }
.grading-actions > .v-btn:only-child { grid-column: 1 / -1; }
.grading-actions .v-btn { min-height: 3.25rem; }
.session-settings-card { min-height: 100dvh; }
.session-settings-header {
  padding:
    calc(1.25rem + max(env(safe-area-inset-top, 0rem), var(--safe-area-inset-top, 0rem)))
    calc(1.25rem + env(safe-area-inset-right, 0rem))
    1rem
    calc(1.25rem + env(safe-area-inset-left, 0rem)) !important;
}
.session-settings-actions {
  display: flex;
  align-items: center;
  padding:
    1rem
    calc(1rem + env(safe-area-inset-right, 0rem))
    calc(1rem + max(env(safe-area-inset-bottom, 0rem), var(--safe-area-inset-bottom, 0rem)))
    calc(1rem + env(safe-area-inset-left, 0rem)) !important;
}
.session-settings-actions > .v-btn { height: 3rem; }
.session-settings-actions__cancel,
.session-settings-actions__primary {
  min-width: 0;
  flex: 1 1 0;
}
@media (min-width: 60rem) {
  .session-settings-actions { justify-content: flex-end; }
  .session-settings-actions__cancel,
  .session-settings-actions__primary { max-width: 10rem; }
}
.completion-panel { display: flex; width: min(42rem, calc(100% - 2rem)); min-height: 0; margin: 0 auto; padding: 2rem 0; align-items: center; justify-content: center; flex: 1 1 auto; flex-direction: column; gap: 1.25rem; overflow-y: auto; text-align: center; }
.completion-panel__icon { display: grid; width: 6rem; height: 6rem; place-items: center; border-radius: 2rem; background: rgba(var(--v-theme-secondary), .16); color: rgb(var(--v-theme-secondary)); }
.completion-panel h1 { font-size: clamp(2.6rem, 10vw, 5rem); }
.completion-panel__done { width: 100%; flex: 0 0 auto; }
.completion-stats { display: grid; width: 100%; margin: 1rem 0; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: .6rem; }
.completion-stats > div { display: flex; padding: 1rem .5rem; border-radius: 1rem; grid-column: span 2; flex-direction: column; background: rgba(var(--v-theme-on-surface), .06); }
.completion-stats > div:last-child:nth-child(3n + 1) { grid-column: 1 / -1; }
.completion-stats > div:nth-last-child(2):nth-child(3n + 1),
.completion-stats > div:last-child:nth-child(3n + 2) { grid-column: span 3; }
.completion-stats strong { font-size: 1.25rem; }
.completion-stats span { margin-top: .2rem; color: rgba(var(--v-theme-on-surface), .52); font-size: .65rem; font-weight: 800; text-transform: uppercase; }
@media (prefers-reduced-motion: reduce) {
  .review-card__inner { transition: opacity 160ms ease; }
  .review-card--revealed .review-card__inner { transform: rotateY(180deg); }
  .standalone-review-card-next-enter-active,
  .standalone-review-card-next-leave-active,
  .standalone-review-card-previous-enter-active,
  .standalone-review-card-previous-leave-active,
  .standalone-review-card-front-enter-active,
  .standalone-review-card-front-leave-active,
  .standalone-review-card-back-enter-active,
  .standalone-review-card-back-leave-active,
  .standalone-review-card-flip-front-enter-active,
  .standalone-review-card-flip-front-leave-active,
  .standalone-review-card-flip-back-enter-active,
  .standalone-review-card-flip-back-leave-active { transition: none; }
  .standalone-review-card-next-enter-from,
  .standalone-review-card-next-leave-to,
  .standalone-review-card-previous-enter-from,
  .standalone-review-card-previous-leave-to,
  .standalone-review-card-front-enter-from,
  .standalone-review-card-front-leave-to,
  .standalone-review-card-back-enter-from,
  .standalone-review-card-back-leave-to,
  .standalone-review-card-flip-front-enter-from,
  .standalone-review-card-flip-front-leave-to,
  .standalone-review-card-flip-back-enter-from,
  .standalone-review-card-flip-back-leave-to { opacity: 1; transform: none; }
}
</style>
