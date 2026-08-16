<?php

declare(strict_types=1);

namespace BackOnTrack\Api;

use PDO;
use PDOException;

final class Database
{
    public readonly PDO $pdo;
    public readonly array $migrationsApplied;

    public function __construct(string $path, ?string $migrationDirectory = null)
    {
        try {
            $this->pdo = new PDO('sqlite:' . $path, null, null, [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
            ]);
            $this->pdo->exec('PRAGMA busy_timeout = 5000');
            $this->pdo->exec('PRAGMA foreign_keys = ON');
            $this->migrationsApplied = (new MigrationRunner(
                $this->pdo,
                $migrationDirectory ?? dirname(__DIR__) . '/migrations',
            ))->migrate();
            $this->assertCompatibleSchema();
        } catch (PDOException $exception) {
            throw new ApiException(500, 'Could not open the application database.', [], $exception);
        }
    }

    private function assertCompatibleSchema(): void
    {
        $required = [
            'users' => [
                'id', 'email', 'email_visibility', 'verified', 'name', 'avatar',
                'password', 'token_key', 'timezone', 'settings', 'created', 'updated',
            ],
            'tags' => ['id', 'owner', 'name'],
            'flashcards' => [
                'id', 'owner', 'front', 'back', 'note', 'image_url', 'image_file',
                'front_audio_url', 'front_audio_file', 'back_audio_url', 'back_audio_file',
                'tags', 'created_at', 'updated_at', 'last_reviewed_at',
                'passive_views', 'success_count', 'error_count',
            ],
            'tasks' => [
                'id', 'owner', 'name', 'description', 'type', 'tags', 'mandatory',
                'review_when_missed', 'active', 'schedule_mode', 'scheduled_time',
                'start_date', 'end_date',
                'recurrence_type', 'weekdays', 'interval_weeks', 'target_value',
                'target_operator', 'unit', 'custom_unit', 'goal_period',
                'quick_amounts', 'cycle_length', 'program_repeat', 'program_strict',
                'entry_notes_enabled', 'entry_note_suggestions_enabled', 'sort_order',
                'color', 'interval_template', 'flashcard_review_set',
                'session_count_mode', 'session_goal_type', 'session_target_seconds',
                'tracking_trackers', 'reminder_enabled', 'reminder_times',
            ],
            'program_steps' => [
                'id', 'owner', 'task', 'name', 'description', 'sort_order',
                'cycle_days', 'completion_type', 'target_value', 'target_operator',
                'unit', 'custom_unit', 'quick_amounts', 'active', 'interval_template',
            ],
            'occurrences' => [
                'id', 'owner', 'task', 'program_step', 'scheduled_date', 'status',
                'sealed', 'completed_at', 'snapshot_name', 'snapshot_target',
                'snapshot_unit',
            ],
            'entries' => [
                'id', 'owner', 'task', 'occurrence', 'program_step', 'entry_date',
                'created_at', 'value', 'kind', 'unit', 'note', 'source_type',
                'source_session',
            ],
            'interval_templates' => [
                'id', 'owner', 'name', 'description', 'color', 'definition',
                'sound_enabled', 'vibration_enabled', 'sound', 'sort_order',
                'flashcard_review_set',
            ],
            'interval_sessions' => [
                'id', 'owner', 'template', 'source', 'status', 'snapshot_name',
                'definition_snapshot', 'cue_snapshot', 'started_at', 'ended_at',
                'planned_seconds', 'elapsed_seconds', 'runtime_state', 'task',
                'program_step', 'task_date', 'note', 'flashcard_snapshot',
            ],
            'tracking_trackers' => [
                'id', 'owner', 'name', 'description', 'role', 'kind', 'category',
                'unit', 'scale_min', 'scale_max', 'favorable_direction',
                'daily_aggregation', 'active', 'sort_order', 'color', 'icon',
            ],
            'tracking_entries' => [
                'id', 'owner', 'tracker', 'occurred_at', 'local_date',
                'timezone_offset', 'value', 'note',
            ],
            'journal_entries' => [
                'id', 'owner', 'title', 'body', 'color', 'occurred_at', 'local_date',
                'timezone_offset', 'task', 'tracker', 'task_snapshot',
                'tracker_snapshot', 'image_url', 'image_file', 'created_at', 'updated_at',
            ],
            'backontrack_rate_limits' => ['rate_key', 'window_start', 'hits'],
            'backontrack_auth_tokens' => [
                'token_hash', 'user_id', 'purpose', 'expires_at', 'created_at',
            ],
            'backontrack_passkey_challenges' => [
                'id', 'purpose', 'user_id', 'user_handle', 'challenge',
                'expires_at', 'created_at',
            ],
            'backontrack_passkeys' => [
                'credential_id', 'user_id', 'user_handle', 'public_key',
                'signature_counter', 'transports', 'backup_eligible', 'backed_up',
                'created', 'last_used',
            ],
            'sync_operation_receipts' => [
                'receipt_sequence', 'account_id', 'client_id', 'operation_id', 'response', 'applied_at',
            ],
            'sync_clients' => [
                'account_id', 'client_id', 'acknowledged_cursor', 'protocol_version',
                'last_seen_at', 'confirmed_receipt_sequence',
            ],
            'sync_retention_watermarks' => ['account_id', 'minimum_cursor', 'compacted_at'],
            'backontrack_schema_migrations' => ['version', 'name', 'checksum', 'applied_at'],
        ];
        $tableNames = array_keys($required);
        $placeholders = implode(',', array_fill(0, count($tableNames), '?'));
        $statement = $this->pdo->prepare(
            "SELECT name FROM sqlite_schema WHERE type = 'table' AND name IN ({$placeholders})",
        );
        $statement->execute($tableNames);
        $found = $statement->fetchAll(PDO::FETCH_COLUMN);
        $missing = array_values(array_diff($tableNames, $found));
        if ($missing !== []) {
            throw new ApiException(500, 'The SQLite database does not have the expected BackOnTrack schema.');
        }

        foreach ($required as $table => $columns) {
            $statement = $this->pdo->query("PRAGMA table_info({$table})");
            $foundColumns = $statement->fetchAll(PDO::FETCH_COLUMN, 1);
            if (array_diff($columns, $foundColumns) !== []) {
                throw new ApiException(
                    500,
                    "The SQLite {$table} table does not have the expected BackOnTrack schema.",
                );
            }
        }
    }
}
