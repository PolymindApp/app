import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { pb } from '@/lib/pocketbase'
import { createRuntimeState, intervalDuration, reconcileIntervalRuntime } from '@/services/intervals'
import type {
  IntervalCueSettings,
  IntervalDefinition,
  IntervalRuntimeState,
  IntervalSession,
  IntervalSessionStatus,
  IntervalTemplate,
  IntervalTemplateDraft,
} from '@/types/domain'

const RECOVERY_KEY = 'mom-active-interval'
const QUICK_CUES_KEY = 'mom-quick-interval-cues'

function mapTemplate(record: Record<string, any>): IntervalTemplate {
  return {
    id: record.id,
    name: record.name,
    description: record.description || '',
    color: record.color || '#C7F464',
    definition: record.definition,
    cues: {
      soundEnabled: record.sound_enabled !== false,
      vibrationEnabled: record.vibration_enabled !== false,
    },
    sortOrder: Number(record.sort_order || 0),
  }
}

function mapSession(record: Record<string, any>): IntervalSession {
  return {
    id: record.id,
    template: record.template || undefined,
    source: record.source,
    status: record.status,
    name: record.snapshot_name,
    definition: record.definition_snapshot,
    cues: {
      soundEnabled: record.cue_snapshot?.soundEnabled !== false,
      vibrationEnabled: record.cue_snapshot?.vibrationEnabled !== false,
    },
    startedAt: record.started_at,
    endedAt: record.ended_at || undefined,
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
    if (!pb.authStore.record) return
    loading.value = true
    error.value = ''
    try {
      const [templateRecords, sessionRecords] = await Promise.all([
        pb.collection('interval_templates').getFullList({ sort: 'sort_order,name' }),
        pb.collection('interval_sessions').getList(1, 100, { sort: '-started_at' }),
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
      owner: pb.authStore.record!.id,
      name: draft.name,
      description: draft.description,
      color: draft.color,
      definition: draft.definition,
      sound_enabled: draft.cues.soundEnabled,
      vibration_enabled: draft.cues.vibrationEnabled,
      sound: 'beep',
      sort_order: draft.sortOrder,
    }
    const record = draft.id
      ? await pb.collection('interval_templates').update(draft.id, payload)
      : await pb.collection('interval_templates').create(payload)
    const template = mapTemplate(record)
    const existing = templates.value.findIndex((item) => item.id === template.id)
    if (existing >= 0) templates.value.splice(existing, 1, template)
    else templates.value.push(template)
    templates.value.sort((a, b) => a.sortOrder - b.sortOrder)
    return template.id
  }

  async function deleteTemplate(templateId: string) {
    await pb.collection('interval_templates').delete(templateId)
    templates.value = templates.value.filter((template) => template.id !== templateId)
    sessions.value.forEach((session) => {
      if (session.template === templateId) session.template = undefined
    })
  }

  async function duplicateTemplate(template: IntervalTemplate) {
    return saveTemplate({
      name: `${template.name} copy`,
      description: template.description,
      color: template.color,
      definition: structuredClone(template.definition),
      cues: { ...template.cues },
      sortOrder: templates.value.length,
    })
  }

  async function reorderTemplates(ordered: IntervalTemplate[]) {
    templates.value = ordered
    templates.value.forEach((template, index) => {
      template.sortOrder = index
    })
    await Promise.all(
      templates.value.map((template) =>
        pb.collection('interval_templates').update(template.id, { sort_order: template.sortOrder }),
      ),
    )
  }

  async function startSession(input: {
    name: string
    source: IntervalSession['source']
    definition: IntervalDefinition
    cues: IntervalCueSettings
    template?: string
  }) {
    if (activeSession.value) return activeSession.value
    const activeRecords = await pb.collection('interval_sessions').getList(1, 1, {
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
    const record = await pb.collection('interval_sessions').create({
      owner: pb.authStore.record!.id,
      template: input.template || '',
      source: input.source,
      status: 'running',
      snapshot_name: input.name,
      definition_snapshot: input.definition,
      cue_snapshot: input.cues,
      started_at: startedAt.toISOString(),
      planned_seconds: intervalDuration(input.definition),
      elapsed_seconds: 0,
      runtime_state: runtime,
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
    },
  ) {
    const payload: Record<string, unknown> = {}
    if (changes.status) payload.status = changes.status
    if (changes.runtime) payload.runtime_state = changes.runtime
    if (changes.elapsedSeconds !== undefined) payload.elapsed_seconds = changes.elapsedSeconds
    if (changes.endedAt !== undefined) payload.ended_at = changes.endedAt
    const record = await pb.collection('interval_sessions').update(sessionId, payload)
    const mapped = mapSession(record)
    const index = sessions.value.findIndex((session) => session.id === sessionId)
    if (index >= 0) sessions.value.splice(index, 1, mapped)
    if (mapped.status === 'running' || mapped.status === 'paused') saveRecovery(mapped.id, mapped.runtime)
    else localStorage.removeItem(RECOVERY_KEY)
    return mapped
  }

  async function reconcileActiveSession() {
    const active = activeSession.value
    if (!active || active.status !== 'running') return active

    const now = new Date()
    const result = reconcileIntervalRuntime(active.definition, active.runtime, now)
    if (result.completed) {
      return updateSession(active.id, {
        status: 'completed',
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

  function getQuickCues(): IntervalCueSettings {
    try {
      const saved = JSON.parse(localStorage.getItem(QUICK_CUES_KEY) || '')
      if (saved) {
        return {
          soundEnabled: saved.soundEnabled !== false,
          vibrationEnabled: saved.vibrationEnabled !== false,
        }
      }
    } catch {
      // Use defaults below.
    }
    return { soundEnabled: true, vibrationEnabled: true }
  }

  function rememberQuickCues(cues: IntervalCueSettings) {
    localStorage.setItem(QUICK_CUES_KEY, JSON.stringify(cues))
  }

  return {
    templates,
    sessions,
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
    reconcileActiveSession,
    mirrorRuntime,
    getQuickCues,
    rememberQuickCues,
  }
})
