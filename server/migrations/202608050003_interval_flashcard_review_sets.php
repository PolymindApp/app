<?php

declare(strict_types=1);

return [
    'version' => '202608050003',
    'name' => 'interval_flashcard_review_sets',
    'up' => static function (\PDO $pdo): void {
        $templateColumns = $pdo->query(
            'PRAGMA table_info(interval_templates)',
        )->fetchAll(\PDO::FETCH_COLUMN, 1);
        if (!in_array('flashcard_review_set', $templateColumns, true)) {
            $pdo->exec(
                "ALTER TABLE interval_templates ADD COLUMN flashcard_review_set TEXT NOT NULL DEFAULT ''",
            );
        }

        $sessionColumns = $pdo->query(
            'PRAGMA table_info(interval_sessions)',
        )->fetchAll(\PDO::FETCH_COLUMN, 1);
        if (!in_array('flashcard_snapshot', $sessionColumns, true)) {
            $pdo->exec(
                "ALTER TABLE interval_sessions ADD COLUMN flashcard_snapshot JSON NOT NULL DEFAULT '{}'",
            );
        }

        $pdo->exec(
            'CREATE INDEX IF NOT EXISTS idx_interval_templates_owner_flashcard_review_set
                ON interval_templates (owner, flashcard_review_set)',
        );
    },
];
