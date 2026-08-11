<?php

declare(strict_types=1);

return [
    'version' => '202608110001',
    'name' => 'flashcard_review_set_exclusions',
    'up' => static function (\PDO $pdo): void {
        $tables = [
            'flashcard_review_sets' => 'excluded_cards',
            'flashcard_review_set_preferences' => 'excluded_cards',
            'flashcard_review_sessions' => 'excluded_cards_snapshot',
        ];

        foreach ($tables as $table => $column) {
            $columns = $pdo->query(
                "PRAGMA table_info({$table})",
            )->fetchAll(\PDO::FETCH_COLUMN, 1);
            if (!in_array($column, $columns, true)) {
                $pdo->exec(
                    "ALTER TABLE {$table} ADD COLUMN {$column} JSON NOT NULL DEFAULT '[]'",
                );
            }
        }
    },
];
