<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import {
  backgroundFlashcardReviewState,
  nativeFlashcardBackgroundIsAvailable,
  speakFlashcardText,
  stopBackgroundFlashcardReview,
  stopFlashcardSpeech,
  syncBackgroundFlashcardReview,
} from '@/services/flashcardSpeech'
import { playReviewCompleteCue } from '@/services/intervalCues'
import { requestScreenWakeLock, type ScreenWakeLock } from '@/services/screenWakeLock'
import {
  flashcardSideFromSwipe,
  flashcardTextFontSize,
  formatReviewDuration,
  sessionAccuracy,
} from '@/services/flashcards'
import { useFlashcardStore } from '@/stores/flashcards'
import type {
  BackgroundFlashcardReviewState,
  FlashcardReviewAction,
  FlashcardReviewSession,
  FlashcardReviewSide,
} from '@/types/domain'

const route = useRoute()
const router = useRouter()
const store = useFlashcardStore()
const loading = ref(true)
const busy = ref(false)
const error = ref('')
const revealed = ref(false)
const endDialog = ref(false)
const tickVersion = ref(0)
const passiveSide = ref<'front' | 'back'>('front')
const passiveRemainingMs = ref(0)
const localElapsedMs = ref(0)
const visibilityPaused = ref(false)
const nativeBackgroundReady = ref(false)
const speechPlaybackWarning = ref('')
const backgroundSpeechWarning = ref('')
const reconcilingBackground = ref(false)
let tickTimer: ReturnType<typeof setInterval> | undefined
let lastTickAt = 0
let mounted = true
let skipLeavePause = false
let passiveAdvancing = false
let visibilityWork: Promise<void> = Promise.resolve()
let lastSpokenKey = ''
let speechRequest = 0
let wakeLock: ScreenWakeLock | undefined
let acquiringWakeLock = false
let wakeLockRetryRequested = false
let manualSwipeStart: { pointerId: number; x: number; y: number } | undefined
let suppressManualCardTap = false
let manualCardTapResetTimer: number | undefined

const currentSessionId = ref('')
const session = computed(() => store.sessions.find(item => item.id === currentSessionId.value))
const currentCard = computed(() => session.value?.queue[0])
const isFinished = computed(() => session.value?.status === 'completed' || session.value?.status === 'ended')
const isRunning = computed(() => session.value?.status === 'running')
const shouldKeepScreenAwake = computed(() => Boolean(session.value && !isFinished.value))
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
const passiveDurationMs = computed(() => {
  if (!session.value) return 1000
  return (passiveSide.value === 'front' ? session.value.frontSeconds : session.value.backSeconds) * 1000
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
  ? (revealed.value ? 'back' : 'front')
  : passiveSide.value)
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

watch([
  loading,
  () => session.value?.status,
  () => session.value?.speechEnabled,
  () => currentCard.value?.id,
  currentSpeechSide,
], () => {
  void speakCurrentSide()
}, { flush: 'post' })

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
      const active = store.activeSession
      const started = active || await store.startReview(route.params.reviewSetId, {
        task: typeof route.query.task === 'string' ? route.query.task : undefined,
        programStep: typeof route.query.step === 'string' ? route.query.step : undefined,
        taskDate: typeof route.query.date === 'string' ? route.query.date : undefined,
      })
      currentSessionId.value = started.id
      initializeLocalState(started)
      skipLeavePause = true
      await router.replace({
        name: 'flashcard-review-runner',
        params: { sessionId: started.id },
        query: {
          ...(route.query.from ? { from: route.query.from } : {}),
        },
      })
      skipLeavePause = false
    } else {
      throw new Error('This review could not be found.')
    }
    const restoredBackground = await reconcileBackgroundReview()
    if (!restoredBackground) await syncNativeBackground()
    tickTimer = setInterval(tick, 100)
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
  if (tickTimer) clearInterval(tickTimer)
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
  return `mom-flashcard-passive:${id}`
}

