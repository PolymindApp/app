<?php

declare(strict_types=1);

return [
    'version' => '202608200003',
    'name' => 'flashcard_review_time_limits',
    'up' => static function (\PDO $pdo): void {
        $columns = [
            'flashcard_review_sets' => 'time_limit_seconds',
            'flashcard_review_set_preferences' => 'time_limit_seconds',
            'flashcard_review_sessions' => 'time_limit_seconds_snapshot',
        ];
        foreach ($columns as $table => $column) {
            $existing = $pdo->query("PRAGMA table_info({$table})")->fetchAll(\PDO::FETCH_COLUMN, 1);
            if (!in_array($column, $existing, true)) {
                $pdo->exec(
                    "ALTER TABLE {$table} ADD COLUMN {$column} INTEGER NOT NULL DEFAULT 0",
                );
            }
        }
    },
];
