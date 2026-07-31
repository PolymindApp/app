<?php

declare(strict_types=1);

namespace Mom\Api;

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
            'tasks' => [
                'fields' => [
                    'name' => self::text(160, true),
                    'description' => self::text(2000),
                    'type' => self::choice(
                        ['check', 'duration', 'daily_total', 'program', 'interval'],
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
                    'sort_order' => self::integer(),
                    'color' => self::text(20),
                    'interval_template' => self::relation(false, true),
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
                    'completion_type' => self::choice(['check', 'quantity'], true),
                    'target_value' => self::number(0),
                    'target_operator' => self::choice(['gte', 'lte', 'eq'], false, true),
                    'unit' => self::text(30),
                    'custom_unit' => self::text(30),
                    'quick_amounts' => self::numberArray(1000),
                    'active' => self::boolean(),
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
                    'note' => self::text(1000),
                ],
                'required' => ['task', 'entry_date', 'kind'],
                'sort' => ['entry_date', 'value'],
                'filter' => ['task', 'occurrence', 'program_step', 'entry_date', 'kind'],
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
                    'task_date' => self::dateKey(false, true),
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
                'sort' => ['started_at', 'ended_at', 'status'],
                'filter' => ['template', 'task', 'task_date', 'source', 'status', 'started_at'],
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
