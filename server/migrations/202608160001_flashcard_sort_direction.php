<?php

declare(strict_types=1);

return [
    'version' => '202608160001',
    'name' => 'flashcard_sort_direction',
    'up' => static function (\PDO $pdo): void {
        $columns = [
            'flashcard_review_sets' => 'sort_direction',
            'flashcard_review_set_preferences' => 'sort_direction',
            'flashcard_review_sessions' => 'sort_direction_snapshot',
        ];
        foreach ($columns as $table => $column) {
            $existing = $pdo->query("PRAGMA table_info({$table})")->fetchAll(\PDO::FETCH_COLUMN, 1);
            if (!in_array($column, $existing, true)) {
                $pdo->exec(
                    "ALTER TABLE {$table} ADD COLUMN {$column} TEXT NOT NULL DEFAULT 'asc'",
                );
            }
        }
    },
];