function restorePassiveState(value: FlashcardReviewSession) {
  passiveSide.value = 'front'
  passiveRemainingMs.value = value.frontSeconds * 1000
  if (value.mode !== 'passive') return
  try {
    const saved = JSON.parse(localStorage.getItem(passiveStorageKey(value.id)) || '')
    if (saved?.cardId === value.queue[0]?.id && (saved.side === 'front' || saved.side === 'back')) {
      passiveSide.value = saved.side
      passiveRemainingMs.value = Math.max(1, Number(saved.remainingMs) || passiveDurationMs.value)
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
  if (!isRunning.value || document.visibilityState !== 'visible' || busy.value) return
  localElapsedMs.value += delta
  if (session.value?.mode === 'passive' && currentCard.value) {
    passiveRemainingMs.value = Math.max(0, passiveRemainingMs.value - delta)
    if (passiveRemainingMs.value === 0 && !passiveAdvancing) void advancePassive()
  }
  tickVersion.value++
}

async function advancePassive() {
  if (!session.value || session.value.mode !== 'passive' || passiveAdvancing) return
  if (passiveSide.value === 'front') {
    passiveSide.value = 'back'
    passiveRemainingMs.value = session.value.backSeconds * 1000
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
  passiveSide.value = 'front'
  passiveRemainingMs.value = (session.value?.frontSeconds || 5) * 1000
  if (isFinished.value) clearPassiveState()
  else savePassiveState()
}

async function navigateLeft() {
  if (!session.value || !canNavigateCards.value || busy.value) return
  await performAction('previous')
}

async function navigateRight() {
  if (!session.value || !canNavigateCards.value || busy.value) return
  await performAction('next')
}

async function performAction(
  action: FlashcardReviewAction,
  options: { syncNative?: boolean; playCompletionCue?: boolean } = {},
) {
  if (!session.value || busy.value) return false
  const previousStatus = session.value.status
  tick()
  busy.value = true
  error.value = ''
  let succeeded = false
  try {
    const updated = await store.act(session.value.id, action, elapsedSeconds.value)
    localElapsedMs.value = updated.elapsedSeconds * 1000
    lastTickAt = Date.now()
    if (['success', 'error', 'view', 'previous', 'next', 'push', 'eject'].includes(action)) resetCurrentCardPhase()
    if (
      previousStatus === 'running'
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

async function resumeReview() {
  if (!session.value || session.value.status !== 'paused' || busy.value) return
  await performAction('resume')
  lastTickAt = Date.now()
  visibilityPaused.value = false
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

function speechKey() {
  if (!currentCard.value || !session.value?.speechEnabled || session.value.status !== 'running') return ''
  return `${currentCard.value.id}:${currentSpeechSide.value}`
}

async function speakCurrentSide() {
  const request = ++speechRequest
  const value = session.value
  const card = currentCard.value
  const key = speechKey()
  if (
    loading.value
    || reconcilingBackground.value
    || document.visibilityState !== 'visible'
    || !value
    || !card
    || !key
  ) {
    if (!key || value?.status !== 'running') lastSpokenKey = ''
    await stopFlashcardSpeech()
    return
  }
  if (key === lastSpokenKey) return

  lastSpokenKey = key
  const side = currentSpeechSide.value
  try {
    await speakFlashcardText(
      side === 'front' ? card.front : card.back,
      side === 'front' ? value.frontLanguage : value.backLanguage,
    )
    if (request === speechRequest) speechPlaybackWarning.value = ''
  } catch {
    if (request === speechRequest) {
      speechPlaybackWarning.value = 'This card could not be spoken in the selected language.'
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
    !session.value?.speechEnabled
    || session.value.status !== 'running'
    || !currentCard.value
    || busy.value
    || document.visibilityState !== 'visible'
  ) return false

  lastSpokenKey = ''
  speechPlaybackWarning.value = ''
  void speakCurrentSide()
  return true
}

function handleManualCardTap() {
  if (suppressManualCardTap) {
    suppressManualCardTap = false
    return
  }
  if (replayCurrentSide()) return
  if (!revealed.value && session.value?.status === 'running' && !busy.value) revealed.value = true
}

function beginManualCardSwipe(event: PointerEvent) {
  if (
    session.value?.mode !== 'manual'
    || session.value.status !== 'running'
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

function finishManualCardSwipe(event: PointerEvent) {
  const start = manualSwipeStart
  if (!start || start.pointerId !== event.pointerId) return
  manualSwipeStart = undefined

  const side = flashcardSideFromSwipe(start, { x: event.clientX, y: event.clientY })
  if (!side) return

  suppressManualCardTap = true
  if (manualCardTapResetTimer) window.clearTimeout(manualCardTapResetTimer)
  manualCardTapResetTimer = window.setTimeout(() => {
    suppressManualCardTap = false
    manualCardTapResetTimer = undefined
  }, 250)
  revealed.value = side === 'back'
}

function cancelManualCardSwipe(event: PointerEvent) {
  if (manualSwipeStart?.pointerId === event.pointerId) manualSwipeStart = undefined
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
    : 'Speech will pause if Mom is sent to the background on this device.'
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

  let replayedAll = true
  const completed = value.indefinite
    ? Math.max(0, state.completedCards)
    : Math.min(Math.max(0, state.completedCards), value.queue.length)
  for (let index = 0; index < completed; index += 1) {
    if (session.value?.status !== 'running') break
    const queueLength = session.value.queue.length
    const succeeded = await performAction('view', {
      syncNative: false,
      playCompletionCue: false,
    })
    if (!succeeded || (!value.indefinite && session.value?.queue.length === queueLength)) {
      replayedAll = false
      break
    }
  }

  if (replayedAll && session.value?.status === 'running' && currentCard.value) {
    passiveSide.value = state.side
    passiveRemainingMs.value = Math.max(1, state.remainingMs)
    savePassiveState()
  }
  reconcilingBackground.value = false

  if (!replayedAll) return true
  await stopBackgroundFlashcardReview()
  if (session.value?.status === 'running') {
    lastSpokenKey = speechKey()
    await syncNativeBackground()
  }
  return true
}

async function finishEarly() {
  endDialog.value = false
  await performAction('end')
}

async function leaveRunner() {
  await pauseReview(false)
  await router.replace(exitDestination.value)
}

function tagName(id: string) {
  return store.tags.find(tag => tag.id === id)?.name || 'Removed tag'
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
      <header class="runner-header">
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
        <v-btn
          icon="mdi-stop-circle-outline"
          variant="text"
          color="error"
          aria-label="End review"
          :disabled="isFinished || busy"
          @click="endDialog = true"
        />
      </header>

      <v-progress-linear
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
        v-else-if="speechWarning"
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

      <section v-if="isFinished" class="completion-panel">
        <div class="completion-panel__icon">
          <v-icon :icon="session.status === 'completed' ? 'mdi-check-bold' : 'mdi-stop'" size="48" />
        </div>
        <h1 class="display-title">{{ session.status === 'completed' ? 'Review complete' : 'Review ended' }}</h1>
        <p class="muted">
          {{ session.status === 'completed' ? 'You reached the end of the queue.' : 'Your partial progress has been saved.' }}
        </p>
        <div class="completion-stats">
          <div><strong>{{ formatReviewDuration(session.elapsedSeconds) }}</strong><span>Active time</span></div>
          <div><strong>{{ session.viewedCount }}</strong><span>Viewed</span></div>
          <div v-if="session.mode === 'manual'"><strong>{{ session.successCount }}</strong><span>Success</span></div>
          <div v-if="session.mode === 'manual'"><strong>{{ session.errorCount }}</strong><span>Errors</span></div>
          <div v-if="accuracy !== undefined"><strong>{{ accuracy }}%</strong><span>Accuracy</span></div>
          <div><strong>{{ session.ejectedCount }}</strong><span>Ejected</span></div>
        </div>
        <v-btn class="completion-panel__done" size="large" color="secondary" @click="router.replace(exitDestination)">Done</v-btn>
      </section>

      <section v-else-if="currentCard" class="runner-body">
        <div class="runner-meta">
          <div>
            <v-icon :icon="session.mode === 'passive' ? 'mdi-play-speed' : 'mdi-gesture-tap'" size="18" />
            <span>{{ session.mode === 'passive' ? 'Passive' : 'Manual' }}</span>
          </div>
          <span>{{ formatReviewDuration(elapsedSeconds) }}</span>
        </div>

        <div class="tag-row">
          <v-chip
            v-for="tag in currentCard.tags"
            :key="tag"
            size="small"
            variant="tonal"
            prepend-icon="mdi-tag-outline"
          >
            {{ tagName(tag) }}
          </v-chip>
          <span v-if="!currentCard.tags.length" class="text-caption muted">No tags</span>
        </div>

        <button
          v-if="session.mode === 'manual'"
          v-ripple
          type="button"
          class="review-card"
          :class="{ 'review-card--revealed': revealed }"
          :aria-label="session.speechEnabled
            ? `Replay ${revealed ? 'back' : 'front'} speech`
            : revealed ? 'Answer shown' : 'Show answer'"
          :disabled="session.status === 'paused' || busy"
          @pointerdown="beginManualCardSwipe"
          @pointerup="finishManualCardSwipe"
          @pointercancel="cancelManualCardSwipe"
          @click="handleManualCardTap"
        >
          <span class="review-card__inner">
            <span class="review-card__face review-card__front">
              <small>Front</small>
              <strong :style="{ fontSize: flashcardTextFontSize(currentCard.front) }">
                {{ currentCard.front }}
              </strong>
              <span v-if="session.speechEnabled" class="review-card__hint">
                <v-icon icon="mdi-volume-high" size="18" /> Tap to replay
              </span>
              <span v-else-if="!revealed" class="review-card__hint">
                <v-icon icon="mdi-gesture-tap" size="18" /> Tap to reveal
              </span>
            </span>
            <span class="review-card__face review-card__back">
              <small>Back</small>
              <span class="review-card__answer">
                <strong
                  class="text-secondary"
                  :style="{ fontSize: flashcardTextFontSize(currentCard.back) }"
                >
                  {{ currentCard.back }}
                </strong>
                <span
                  v-if="currentCard.note"
                  class="review-card__note"
                  :style="{ fontSize: flashcardTextFontSize(currentCard.note, 'note') }"
                >
                  {{ currentCard.note }}
                </span>
              </span>
              <span v-if="session.speechEnabled" class="review-card__hint">
                <v-icon icon="mdi-volume-high" size="18" /> Tap to replay
              </span>
            </span>
          </span>
        </button>

        <div
          v-else
          v-ripple="session.speechEnabled && session.status === 'running' && !busy"
          class="passive-card"
          :class="{ 'passive-card--interactive': session.speechEnabled && session.status === 'running' && !busy }"
          :role="session.speechEnabled ? 'button' : undefined"
          :tabindex="session.speechEnabled && session.status === 'running' && !busy ? 0 : undefined"
          :aria-label="session.speechEnabled ? `Replay ${passiveSide} speech` : undefined"
          :aria-disabled="session.speechEnabled ? session.status !== 'running' || busy : undefined"
          @click="replayCurrentSide"
          @keydown.enter="replayCurrentSide"
          @keydown.space.prevent="replayCurrentSide"
        >
          <div class="passive-card__content">
            <small>{{ passiveSide === 'front' ? 'Front' : 'Back' }}</small>
            <span class="review-card__answer">
              <strong
                :class="{ 'text-secondary': passiveSide === 'back' }"
                :style="{
                  fontSize: flashcardTextFontSize(
                    passiveSide === 'front' ? currentCard.front : currentCard.back,
                  ),
                }"
              >
                {{ passiveSide === 'front' ? currentCard.front : currentCard.back }}
              </strong>
              <span
                v-if="passiveSide === 'back' && currentCard.note"
                class="review-card__note"
                :style="{ fontSize: flashcardTextFontSize(currentCard.note, 'note') }"
              >
                {{ currentCard.note }}
              </span>
            </span>
            <span v-if="session.speechEnabled" class="review-card__hint">
              <v-icon icon="mdi-volume-high" size="18" /> Tap to replay
            </span>
          </div>
          <v-progress-linear
            :model-value="passiveProgress"
            color="secondary"
            bg-color="surface-variant"
            height="6"
            rounded
          />
        </div>

        <div v-if="session.mode === 'manual'" class="grading-actions">
          <v-btn
            v-if="!revealed"
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
              @click="performAction('error')"
            >
              Error
            </v-btn>
            <v-btn
              size="large"
              color="success"
              prepend-icon="mdi-check-bold"
              :loading="busy"
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
              :aria-label="session.status === 'paused' ? 'Resume review' : 'Pause review'"
              @touchstart.stop
              @click.stop="session.status === 'paused' ? resumeReview() : pauseReview(false)"
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

        <div class="queue-actions">
          <v-btn
            variant="text"
            prepend-icon="mdi-arrow-down-bold-box-outline"
            :disabled="busy || session.status === 'paused'"
            @click="performAction('push')"
          >
            Push later
          </v-btn>
          <v-btn
            variant="text"
            color="warning"
            prepend-icon="mdi-eject-outline"
            :disabled="busy || session.status === 'paused'"
            @click="performAction('eject')"
          >
            Eject
          </v-btn>
        </div>
      </section>
    </template>

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
  </main>
</template>

<style scoped>
.review-runner { position: fixed; z-index: 1003; inset: 0; display: flex; width: 100%; max-width: 100vw; height: 100dvh; min-height: 0; flex-direction: column; overflow: hidden; background: radial-gradient(circle at 50% 26%, rgba(var(--v-theme-secondary), .08), transparent 34rem), rgb(var(--v-theme-background)); color: rgb(var(--v-theme-on-background)); }
.runner-header { display: grid; min-height: calc(4rem + max(env(safe-area-inset-top), var(--safe-area-inset-top, 0rem))); padding: max(env(safe-area-inset-top), var(--safe-area-inset-top, 0rem)) 1rem 0; grid-template-columns: 2.75rem minmax(0, 1fr) 2.75rem; align-items: center; gap: .75rem; }
.runner-header__title { display: flex; flex-direction: column; align-items: center; }
.runner-header__title strong { max-width: 100%; font-size: .88rem; }
.runner-header__title span { color: rgba(var(--v-theme-on-surface), .52); font-size: .68rem; font-weight: 800; }
.runner-state { display: flex; min-height: 100dvh; align-items: center; justify-content: center; flex-direction: column; gap: 1rem; }
.runner-alert { width: min(44rem, calc(100% - 2rem)); flex: 0 0 auto; margin: 1rem auto 0; }
.runner-alert--speech { width: fit-content; max-width: calc(100% - 2rem); margin-top: .5rem; padding: .25rem .5rem !important; font-size: .7rem; line-height: 1.35; }
.runner-alert--speech :deep(.v-alert__prepend) { min-height: 1rem; margin-inline-end: .4rem; }
.runner-alert--speech :deep(.v-alert__prepend > .v-icon) { width: 1rem; height: 1rem; font-size: 1rem; }
.runner-alert--speech :deep(.v-alert__append) { align-self: center; margin-inline-start: .5rem; }
.runner-body { display: flex; width: 100%; max-width: 44rem; min-height: 0; margin: 0 auto; padding: 1rem 1rem .5rem; flex: 1 1 auto; flex-direction: column; gap: .875rem; overflow-y: auto; overscroll-behavior: contain; }
.runner-meta { display: flex; align-items: center; justify-content: space-between; gap: 1rem; color: rgba(var(--v-theme-on-surface), .68); font-size: .75rem; font-weight: 850; }
.runner-meta > div { display: flex; align-items: center; gap: .4rem; }
.tag-row { display: flex; min-height: 2rem; flex-wrap: wrap; justify-content: center; gap: .4rem; }
.review-card { position: relative; width: 100%; min-height: min(38dvh, 22rem); border: 0; border-radius: 1.5rem; flex: 1 1 auto; overflow: hidden; background: transparent; color: inherit; cursor: pointer; perspective: 80rem; touch-action: pan-y; }
.review-card :deep(.v-ripple__container) { z-index: 2; }
.review-card:focus-visible { outline: .1875rem solid rgba(var(--v-theme-secondary), .72); outline-offset: .25rem; }
.review-card__inner { position: relative; display: grid; min-height: inherit; transform-style: preserve-3d; transition: transform 240ms cubic-bezier(.22, 1, .36, 1); }
.review-card--revealed .review-card__inner { transform: rotateY(180deg); }
.review-card__face { display: flex; min-height: inherit; padding: 2rem; border: .0625rem solid rgba(var(--v-theme-on-surface), .1); border-radius: 1.5rem; grid-area: 1 / 1; align-items: center; justify-content: center; flex-direction: column; gap: 1.5rem; overflow: auto; background: rgb(var(--v-theme-surface)); box-shadow: 0 1rem 2.5rem rgba(0, 0, 0, .26); backface-visibility: hidden; }
.review-card__face small,
.passive-card small { color: rgba(var(--v-theme-on-surface), .48); font-size: .68rem; font-weight: 900; letter-spacing: .12em; text-transform: uppercase; }
.review-card__face strong,
.passive-card strong { max-width: 34rem; overflow-wrap: anywhere; font-size: clamp(1.3rem, 5vw, 2.1rem); font-weight: 850; line-height: 1.35; white-space: pre-wrap; }
.review-card__answer { display: flex; align-items: center; flex-direction: column; gap: .45rem; }
.review-card__note { max-width: 32rem; color: rgba(var(--v-theme-on-surface), .6); font-size: .82rem; font-weight: 650; line-height: 1.5; white-space: pre-wrap; }
.review-card__back { border-color: rgba(var(--v-theme-secondary), .34); transform: rotateY(180deg); }
.review-card__hint { display: flex; align-items: center; gap: .4rem; color: rgba(var(--v-theme-on-surface), .48); font-size: .72rem; font-weight: 800; }
.passive-card { position: relative; display: flex; width: 100%; min-height: min(38dvh, 22rem); padding: 2rem; border: .0625rem solid rgba(var(--v-theme-secondary), .28); border-radius: 1.5rem; align-items: center; flex: 1 1 auto; flex-direction: column; gap: 1.5rem; overflow: hidden; background: rgb(var(--v-theme-surface)); color: inherit; font: inherit; text-align: center; box-shadow: 0 1rem 2.5rem rgba(0, 0, 0, .26); }
.passive-card--interactive { cursor: pointer; }
.passive-card__content { display: flex; width: 100%; flex: 1 1 auto; align-items: center; justify-content: center; flex-direction: column; gap: 1.5rem; }
.passive-card .v-progress-linear { width: min(20rem, 100%); flex: 0 0 auto; }
.review-navigation { display: grid; margin-top: auto; padding-top: .25rem; grid-template-columns: repeat(3, minmax(0, 1fr)); align-items: center; justify-items: center; gap: 1rem; }
.review-navigation__control { display: flex; min-width: 0; align-items: center; }
.grading-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .75rem; }
.grading-actions > .v-btn:only-child { grid-column: 1 / -1; }
.queue-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .75rem; }
.queue-actions .v-btn,
.grading-actions .v-btn { min-height: 3.25rem; }
.completion-panel { display: flex; width: min(42rem, calc(100% - 2rem)); min-height: 0; margin: 0 auto; padding: 2rem 0; align-items: center; justify-content: center; flex: 1 1 auto; flex-direction: column; gap: 1.25rem; overflow-y: auto; text-align: center; }
.completion-panel__icon { display: grid; width: 6rem; height: 6rem; place-items: center; border-radius: 2rem; background: rgba(var(--v-theme-secondary), .16); color: rgb(var(--v-theme-secondary)); }
.completion-panel h1 { font-size: clamp(2.6rem, 10vw, 5rem); }
.completion-panel__done { width: 100%; flex: 0 0 auto; }
.completion-stats { display: grid; width: 100%; margin: 1rem 0; grid-template-columns: repeat(auto-fit, minmax(6rem, 1fr)); gap: .6rem; }
.completion-stats > div { display: flex; padding: 1rem .5rem; border-radius: 1rem; flex-direction: column; background: rgba(var(--v-theme-on-surface), .06); }
.completion-stats strong { font-size: 1.25rem; }
.completion-stats span { margin-top: .2rem; color: rgba(var(--v-theme-on-surface), .52); font-size: .65rem; font-weight: 800; text-transform: uppercase; }
@media (prefers-reduced-motion: reduce) {
  .review-card__inner { transition: opacity 160ms ease; }
  .review-card--revealed .review-card__inner { transform: rotateY(180deg); }
}
</style>
