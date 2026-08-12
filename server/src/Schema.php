<?php

declare(strict_types=1);

namespace Polymind\Api;

final class Schema
{
    private static ?array $collections = null;

    public static function collection(string $name): ?array
    {
        return self::collections()[$name] ?? null;
    }

    public static function collections(): array
    {
        if (self::$collections !== null) {
            return self::$collections;
        }

        self::$collections = [
            'tags' => [
                'fields' => [
                    'name' => self::text(50, true),
                ],
                'required' => ['name'],
                'sort' => ['name'],
                'filter' => ['name'],
            ],
            'flashcard_tags' => [
                'fields' => [
                    'name' => self::text(50, true),
                ],
                'required' => ['name'],
                'sort' => ['name'],
                'filter' => ['name'],
            ],
            'flashcards' => [
                'fields' => [
                    'front' => self::text(5000, true),
                    'back' => self::text(5000, true),
                    'note' => self::text(2000),
                    'image_url' => self::text(2048),
                    'image_file' => self::text(52),
                    'library_image_id' => self::integer(0),
                    'image_metadata' => self::json(8000),
                    'tags' => self::jsonArray(5000),
                    'created_at' => self::timestamp(false, true),
                    'updated_at' => self::timestamp(false, true),
                    'last_reviewed_at' => self::timestamp(false, true),
                    'passive_views' => self::integer(0),
                    'success_count' => self::integer(0),
                    'error_count' => self::integer(0),
                ],
                'required' => ['front', 'back'],
                'sort' => [
                    'front', 'created_at', 'updated_at', 'last_reviewed_at',
                    'passive_views', 'success_count', 'error_count',
                ],
                'filter' => ['created_at', 'last_reviewed_at'],
            ],
            'flashcard_review_sets' => [
                'fields' => [
                    'name' => self::text(160, true),
                    'tags' => self::jsonArray(5000),
                    'excluded_cards' => self::jsonArray(200000),
                    'mode' => self::choice(['manual', 'passive'], true),
                    'card_sides' => self::choice(['both', 'front', 'back'], true),
                    'indefinite' => self::boolean(),
                    'max_cards' => self::integer(1, 100),
                    'front_seconds' => self::integer(1, 60),
                    'back_seconds' => self::integer(1, 60),
                    'back_speech_repeat_count' => self::integer(1, 5),
                    'note_before_back' => self::boolean(),
                    'speech_enabled' => self::boolean(),
                    'front_language' => self::text(35),
                    'back_language' => self::text(35),
                    'sort_mode' => self::choice([
                        'difficult', 'never_reviewed', 'least_recent', 'recently_added', 'random',
                    ], true),
                    'sort_order' => self::integer(0),
                    'created_at' => self::timestamp(false, true),
                    'updated_at' => self::timestamp(false, true),
                ],
                'required' => ['name', 'mode', 'sort_mode'],
                'sort' => ['name', 'sort_order', 'created_at', 'updated_at'],
                'filter' => ['mode', 'sort_mode'],
            ],
            'tasks' => [
                'fields' => [
                    'name' => self::text(160, true),
                    'description' => self::text(2000),
                    'type' => self::choice(
                        [
                            'check', 'duration', 'daily_total', 'step_counter',
                            'program', 'interval', 'flashcards', 'tracking', 'journal',
                        ],
                        true,
                    ),
                    'tags' => self::jsonArray(1000),
                    'mandatory' => self::boolean(),
                    'review_when_missed' => self::boolean(),
                    'active' => self::boolean(),
                    'start_date' => self::dateKey(true),
                    'end_date' => self::dateKey(false, true),
                    'recurrence_type' => self::choice(['daily', 'weekdays', 'interval_weeks'], true),
                    'weekdays' => self::numberArray(1000),
                    'interval_weeks' => self::integer(1, 52),
                    'target_value' => self::number(0),
                    'target_operator' => self::choice(['gte', 'lte', 'eq'], false, true),
                    'unit' => self::text(30),
                    'custom_unit' => self::text(30),
                    'goal_period' => self::choice(['occurrence', 'week'], false, true),
                    'quick_amounts' => self::numberArray(1000),
                    'cycle_length' => self::integer(0, 365),
                    'program_repeat' => self::boolean(),
                    'program_strict' => self::boolean(),
                    'entry_notes_enabled' => self::boolean(),
                    'entry_note_suggestions_enabled' => self::boolean(),
                    'sort_order' => self::integer(),
                    'color' => self::text(20),
                    'interval_template' => self::relation(false, true),
                    'flashcard_review_set' => self::relation(false, true),
                    'session_count_mode' => self::choice(['task', 'linked']),
                    'session_goal_type' => self::choice(['complete', 'duration']),
                    'session_target_seconds' => self::integer(0, 86400),
                    'tracking_trackers' => self::jsonArray(5000),
                    'reminder_enabled' => self::boolean(),
                    'reminder_times' => self::jsonArray(5000),
                ],
                'required' => ['name', 'type', 'start_date', 'recurrence_type'],
                'sort' => ['name', 'sort_order', 'start_date'],
                'filter' => ['active', 'type', 'start_date'],
            ],
            'program_steps' => [
                'fields' => [
                    'task' => self::relation(true),
                    'name' => self::text(160, true),
                    'description' => self::text(2000),
                    'sort_order' => self::integer(0),
                    'cycle_days' => self::numberArray(2000, true),
                    'completion_type' => self::choice(
                        ['check', 'quantity', 'interval', 'flashcards'],
                        true,
                    ),
                    'target_value' => self::number(0),
                    'target_operator' => self::choice(['gte', 'lte', 'eq'], false, true),
                    'unit' => self::text(30),
                    'custom_unit' => self::text(30),
                    'quick_amounts' => self::numberArray(1000),
                    'active' => self::boolean(),
                    'interval_template' => self::relation(false, true),
                    'flashcard_review_set' => self::relation(false, true),
                ],
                'required' => ['task', 'name', 'sort_order', 'cycle_days', 'completion_type'],
                'sort' => ['name', 'sort_order'],
                'filter' => ['task', 'active'],
            ],
            'occurrences' => [
                'fields' => [
                    'task' => self::relation(true),
                    'program_step' => self::relation(false, true),
                    'scheduled_date' => self::dateKey(true),
                    'status' => self::choice(
                        ['pending', 'completed', 'missed', 'carried', 'rescheduled'],
                        true,
                    ),
                    'completed_at' => self::timestamp(false, true),
                    'snapshot_name' => self::text(160, true),
                    'snapshot_target' => self::number(0),
                    'snapshot_unit' => self::text(30),
                    'sealed' => self::boolean(),
                ],
                'required' => ['task', 'scheduled_date', 'status', 'snapshot_name'],
                'sort' => ['scheduled_date', 'completed_at'],
                'filter' => ['task', 'program_step', 'scheduled_date', 'status'],
            ],
            'entries' => [
                'fields' => [
                    'task' => self::relation(true),
                    'occurrence' => self::relation(false, true),
                    'program_step' => self::relation(false, true),
                    'entry_date' => self::dateKey(true),
                    'value' => self::number(),
                    'kind' => self::choice(['duration', 'quantity', 'adjustment'], true),
                    'unit' => self::text(30),
                    'note' => self::text(255),
                    'source_type' => self::choice(['interval', 'flashcards'], false, true),
                    'source_session' => self::text(64),
                ],
                'required' => ['task', 'entry_date', 'kind'],
                'sort' => ['entry_date', 'created_at', 'value'],
                'filter' => [
                    'task', 'occurrence', 'program_step', 'entry_date', 'kind',
                    'source_type', 'source_session',
                ],
            ],
            'interval_templates' => [
                'fields' => [
                    'name' => self::text(160, true),
                    'description' => self::text(2000),
                    'color' => self::text(20, true),
                    'definition' => self::json(2000000, true),
                    'sound_enabled' => self::boolean(),
                    'vibration_enabled' => self::boolean(),
                    'sound' => self::choice(['beep', 'bell', 'soft'], true),
                    'sort_order' => self::integer(0),
                    'flashcard_review_set' => self::relation(false, true),
                ],
                'required' => ['name', 'color', 'definition', 'sound'],
                'sort' => ['name', 'sort_order'],
                'filter' => ['name'],
            ],
            'interval_sessions' => [
                'fields' => [
                    'template' => self::relation(false, true),
                    'source' => self::choice(['template', 'quick'], true),
                    'status' => self::choice(['running', 'paused', 'completed', 'ended'], true),
                    'snapshot_name' => self::text(160, true),
                    'definition_snapshot' => self::json(2000000, true),
                    'cue_snapshot' => self::json(2000, true),
                    'started_at' => self::timestamp(true),
                    'ended_at' => self::timestamp(false, true),
                    'planned_seconds' => self::number(0),
                    'elapsed_seconds' => self::number(0),
                    'runtime_state' => self::json(20000, true),
                    'task' => self::relation(false, true),
                    'program_step' => self::relation(false, true),
                    'task_date' => self::dateKey(false, true),
                    'note' => self::text(2000),
                    'flashcard_snapshot' => self::json(2000000),
                ],
                'required' => [
                    'source',
                    'status',
                    'snapshot_name',
                    'definition_snapshot',
                    'cue_snapshot',
                    'started_at',
                    'runtime_state',
                ],
                'sort' => ['started_at', 'ended_at', 'task_date', 'status'],
                'filter' => [
                    'template', 'task', 'program_step', 'task_date', 'source', 'status', 'started_at',
                ],
            ],
            'flashcard_review_sessions' => [
                'fields' => [
                    'source_owner' => self::relation(false, true),
                    'review_set' => self::relation(false, true),
                    'status' => self::choice(['running', 'paused', 'completed', 'ended'], true),
                    'snapshot_name' => self::text(160, true),
                    'mode_snapshot' => self::choice(['manual', 'passive'], true),
                    'card_sides_snapshot' => self::choice(['both', 'front', 'back'], true),
                    'indefinite_snapshot' => self::boolean(),
                    'max_cards_snapshot' => self::integer(1, 100),
                    'sort_snapshot' => self::choice([
                        'difficult', 'never_reviewed', 'least_recent', 'recently_added', 'random',
                    ], true),
                    'tags_snapshot' => self::jsonArray(5000),
                    'excluded_cards_snapshot' => self::jsonArray(200000),
                    'front_seconds_snapshot' => self::integer(1, 60),
                    'back_seconds_snapshot' => self::integer(1, 60),
                    'back_speech_repeat_count_snapshot' => self::integer(1, 5),
                    'note_before_back_snapshot' => self::boolean(),
                    'speech_enabled_snapshot' => self::boolean(),
                    'front_language_snapshot' => self::text(35),
                    'back_language_snapshot' => self::text(35),
                    'queue_state' => self::json(2000000, true),
                    'started_at' => self::timestamp(true),
                    'ended_at' => self::timestamp(false, true),
                    'updated_at' => self::timestamp(true),
                    'elapsed_seconds' => self::integer(0),
                    'total_cards' => self::integer(0),
                    'viewed_count' => self::integer(0),
                    'success_count' => self::integer(0),
                    'error_count' => self::integer(0),
                    'ejected_count' => self::integer(0),
                    'task' => self::relation(false, true),
                    'program_step' => self::relation(false, true),
                    'task_date' => self::dateKey(false, true),
                ],
                'required' => [
                    'status', 'snapshot_name', 'mode_snapshot', 'sort_snapshot',
                    'queue_state', 'started_at', 'updated_at',
                ],
                'sort' => ['started_at', 'ended_at', 'updated_at', 'status'],
                'filter' => [
                    'review_set', 'task', 'program_step', 'task_date', 'status', 'started_at',
                ],
            ],
            'flashcard_review_events' => [
                'fields' => [
                    'session' => self::relation(true),
                    'card' => self::relation(false, true),
                    'outcome' => self::choice(['success', 'error', 'passive', 'ejected'], true),
                    'reviewed_at' => self::timestamp(true),
                    'front_snapshot' => self::text(5000, true),
                    'back_snapshot' => self::text(5000, true),
                    'tags_snapshot' => self::jsonArray(5000),
                ],
                'required' => [
                    'session', 'outcome', 'reviewed_at', 'front_snapshot', 'back_snapshot',
                ],
                'sort' => ['reviewed_at'],
                'filter' => ['session', 'card', 'outcome', 'reviewed_at'],
            ],
            'tracking_trackers' => [
                'fields' => [
                    'name' => self::text(160, true),
                    'description' => self::text(2000),
                    'role' => self::choice(['factor', 'outcome'], true),
                    'kind' => self::choice(['yes_no', 'event', 'number', 'rating', 'duration'], true),
                    'category' => self::choice([
                        'mindfulness', 'medication', 'nutrition', 'mood', 'symptom',
                        'sleep', 'activity', 'other',
                    ], true),
                    'unit' => self::text(30),
                    'scale_min' => self::number(-1000000, 1000000),
                    'scale_max' => self::number(-1000000, 1000000),
                    'favorable_direction' => self::choice(['higher', 'lower', 'neutral'], true),
                    'daily_aggregation' => self::choice(['last', 'average', 'sum', 'count'], true),
                    'active' => self::boolean(),
                    'sort_order' => self::integer(0),
                    'color' => self::text(20),
                    'icon' => self::text(50),
                ],
                'required' => [
                    'name', 'role', 'kind', 'category', 'favorable_direction',
                    'daily_aggregation',
                ],
                'sort' => ['name', 'sort_order'],
                'filter' => ['active', 'role', 'kind', 'category'],
            ],
            'tracking_entries' => [
                'fields' => [
                    'tracker' => self::relation(true),
                    'occurred_at' => self::timestamp(true),
                    'local_date' => self::dateKey(true),
                    'timezone_offset' => self::integer(-840, 840),
                    'value' => self::number(-1000000000, 1000000000),
                    'note' => self::text(2000),
                ],
                'required' => ['tracker', 'occurred_at', 'local_date', 'timezone_offset', 'value'],
                'sort' => ['occurred_at', 'local_date'],
                'filter' => ['tracker', 'occurred_at', 'local_date'],
            ],
            'journal_entries' => [
                'fields' => [
                    'title' => self::text(160),
                    'body' => self::text(20000, true),
                    'occurred_at' => self::timestamp(true),
                    'local_date' => self::dateKey(true),
                    'timezone_offset' => self::integer(-840, 840),
                    'task' => self::relation(false, true),
                    'tracker' => self::jsonArray(5000),
                ],
                'required' => ['body', 'occurred_at', 'local_date', 'timezone_offset'],
                'sort' => ['occurred_at', 'local_date', 'created_at', 'updated_at'],
                'filter' => ['task', 'occurred_at', 'local_date'],
            ],
        ];

        return self::$collections;
    }

