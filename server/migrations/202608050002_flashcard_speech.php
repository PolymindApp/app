<?php

declare(strict_types=1);

return [
    'version' => '202608050002',
    'name' => 'flashcard_speech',
    'up' => static function (\PDO $pdo): void {
        $reviewSetColumns = $pdo->query(
            "PRAGMA table_info(flashcard_review_sets)",
        )->fetchAll(\PDO::FETCH_COLUMN, 1);
        if (!in_array('speech_enabled', $reviewSetColumns, true)) {
            $pdo->exec(
                "ALTER TABLE flashcard_review_sets ADD COLUMN speech_enabled BOOLEAN NOT NULL DEFAULT FALSE",
            );
        }
        if (!in_array('front_language', $reviewSetColumns, true)) {
            $pdo->exec(
                "ALTER TABLE flashcard_review_sets ADD COLUMN front_language VARCHAR(35) NOT NULL DEFAULT ''",
            );
        }
        if (!in_array('back_language', $reviewSetColumns, true)) {
            $pdo->exec(
                "ALTER TABLE flashcard_review_sets ADD COLUMN back_language VARCHAR(35) NOT NULL DEFAULT ''",
            );
        }

        $sessionColumns = $pdo->query(
            "PRAGMA table_info(flashcard_review_sessions)",
        )->fetchAll(\PDO::FETCH_COLUMN, 1);
        if (!in_array('speech_enabled_snapshot', $sessionColumns, true)) {
            $pdo->exec(
                "ALTER TABLE flashcard_review_sessions ADD COLUMN speech_enabled_snapshot BOOLEAN NOT NULL DEFAULT FALSE",
            );
        }
        if (!in_array('front_language_snapshot', $sessionColumns, true)) {
            $pdo->exec(
                "ALTER TABLE flashcard_review_sessions ADD COLUMN front_language_snapshot VARCHAR(35) NOT NULL DEFAULT ''",
            );
        }
        if (!in_array('back_language_snapshot', $sessionColumns, true)) {
            $pdo->exec(
                "ALTER TABLE flashcard_review_sessions ADD COLUMN back_language_snapshot VARCHAR(35) NOT NULL DEFAULT ''",
            );
        }
    },
];
