<?php

declare(strict_types=1);

return [
    'version' => '202608010001',
    'name' => 'interval_session_notes',
    'up' => static function (\PDO $pdo): void {
        $sessionColumns = $pdo->query('PRAGMA table_info(interval_sessions)')->fetchAll(\PDO::FETCH_COLUMN, 1);
        if (!in_array('note', $sessionColumns, true)) {
            $pdo->exec(
                "ALTER TABLE interval_sessions ADD COLUMN note TEXT NOT NULL DEFAULT ''",
            );
        }
    },
];
