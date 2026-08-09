<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { isValid, parseISO } from 'date-fns'
import { useRoute, useRouter } from 'vue-router'
import ActionBottomSheet from '@/components/ActionBottomSheet.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import FlashcardCardDialog from '@/components/FlashcardCardDialog.vue'
import FlashcardContextActions from '@/components/FlashcardContextActions.vue'
import FlashcardResponseText from '@/components/FlashcardResponseText.vue'
import FlashcardReviewSettingsFields from '@/components/FlashcardReviewSettingsFields.vue'
import AppForm from '@/components/AppForm.vue'
import IntervalTypeIcon from '@/components/IntervalTypeIcon.vue'
import LabeledSlider from '@/components/LabeledSlider.vue'
import { stopBackgroundInterval, syncBackgroundInterval } from '@/services/backgroundInterval'
import {
  speakFlashcardText,
  stopFlashcardSpeech,
} from '@/services/flashcardSpeech'
import {
  cardMatchesTags,
  createIntervalFlashcardReviewSnapshot,
  intervalFlashcardPhase,
  flashcardTextFontSize,
  flashcardReviewSettingsAreValid,
  flashcardReviewSettingsSignature,
} from '@/services/flashcards'
import { loadFlashcardSpeechSupport } from '@/services/flashcardSpeech'
import { createIntervalCueHandoff } from '@/services/intervalCueHandoff'
import {
  notifyIntervalTransition,
  playIntervalCompleteCue,
  playIntervalCountCue,
  playIntervalGoCue,
  prepareIntervalCues,
  requestIntervalWakeLock,
} from '@/services/intervalCues'
import {
  createRuntimeState,
  formatIntervalDuration,
  intervalDefinitionWithRepetitions,
  intervalDuration,
  intervalGlobalRepetitionSettings,
  intervalRunProgress,
  reconcileIntervalRuntime,
  resolveIntervalStep,
  intervalStepDurationSeconds,
  MAX_GLOBAL_REPETITIONS,
  MIN_GLOBAL_REPETITIONS,
} from '@/services/intervals'
import { isTaskScheduled, stepsForDate, toDateKey } from '@/services/schedule'
import { useFlashcardStore } from '@/stores/flashcards'
import { useIntervalStore } from '@/stores/intervals'
import { useTaskStore } from '@/stores/tasks'
import type {
  Flashcard,
  FlashcardContextAction,
  FlashcardReviewSettings,
  FlashcardSpeechSupport,
  IntervalDefinition,
  IntervalFlashcardReviewSnapshot,
  IntervalRuntimeState,
  IntervalSession,
} from '@/types/domain'

const route = useRoute()
const router = useRouter()
const store = useIntervalStore()
const flashcardStore = useFlashcardStore()
const taskStore = useTaskStore()
const displayRemainingMs = ref(0)
const syncing = ref(false)
const starting = ref(false)
const endDialog = ref(false)
const noteDialog = ref(false)
const noteDraft = ref('')
const noteField = ref<{ focus: () => void }>()
const noteSaving = ref(false)
const noteError = ref('')
const repetitionDialog = ref(false)
const selectedRepetitions = ref(MIN_GLOBAL_REPETITIONS)
const repetitionDefinition = ref<IntervalDefinition>()
const pendingRepetitionStart = ref<
  | { kind: 'template'; taskId?: string; programStepId?: string }
  | { kind: 'run-again' }
>()
const repetitionError = ref('')
const attributionSheet = ref(false)
const activeSessionSheet = ref(false)
const flashcardContextSheet = ref(false)
const openingFlashcardContext = ref(false)
const flashcardEditorDialog = ref(false)
const flashcardEditorCard = ref<Flashcard>()
const flashcardDeleteDialog = ref(false)
const flashcardDeleting = ref(false)
const flashcardEjectDialog = ref(false)
const flashcardEjecting = ref(false)
const flashcardSettingsDialog = ref(false)
const flashcardSettingsForm = ref()
const flashcardSettingsSaving = ref(false)
const flashcardSettingsError = ref('')
const flashcardSettingsOriginal = ref('')
const flashcardSpeechLoading = ref(false)
const flashcardSpeechSupport = ref<FlashcardSpeechSupport>({ available: false, languages: [] })
const flashcardSettingsDraft = reactive<FlashcardReviewSettings>({
  mode: 'passive',
  cardSides: 'both',
  indefinite: true,
  maxCards: 1,
  frontSeconds: 5,
  backSeconds: 5,
  backSpeechRepeatCount: 1,
  noteBeforeBack: false,
  speechEnabled: false,
  frontLanguage: '',
  backLanguage: '',
  sortMode: 'difficult',
})
const error = ref('')
const completionError = ref('')
const pendingCompletion = ref<{
  sessionId: string
  runtime: IntervalRuntimeState
  elapsedSeconds: number
  endedAt: string
}>()
const backgroundError = ref('')
const timerEffect = ref<'count' | ''>('')
const timerEffectKey = ref(0)
let ticker: number | undefined
let wakeLock: { release: () => Promise<void> } | undefined
let runnerMounted = false
let lastCountCue = ''
let timerEffectTimeout: number | undefined
let lastSpokenFlashcardKey = ''
let resumeAfterFlashcardContext = false
let resumeAfterFlashcardModal = false
let flashcardSaveWork: Promise<void> = Promise.resolve()
const cueHandoff = createIntervalCueHandoff(document.visibilityState)

const previewSession = ref<IntervalSession>()
const isTemplatePreview = computed(() => Boolean(route.params.templateId))
const persistedSession = computed(() => store.sessions.find((item) => item.id === route.params.sessionId))
const session = computed(() => persistedSession.value || previewSession.value)
const current = computed(() => session.value ? resolveIntervalStep(session.value.definition, session.value.runtime.stepIndex) : undefined)
const next = computed(() => session.value ? resolveIntervalStep(session.value.definition, session.value.runtime.stepIndex + 1) : undefined)
const finished = computed(() => session.value?.status === 'completed' || session.value?.status === 'ended')
const currentConfirmation = computed(() => current.value?.step.kind === 'confirmation')
const sessionElapsedMs = computed(() => {
  displayRemainingMs.value
  const item = session.value
  if (!item) return 0
  if (item.status !== 'running' || !item.runtime.stepStartedAt) return item.runtime.accumulatedMs
  return item.runtime.accumulatedMs
    + Math.max(0, Date.now() - new Date(item.runtime.stepStartedAt).getTime())
})
const flashcardPhase = computed(() => session.value?.flashcardReview
  ? intervalFlashcardPhase(session.value.flashcardReview, sessionElapsedMs.value)
  : undefined)
const flashcardReviewSet = computed(() => flashcardStore.reviewSets
  .find(item => item.id === session.value?.flashcardReview?.reviewSet))
const canManageIntervalCards = computed(() => Boolean(
  flashcardReviewSet.value && flashcardReviewSet.value.accessRole !== 'readonly',
))
const intervalFlashcardSource = computed(() => {
  const reviewSet = flashcardReviewSet.value
  if (!reviewSet) return []
  return reviewSet.accessRole === 'owner'
    ? flashcardStore.cards
    : flashcardStore.reviewSetCards[reviewSet.id] || []
})
const currentFlashcardRecord = computed(() => intervalFlashcardSource.value
  .find(card => card.id === flashcardPhase.value?.card.id))
const flashcardSettingsChanged = computed(() => flashcardSettingsDialog.value
  && flashcardReviewSettingsSignature(flashcardSettingsDraft) !== flashcardSettingsOriginal.value)
const canSaveFlashcardSettings = computed(() => flashcardSettingsChanged.value
  && flashcardReviewSettingsAreValid(flashcardSettingsDraft))
