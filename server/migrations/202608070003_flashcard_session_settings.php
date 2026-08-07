<?php

declare(strict_types=1);

return [
    'version' => '202608070003',
    'name' => 'flashcard_session_settings',
    'up' => static function (\PDO $pdo): void {
        $columns = $pdo->query(
            'PRAGMA table_info(flashcard_review_sessions)',
        )->fetchAll(\PDO::FETCH_COLUMN, 1);
        if (!in_array('max_cards_snapshot', $columns, true)) {
            $pdo->exec(
                'ALTER TABLE flashcard_review_sessions '
                . 'ADD COLUMN max_cards_snapshot INTEGER NOT NULL DEFAULT 20',
            );
        }
    },
];
