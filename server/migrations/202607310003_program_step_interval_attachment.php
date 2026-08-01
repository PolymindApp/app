<?php

declare(strict_types=1);

return [
    'version' => '202607310003',
    'name' => 'program_step_interval_attachment',
    'up' => static function (\PDO $pdo): void {
        $stepColumns = $pdo->query('PRAGMA table_info(program_steps)')->fetchAll(\PDO::FETCH_COLUMN, 1);
        if (!in_array('interval_template', $stepColumns, true)) {
            $pdo->exec(
                "ALTER TABLE program_steps ADD COLUMN interval_template TEXT NOT NULL DEFAULT ''",
            );
        }

        $sessionColumns = $pdo->query('PRAGMA table_info(interval_sessions)')->fetchAll(\PDO::FETCH_COLUMN, 1);
        if (!in_array('program_step', $sessionColumns, true)) {
            $pdo->exec(
                "ALTER TABLE interval_sessions ADD COLUMN program_step TEXT NOT NULL DEFAULT ''",
            );
        }

        $pdo->exec(
            'CREATE INDEX IF NOT EXISTS idx_program_steps_owner_interval_template
                ON program_steps (owner, interval_template)',
        );
        $pdo->exec(
            'CREATE INDEX IF NOT EXISTS idx_interval_sessions_owner_program_step_date
                ON interval_sessions (owner, program_step, task_date)',
        );
    },
];
