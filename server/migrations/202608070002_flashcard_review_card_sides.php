<?php

declare(strict_types=1);

return [
    'version' => '202608070002',
    'name' => 'flashcard_review_card_sides',
    'up' => static function (\PDO $pdo): void {
        $reviewSetColumns = $pdo->query(
            'PRAGMA table_info(flashcard_review_sets)',
        )->fetchAll(\PDO::FETCH_COLUMN, 1);
        if (!in_array('card_sides', $reviewSetColumns, true)) {
            $pdo->exec(
                "ALTER TABLE flashcard_review_sets "
                . "ADD COLUMN card_sides TEXT NOT NULL DEFAULT 'both'",
            );
        }

        $sessionColumns = $pdo->query(
            'PRAGMA table_info(flashcard_review_sessions)',
        )->fetchAll(\PDO::FETCH_COLUMN, 1);
        if (!in_array('card_sides_snapshot', $sessionColumns, true)) {
            $pdo->exec(
                "ALTER TABLE flashcard_review_sessions "
                . "ADD COLUMN card_sides_snapshot TEXT NOT NULL DEFAULT 'both'",
            );
        }
    },
];
