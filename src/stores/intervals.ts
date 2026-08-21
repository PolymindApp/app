import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { ApiError, api, apiAssetUrl } from '@/lib/api'
import { createLocalRecordId } from '@/lib/localDatabase'
import { useSnackbarStore } from '@/stores/snackbar'
import { useTaskStore } from '@/stores/tasks'
import {
  completedIntervalFlashcardReviewSeconds,
  createRuntimeState,
  intervalDuration,
  normalizeQuickIntervalSettings,
  reconcileIntervalRuntime,
} from '@/services/intervals'
import { normalizeIntervalTypeSounds } from '@/services/intervalTypes'
import type {
  IntervalCueSettings,
  IntervalDefinition,
  IntervalFlashcardReviewSnapshot,
  IntervalRuntimeState,
  IntervalSession,
  IntervalSessionStatus,
  IntervalTemplate,
  IntervalTemplateDraft,
  QuickIntervalSettings,
} from '@/types/domain'

const RECOVERY_KEY = 'backontrack-active-interval'

function mapTemplate(record: Record<string, any>): IntervalTemplate {
  return {
    id: record.id,
    name: record.name,
    description: record.description || '',
    color: record.color || '#C7F464',
    flashcardReviewSet: record.flashcard_review_set || undefined,
    definition: record.definition,
    cues: {
      soundEnabled: record.sound_enabled !== false,
      vibrationEnabled: record.vibration_enabled !== false,
    },
    sortOrder: Number(record.sort_order || 0),
  }
}

function mapSession(record: Record<string, any>): IntervalSession {
  const flashcardSnapshot = record.flashcard_snapshot
  const flashcardReview = flashcardSnapshot
    && typeof flashcardSnapshot === 'object'
    && !Array.isArray(flashcardSnapshot)
    && Array.isArray(flashcardSnapshot.cards)
    && flashcardSnapshot.cards.length
      ? {
          ...flashcardSnapshot,
          cardSides: flashcardSnapshot.cardSides || 'both',
          sortDirection: flashcardSnapshot.sortDirection || 'asc',
          ...(flashcardSnapshot.ejectBehavior !== undefined
            ? {
                ejectBehavior: flashcardSnapshot.ejectBehavior === 'replace'
                  || flashcardSnapshot.ejectBehavior === 'exclude'
                  || flashcardSnapshot.ejectBehavior === 'replace_exclude'
                  ? flashcardSnapshot.ejectBehavior
                  : 'remove',
              }
            : {}),
          ...(flashcardSnapshot.maxCards !== undefined
            ? { maxCards: Number(flashcardSnapshot.maxCards || flashcardSnapshot.cards.length) }
            : {}),
          backSpeechRepeatCount: Number(flashcardSnapshot.backSpeechRepeatCount || 1),
          noteBeforeBack: Boolean(flashcardSnapshot.noteBeforeBack),
          cards: flashcardSnapshot.cards.map((card: Record<string, any>) => ({
            ...card,
            ...(typeof card.frontAudio === 'string' && card.frontAudio
              ? { frontAudio: apiAssetUrl(card.frontAudio) }
              : {}),
            ...(typeof card.backAudio === 'string' && card.backAudio
              ? { backAudio: apiAssetUrl(card.backAudio) }
              : {}),
          })),
          ...(flashcardSnapshot.reserveCardIds !== undefined
            ? {
                reserveCardIds: Array.isArray(flashcardSnapshot.reserveCardIds)
                  ? flashcardSnapshot.reserveCardIds.filter(
                      (id: unknown): id is string => typeof id === 'string',
                    )
                  : [],
              }
            : {}),
        } as IntervalFlashcardReviewSnapshot
      : undefined
  return {
    id: record.id,
    template: record.template || undefined,
    task: record.task || undefined,
    programStep: record.program_step || undefined,
    programStepCompletion: record.program_step_completion || undefined,
    taskDate: record.task_date || '',
    source: record.source,
    status: record.status,
    name: record.snapshot_name,
    definition: record.definition_snapshot,
    cues: {
      soundEnabled: record.cue_snapshot?.soundEnabled !== false,
      vibrationEnabled: record.cue_snapshot?.vibrationEnabled !== false,
      typeSounds: normalizeIntervalTypeSounds(record.cue_snapshot?.typeSounds),
    },
    flashcardReview,
    startedAt: record.started_at,
    endedAt: record.ended_at || undefined,
    note: record.note || undefined,
    plannedSeconds: Number(record.planned_seconds || 0),
    elapsedSeconds: Number(record.elapsed_seconds || 0),
    runtime: record.runtime_state,
    updated: record.updated,
  }
}

