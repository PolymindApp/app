<?php

declare(strict_types=1);

return [
    'version' => '202608070001',
    'name' => 'flashcard_back_speech_repeats',
    'up' => static function (\PDO $pdo): void {
        $reviewSetColumns = $pdo->query(
            'PRAGMA table_info(flashcard_review_sets)',
        )->fetchAll(\PDO::FETCH_COLUMN, 1);
        if (!in_array('back_speech_repeat_count', $reviewSetColumns, true)) {
            $pdo->exec(
                'ALTER TABLE flashcard_review_sets '
                . 'ADD COLUMN back_speech_repeat_count INTEGER NOT NULL DEFAULT 1',
            );
        }

        $sessionColumns = $pdo->query(
            'PRAGMA table_info(flashcard_review_sessions)',
        )->fetchAll(\PDO::FETCH_COLUMN, 1);
        if (!in_array('back_speech_repeat_count_snapshot', $sessionColumns, true)) {
            $pdo->exec(
                'ALTER TABLE flashcard_review_sessions '
                . 'ADD COLUMN back_speech_repeat_count_snapshot INTEGER NOT NULL DEFAULT 1',
            );
        }
    },
];
