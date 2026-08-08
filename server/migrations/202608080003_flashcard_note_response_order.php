<?php

declare(strict_types=1);

return [
    'version' => '202608080003',
    'name' => 'flashcard_note_response_order',
    'up' => static function (\PDO $pdo): void {
        $tables = [
            'flashcard_review_sets' => 'note_before_back',
            'flashcard_review_set_preferences' => 'note_before_back',
            'flashcard_review_sessions' => 'note_before_back_snapshot',
        ];

        foreach ($tables as $table => $column) {
            $columns = $pdo->query(
                "PRAGMA table_info({$table})",
            )->fetchAll(\PDO::FETCH_COLUMN, 1);
            if (!in_array($column, $columns, true)) {
                $pdo->exec(
                    "ALTER TABLE {$table} ADD COLUMN {$column} BOOLEAN NOT NULL DEFAULT FALSE",
                );
            }
        }
    },
];