function mapSessionWithSpeechPause(
  record: Record<string, any>,
  speechPaused: boolean | undefined,
  speechPausedElapsedMs?: number,
) {
  const session = mapSession(record)
  if (speechPaused !== undefined && session.flashcardReview) {
    session.flashcardReview.speechPaused = speechPaused
    if (speechPaused && Number.isFinite(speechPausedElapsedMs)) {
      session.flashcardReview.speechPausedElapsedMs = speechPausedElapsedMs
    } else if (!speechPaused) {
      delete session.flashcardReview.speechPausedElapsedMs
    }
  }
  return session
}

function loadRecovery(): { sessionId: string; runtime: IntervalRuntimeState } | undefined {
  try {
    return JSON.parse(localStorage.getItem(RECOVERY_KEY) || '') || undefined
  } catch {
    return undefined
  }
}

function saveRecovery(sessionId: string, runtime: IntervalRuntimeState) {
  localStorage.setItem(RECOVERY_KEY, JSON.stringify({ sessionId, runtime }))
}

export const useIntervalStore = defineStore('intervals', () => {
  const templates = ref<IntervalTemplate[]>([])
  const sessions = ref<IntervalSession[]>([])
  const quickIntervalSettings = ref<QuickIntervalSettings>()
  const loading = ref(false)
  const loaded = ref(false)
  const error = ref('')

  const activeSession = computed(() =>
    sessions.value.find((session) => session.status === 'running' || session.status === 'paused'),
  )
  const recentSessions = computed(() =>
    sessions.value.filter((session) => session.status === 'completed' || session.status === 'ended').slice(0, 20),
  )

  async function load(options: { reconcileActiveSession?: boolean } = {}) {
    if (!api.authStore.record) return
    loading.value = true
    error.value = ''
    try {
      const [templateRecords, sessionRecords] = await Promise.all([
        api.collection('interval_templates').getFullList({ sort: 'sort_order,name' }),
        api.collection('interval_sessions').getList(1, 100, { sort: '-started_at' }),
      ])
      templates.value = templateRecords.map(mapTemplate)
      sessions.value = sessionRecords.items.map(mapSession)

      const recovery = loadRecovery()
      const active = activeSession.value
      if (active && recovery?.sessionId === active.id && recovery.runtime.updatedAt > active.runtime.updatedAt) {
        active.runtime = recovery.runtime
      }
      if (active && options.reconcileActiveSession !== false) {
        await reconcileActiveSession()
      } else {
        if (!active) localStorage.removeItem(RECOVERY_KEY)
      }
      loaded.value = true
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Could not load intervals.'
      throw cause
    } finally {
      loading.value = false
    }
  }

  async function saveTemplate(draft: IntervalTemplateDraft) {
    const payload = {
      owner: api.authStore.record!.id,
      name: draft.name,
      description: draft.description,
      color: draft.color,
      flashcard_review_set: draft.flashcardReviewSet || '',
      definition: draft.definition,
      sound_enabled: draft.cues.soundEnabled,
      vibration_enabled: draft.cues.vibrationEnabled,
      sound: 'beep',
      sort_order: draft.sortOrder,
    }
    const existing = draft.id ? templates.value.findIndex(item => item.id === draft.id) : -1
    const previous = existing >= 0 ? templates.value[existing] : undefined
    const template = mapTemplate({ id: draft.id || createLocalRecordId(), ...payload })
    if (existing >= 0) templates.value.splice(existing, 1, template)
    else templates.value.push(template)
    templates.value.sort((a, b) => a.sortOrder - b.sortOrder)
    try {
      const record = draft.id
        ? await api.collection('interval_templates').update(draft.id, payload)
        : await api.collection('interval_templates').create(payload)
      Object.assign(template, mapTemplate(record))
      templates.value.sort((a, b) => a.sortOrder - b.sortOrder)
      return template.id
    } catch (cause) {
      const optimisticIndex = templates.value.indexOf(template)
      if (previous && optimisticIndex >= 0) templates.value.splice(optimisticIndex, 1, previous)
      else if (optimisticIndex >= 0) templates.value.splice(optimisticIndex, 1)
      throw cause
    }
  }

  async function deleteTemplate(templateId: string) {
    error.value = ''
    const previousTemplates = templates.value
    const previousSessionTemplates = new Map(
      sessions.value.map(session => [session.id, session.template]),
    )
    templates.value = templates.value.filter(template => template.id !== templateId)
    sessions.value.forEach((session) => {
      if (session.template === templateId) session.template = undefined
    })
    try {
      await api.collection('interval_templates').delete(templateId)
      useSnackbarStore().showDeletion('Interval')
    } catch (cause) {
      templates.value = previousTemplates
      sessions.value.forEach((session) => {
        session.template = previousSessionTemplates.get(session.id)
      })
      const attachedTasks = cause instanceof ApiError && Array.isArray(cause.details.tasks)
        ? cause.details.tasks
          .map((task) => task && typeof task === 'object' && 'name' in task ? String(task.name) : '')
          .filter(Boolean)
        : []
      const attachedProgramSteps = cause instanceof ApiError && Array.isArray(cause.details.programSteps)
        ? cause.details.programSteps
          .map((step) => {
            if (!step || typeof step !== 'object' || !('name' in step)) return ''
            const taskName = 'taskName' in step ? String(step.taskName) : ''
            return `${taskName ? `${taskName} · ` : ''}${String(step.name)}`
          })
          .filter(Boolean)
        : []
      error.value = cause instanceof Error
        ? `${cause.message}${attachedTasks.length ? ` Attached tasks: ${attachedTasks.join(', ')}.` : ''}${attachedProgramSteps.length ? ` Attached program steps: ${attachedProgramSteps.join(', ')}.` : ''}`
        : 'Could not delete the interval.'
      throw cause
    }
  }

  async function deleteSession(sessionId: string) {
    error.value = ''
    const index = sessions.value.findIndex(session => session.id === sessionId)
    if (index < 0) throw new Error('Interval session not found.')
    const session = sessions.value[index]!
    sessions.value.splice(index, 1)
    try {
      await api.collection('interval_sessions').delete(sessionId)
      useSnackbarStore().showDeletion('Run')
    } catch (cause) {
      if (!sessions.value.includes(session)) sessions.value.splice(index, 0, session)
      error.value = cause instanceof Error ? cause.message : 'Could not delete this run.'
      throw cause
    }
  }

  async function reorderTemplates(ordered: IntervalTemplate[]) {
    const previousTemplates = templates.value.map((template) => ({ ...template }))
    const previousSortOrders = new Map(
      previousTemplates.map((template) => [template.id, template.sortOrder]),
    )
    templates.value = ordered
    templates.value.forEach((template, index) => {
      template.sortOrder = index
    })
    const changedTemplates = templates.value.filter(
      (template) => previousSortOrders.get(template.id) !== template.sortOrder,
    )
    if (!changedTemplates.length) return

    error.value = ''
    try {
      await Promise.all(
        changedTemplates.map((template) =>
          api.collection('interval_templates').update(template.id, {
            sort_order: template.sortOrder,
          }),
        ),
      )
    } catch (cause) {
      templates.value = previousTemplates
      await Promise.allSettled(
        changedTemplates.map((template) =>
          api.collection('interval_templates').update(template.id, {
            sort_order: previousSortOrders.get(template.id),
          }),
        ),
      )
      error.value = cause instanceof Error
        ? cause.message
        : 'Could not save the interval order.'
      throw cause
    }
  }

  async function startSession(input: {
    name: string
    source: IntervalSession['source']
    definition: IntervalDefinition
    cues: IntervalCueSettings
    template?: string
    task?: string
    programStep?: string
    programStepCompletion?: string
    taskDate?: string
    flashcardReview?: IntervalFlashcardReviewSnapshot
  }) {
    if (activeSession.value) return activeSession.value
    const activeRecords = await api.collection('interval_sessions').getList(1, 1, {
      filter: 'status = "running" || status = "paused"',
      sort: '-started_at',
    })
    if (activeRecords.items[0]) {
      const existing = mapSession(activeRecords.items[0])
      if (!sessions.value.some((session) => session.id === existing.id)) sessions.value.unshift(existing)
      return existing
    }
    const startedAt = new Date()
    const runtime = createRuntimeState(input.definition, startedAt)
    const cues: IntervalCueSettings = {
      ...input.cues,
      typeSounds: normalizeIntervalTypeSounds(
        api.authStore.record?.settings?.intervalTypeSounds ?? input.cues.typeSounds,
      ),
    }
    const record = await api.collection('interval_sessions').create({
      owner: api.authStore.record!.id,
      template: input.template || '',
      task: input.task || '',
      program_step: input.programStep || '',
      program_step_completion: input.programStepCompletion || '',
      task_date: input.task ? input.taskDate || '' : '',
      source: input.source,
      status: 'running',
      snapshot_name: input.name,
      definition_snapshot: input.definition,
      cue_snapshot: cues,
      started_at: startedAt.toISOString(),
      planned_seconds: intervalDuration(input.definition),
      elapsed_seconds: 0,
      runtime_state: runtime,
      ...(input.flashcardReview ? { flashcard_snapshot: input.flashcardReview } : {}),
    })
    const session = mapSession(record)
    sessions.value.unshift(session)
    saveRecovery(session.id, session.runtime)
    return session
  }

  async function updateSession(
    sessionId: string,
    changes: {
      status?: IntervalSessionStatus
      definition?: IntervalDefinition
      cues?: IntervalCueSettings
      runtime?: IntervalRuntimeState
      plannedSeconds?: number
      elapsedSeconds?: number
      endedAt?: string
      note?: string
    },
  ) {
    const payload: Record<string, unknown> = {}
    if (changes.status) payload.status = changes.status
    if (changes.definition) payload.definition_snapshot = changes.definition
    if (changes.cues) payload.cue_snapshot = changes.cues
    if (changes.runtime) payload.runtime_state = changes.runtime
    if (changes.plannedSeconds !== undefined) payload.planned_seconds = changes.plannedSeconds
    if (changes.elapsedSeconds !== undefined) payload.elapsed_seconds = changes.elapsedSeconds
    if (changes.endedAt !== undefined) payload.ended_at = changes.endedAt
    if (changes.note !== undefined) payload.note = changes.note
    const index = sessions.value.findIndex((session) => session.id === sessionId)
    if (index < 0) {
      return mapSession(await api.collection('interval_sessions').update(sessionId, payload))
    }
    const session = sessions.value[index]!
    const previous = { ...session }
    if (changes.status !== undefined) session.status = changes.status
    if (changes.definition !== undefined) session.definition = changes.definition
    if (changes.cues !== undefined) session.cues = changes.cues
    if (changes.runtime !== undefined) session.runtime = changes.runtime
    if (changes.plannedSeconds !== undefined) session.plannedSeconds = changes.plannedSeconds
    if (changes.elapsedSeconds !== undefined) session.elapsedSeconds = changes.elapsedSeconds
    if (changes.endedAt !== undefined) session.endedAt = changes.endedAt || undefined
    if (changes.note !== undefined) session.note = changes.note || undefined
    if (session.status === 'running' || session.status === 'paused') saveRecovery(session.id, session.runtime)
    else localStorage.removeItem(RECOVERY_KEY)
    try {
      const record = await api.collection('interval_sessions').update(sessionId, payload)
      const speechPaused = session.flashcardReview?.speechPaused
      const updated = mapSessionWithSpeechPause(
        record,
        speechPaused,
        session.flashcardReview?.speechPausedElapsedMs,
      )
      Object.assign(session, updated)
      return session
    } catch (cause) {
      Object.assign(session, previous)
      if (session.status === 'running' || session.status === 'paused') saveRecovery(session.id, session.runtime)
      throw cause
    }
  }

  async function updateSessionFlashcardReview(
    sessionId: string,
    flashcardReview: IntervalFlashcardReviewSnapshot | undefined,
  ) {
    const index = sessions.value.findIndex((session) => session.id === sessionId)
    if (index < 0) {
      const record = await api.updateIntervalSessionFlashcards(sessionId, flashcardReview || {})
      return mapSessionWithSpeechPause(
        record,
        flashcardReview?.speechPaused,
        flashcardReview?.speechPausedElapsedMs,
      )
    }
    const session = sessions.value[index]!
    const previous = session.flashcardReview
    session.flashcardReview = flashcardReview
    try {
      const record = await api.updateIntervalSessionFlashcards(sessionId, flashcardReview || {})
      const updated = mapSessionWithSpeechPause(
        record,
        flashcardReview?.speechPaused,
        flashcardReview?.speechPausedElapsedMs,
      )
      Object.assign(session, updated)
      if (session.status === 'running' || session.status === 'paused') saveRecovery(session.id, session.runtime)
      return session
    } catch (cause) {
      session.flashcardReview = previous
      throw cause
    }
  }

  async function completeSession(
    sessionId: string,
    changes: {
      runtime: IntervalRuntimeState
      elapsedSeconds: number
      endedAt: string
    },
  ) {
    return finishSessionOptimistically(sessionId, 'completed', changes, () => (
      api.completeIntervalSession(sessionId, {
        runtimeState: changes.runtime,
        elapsedSeconds: changes.elapsedSeconds,
        endedAt: changes.endedAt,
      })
    ))
  }

  async function endSession(
    sessionId: string,
    changes: {
      runtime: IntervalRuntimeState
      elapsedSeconds: number
      endedAt: string
    },
  ) {
    return finishSessionOptimistically(sessionId, 'ended', changes, () => (
      api.endIntervalSession(sessionId, {
        runtimeState: changes.runtime,
        elapsedSeconds: changes.elapsedSeconds,
        endedAt: changes.endedAt,
      })
    ))
  }

  async function finishSessionOptimistically(
    sessionId: string,
    status: Extract<IntervalSessionStatus, 'completed' | 'ended'>,
    changes: { runtime: IntervalRuntimeState; elapsedSeconds: number; endedAt: string },
    persist: () => Promise<{
      session: Record<string, any>
      occurrence: Record<string, any> | null
      occurrences?: Record<string, any>[]
      entries?: Record<string, any>[]
      local?: boolean
    }>,
  ) {
    const session = sessions.value.find(item => item.id === sessionId)
    const previous = session ? { ...session } : undefined
    if (session) {
      session.status = status
      session.runtime = changes.runtime
      session.elapsedSeconds = changes.elapsedSeconds
      session.endedAt = changes.endedAt
      localStorage.removeItem(RECOVERY_KEY)
    }
    try {
      return await mergeFinishedSession(await persist())
    } catch (cause) {
      if (session && previous) {
        Object.assign(session, previous)
        if (session.status === 'running' || session.status === 'paused') {
          saveRecovery(session.id, session.runtime)
        }
      }
      throw cause
    }
  }

  async function mergeFinishedSession(response: {
    session: Record<string, any>
    occurrence: Record<string, any> | null
    occurrences?: Record<string, any>[]
    entries?: Record<string, any>[]
    local?: boolean
  }) {
    const mapped = mapSession(response.session)
    const index = sessions.value.findIndex((session) => session.id === mapped.id)
    if (index >= 0) sessions.value.splice(index, 1, mapped)
    else sessions.value.unshift(mapped)
    const taskStore = useTaskStore()
    const progressOccurrences = response.occurrences || []
    progressOccurrences.forEach(record => taskStore.upsertOccurrenceRecord(record))
    if (response.occurrence && !progressOccurrences.some(record => record.id === response.occurrence?.id)) {
      taskStore.upsertOccurrenceRecord(response.occurrence)
    }
    const progressEntries = response.entries || []
    progressEntries.forEach(record => taskStore.upsertEntryRecord(record))
    if (response.local) {
      const reviewSetId = mapped.flashcardReview?.reviewSet || ''
      const reviewElapsedSeconds = reviewSetId
        ? completedIntervalFlashcardReviewSeconds(
            mapped.definition,
            mapped.runtime,
            mapped.elapsedSeconds,
          )
        : 0
      await taskStore.applyLocalSessionProgress({
        id: mapped.id,
        sourceType: 'interval',
        sourceId: mapped.template,
        taskId: mapped.task,
        programStepId: mapped.programStep,
        programStepCompletionId: mapped.programStepCompletion,
        taskDate: mapped.taskDate,
        startedAt: mapped.startedAt,
        status: mapped.status === 'completed' ? 'completed' : 'ended',
        elapsedSeconds: mapped.elapsedSeconds,
        completedAt: mapped.endedAt || new Date().toISOString(),
      }, reviewElapsedSeconds <= 0)
      if (reviewElapsedSeconds > 0) {
        await taskStore.applyLocalSessionProgress({
          id: mapped.id,
          sourceType: 'flashcards',
          sourceId: reviewSetId,
          taskDate: mapped.taskDate,
          startedAt: mapped.startedAt,
          status: mapped.status === 'completed' ? 'completed' : 'ended',
          elapsedSeconds: reviewElapsedSeconds,
          completedAt: mapped.endedAt || new Date().toISOString(),
        })
      }
    } else if (
      !response.occurrence
      && !progressOccurrences.length
      && mapped.status === 'completed'
      && mapped.task
      && mapped.taskDate
    ) {
      await taskStore.completeAttributedTask(
        mapped.task,
        mapped.taskDate,
        mapped.programStep || '',
        mapped.programStepCompletion || '',
      )
    }
    localStorage.removeItem(RECOVERY_KEY)
    return mapped
  }

  async function reconcileActiveSession() {
    const active = activeSession.value
    if (!active || active.status !== 'running') return active

    const now = new Date()
    const result = reconcileIntervalRuntime(active.definition, active.runtime, now)
    if (result.completed) {
      return completeSession(active.id, {
        runtime: result.runtime,
        elapsedSeconds: Math.round(result.runtime.accumulatedMs / 1000),
        endedAt: now.toISOString(),
      })
    }

    if (result.transitions > 0 || result.runtime.remainingMs !== active.runtime.remainingMs) {
      return updateSession(active.id, {
        runtime: result.runtime,
        elapsedSeconds: Math.round(result.runtime.accumulatedMs / 1000),
      })
    }
    return active
  }

  function mirrorRuntime(sessionId: string, runtime: IntervalRuntimeState) {
    const session = sessions.value.find((item) => item.id === sessionId)
    if (session) session.runtime = runtime
    saveRecovery(sessionId, runtime)
  }

  async function loadQuickIntervalSettings() {
    const settings = await api.getUserSettings()
    quickIntervalSettings.value = normalizeQuickIntervalSettings(settings.quickInterval)
    return quickIntervalSettings.value
  }

  async function rememberQuickIntervalSettings(settings: QuickIntervalSettings) {
    const previous = quickIntervalSettings.value
    quickIntervalSettings.value = normalizeQuickIntervalSettings(settings)
    try {
      const saved = await api.updateUserSettings({ quickInterval: settings })
      quickIntervalSettings.value = normalizeQuickIntervalSettings(saved.quickInterval)
      if (!quickIntervalSettings.value) {
        throw new Error('The saved quick interval settings are invalid.')
      }
      return quickIntervalSettings.value
    } catch (cause) {
      quickIntervalSettings.value = previous
      throw cause
    }
  }

  return {
    templates,
    sessions,
    quickIntervalSettings,
    loading,
    loaded,
    error,
    activeSession,
    recentSessions,
    load,
    saveTemplate,
    deleteTemplate,
    deleteSession,
    reorderTemplates,
    startSession,
    updateSession,
    updateSessionFlashcardReview,
    completeSession,
    endSession,
    reconcileActiveSession,
    mirrorRuntime,
    loadQuickIntervalSettings,
    rememberQuickIntervalSettings,
  }
})
