import 'fake-indexeddb/auto'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import {
  completeLocalBootstrap,
  listLocalRecords,
  localDatabase,
} from '@/lib/localDatabase'

vi.mock('@/services/taskReminders', () => ({
  reconcileTaskReminders: vi.fn().mockResolvedValue(undefined),
}))

import { useFlashcardStore } from './flashcards'
import { useTaskStore } from './tasks'

const accountId = 'offline-account'

function resource(resourceName: string, id: string, data: Record<string, unknown>) {
  return {
    resource: resourceName,
    id,
    revision: 1,
    fieldClocks: { '*': '100-server' },
    deleted: false,
    data: { id, owner: accountId, ...data },
  }
}

function durationTaskResource() {
  return resource('tasks', 'task-1', {
    name: 'Review vocabulary',
    description: '',
    type: 'flashcards',
    mandatory: true,
    review_when_missed: false,
    active: true,
    start_date: '2026-01-01',
    end_date: '',
    recurrence_type: 'daily',
    weekdays: [],
    interval_weeks: 1,
    target_value: 1,
    target_operator: 'gte',
    goal_period: 'occurrence',
    program_repeat: false,
    program_strict: false,
    entry_notes_enabled: false,
    entry_note_suggestions_enabled: false,
    sort_order: 0,
    interval_template: '',
    flashcard_review_set: 'set-1',
    session_count_mode: 'linked',
    session_goal_type: 'duration',
    session_target_seconds: 300,
    tracking_trackers: [],
    reminder_enabled: false,
    reminder_times: [],
  })
}

describe('offline Review set task progress', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    localDatabase.close()
    await localDatabase.delete()
    await localDatabase.open()
    api.authStore.record = {
      id: accountId,
      email: 'offline@example.com',
      name: 'Offline user',
    }
  })

  it('credits elapsed time when a standalone Review set session is ended manually', async () => {
    await completeLocalBootstrap(accountId, 1, [
      durationTaskResource(),
      resource('accessible_flashcard_review_sets', 'set-1', {
        name: 'Vocabulary',
        tags: [],
        owner_name: 'Offline user',
        owner_avatar: '',
        access_role: 'owner',
        matching_card_count: 1,
        mode: 'manual',
        card_sides: 'both',
        indefinite: false,
        max_cards: 20,
        front_seconds: 5,
        back_seconds: 5,
        back_speech_repeat_count: 1,
        note_before_back: false,
        speech_enabled: false,
        front_language: '',
        back_language: '',
        sort_mode: 'recently_added',
        sort_order: 0,
        created_at: '2026-08-10T12:00:00.000Z',
        updated_at: '2026-08-10T12:00:00.000Z',
      }),
      resource('flashcard_review_sessions', 'session-1', {
        source_owner: accountId,
        review_set: 'set-1',
        status: 'running',
        snapshot_name: 'Vocabulary',
        mode_snapshot: 'manual',
        card_sides_snapshot: 'both',
        indefinite_snapshot: false,
        max_cards_snapshot: 20,
        sort_snapshot: 'recently_added',
        tags_snapshot: [],
        front_seconds_snapshot: 5,
        back_seconds_snapshot: 5,
        back_speech_repeat_count_snapshot: 1,
        note_before_back_snapshot: false,
        speech_enabled_snapshot: false,
        front_language_snapshot: '',
        back_language_snapshot: '',
        queue_state: [{ id: 'card-1', front: 'One', back: 'Un', note: '', tags: [] }],
        started_at: '2026-08-10T16:00:00.000Z',
        ended_at: '',
        updated_at: '2026-08-10T16:00:00.000Z',
        elapsed_seconds: 0,
        total_cards: 1,
        viewed_count: 0,
        success_count: 0,
        error_count: 0,
        ejected_count: 0,
        task: '',
        program_step: '',
        task_date: '',
      }),
    ])

    const taskStore = useTaskStore()
    const flashcardStore = useFlashcardStore()
    await Promise.all([taskStore.load(), flashcardStore.load()])

    const ended = await flashcardStore.act('session-1', 'end', 120)

    expect(ended).toMatchObject({ status: 'ended', elapsedSeconds: 120 })
    expect(taskStore.makeProgress(taskStore.tasks[0]!, new Date(2026, 7, 10))).toMatchObject({
      value: 120,
      percent: 40,
      complete: false,
    })
    expect(await listLocalRecords(accountId, 'entries')).toEqual([
      expect.objectContaining({
        task: 'task-1',
        value: 120,
        source_type: 'flashcards',
        source_session: 'session-1',
      }),
    ])
  })

  it('repairs missing progress from a Review set session that was already ended', async () => {
    await completeLocalBootstrap(accountId, 1, [
      durationTaskResource(),
      resource('flashcard_review_sessions', 'session-1', {
        review_set: 'set-1',
        status: 'ended',
        started_at: '2026-08-10T16:00:00.000Z',
        ended_at: '2026-08-10T16:02:00.000Z',
        elapsed_seconds: 120,
        task: '',
        program_step: '',
        task_date: '',
      }),
    ])

    const taskStore = useTaskStore()
    await taskStore.load()

    expect(taskStore.makeProgress(taskStore.tasks[0]!, new Date(2026, 7, 10))).toMatchObject({
      value: 120,
      percent: 40,
    })
    await taskStore.load()
    expect(await listLocalRecords(accountId, 'entries')).toHaveLength(1)
  })

  it('credits only Review-enabled time from a completed interval with an attached set', async () => {
    await completeLocalBootstrap(accountId, 1, [
      durationTaskResource(),
      resource('interval_sessions', 'interval-session-1', {
        template: 'interval-1',
        task: '',
        program_step: '',
        task_date: '',
        source: 'template',
        status: 'completed',
        snapshot_name: 'Study interval',
        definition_snapshot: {
          version: 1,
          children: [
            {
              id: 'review-step',
              type: 'step',
              name: 'Review',
              kind: 'work',
              durationSeconds: 60,
            },
            {
              id: 'silent-step',
              type: 'step',
              name: 'Silent',
              kind: 'rest',
              durationSeconds: 60,
              flashcardReviewEnabled: false,
            },
          ],
        },
        cue_snapshot: { soundEnabled: true, vibrationEnabled: true },
        flashcard_snapshot: {
          reviewSet: 'set-1',
          cards: [{ id: 'card-1', front: 'One', back: 'Un', note: '', tags: [] }],
        },
        started_at: '2026-08-10T16:00:00.000Z',
        ended_at: '2026-08-10T16:02:00.000Z',
        updated_at: '2026-08-10T16:02:00.000Z',
        planned_seconds: 120,
        elapsed_seconds: 120,
        runtime_state: {
          stepIndex: 2,
          remainingMs: 0,
          accumulatedMs: 120_000,
          updatedAt: '2026-08-10T16:02:00.000Z',
        },
      }),
    ])

    const taskStore = useTaskStore()
    await taskStore.load()

    expect(taskStore.makeProgress(taskStore.tasks[0]!, new Date(2026, 7, 10))).toMatchObject({
      value: 52,
      percent: (52 / 300) * 100,
      complete: false,
    })
    expect(await listLocalRecords(accountId, 'entries')).toEqual([
      expect.objectContaining({
        task: 'task-1',
        value: 52,
        source_type: 'flashcards',
        source_session: 'interval-session-1',
      }),
    ])
    await taskStore.load()
    expect(await listLocalRecords(accountId, 'entries')).toHaveLength(1)
  })
})
