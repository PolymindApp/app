<?php

declare(strict_types=1);

return [
    'version' => '202608140001',
    'name' => 'flashcard_audio',
    'up' => static function (\PDO $pdo): void {
        $columns = $pdo->query(
            'PRAGMA table_info(flashcards)',
        )->fetchAll(\PDO::FETCH_COLUMN, 1);
        foreach (['front', 'back'] as $side) {
            if (!in_array($side . '_audio_url', $columns, true)) {
                $pdo->exec(sprintf(
                    "ALTER TABLE flashcards ADD COLUMN %s_audio_url VARCHAR(2048) NOT NULL DEFAULT ''",
                    $side,
                ));
            }
            if (!in_array($side . '_audio_file', $columns, true)) {
                $pdo->exec(sprintf(
                    "ALTER TABLE flashcards ADD COLUMN %s_audio_file VARCHAR(64) NOT NULL DEFAULT ''",
                    $side,
                ));
            }
        }
    },
];
