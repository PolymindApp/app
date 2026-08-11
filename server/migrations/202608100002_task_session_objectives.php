<?php

declare(strict_types=1);

return [
    'version' => '202608100002',
    'name' => 'task_session_objectives',
    'up' => static function (\PDO $pdo): void {
        $pdo->exec(<<<'SQL'
            ALTER TABLE tasks ADD COLUMN session_count_mode TEXT NOT NULL DEFAULT 'task';
            ALTER TABLE tasks ADD COLUMN session_goal_type TEXT NOT NULL DEFAULT 'complete';
            ALTER TABLE tasks ADD COLUMN session_target_seconds NUMERIC NOT NULL DEFAULT 0;
            ALTER TABLE entries ADD COLUMN source_type TEXT NOT NULL DEFAULT '';
            ALTER TABLE entries ADD COLUMN source_session TEXT NOT NULL DEFAULT '';
            CREATE UNIQUE INDEX idx_entries_task_source_session
                ON entries (owner, task, program_step, source_type, source_session)
                WHERE source_session != '';
            SQL);
    },
];
