import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { ApiError, api, apiAssetUrl } from '@/lib/api'
import { useSnackbarStore } from '@/stores/snackbar'
import { useTaskStore } from '@/stores/tasks'
import {
  cloneIntervalTemplateDraft,
  createRuntimeState,
  intervalDuration,
  normalizeQuickIntervalSettings,
  reconcileIntervalRuntime,
} from '@/services/intervals'
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

const RECOVERY_KEY = 'mom-active-interval'

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
          backSpeechRepeatCount: Number(flashcardSnapshot.backSpeechRepeatCount || 1),
          noteBeforeBack: Boolean(flashcardSnapshot.noteBeforeBack),
          cards: flashcardSnapshot.cards.map((card: Record<string, any>) => ({
            ...card,
            image: apiAssetUrl(typeof card.image === 'string' ? card.image : ''),
          })),
        } as IntervalFlashcardReviewSnapshot
      : undefined
  return {
    id: record.id,
    template: record.template || undefined,
    task: record.task || undefined,
    programStep: record.program_step || undefined,
    taskDate: record.task_date || '',
    source: record.source,
    status: record.status,
    name: record.snapshot_name,
    definition: record.definition_snapshot,
    cues: {
      soundEnabled: record.cue_snapshot?.soundEnabled !== false,
      vibrationEnabled: record.cue_snapshot?.vibrationEnabled !== false,
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

  async function load() {
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
      if (active) {
        await reconcileActiveSession()
      } else {
        localStorage.removeItem(RECOVERY_KEY)
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
    const record = draft.id
      ? await api.collection('interval_templates').update(draft.id, payload)
      : await api.collection('interval_templates').create(payload)
    const template = mapTemplate(record)
    const existing = templates.value.findIndex((item) => item.id === template.id)
    if (existing >= 0) templates.value.splice(existing, 1, template)
    else templates.value.push(template)
    templates.value.sort((a, b) => a.sortOrder - b.sortOrder)
    return template.id
  }

  async function deleteTemplate(templateId: string) {
    error.value = ''
    try {
      await api.collection('interval_templates').delete(templateId)
      templates.value = templates.value.filter((template) => template.id !== templateId)
      sessions.value.forEach((session) => {
        if (session.template === templateId) session.template = undefined
      })
      useSnackbarStore().showDeletion('Interval')
    } catch (cause) {
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

  async function duplicateTemplate(template: IntervalTemplate) {
    const draft = cloneIntervalTemplateDraft(template)
    return saveTemplate({
      ...draft,
      id: undefined,
      name: `${draft.name} copy`,
      sortOrder: templates.value.length,
    })
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
    const record = await api.collection('interval_sessions').create({
      owner: api.authStore.record!.id,
      template: input.template || '',
      task: input.task || '',
      program_step: input.programStep || '',
      task_date: input.task ? input.taskDate || '' : '',
      source: input.source,
      status: 'running',
      snapshot_name: input.name,
      definition_snapshot: input.definition,
      cue_snapshot: input.cues,
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
      runtime?: IntervalRuntimeState
      elapsedSeconds?: number
      endedAt?: string
      note?: string
    },
  ) {
    const payload: Record<string, unknown> = {}
    if (changes.status) payload.status = changes.status
    if (changes.runtime) payload.runtime_state = changes.runtime
    if (changes.elapsedSeconds !== undefined) payload.elapsed_seconds = changes.elapsedSeconds
    if (changes.endedAt !== undefined) payload.ended_at = changes.endedAt
    if (changes.note !== undefined) payload.note = changes.note
    const record = await api.collection('interval_sessions').update(sessionId, payload)
    const mapped = mapSession(record)
    const index = sessions.value.findIndex((session) => session.id === sessionId)
    if (index >= 0) sessions.value.splice(index, 1, mapped)
    if (mapped.status === 'running' || mapped.status === 'paused') saveRecovery(mapped.id, mapped.runtime)
    else localStorage.removeItem(RECOVERY_KEY)
    return mapped
  }

  async function updateSessionFlashcardReview(
    sessionId: string,
    flashcardReview: IntervalFlashcardReviewSnapshot,
  ) {
    const record = await api.updateIntervalSessionFlashcards(sessionId, flashcardReview)
    const mapped = mapSession(record)
    const index = sessions.value.findIndex((session) => session.id === sessionId)
    if (index >= 0) sessions.value.splice(index, 1, mapped)
    if (mapped.status === 'running' || mapped.status === 'paused') saveRecovery(mapped.id, mapped.runtime)
    return mapped
  }

  async function completeSession(
    sessionId: string,
    changes: {
      runtime: IntervalRuntimeState
      elapsedSeconds: number
      endedAt: string
    },
  ) {
    const response = await api.completeIntervalSession(sessionId, {
      runtimeState: changes.runtime,
      elapsedSeconds: changes.elapsedSeconds,
      endedAt: changes.endedAt,
    })
    const mapped = mapSession(response.session)
    const index = sessions.value.findIndex((session) => session.id === sessionId)
    if (index >= 0) sessions.value.splice(index, 1, mapped)
    else sessions.value.unshift(mapped)
    if (response.occurrence) useTaskStore().upsertOccurrenceRecord(response.occurrence)
    else if (mapped.status === 'completed' && mapped.task && mapped.taskDate) {
      await useTaskStore().completeAttributedTask(
        mapped.task,
        mapped.taskDate,
        mapped.programStep || '',
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
    const saved = await api.updateUserSettings({ quickInterval: settings })
    quickIntervalSettings.value = normalizeQuickIntervalSettings(saved.quickInterval)
    if (!quickIntervalSettings.value) {
      throw new Error('The saved quick interval settings are invalid.')
    }
    return quickIntervalSettings.value
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
    duplicateTemplate,
    reorderTemplates,
    startSession,
    updateSession,
    updateSessionFlashcardReview,
    completeSession,
    reconcileActiveSession,
    mirrorRuntime,
    loadQuickIntervalSettings,
    rememberQuickIntervalSettings,
  }
})
