<?php

declare(strict_types=1);

return [
    'version' => '202608200004',
    'name' => 'flashcard_eject_behavior',
    'up' => static function (\PDO $pdo): void {
        $columns = [
            'flashcard_review_sets' => [
                'eject_behavior' => "TEXT NOT NULL DEFAULT 'remove'",
            ],
            'flashcard_review_set_preferences' => [
                'eject_behavior' => "TEXT NOT NULL DEFAULT 'remove'",
            ],
            'flashcard_review_sessions' => [
                'eject_behavior_snapshot' => "TEXT NOT NULL DEFAULT 'remove'",
                'reserve_card_ids' => "JSON NOT NULL DEFAULT '[]'",
            ],
        ];
        foreach ($columns as $table => $definitions) {
            $existing = $pdo->query("PRAGMA table_info({$table})")->fetchAll(\PDO::FETCH_COLUMN, 1);
            foreach ($definitions as $column => $definition) {
                if (!in_array($column, $existing, true)) {
                    $pdo->exec("ALTER TABLE {$table} ADD COLUMN {$column} {$definition}");
                }
            }
        }
    },
];