const remainingLabel = computed(() => {
  const totalSeconds = Math.max(0, Math.ceil(displayRemainingMs.value / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  return `${String(minutes).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`
})
const progress = computed(() => {
  if (!session.value || !current.value) {
    return { total: finished.value ? 100 : 0, item: finished.value ? 100 : 0 }
  }
  return intervalRunProgress(
    session.value.definition,
    current.value.index,
    displayRemainingMs.value,
  )
})
const showTotalProgress = computed(() => (current.value?.totalSteps || 0) > 1)
const showRoundProgress = computed(() => progress.value.round !== undefined)
const elapsedSeconds = computed(() => {
  const item = session.value
  if (!item) return 0
  if (item.status !== 'running' || !item.runtime.stepStartedAt) return Math.round(item.runtime.accumulatedMs / 1000)
  return Math.round((item.runtime.accumulatedMs + Math.max(0, Date.now() - new Date(item.runtime.stepStartedAt).getTime())) / 1000)
})
const hasStarted = computed(() => {
  const item = session.value
  if (!item) return false
  const initialStep = resolveIntervalStep(item.definition, 0)
  const initialDurationMs = initialStep ? intervalStepDurationSeconds(initialStep.step) * 1000 : 0
  return item.runtime.stepIndex > 0
    || item.runtime.accumulatedMs > 0
    || item.runtime.remainingMs < initialDurationMs
})
const playActionLabel = computed(() => hasStarted.value ? 'Resume' : 'Start')
const returnTo = computed(() => route.query.from === 'tasks' ? '/tasks' : '/intervals')
const originTaskId = computed(() => typeof route.query.task === 'string' ? route.query.task : '')
const originProgramStepId = computed(() => typeof route.query.step === 'string' ? route.query.step : '')
const originTaskDate = computed(() => {
  if (typeof route.query.date !== 'string') return toDateKey(new Date())
  const parsed = parseISO(route.query.date)
  return isValid(parsed) && toDateKey(parsed) === route.query.date
    ? route.query.date
    : toDateKey(new Date())
})
const attachedProgressCandidates = computed(() => {
  const templateId = typeof route.params.templateId === 'string' ? route.params.templateId : session.value?.template
  if (!templateId) return []
  const taskDate = originTaskId.value ? parseISO(originTaskDate.value) : new Date()
  const taskProgress = taskStore.tasks
    .filter((task) => task.type === 'interval' && task.intervalTemplate === templateId)
    .map((task) => taskStore.makeProgress(task, taskDate))
  const stepProgress = taskStore.steps
    .filter((step) => step.active
      && step.completionType === 'interval'
      && step.intervalTemplate === templateId)
    .flatMap((step) => {
      const task = taskStore.tasks.find((item) => item.id === step.task && item.type === 'program')
      return task ? [taskStore.makeProgress(task, taskDate, step)] : []
    })
  return [...taskProgress, ...stepProgress]
})
const eligibleTaskProgress = computed(() => {
  const today = new Date()
  return attachedProgressCandidates.value
    .filter((item) => (item.status === 'pending' || item.status === 'missed')
      && !item.complete
      && !item.locked
      && item.task.active
      && (Boolean(item.occurrence)
        || (item.programStep
          ? stepsForDate(item.task, taskStore.steps, today).some((step) => step.id === item.programStep?.id)
          : isTaskScheduled(item.task, today))))
})
const attributedTaskName = computed(() => {
  const taskId = session.value?.task
  if (!taskId) return undefined
  const task = taskStore.tasks.find((item) => item.id === taskId)
  const programStep = session.value?.programStep
    ? taskStore.steps.find((step) => step.id === session.value?.programStep)
    : undefined
  return programStep ? `${task?.name || 'Program'} · ${programStep.name}` : task?.name
})
const noteChanged = computed(() => noteDraft.value.trim() !== (session.value?.note || ''))
const selectedRepetitionDuration = computed(() => repetitionDefinition.value
  ? intervalDuration(intervalDefinitionWithRepetitions(
      repetitionDefinition.value,
      selectedRepetitions.value,
    ))
  : 0)

watch([
  () => session.value?.status,
  () => session.value?.flashcardReview?.speechEnabled,
  () => flashcardPhase.value?.key,
], () => {
  void speakCurrentFlashcardSide()
}, { flush: 'post' })

watch(flashcardContextSheet, (open, wasOpen) => {
  if (wasOpen && !open) void finishFlashcardContext()
})

onMounted(async () => {
  runnerMounted = true
  try {
    await Promise.all([
      store.loaded ? Promise.resolve() : store.load(),
      flashcardStore.loaded ? Promise.resolve() : flashcardStore.load(),
      taskStore.tasks.length ? Promise.resolve() : taskStore.load(),
    ])
    if (isTemplatePreview.value) {
      const template = store.templates.find((item) => item.id === route.params.templateId)
      if (!template) {
        error.value = 'That interval template could not be found.'
        return
      }
      const now = new Date()
      const runtime = createRuntimeState(template.definition, now)
      runtime.stepStartedAt = undefined
      let flashcardReview
      if (template.flashcardReviewSet) {
        const reviewSet = flashcardStore.reviewSets.find(item => item.id === template.flashcardReviewSet)
        if (!reviewSet) {
          error.value = 'The Review set attached to this interval could not be found.'
          return
        }
        const reviewCards = reviewSet.accessRole === 'owner'
          ? flashcardStore.cards
          : await flashcardStore.loadReviewSetCards(reviewSet.id)
        flashcardReview = createIntervalFlashcardReviewSnapshot(reviewSet, reviewCards)
        if (!flashcardReview) {
          error.value = 'The Review set attached to this interval has no matching cards.'
          return
        }
      }
      previewSession.value = {
        id: `template-preview-${template.id}`,
        template: template.id,
        task: originTaskId.value || undefined,
        programStep: originProgramStepId.value || undefined,
        taskDate: originTaskId.value ? originTaskDate.value : toDateKey(now),
        source: 'template',
        status: 'paused',
        name: template.name,
        definition: template.definition,
        cues: template.cues,
        flashcardReview,
        startedAt: now.toISOString(),
        plannedSeconds: intervalDuration(template.definition),
        elapsedSeconds: 0,
        runtime,
        updated: now.toISOString(),
      }
      if (originTaskId.value && !eligibleTaskProgress.value.some((item) =>
        item.task.id === originTaskId.value
        && (item.programStep?.id || '') === originProgramStepId.value,
      )) {
        error.value = 'This interval task or program step is not open today.'
        return
      }
    }
    if (!session.value) {
      error.value = 'That interval session could not be found.'
      return
    }
    displayRemainingMs.value = session.value.runtime.remainingMs
    await tick()
    ticker = window.setInterval(tick, 250)
    document.addEventListener('visibilitychange', handleVisibility)
    cueHandoff.recordVisibility(document.visibilityState)
    window.addEventListener('pagehide', handlePageHide)

    const active = session.value
    if (active?.status === 'running') {
      void prepareIntervalCues(active.cues)
      void syncNativeTimer(active)
      void requestIntervalWakeLock().then(async (lock) => {
        if (!runnerMounted || session.value?.id !== active.id || session.value.status !== 'running') {
          await lock?.release()
          return
        }
        wakeLock = lock
      })
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not restore the interval.'
  }
})

onBeforeUnmount(() => {
  runnerMounted = false
  if (ticker) window.clearInterval(ticker)
  if (timerEffectTimeout) window.clearTimeout(timerEffectTimeout)
  document.removeEventListener('visibilitychange', handleVisibility)
  window.removeEventListener('pagehide', handlePageHide)
  void wakeLock?.release()
  void stopFlashcardSpeech()
})

async function speakCurrentFlashcardSide() {
  const item = session.value
  const review = item?.flashcardReview
  const phase = flashcardPhase.value
  const key = item && phase ? `${item.id}:${phase.key}` : ''
  if (
    document.visibilityState !== 'visible'
    || item?.status !== 'running'
    || !review?.speechEnabled
    || !phase
    || !key
  ) {
    if (!key || item?.status !== 'running') lastSpokenFlashcardKey = ''
    await stopFlashcardSpeech()
    return
  }
  if (key === lastSpokenFlashcardKey) return

  lastSpokenFlashcardKey = key
  try {
    await speakFlashcardText(
      phase.side === 'front' ? phase.card.front : phase.card.back,
      phase.side === 'front' ? review.frontLanguage : review.backLanguage,
    )
  } catch {
    // Speech is optional during intervals; timer playback continues without an inline warning.
  }
}

function pulseTimer(effect: 'count') {
  if (timerEffectTimeout) window.clearTimeout(timerEffectTimeout)
  timerEffect.value = effect
  timerEffectKey.value += 1
  timerEffectTimeout = window.setTimeout(() => {
    timerEffect.value = ''
    timerEffectTimeout = undefined
  }, 560)
}

function reconciled(item: IntervalSession) {
  return item.status === 'running'
    ? reconcileIntervalRuntime(item.definition, item.runtime)
    : { runtime: { ...item.runtime }, completed: false, transitions: 0 }
}

async function syncNativeTimer(item: IntervalSession) {
  try {
    await syncBackgroundInterval(item)
    backgroundError.value = ''
  } catch (cause) {
    backgroundError.value = cause instanceof Error ? cause.message : 'Background interval timing is unavailable.'
  }
}

function mirrorCurrentRuntime() {
  const item = session.value
  if (!item || item.status !== 'running') return
  const result = reconciled(item)
  store.mirrorRuntime(item.id, result.runtime)
}

function handlePageHide() {
  cueHandoff.recordVisibility('hidden')
  mirrorCurrentRuntime()
  void wakeLock?.release()
  wakeLock = undefined
  void stopFlashcardSpeech()
}

async function handleVisibility() {
  cueHandoff.recordVisibility(document.visibilityState)
  if (document.visibilityState === 'visible' && session.value?.status === 'running') {
    wakeLock = await requestIntervalWakeLock()
    await tick()
    lastSpokenFlashcardKey = ''
    await speakCurrentFlashcardSide()
  } else if (document.visibilityState !== 'visible') {
    await wakeLock?.release()
    wakeLock = undefined
    await stopFlashcardSpeech()
  }
}

async function tick() {
  const item = session.value
  if (!item || syncing.value || finished.value || pendingCompletion.value) return
  const suppressCues = cueHandoff.consumeForegroundSuppression(document.visibilityState)
  if (item.status === 'paused') {
    displayRemainingMs.value = item.runtime.remainingMs
    return
  }
  const result = reconciled(item)
  displayRemainingMs.value = result.runtime.remainingMs
  if (!result.transitions) {
    const remainingSeconds = Math.ceil(result.runtime.remainingMs / 1000)
    if (remainingSeconds >= 1 && remainingSeconds <= 3) {
      const cue = `${result.runtime.stepIndex}:${remainingSeconds}`
      if (cue !== lastCountCue) {
        lastCountCue = cue
        if (!suppressCues) {
          pulseTimer('count')
          playIntervalCountCue(item.cues)
        }
      }
    }
  }
  if (!result.transitions) return

  syncing.value = true
  store.mirrorRuntime(item.id, result.runtime)
  try {
    if (result.completed) {
      await completeSession(item, result.runtime, !suppressCues)
      return
    }
    if (!suppressCues) playIntervalGoCue(item.cues)
    const updated = await store.updateSession(item.id, {
      runtime: result.runtime,
      elapsedSeconds: Math.round(result.runtime.accumulatedMs / 1000),
    })
    const resolved = resolveIntervalStep(updated.definition, updated.runtime.stepIndex)
    if (resolved) {
      await notifyIntervalTransition(resolved.step.name, `Interval ${resolved.index + 1} of ${resolved.totalSteps}`)
    }
  } finally {
    syncing.value = false
  }
}

async function completeSession(
  item: IntervalSession,
  runtime: IntervalRuntimeState,
  playCompletionCue = true,
) {
  if (playCompletionCue) playIntervalCompleteCue(item.cues)
  await stopFlashcardSpeech()
  await notifyIntervalTransition(`${item.name} complete`, 'Your interval session is finished.')
  await stopBackgroundInterval()
  const completion = {
    sessionId: item.id,
    runtime,
    elapsedSeconds: Math.round(runtime.accumulatedMs / 1000),
    endedAt: new Date().toISOString(),
  }
  try {
    await store.completeSession(completion.sessionId, completion)
    completionError.value = ''
    pendingCompletion.value = undefined
  } catch (cause) {
    pendingCompletion.value = completion
    completionError.value = cause instanceof Error
      ? cause.message
      : 'Could not save the completed interval.'
  }
  await wakeLock?.release()
  wakeLock = undefined
}

async function retryCompletion() {
  const completion = pendingCompletion.value
  if (!completion || syncing.value) return
  syncing.value = true
  try {
    await store.completeSession(completion.sessionId, completion)
    completionError.value = ''
    pendingCompletion.value = undefined
  } catch (cause) {
    completionError.value = cause instanceof Error
      ? cause.message
      : 'Could not save the completed interval.'
  } finally {
    syncing.value = false
  }
}

async function openNoteDialog() {
  noteDraft.value = session.value?.note || ''
  noteError.value = ''
  noteDialog.value = true
  await nextTick()
  noteField.value?.focus()
}

async function saveSessionNote() {
  const item = session.value
  if (!item || noteSaving.value || !noteChanged.value) return
  noteSaving.value = true
  noteError.value = ''
  try {
    await store.updateSession(item.id, { note: noteDraft.value.trim() })
    noteDialog.value = false
  } catch (cause) {
    noteError.value = cause instanceof Error ? cause.message : 'Could not save the interval note.'
  } finally {
    noteSaving.value = false
  }
}

async function pause() {
  const item = session.value
  if (!item || item.status !== 'running') return
  const result = reconciled(item)
  if (result.completed) return completeSession(item, result.runtime)
  const runtime = { ...result.runtime, stepStartedAt: undefined, updatedAt: new Date().toISOString() }
  await store.updateSession(item.id, {
    status: 'paused',
    runtime,
    elapsedSeconds: Math.round(runtime.accumulatedMs / 1000),
  })
  displayRemainingMs.value = runtime.remainingMs
  await stopBackgroundInterval()
  await stopFlashcardSpeech()
  await wakeLock?.release()
  wakeLock = undefined
}

async function resume() {
  const item = session.value
  if (!item || item.status !== 'paused') return
  const now = new Date().toISOString()
  const step = resolveIntervalStep(item.definition, item.runtime.stepIndex)
  const runtime = {
    ...item.runtime,
    stepStartedAt: step?.step.kind === 'confirmation' ? undefined : now,
    updatedAt: now,
  }
  await prepareIntervalCues(item.cues)
  const updated = await store.updateSession(item.id, { status: 'running', runtime })
  lastSpokenFlashcardKey = ''
  await syncNativeTimer(updated)
  wakeLock = await requestIntervalWakeLock()
}

async function requestStartTemplate() {
  const active = store.activeSession
  if (active) {
    if (
      originTaskId.value
      && active.task === originTaskId.value
      && (active.programStep || '') === originProgramStepId.value
    ) {
      await router.replace({
        name: 'interval-runner',
        params: { sessionId: active.id },
        query: { from: route.query.from },
      })
    } else {
      activeSessionSheet.value = true
    }
    return
  }
  if (!originTaskId.value && attachedProgressCandidates.value.length) {
    attributionSheet.value = true
    return
  }
  await startTemplate(originTaskId.value || undefined, originProgramStepId.value || undefined)
}

async function startTemplate(taskId?: string, programStepId?: string, repetitions?: number) {
  const item = previewSession.value
  if (!item || starting.value) return
  const repetitionSettings = intervalGlobalRepetitionSettings(item.definition)
  if (repetitionSettings.enabled && repetitions === undefined) {
    selectedRepetitions.value = repetitionSettings.defaultCount
    repetitionDefinition.value = item.definition
    pendingRepetitionStart.value = { kind: 'template', taskId, programStepId }
    repetitionError.value = ''
    attributionSheet.value = false
    repetitionDialog.value = true
    return
  }

  starting.value = true
  error.value = ''
  repetitionError.value = ''
  try {
    const attributedProgress = taskId
      ? eligibleTaskProgress.value.find((progress) =>
          progress.task.id === taskId
          && (progress.programStep?.id || '') === (programStepId || ''),
        )
      : undefined
    if (attributedProgress?.status === 'missed') {
      await taskStore.setStatus(attributedProgress, 'pending')
    }
    const definition = repetitionSettings.enabled
      ? intervalDefinitionWithRepetitions(item.definition, repetitions ?? repetitionSettings.defaultCount)
      : item.definition
    await prepareIntervalCues(item.cues)
    const started = await store.startSession({
      name: item.name,
      source: 'template',
      definition,
      cues: item.cues,
      template: item.template,
      task: taskId,
      programStep: programStepId,
      taskDate: taskId ? item.taskDate : undefined,
    })
    if (started.task !== taskId || started.programStep !== programStepId) {
      repetitionDialog.value = false
      repetitionDefinition.value = undefined
      pendingRepetitionStart.value = undefined
      activeSessionSheet.value = true
      return
    }
    attributionSheet.value = false
    repetitionDialog.value = false
    repetitionDefinition.value = undefined
    pendingRepetitionStart.value = undefined
    previewSession.value = undefined
    await router.replace({
      name: 'interval-runner',
      params: { sessionId: started.id },
      query: route.query.from === 'tasks' ? { from: 'tasks' } : {},
    })
    displayRemainingMs.value = started.runtime.remainingMs
    if (started.status === 'running') {
      await syncNativeTimer(started)
      wakeLock = await requestIntervalWakeLock()
    }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Could not start the interval.'
    if (repetitionDialog.value) repetitionError.value = message
    else error.value = message
  } finally {
    starting.value = false
  }
}

async function confirmRepetitionStart() {
  const pending = pendingRepetitionStart.value
  if (!pending) return
  if (pending.kind === 'run-again') {
    await runAgain(selectedRepetitions.value)
    return
  }
  await startTemplate(
    pending.taskId,
    pending.programStepId,
    selectedRepetitions.value,
  )
}

function cancelRepetitionStart() {
  if (starting.value) return
  repetitionDialog.value = false
  repetitionDefinition.value = undefined
  pendingRepetitionStart.value = undefined
  repetitionError.value = ''
}

async function resumeActiveSession() {
  const active = store.activeSession
  if (!active) return
  activeSessionSheet.value = false
  await router.replace({
    name: 'interval-runner',
    params: { sessionId: active.id },
    query: route.query.from === 'tasks' ? { from: 'tasks' } : {},
  })
}

async function advanceCurrent(item: IntervalSession) {
  if (syncing.value) return
  syncing.value = true
  const result = reconciled(item)
  const nextIndex = result.runtime.stepIndex + 1
  const nextStep = resolveIntervalStep(item.definition, nextIndex)
  try {
    if (!nextStep) {
      await completeSession(item, {
        ...result.runtime,
        stepIndex: nextIndex,
        remainingMs: 0,
        stepStartedAt: undefined,
      })
      return
    }
    const now = new Date().toISOString()
    const runtime = {
      ...result.runtime,
      stepIndex: nextIndex,
      remainingMs: intervalStepDurationSeconds(nextStep.step) * 1000,
      stepStartedAt: item.status === 'running' && nextStep.step.kind !== 'confirmation'
        ? now
        : undefined,
      updatedAt: now,
    }
    const updated = await store.updateSession(item.id, {
      runtime,
      elapsedSeconds: Math.round(runtime.accumulatedMs / 1000),
    })
    displayRemainingMs.value = runtime.remainingMs
    lastCountCue = ''
    if (updated.status === 'running') await syncNativeTimer(updated)
    playIntervalGoCue(item.cues)
  } finally {
    syncing.value = false
  }
}

async function confirmCurrent() {
  const item = session.value
  if (
    !item
    || item.status !== 'running'
    || current.value?.step.kind !== 'confirmation'
    || finished.value
  ) return
  await advanceCurrent(item)
}

async function skip() {
  const item = session.value
  if (!item || currentConfirmation.value || finished.value) return
  await advanceCurrent(item)
}

async function previous() {
  const item = session.value
  if (!item || finished.value) return
  const result = reconciled(item)
  const previousIndex = Math.max(0, result.runtime.stepIndex - 1)
  const previousStep = resolveIntervalStep(item.definition, previousIndex)
  if (!previousStep) return
  const now = new Date().toISOString()
  const runtime = {
    ...result.runtime,
    stepIndex: previousIndex,
    remainingMs: intervalStepDurationSeconds(previousStep.step) * 1000,
    stepStartedAt: item.status === 'running' && previousStep.step.kind !== 'confirmation'
      ? now
      : undefined,
    updatedAt: now,
  }
  const updated = await store.updateSession(item.id, { runtime, elapsedSeconds: Math.round(runtime.accumulatedMs / 1000) })
  displayRemainingMs.value = runtime.remainingMs
  lastCountCue = ''
  if (updated.status === 'running') await syncNativeTimer(updated)
}

async function restart() {
  const item = session.value
  if (!item) return
  const runtime = createRuntimeState(item.definition)
  if (item.status === 'paused') runtime.stepStartedAt = undefined
  const updated = await store.updateSession(item.id, { status: item.status === 'paused' ? 'paused' : 'running', runtime, elapsedSeconds: 0 })
  displayRemainingMs.value = runtime.remainingMs
  lastCountCue = ''
  lastSpokenFlashcardKey = ''
  if (updated.status === 'running') await syncNativeTimer(updated)
}

async function ensureIntervalFlashcardSource() {
  const reviewSet = flashcardReviewSet.value
  if (reviewSet && reviewSet.accessRole !== 'owner') {
    await flashcardStore.loadReviewSetCards(reviewSet.id)
  }
}

async function openFlashcardContext() {
  const item = session.value
  if (!item || isTemplatePreview.value || syncing.value || openingFlashcardContext.value) return
  resumeAfterFlashcardContext = item.status === 'running'
  openingFlashcardContext.value = true
  try {
    if (resumeAfterFlashcardContext) await pause()
    if (session.value?.id === item.id && !finished.value) {
      flashcardContextSheet.value = true
    } else {
      resumeAfterFlashcardContext = false
    }
  } catch (cause) {
    resumeAfterFlashcardContext = false
    error.value = cause instanceof Error ? cause.message : 'Could not pause this interval.'
  } finally {
    openingFlashcardContext.value = false
  }
}

async function finishFlashcardContext() {
  const shouldResume = resumeAfterFlashcardContext
  resumeAfterFlashcardContext = false
  if (!shouldResume || session.value?.status !== 'paused') return
  try {
    await resume()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not resume this interval.'
  }
}

async function pauseForFlashcardModal() {
  const shouldPause = session.value?.status === 'running'
  resumeAfterFlashcardModal = resumeAfterFlashcardModal
    || resumeAfterFlashcardContext
    || shouldPause
  resumeAfterFlashcardContext = false
  if (shouldPause) await pause()
}

async function finishFlashcardModal() {
  if (resumeAfterFlashcardModal && session.value?.status === 'paused') await resume()
  resumeAfterFlashcardModal = false
}

async function updateFlashcardSnapshot(review: IntervalFlashcardReviewSnapshot) {
  const item = session.value
  if (!item || isTemplatePreview.value) return
  await store.updateSessionFlashcardReview(item.id, review)
  lastSpokenFlashcardKey = ''
}

function snapshotCard(card: Flashcard) {
  return {
    id: card.id,
    front: card.front,
    back: card.back,
    note: card.note,
    image: card.image,
    tags: [...card.tags],
  }
}

async function openFlashcardEditor(action: 'add' | 'edit') {
  if (!session.value?.flashcardReview || !canManageIntervalCards.value || syncing.value) return
  await pauseForFlashcardModal()
  try {
    await ensureIntervalFlashcardSource()
    flashcardEditorCard.value = action === 'edit' ? currentFlashcardRecord.value : undefined
    if (action === 'edit' && !flashcardEditorCard.value) {
      throw new Error('That flashcard could not be found.')
    }
    flashcardEditorDialog.value = true
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not open this flashcard.'
    await finishFlashcardModal()
  }
}

async function closeFlashcardEditor(open: boolean) {
  flashcardEditorDialog.value = open
  if (!open) {
    await flashcardSaveWork
    await finishFlashcardModal()
  }
}

async function saveIntervalFlashcard(card: Flashcard) {
  const review = session.value?.flashcardReview
  if (!review) return
  const existing = review.cards.findIndex(item => item.id === card.id)
  const cards = [...review.cards]
  if (existing >= 0) cards.splice(existing, 1, snapshotCard(card))
  else if (cardMatchesTags(card, review.tags)) cards.push(snapshotCard(card))
  await updateFlashcardSnapshot({ ...review, cards })
}

function handleIntervalFlashcardSaved(card: Flashcard) {
  flashcardSaveWork = saveIntervalFlashcard(card)
}

async function requestFlashcardRemoval() {
  if (!flashcardPhase.value || !canManageIntervalCards.value) return
  await pauseForFlashcardModal()
  try {
    await ensureIntervalFlashcardSource()
    if (!currentFlashcardRecord.value) throw new Error('That flashcard could not be found.')
    flashcardDeleteDialog.value = true
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not open this flashcard.'
    await finishFlashcardModal()
  }
}

async function requestFlashcardEjection() {
  if (!flashcardPhase.value) return
  await pauseForFlashcardModal()
  flashcardEjectDialog.value = true
}

async function closeFlashcardEjection(open: boolean) {
  flashcardEjectDialog.value = open
  if (!open) await finishFlashcardModal()
}

async function ejectIntervalFlashcard() {
  const review = session.value?.flashcardReview
  const cardId = flashcardPhase.value?.card.id
  if (!review || !cardId || flashcardEjecting.value) return
  flashcardEjecting.value = true
  try {
    await updateFlashcardSnapshot({
      ...review,
      cards: review.cards.filter(card => card.id !== cardId),
    })
    await closeFlashcardEjection(false)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not eject this flashcard.'
  } finally {
    flashcardEjecting.value = false
  }
}

async function cancelFlashcardRemoval() {
  flashcardDeleteDialog.value = false
  await finishFlashcardModal()
}

async function removeIntervalFlashcard() {
  const review = session.value?.flashcardReview
  const card = currentFlashcardRecord.value
  const reviewSet = flashcardReviewSet.value
  if (!review || !card || !reviewSet || flashcardDeleting.value) return
  flashcardDeleting.value = true
  try {
    if (reviewSet.accessRole === 'owner') await flashcardStore.deleteCard(card.id)
    else await flashcardStore.deleteReviewSetCard(reviewSet.id, card.id)
    await updateFlashcardSnapshot({
      ...review,
      cards: review.cards.filter(item => item.id !== card.id),
    })
    flashcardDeleteDialog.value = false
    await finishFlashcardModal()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not remove this flashcard.'
  } finally {
    flashcardDeleting.value = false
  }
}

async function openFlashcardSettings() {
  const review = session.value?.flashcardReview
  if (!review || syncing.value) return
  await pauseForFlashcardModal()
  Object.assign(flashcardSettingsDraft, {
    mode: 'passive',
    cardSides: review.cardSides,
    indefinite: true,
    maxCards: review.cards.length,
    frontSeconds: review.frontSeconds,
    backSeconds: review.backSeconds,
    backSpeechRepeatCount: review.backSpeechRepeatCount,
    noteBeforeBack: review.noteBeforeBack,
    speechEnabled: review.speechEnabled,
    frontLanguage: review.frontLanguage,
    backLanguage: review.backLanguage,
    sortMode: review.sortMode,
  })
  flashcardSettingsOriginal.value = flashcardReviewSettingsSignature(flashcardSettingsDraft)
  flashcardSettingsError.value = ''
  flashcardSettingsDialog.value = true
  flashcardSpeechLoading.value = true
  try {
    await ensureIntervalFlashcardSource()
    flashcardSpeechSupport.value = await loadFlashcardSpeechSupport()
  } finally {
    flashcardSpeechLoading.value = false
  }
}

async function closeFlashcardSettings() {
  flashcardSettingsDialog.value = false
  flashcardSettingsError.value = ''
  await finishFlashcardModal()
}

async function saveFlashcardSettings() {
  const validation = await flashcardSettingsForm.value?.validate()
  const review = session.value?.flashcardReview
  const reviewSet = flashcardReviewSet.value
  if (!validation?.valid || !canSaveFlashcardSettings.value || !review || !reviewSet) return
  flashcardSettingsSaving.value = true
  flashcardSettingsError.value = ''
  try {
    const snapshot = createIntervalFlashcardReviewSnapshot(
      { ...reviewSet, ...flashcardSettingsDraft },
      intervalFlashcardSource.value,
    )
    if (!snapshot) throw new Error('These settings do not match any available cards.')
    await updateFlashcardSnapshot(snapshot)
    await closeFlashcardSettings()
  } catch (cause) {
    flashcardSettingsError.value = cause instanceof Error
      ? cause.message
      : 'Could not update the flashcard settings.'
  } finally {
    flashcardSettingsSaving.value = false
  }
}

function handleFlashcardContextAction(action: FlashcardContextAction) {
  if (action === 'add' || action === 'edit') void openFlashcardEditor(action)
  else if (action === 'eject') void requestFlashcardEjection()
  else if (action === 'remove') void requestFlashcardRemoval()
  else if (action === 'settings') void openFlashcardSettings()
}

async function endEarly() {
  const item = session.value
  if (!item) return
  const result = reconciled(item)
  const runtime = { ...result.runtime, stepStartedAt: undefined, updatedAt: new Date().toISOString() }
  await store.updateSession(item.id, {
    status: 'ended',
    runtime,
    elapsedSeconds: Math.round(runtime.accumulatedMs / 1000),
    endedAt: new Date().toISOString(),
  })
  endDialog.value = false
  await stopBackgroundInterval()
  await stopFlashcardSpeech()
  await wakeLock?.release()
  wakeLock = undefined
}

async function runAgain(repetitions?: number) {
  const item = session.value
  if (!item || starting.value) return
  const repetitionSettings = intervalGlobalRepetitionSettings(item.definition)
  if (repetitionSettings.enabled && repetitions === undefined) {
    selectedRepetitions.value = repetitionSettings.defaultCount
    repetitionDefinition.value = item.definition
    pendingRepetitionStart.value = { kind: 'run-again' }
    repetitionError.value = ''
    repetitionDialog.value = true
    return
  }

  starting.value = true
  repetitionError.value = ''
  try {
    const definition = repetitionSettings.enabled
      ? intervalDefinitionWithRepetitions(item.definition, repetitions ?? repetitionSettings.defaultCount)
      : item.definition
    await prepareIntervalCues(item.cues)
    const nextSession = await store.startSession({
      name: item.name,
      source: item.source,
      definition,
      cues: item.cues,
      template: item.template,
    })
    repetitionDialog.value = false
    repetitionDefinition.value = undefined
    pendingRepetitionStart.value = undefined
    await router.replace({
      name: 'interval-runner',
      params: { sessionId: nextSession.id },
      query: route.query.from === 'tasks' ? { from: 'tasks' } : {},
    })
    displayRemainingMs.value = nextSession.runtime.remainingMs
    await syncNativeTimer(nextSession)
    wakeLock = await requestIntervalWakeLock()
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Could not start the interval again.'
    if (repetitionDialog.value) repetitionError.value = message
    else error.value = message
  } finally {
    starting.value = false
  }
}
</script>

<template>
  <main class="runner-page" :class="{ 'runner-page--finished': finished }">
    <v-alert v-if="backgroundError" type="warning" variant="tonal" class="mb-3">{{ backgroundError }}</v-alert>
    <v-alert v-if="completionError" type="error" variant="tonal" class="mb-3">
      {{ completionError }}
      <template #append>
        <v-btn size="small" variant="text" :loading="syncing" @click="retryCompletion">Retry</v-btn>
      </template>
    </v-alert>
    <v-alert v-if="error" type="error" variant="tonal">{{ error }}</v-alert>

    <transition name="runner-completion" mode="out-in">
      <section
        v-if="!error && session && finished"
        key="briefing"
        class="finish-card runner-view runner-view--briefing"
      >
        <div class="finish-icon"><v-icon :icon="session.status === 'completed' ? 'mdi-check-bold' : 'mdi-stop'" size="34" /></div>
        <p class="runner-label">{{ session.status === 'completed' ? 'Session complete' : 'Session ended' }}</p>
        <h1 class="display-title">{{ session.name }}<span class="text-secondary">.</span></h1>
        <div class="finish-stats">
          <div><span>Planned</span><strong>{{ formatIntervalDuration(session.plannedSeconds) }}</strong></div>
          <div><span>Elapsed</span><strong>{{ formatIntervalDuration(session.elapsedSeconds) }}</strong></div>
          <div><span>Intervals</span><strong>{{ Math.min(session.runtime.stepIndex, current?.totalSteps || session.runtime.stepIndex) }}</strong></div>
        </div>
        <div v-if="session.note" class="finish-note">
          <v-icon icon="mdi-note-text-outline" size="22" />
          <p>{{ session.note }}</p>
        </div>
        <div class="finish-actions">
          <v-btn color="secondary" size="large" prepend-icon="mdi-replay" :loading="starting" @click="runAgain()">Run again</v-btn>
          <v-btn variant="tonal" size="large" prepend-icon="mdi-note-plus-outline" @click="openNoteDialog">
            {{ session.note ? 'Edit note' : 'Add note' }}
          </v-btn>
          <v-btn variant="outlined" size="large" :to="returnTo">Done</v-btn>
        </div>
      </section>

      <div
        v-else-if="!error && session && current"
        key="runner"
        class="runner-view runner-view--active"
      >
        <header class="runner-header">
          <v-btn icon="mdi-chevron-down" variant="text" aria-label="Leave runner" :to="returnTo" />
          <div class="text-center min-width-0">
            <p class="runner-label">Interval {{ current.index + 1 }} of {{ current.totalSteps }}</p>
            <strong class="text-truncate d-block">{{ session.name }}</strong>
          </div>
          <v-btn icon="mdi-stop-circle-outline" variant="text" color="error" aria-label="End session" :disabled="isTemplatePreview" @click="endDialog = true" />
        </header>

        <div class="runner-stage">
          <section class="runner-main" :class="{ 'runner-main--with-review': flashcardPhase }">
            <div class="runner-details">
              <p class="runner-session">{{ session.name }}</p>
              <p v-if="attributedTaskName" class="runner-task-link">
                Completes {{ attributedTaskName }}
              </p>
              <p class="runner-label runner-position">Interval {{ current.index + 1 }} of {{ current.totalSteps }}</p>
              <div v-if="current.groups.length" class="group-breadcrumb">
                <span v-for="group in current.groups" :key="`${group.name}-${group.iteration}`">{{ group.name }} {{ group.iteration }}/{{ group.total }}</span>
              </div>
              <h1 class="runner-step">{{ current.step.name }}</h1>
            </div>
            <div class="runner-progress-stack">
              <div class="runner-progress" :class="{ 'runner-progress--confirmation': currentConfirmation }">
                <div
                  class="progress-rings"
                  :class="{ 'progress-rings--with-image': Boolean(flashcardPhase?.card.image) }"
                >
                  <IntervalTypeIcon
                    v-if="current.step.kind"
                    class="runner-type-backdrop"
                    :class="{ 'runner-type-backdrop--hidden': Boolean(flashcardPhase?.card.image) }"
                    :kind="current.step.kind"
                    size="clamp(8rem, 44vw, 28rem)"
                    :animated="session.status === 'running' && !flashcardPhase?.card.image"
                  />
                  <transition name="runner-flashcard-image">
                    <img
                      v-if="flashcardPhase?.card.image"
                      :key="flashcardPhase.card.image"
                      :src="flashcardPhase.card.image"
                      alt=""
                      class="runner-flashcard-image"
                    />
                  </transition>
                  <v-progress-circular
                    v-if="showTotalProgress"
                    class="progress-ring progress-ring--total"
                    :model-value="progress.total"
                    :width="7"
                    color="info"
                    bg-color="surface-variant"
                    :aria-label="`Total progress: ${Math.round(progress.total)}%`"
                  />
                  <v-progress-circular
                    v-if="showRoundProgress"
                    class="progress-ring progress-ring--round"
                    :model-value="progress.round"
                    :width="7"
                    color="warning"
                    bg-color="surface-variant"
                    :aria-label="`Current round progress: ${Math.round(progress.round || 0)}%`"
                  />
                  <v-progress-circular
                    class="progress-ring progress-ring--item"
                    :model-value="progress.item"
                    :width="12"
                    color="secondary"
                    bg-color="surface-variant"
                    :aria-label="`Current item progress: ${Math.round(progress.item)}%`"
                  />
                  <div class="progress-rings__content">
                    <v-btn
                      v-if="currentConfirmation"
                      color="secondary"
                      size="large"
                      prepend-icon="mdi-check-bold"
                      :loading="starting || syncing"
                      :disabled="!isTemplatePreview && session.status !== 'running'"
                      @touchstart.stop
                      @click.stop="isTemplatePreview ? requestStartTemplate() : confirmCurrent()"
                    >
                      {{ isTemplatePreview ? playActionLabel : 'Confirm and continue' }}
                    </v-btn>
                    <span
                      v-else
                      :key="timerEffectKey"
                      class="timer-value"
                      :class="{
                        'timer-value--count': timerEffect === 'count',
                      }"
                    >
                      {{ remainingLabel }}
                    </span>
                  </div>
                </div>
              </div>
              <button
                v-if="flashcardPhase && session.flashcardReview"
                v-ripple
                type="button"
                class="interval-review-card"
                :aria-label="`${session.flashcardReview.name}, ${flashcardPhase.side}, card ${flashcardPhase.cardIndex + 1} of ${session.flashcardReview.cards.length}`"
                :disabled="isTemplatePreview || syncing || openingFlashcardContext"
                @click="openFlashcardContext"
              >
                <div class="interval-review-card__content">
                  <div class="interval-review-card__heading">
                    <span class="interval-review-card__set">
                      <v-icon icon="mdi-cards-outline" size="17" />
                      <span class="text-truncate">{{ session.flashcardReview.name }}</span>
                    </span>
                    <div class="interval-review-card__meta">
                      <small>{{ flashcardPhase.side === 'front' ? 'Front' : 'Back' }}</small>
                      <span>{{ flashcardPhase.cardIndex + 1 }}/{{ session.flashcardReview.cards.length }}</span>
                    </div>
                  </div>
                  <strong
                    v-if="flashcardPhase.side === 'front'"
                    :style="{
                      fontSize: flashcardTextFontSize(
                        flashcardPhase.card.front,
                        'face',
                        'compact',
                      ),
                    }"
                  >
                    {{ flashcardPhase.card.front }}
                  </strong>
                  <FlashcardResponseText
                    v-else
                    :back="flashcardPhase.card.back"
                    :note="flashcardPhase.card.note"
                    :note-before-back="session.flashcardReview.noteBeforeBack"
                    density="compact"
                  />
                </div>
                <v-progress-linear
                  :model-value="flashcardPhase.progress"
                  color="surface-variant"
                  bg-color="background"
                  height="5"
                  rounded
                  :aria-label="`${Math.round(flashcardPhase.progress)}% through the ${flashcardPhase.side}`"
                />
              </button>
            </div>
            <p class="next-copy">{{ next ? `Next: ${next.step.name}` : 'Final interval' }}</p>
          </section>

          <footer class="runner-controls runner-controls--portrait">
            <v-btn icon="mdi-skip-previous" variant="tonal" size="large" aria-label="Previous interval" :disabled="isTemplatePreview || current.index === 0" @click="previous" />
            <v-btn
              :icon="session.status === 'paused' ? 'mdi-play' : 'mdi-pause'"
              color="secondary"
              size="x-large"
              :loading="starting"
              :aria-label="session.status === 'paused' ? playActionLabel : 'Pause'"
              @touchstart.stop
              @click.stop="isTemplatePreview ? requestStartTemplate() : session.status === 'paused' ? resume() : pause()"
            />
            <v-btn icon="mdi-skip-next" variant="tonal" size="large" aria-label="Skip interval" :disabled="isTemplatePreview || currentConfirmation" @click="skip" />
            <v-btn prepend-icon="mdi-restart" variant="text" class="restart-button" :disabled="isTemplatePreview" @click="restart">Restart</v-btn>
          </footer>

          <footer class="runner-controls runner-controls--landscape">
            <v-btn
              icon="mdi-skip-previous"
              variant="tonal"
              :disabled="isTemplatePreview || current.index === 0"
              aria-label="Previous interval"
              @click="previous"
            />
            <v-btn
              :icon="session.status === 'paused' ? 'mdi-play' : 'mdi-pause'"
              color="secondary"
              class="runner-pause-button"
              :loading="starting"
              :aria-label="session.status === 'paused' ? playActionLabel : 'Pause'"
              @touchstart.stop
              @click.stop="isTemplatePreview ? requestStartTemplate() : session.status === 'paused' ? resume() : pause()"
            />
            <v-btn icon="mdi-skip-next" variant="tonal" aria-label="Next interval" :disabled="isTemplatePreview || currentConfirmation" @click="skip" />
            <v-btn
              icon="mdi-chevron-left"
              variant="text"
              class="runner-back-button"
              aria-label="Leave runner"
              :to="returnTo"
            />
            <v-btn
              icon="mdi-restart"
              variant="text"
              class="restart-button"
              aria-label="Restart interval"
              :disabled="isTemplatePreview"
              @click="restart"
            />
            <v-btn
              icon="mdi-stop-circle-outline"
              variant="text"
              color="error"
              class="runner-stop-button"
              aria-label="Stop interval"
              :disabled="isTemplatePreview"
              @click="endDialog = true"
            />
          </footer>
        </div>
      </div>
    </transition>

    <FlashcardContextActions
      v-model="flashcardContextSheet"
      :busy="syncing || starting"
      :can-manage-card="!isTemplatePreview && canManageIntervalCards && Boolean(flashcardPhase)"
      :can-add-card="!isTemplatePreview && canManageIntervalCards"
      :can-eject-card="!isTemplatePreview && Boolean(flashcardPhase)"
      @action="handleFlashcardContextAction"
    />

    <FlashcardCardDialog
      :model-value="flashcardEditorDialog"
      :card="flashcardEditorCard"
      :review-set-id="flashcardReviewSet?.accessRole === 'owner' ? undefined : flashcardReviewSet?.id"
      :initial-tags="session?.flashcardReview?.tags"
      @update:model-value="closeFlashcardEditor"
      @saved="handleIntervalFlashcardSaved"
    />

    <v-dialog
      v-model="flashcardSettingsDialog"
      persistent
      scrollable
      fullscreen
    >
      <v-card class="flashcard-settings-card" rounded="0">
        <v-card-title class="flashcard-settings-header d-flex align-center ga-3">
          <v-icon icon="mdi-tune-variant" color="secondary" />
          <span>Flashcard settings</span>
        </v-card-title>
        <v-card-text class="px-5 py-4">
          <v-alert
            v-if="flashcardSettingsError"
            type="error"
            variant="tonal"
            density="compact"
            class="mb-4"
          >
            {{ flashcardSettingsError }}
          </v-alert>
          <AppForm ref="flashcardSettingsForm" @submit.prevent="saveFlashcardSettings">
            <FlashcardReviewSettingsFields
              :model-value="flashcardSettingsDraft"
              :speech-support="flashcardSpeechSupport"
              :speech-loading="flashcardSpeechLoading"
              :available-cards="intervalFlashcardSource.length"
              session
              interval
            />
          </AppForm>
        </v-card-text>
        <v-divider />
        <v-card-actions class="flashcard-settings-actions ga-2">
          <v-spacer />
          <v-btn variant="text" :disabled="flashcardSettingsSaving" @click="closeFlashcardSettings">
            Cancel
          </v-btn>
          <v-btn
            color="secondary"
            :loading="flashcardSettingsSaving"
            :disabled="!canSaveFlashcardSettings"
            @click="saveFlashcardSettings"
          >
            Save
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <ConfirmDialog
      :model-value="flashcardEjectDialog"
      title="Eject this flashcard?"
      message="The card will leave this interval only. It will remain available in the Review set and future sessions."
      confirm-text="Eject card"
      confirm-color="warning"
      icon="mdi-eject-outline"
      :loading="flashcardEjecting"
      @update:model-value="closeFlashcardEjection"
      @confirm="ejectIntervalFlashcard"
    />

    <ConfirmDialog
      :model-value="flashcardDeleteDialog"
      title="Remove this flashcard?"
      message="The card will be deleted from future reviews and removed from this interval. Existing review history keeps its saved faces."
      confirm-text="Remove card"
      confirm-color="error"
      icon="mdi-delete-outline"
      :loading="flashcardDeleting"
      @update:model-value="!$event && cancelFlashcardRemoval()"
      @confirm="removeIntervalFlashcard"
    />

    <ConfirmDialog
      v-model="endDialog"
      title="End this session?"
      message="Your elapsed time will be saved, but this run will be marked as ended early."
      confirm-text="End session"
      icon="mdi-stop-circle-outline"
      @confirm="endEarly"
    />

    <v-dialog v-model="noteDialog" max-width="480" :persistent="noteSaving">
      <v-card class="pa-5">
        <div class="note-dialog-heading">
          <div class="note-dialog-icon">
            <v-icon icon="mdi-note-edit-outline" size="24" />
          </div>
          <div class="min-width-0">
            <h2 class="text-h6 font-weight-black">Interval note</h2>
            <p class="text-body-2 muted mt-1">Capture how the session felt or anything worth remembering.</p>
          </div>
        </div>
        <v-alert v-if="noteError" type="error" variant="tonal" class="mt-4">{{ noteError }}</v-alert>
        <v-textarea
          ref="noteField"
          v-model="noteDraft"
          label="Note"
          maxlength="2000"
          counter
          rows="4"
          auto-grow
          class="mt-5"
          @keydown.ctrl.enter="saveSessionNote"
          @keydown.meta.enter="saveSessionNote"
        />
        <div class="note-dialog-actions mt-5">
          <v-btn variant="text" :disabled="noteSaving" @click="noteDialog = false">Cancel</v-btn>
          <v-btn color="secondary" :loading="noteSaving" :disabled="!noteChanged" @click="saveSessionNote">Save note</v-btn>
        </div>
      </v-card>
    </v-dialog>

    <v-dialog
      :model-value="repetitionDialog"
      max-width="440"
      :persistent="starting"
      @update:model-value="!$event && cancelRepetitionStart()"
    >
      <v-card class="pa-5">
        <div class="note-dialog-heading">
          <div class="note-dialog-icon">
            <v-icon icon="mdi-repeat" size="24" />
          </div>
          <div class="min-width-0">
            <h2 class="text-h6 font-weight-black">Choose repetitions</h2>
            <p class="text-body-2 muted mt-1">Repeat the entire interval sequence.</p>
          </div>
        </div>
        <v-alert v-if="repetitionError" type="error" variant="tonal" class="mt-4">{{ repetitionError }}</v-alert>
        <LabeledSlider
          v-model="selectedRepetitions"
          title="Repetitions"
          :min="MIN_GLOBAL_REPETITIONS"
          :max="MAX_GLOBAL_REPETITIONS"
          :step="1"
          aria-label="Repetitions for this interval run"
          class="mt-6"
        />
        <p class="repetition-summary mt-4">
          {{ selectedRepetitions }} repetitions · {{ formatIntervalDuration(selectedRepetitionDuration) }} total
        </p>
        <div class="note-dialog-actions mt-5">
          <v-btn variant="text" :disabled="starting" @click="cancelRepetitionStart">Cancel</v-btn>
          <v-btn color="secondary" prepend-icon="mdi-play" :loading="starting" @click="confirmRepetitionStart">Start</v-btn>
        </div>
      </v-card>
    </v-dialog>

    <ActionBottomSheet
      v-model="attributionSheet"
      title="Choose what this run completes"
      aria-label="Choose an interval task or standalone run"
    >
      <p class="text-body-2 muted px-4 pb-3">Choose one open task for today, or run the interval on its own.</p>
      <p v-if="!eligibleTaskProgress.length" class="text-caption muted px-4 pb-2">No attached tasks are open today.</p>
      <v-list-item
        v-for="item in eligibleTaskProgress"
        :key="`${item.task.id}-${item.programStep?.id || ''}`"
        prepend-icon="mdi-format-list-checks"
        :title="item.programStep?.name || item.task.name"
        :subtitle="item.programStep ? `${item.task.name} · Complete this step when the interval finishes` : 'Complete this task when the interval finishes'"
        rounded="lg"
        @click="startTemplate(item.task.id, item.programStep?.id)"
      />
      <v-list-item
        prepend-icon="mdi-timer-outline"
        title="Standalone"
        subtitle="Save the run without completing a task"
        rounded="lg"
        @click="startTemplate()"
      />
    </ActionBottomSheet>

    <ActionBottomSheet
      v-model="activeSessionSheet"
      title="Interval already running"
      aria-label="Active interval actions"
    >
      <div class="px-2 py-3">
        <p class="text-body-2 muted mb-4">
          {{ store.activeSession?.name || 'Another interval' }} is already in progress. Its task attachment will not be changed.
        </p>
        <v-btn block color="secondary" prepend-icon="mdi-play" @click="resumeActiveSession">
          Resume active interval
        </v-btn>
      </div>
    </ActionBottomSheet>
  </main>
</template>

<style scoped>
.runner-page {
  position: fixed;
  z-index: 1003;
  inset: 0;
  display: flex;
  width: 100%;
  max-width: 100vw;
  height: 100dvh;
  min-height: 0;
  padding: max(1rem, env(safe-area-inset-top)) 1rem max(1rem, env(safe-area-inset-bottom));
  flex-direction: column;
  overflow-x: hidden;
  overflow-y: auto;
  background: rgb(var(--v-theme-background));
}
.runner-page.page-depth-deeper-enter-active > *,
.runner-page.page-depth-deeper-leave-active > *,
.runner-page.page-depth-higher-enter-active > *,
.runner-page.page-depth-higher-leave-active > * {
  transition: none;
}
.runner-page.page-depth-deeper-enter-from > *,
.runner-page.page-depth-deeper-leave-to > *,
.runner-page.page-depth-higher-enter-from > *,
.runner-page.page-depth-higher-leave-to > * {
  transform: none;
}
.runner-view--active {
  display: flex;
  width: 100%;
  min-height: 0;
  flex: 1;
  flex-direction: column;
}
.runner-completion-enter-active {
  transition: opacity 220ms ease, transform 240ms cubic-bezier(.22, 1, .36, 1);
}
.runner-completion-leave-active {
  transition: opacity 160ms ease, transform 180ms cubic-bezier(.22, 1, .36, 1);
  pointer-events: none;
}
.runner-completion-enter-from {
  opacity: 0;
  transform: translateY(1.5rem);
}
.runner-completion-leave-to {
  opacity: 0;
  transform: translateY(-1rem);
}
.runner-header { display: grid; grid-template-columns: 48px minmax(0, 1fr) 48px; align-items: center; }
.runner-label { color: rgb(var(--v-theme-on-surface) / .52); font-size: .68rem; font-weight: 850; letter-spacing: .1em; text-transform: uppercase; }
.runner-stage { position: relative; display: flex; min-height: 0; flex: 1; flex-direction: column; isolation: isolate; }
.runner-type-backdrop {
  position: absolute;
  z-index: 0;
  top: 50%;
  left: 50%;
  opacity: .3;
  pointer-events: none;
  filter: drop-shadow(0 0 2.75rem currentColor);
  transition: opacity 200ms ease;
  transform-origin: center center;
  transform: translate(-50%, -50%) rotate(-8deg);
  -webkit-mask-image: radial-gradient(circle, #000 32%, rgba(0, 0, 0, .82) 56%, transparent 82%);
  mask-image: radial-gradient(circle, #000 32%, rgba(0, 0, 0, .82) 56%, transparent 82%);
}
.runner-type-backdrop--hidden { opacity: 0; }
.runner-main,
.runner-controls,
.runner-details,
.runner-progress-stack,
.runner-progress,
.next-copy { position: relative; z-index: 1; }
.runner-main { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
.runner-details { display: contents; }
.runner-progress-stack { display: flex; width: 100%; flex-direction: column; align-items: center; }
.runner-session { display: none; }
.runner-task-link { margin-top: .45rem; color: rgb(var(--v-theme-secondary)); font-size: .76rem; font-weight: 800; }
.runner-position { display: none; }
.group-breadcrumb { display: flex; flex-wrap: wrap; justify-content: center; gap: .35rem; margin-bottom: 1.25rem; }
.group-breadcrumb span { padding: 4px 8px; border-radius: 999px; background: rgb(var(--v-theme-surface-variant)); color: rgb(var(--v-theme-on-surface) / .7); font-size: .65rem; }
.runner-step { min-width: 0; max-width: 40rem; margin-top: .5rem; font-size: clamp(2rem, 10vw, 4.5rem); font-weight: 900; line-height: 1; }
.interval-review-card { position: relative; width: min(100%, 34rem); padding: 0; overflow: hidden; border: 1px solid rgba(var(--v-theme-on-surface), .08); border-radius: .75rem; background: rgba(var(--v-theme-on-surface), .055); box-shadow: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.interval-review-card:focus-visible { outline: .1875rem solid rgba(var(--v-theme-secondary), .72); outline-offset: .25rem; }
.interval-review-card:disabled { cursor: default; opacity: .72; }
.interval-review-card :deep(.v-ripple__container) { z-index: 2; }
.interval-review-card__content { display: flex; padding: 1rem; align-items: center; justify-content: center; flex-direction: column; gap: .65rem; text-align: center; }
.interval-review-card__heading { display: flex; width: 100%; min-width: 0; align-items: center; justify-content: space-between; gap: .75rem; }
.interval-review-card__meta { display: flex; flex: 0 0 auto; align-items: center; justify-content: flex-end; gap: .75rem; color: rgba(var(--v-theme-on-surface), .58); font-size: .62rem; font-weight: 900; letter-spacing: .1em; text-transform: uppercase; }
.interval-review-card__meta > span:last-child { flex: 0 0 auto; font-variant-numeric: tabular-nums; }
.interval-review-card__set { display: flex; min-width: 0; max-width: 75%; align-items: center; gap: .4rem; color: rgba(var(--v-theme-on-surface), .58); font-size: .62rem; font-weight: 900; letter-spacing: .1em; text-align: left; text-transform: uppercase; }
.interval-review-card__set > .text-truncate { min-width: 0; }
.interval-review-card__content small { color: rgba(var(--v-theme-on-surface), .58); font-size: .62rem; font-weight: 900; letter-spacing: .1em; text-transform: uppercase; }
.interval-review-card__content strong { overflow-wrap: anywhere; font-size: clamp(1.05rem, 4.5vw, 1.5rem); line-height: 1.3; white-space: pre-wrap; }
.interval-review-card :deep(.v-progress-linear) { border-radius: 0; }
.runner-progress {
  display: flex;
  width: 100%;
  margin: 2.25rem 0 1.5rem;
  flex-direction: column;
  align-items: center;
}
.runner-main--with-review .runner-progress { margin: 1.25rem 0 1rem; }
.runner-main--with-review .interval-review-card { margin-bottom: 1.25rem; }
.runner-main--with-review .progress-rings { width: min(13.5rem, calc(100vw - 3rem)); }
.runner-main--with-review .timer-value { font-size: 3.25rem; }
.progress-rings {
  position: relative;
  width: min(292px, calc(100vw - 2rem));
  aspect-ratio: 1;
  container-type: inline-size;
  isolation: isolate;
}
.progress-ring {
  position: absolute;
  z-index: 1;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
}
.progress-ring--total {
  width: 100% !important;
  height: 100% !important;
  opacity: .5;
}
.progress-ring--round {
  width: calc(100% - 16px) !important;
  height: calc(100% - 16px) !important;
  opacity: .75;
}
.progress-ring--item {
  width: calc(100% - 32px) !important;
  height: calc(100% - 32px) !important;
  opacity: 1;
}
.runner-flashcard-image {
  position: absolute;
  z-index: 0;
  inset: 1.75rem;
  width: calc(100% - 3.5rem);
  height: calc(100% - 3.5rem);
  border-radius: 100%;
  object-fit: cover;
  opacity: .68;
  pointer-events: none;
  filter: brightness(.72) saturate(.9);
}
.runner-flashcard-image-enter-active,
.runner-flashcard-image-leave-active { transition: opacity 200ms ease; }
.runner-flashcard-image-enter-from,
.runner-flashcard-image-leave-to { opacity: 0; }
.progress-rings__content {
  position: absolute;
  z-index: 2;
  inset: 40px;
  display: grid;
  place-items: center;
}
.runner-progress--confirmation .progress-rings__content :deep(.v-btn) {
  width: min(100%, 13rem);
  min-height: 64px;
  white-space: normal;
}
.timer-value { display: inline-block; font-family: "Arial Narrow", Impact, sans-serif; font-size: 4rem; font-weight: 900; letter-spacing: -.04em; transform-origin: center; }
.progress-rings--with-image .timer-value { text-shadow: 0 .125rem .75rem rgba(0, 0, 0, .9); }
.timer-value--count { color: rgb(var(--v-theme-warning)); animation: timer-value-pulse 560ms cubic-bezier(.22, 1, .36, 1); }
@keyframes timer-value-pulse {
  0% { transform: scale(1); }
  38% { transform: scale(1.16); }
  100% { transform: scale(1); }
}
.next-copy { color: rgb(var(--v-theme-on-surface) / .56); font-size: .78rem; }
.runner-controls { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; justify-items: center; gap: 1rem; }
.runner-controls--landscape { display: none; }
.restart-button { grid-column: 1 / -1; }
.finish-card { width: 100%; max-width: 620px; margin: auto; text-align: center; }
.finish-icon { display: grid; width: 72px; height: 72px; margin: 0 auto 1rem; place-items: center; border-radius: 24px; background: rgb(var(--v-theme-secondary)); color: rgb(var(--v-theme-on-secondary)); }
.finish-card h1 { margin-top: .75rem; font-size: clamp(2.8rem, 12vw, 5rem); }
.finish-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: .75rem; margin: 2rem 0; }
.finish-stats div { display: flex; padding: 1rem .5rem; flex-direction: column; border-radius: 16px; background: rgb(var(--v-theme-surface)); }
.finish-stats span { color: rgb(var(--v-theme-on-surface) / .52); font-size: .6rem; text-transform: uppercase; }
.finish-stats strong { margin-top: .25rem; font-size: 1rem; }
.finish-note {
  display: flex;
  margin: -1rem 0 1.5rem;
  padding: 1rem;
  align-items: flex-start;
  gap: .75rem;
  border: 1px solid rgb(var(--v-theme-on-surface) / .08);
  border-radius: 16px;
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface) / .76);
  text-align: left;
}
.finish-note :deep(.v-icon) { flex: 0 0 auto; color: rgb(var(--v-theme-secondary)); }
.finish-note p { overflow-wrap: anywhere; white-space: pre-wrap; }
.finish-actions { display: grid; gap: .75rem; }
.note-dialog-heading { display: flex; align-items: center; gap: 12px; }
.note-dialog-icon {
  display: grid;
  width: 48px;
  height: 48px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 15px;
  background: rgb(var(--v-theme-secondary) / .16);
  color: rgb(var(--v-theme-secondary));
}
.note-dialog-actions { display: flex; justify-content: flex-end; gap: .5rem; }
.flashcard-settings-card { min-height: 100dvh; }
.flashcard-settings-header {
  padding:
    calc(1.25rem + max(env(safe-area-inset-top, 0rem), var(--safe-area-inset-top, 0rem)))
    calc(1.25rem + env(safe-area-inset-right, 0rem))
    1rem
    calc(1.25rem + env(safe-area-inset-left, 0rem)) !important;
}
.flashcard-settings-actions {
  padding:
    1rem
    calc(1rem + env(safe-area-inset-right, 0rem))
    calc(1rem + max(env(safe-area-inset-bottom, 0rem), var(--safe-area-inset-bottom, 0rem)))
    calc(1rem + env(safe-area-inset-left, 0rem)) !important;
}
.repetition-summary {
  color: rgb(var(--v-theme-on-surface) / .62);
  font-size: .75rem;
  font-weight: 750;
  text-align: center;
}
@media (min-width: 700px) { .finish-actions { grid-template-columns: repeat(3, 1fr); } }

@media (orientation: portrait) {
  .runner-page {
    padding-bottom: max(2rem, calc(env(safe-area-inset-bottom, 0px) + 1rem));
  }
}

@media (orientation: landscape) and (max-height: 700px) {
  .runner-page {
    display: flex;
    width: 100%;
    max-width: 100vw;
    height: 100dvh;
    min-height: 0;
    padding:
      max(.5rem, env(safe-area-inset-top))
      max(1rem, env(safe-area-inset-right))
      max(.5rem, env(safe-area-inset-bottom))
      max(1rem, env(safe-area-inset-left));
    gap: .5rem;
    overflow: hidden;
  }

  .runner-page > :deep(.v-alert) {
    position: fixed;
    z-index: 20;
    top: max(.5rem, env(safe-area-inset-top));
    left: 50%;
    width: min(34rem, calc(100vw - 2rem));
    margin: 0 !important;
    transform: translateX(-50%);
  }

  .runner-header {
    display: none;
  }

  .runner-stage {
    display: grid;
    min-width: 0;
    min-height: 0;
    grid-template-columns: minmax(0, 1.15fr) minmax(14rem, .85fr);
    grid-template-rows: minmax(0, 1fr) auto auto;
    gap: .5rem 1rem;
  }

  .runner-main {
    display: contents;
  }

  .runner-details {
    display: flex;
    min-width: 0;
    min-height: 0;
    padding:
      clamp(.75rem, 2.5dvh, 1.25rem)
      clamp(.75rem, 2.5dvh, 1.25rem)
      clamp(.75rem, 2.5dvh, 1.25rem)
      clamp(1rem, 3vw, 2rem);
    grid-column: 2;
    grid-row: 1;
    flex-direction: column;
    justify-content: center;
    overflow: hidden;
    border-left: 1px solid rgb(var(--v-theme-on-surface) / .12);
    border-radius: 0;
    background: transparent;
    text-align: left;
  }

  .runner-progress-stack {
    display: flex;
    min-width: 0;
    min-height: 0;
    grid-column: 1;
    grid-row: 1 / 4;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  }

  .runner-session {
    display: block;
    margin-bottom: clamp(.6rem, 2dvh, 1rem);
    overflow: hidden;
    color: rgb(var(--v-theme-on-surface) / .5);
    font-size: .72rem;
    font-weight: 800;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .runner-position {
    display: block;
    margin-bottom: .45rem;
    color: rgb(var(--v-theme-secondary));
  }

  .group-breadcrumb {
    min-width: 0;
    margin: 0 0 .55rem;
    flex-wrap: nowrap;
    justify-content: flex-start;
    overflow: hidden;
  }

  .group-breadcrumb span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .runner-step {
    margin-top: 0;
    overflow-wrap: anywhere;
    font-size: clamp(1.65rem, 4.5vw, 3.6rem);
    line-height: .96;
  }

  .interval-review-card {
    flex: 0 0 auto;
  }

  .interval-review-card__content {
    padding: .65rem;
  }

  .interval-review-card__heading,
  .interval-review-card__meta {
    gap: .5rem;
  }

  .interval-review-card__content strong {
    display: -webkit-box;
    overflow: hidden;
    font-size: clamp(.9rem, 2.5dvh, 1.2rem);
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
  }

  .runner-progress {
    --runner-progress-inset: clamp(1rem, 5dvh, 2.5rem);
    display: flex;
    min-width: 0;
    min-height: 0;
    margin: 0;
    padding: var(--runner-progress-inset);
    flex: 1 1 auto;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    overflow: visible;
    border-radius: 0;
    background: transparent;
  }

  .runner-main--with-review .runner-progress {
    margin: 0;
    padding: clamp(.5rem, 2dvh, 1rem);
  }

  .runner-main--with-review .progress-rings {
    width: min(12rem, 50dvh, calc(100% - 1rem));
  }

  .runner-main--with-review .interval-review-card {
    width: min(100%, 30rem);
    margin: 0;
  }

  .progress-rings {
    width: min(
      100%,
      calc(
        100dvh
        - max(1rem, env(safe-area-inset-top))
        - max(1rem, env(safe-area-inset-bottom))
        - var(--runner-progress-inset)
        - var(--runner-progress-inset)
      )
    );
  }

  .runner-type-backdrop {
    --interval-type-size: 75cqi !important;
  }

  .timer-value {
    font-size: clamp(3rem, 18dvh, 6rem);
  }

  .runner-progress--confirmation .progress-rings__content :deep(.v-btn) {
    min-height: clamp(3.5rem, 18dvh, 5rem);
  }

  .next-copy {
    min-width: 0;
    padding: .7rem 0 .7rem clamp(1rem, 3vw, 2rem);
    grid-column: 2;
    grid-row: 2;
    overflow: hidden;
    border-top: 1px solid rgb(var(--v-theme-on-surface) / .12);
    border-bottom: 1px solid rgb(var(--v-theme-on-surface) / .12);
    border-radius: 0;
    background: transparent;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .runner-controls--portrait {
    display: none;
  }

  .runner-controls--landscape {
    display: grid;
    width: 100%;
    padding: .5rem 0 0 clamp(1rem, 3vw, 2rem);
    grid-column: 2;
    grid-row: 3;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    justify-content: stretch;
    align-content: center;
    gap: .5rem;
    border-radius: 0;
    background: transparent;
  }

  .runner-controls :deep(.v-btn) {
    width: 100% !important;
    max-width: none;
    min-width: 0;
  }

  .runner-controls--landscape :deep(.v-btn) {
    height: clamp(2.75rem, 12dvh, 3.5rem);
  }

  .runner-controls--landscape :deep(.runner-pause-button) {
    height: clamp(3rem, 14dvh, 4rem);
  }

  .runner-controls--landscape :deep(.v-btn__content) {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .runner-controls--landscape .runner-back-button {
    grid-column: 1;
  }

  .runner-controls--landscape .restart-button {
    grid-column: 2;
  }

  .runner-controls--landscape .runner-stop-button {
    grid-column: 3;
  }

  .restart-button {
    grid-column: 1 / -1;
  }

  .runner-page--finished {
    display: grid;
    place-items: center;
  }

  .runner-page--finished .runner-view--active {
    height: 100%;
  }

  .finish-card {
    display: grid;
    width: min(100%, 56rem);
    max-width: none;
    margin: 0;
    padding: clamp(.75rem, 3dvh, 1.25rem);
    grid-column: 1 / -1;
    grid-row: 1 / -1;
    grid-template-columns: auto minmax(10rem, 1fr) minmax(9rem, auto);
    grid-template-rows: auto auto auto;
    align-items: center;
    gap: .35rem clamp(.75rem, 3vw, 2rem);
    border-radius: 28px;
    background: rgb(var(--v-theme-surface) / .72);
    text-align: left;
  }

  .finish-icon {
    width: clamp(3rem, 12dvh, 4rem);
    height: clamp(3rem, 12dvh, 4rem);
    margin: 0;
    grid-column: 1;
    grid-row: 1 / -1;
    border-radius: 18px;
  }

  .finish-card > .runner-label {
    grid-column: 2;
    grid-row: 1;
    align-self: end;
  }

  .finish-card h1 {
    margin-top: 0;
    grid-column: 2;
    grid-row: 2;
    font-size: clamp(1.8rem, 6vw, 3.5rem);
  }

  .finish-stats {
    margin: .5rem 0 0;
    grid-column: 2;
    grid-row: 3;
    gap: .4rem;
  }

  .finish-stats div {
    padding: .5rem;
  }

  .finish-actions {
    min-width: 9rem;
    grid-column: 3;
    grid-row: 1 / -1;
    grid-template-columns: 1fr;
    align-self: center;
    gap: .5rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .runner-completion-enter-active,
  .runner-completion-leave-active {
    transition: opacity 160ms ease;
  }

  .runner-type-backdrop,
  .runner-flashcard-image-enter-active,
  .runner-flashcard-image-leave-active {
    transition: none;
  }

  .runner-completion-enter-from,
  .runner-completion-leave-to {
    transform: none;
  }
}
</style>
