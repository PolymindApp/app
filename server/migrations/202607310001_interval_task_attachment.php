<?php

declare(strict_types=1);

return [
    'version' => '202607310001',
    'name' => 'interval_task_attachment',
    'up' => static function (\PDO $pdo): void {
        $taskColumns = $pdo->query('PRAGMA table_info(tasks)')->fetchAll(\PDO::FETCH_COLUMN, 1);
        if (!in_array('interval_template', $taskColumns, true)) {
            $pdo->exec(
                "ALTER TABLE tasks ADD COLUMN interval_template TEXT NOT NULL DEFAULT ''",
            );
        }

        $sessionColumns = $pdo->query('PRAGMA table_info(interval_sessions)')->fetchAll(\PDO::FETCH_COLUMN, 1);
        if (!in_array('task', $sessionColumns, true)) {
            $pdo->exec(
                "ALTER TABLE interval_sessions ADD COLUMN task TEXT NOT NULL DEFAULT ''",
            );
        }
        if (!in_array('task_date', $sessionColumns, true)) {
            $pdo->exec(
                "ALTER TABLE interval_sessions ADD COLUMN task_date TEXT NOT NULL DEFAULT ''",
            );
        }

        $pdo->exec(
            'CREATE INDEX IF NOT EXISTS idx_tasks_owner_interval_template
                ON tasks (owner, interval_template)',
        );
        $pdo->exec(
            'CREATE INDEX IF NOT EXISTS idx_interval_sessions_owner_task_date
                ON interval_sessions (owner, task, task_date)',
        );
    },
];
