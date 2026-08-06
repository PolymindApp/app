<?php

declare(strict_types=1);

return [
    'version' => '202608060004',
    'name' => 'flashcard_passive_indefinite',
    'up' => static function (\PDO $pdo): void {
        $reviewSetColumns = $pdo->query(
            'PRAGMA table_info(flashcard_review_sets)',
        )->fetchAll(\PDO::FETCH_COLUMN, 1);
        if (!in_array('indefinite', $reviewSetColumns, true)) {
            $pdo->exec(
                'ALTER TABLE flashcard_review_sets ADD COLUMN indefinite BOOLEAN NOT NULL DEFAULT FALSE',
            );
        }

        $sessionColumns = $pdo->query(
            'PRAGMA table_info(flashcard_review_sessions)',
        )->fetchAll(\PDO::FETCH_COLUMN, 1);
        if (!in_array('indefinite_snapshot', $sessionColumns, true)) {
            $pdo->exec(
                'ALTER TABLE flashcard_review_sessions ADD COLUMN indefinite_snapshot BOOLEAN NOT NULL DEFAULT FALSE',
            );
        }
    },
];