    private static function text(int $max, bool $required = false): array
    {
        return ['type' => 'text', 'max' => $max, 'required' => $required];
    }

    private static function choice(array $values, bool $required = false, bool $allowEmpty = false): array
    {
        return [
            'type' => 'choice',
            'values' => $values,
            'required' => $required,
            'allowEmpty' => $allowEmpty,
        ];
    }

    private static function boolean(): array
    {
        return ['type' => 'boolean'];
    }

    private static function integer(?int $min = null, ?int $max = null): array
    {
        return ['type' => 'integer', 'min' => $min, 'max' => $max];
    }

    private static function number(?float $min = null, ?float $max = null): array
    {
        return ['type' => 'number', 'min' => $min, 'max' => $max];
    }

    private static function dateKey(bool $required = false, bool $allowEmpty = false): array
    {
        return ['type' => 'date_key', 'required' => $required, 'allowEmpty' => $allowEmpty];
    }

    private static function timestamp(bool $required = false, bool $allowEmpty = false): array
    {
        return ['type' => 'timestamp', 'required' => $required, 'allowEmpty' => $allowEmpty];
    }

    private static function timeKey(): array
    {
        return ['type' => 'time_key', 'required' => true];
    }

    private static function relation(bool $required = false, bool $allowEmpty = false): array
    {
        return ['type' => 'relation', 'required' => $required, 'allowEmpty' => $allowEmpty];
    }

    private static function json(int $max, bool $required = false): array
    {
        return ['type' => 'json', 'max' => $max, 'required' => $required];
    }

    private static function jsonArray(int $max, bool $required = false): array
    {
        return ['type' => 'json_array', 'max' => $max, 'required' => $required];
    }

    private static function numberArray(int $max, bool $required = false): array
    {
        return ['type' => 'number_array', 'max' => $max, 'required' => $required];
    }
}
