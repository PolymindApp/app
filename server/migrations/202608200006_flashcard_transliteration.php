<?php

declare(strict_types=1);

return [
    'version' => '202608200006',
    'name' => 'flashcard_transliteration',
    'up' => static function (\PDO $pdo): void {
        $columns = $pdo->query(
            'PRAGMA table_info(flashcards)',
        )->fetchAll(\PDO::FETCH_COLUMN, 1);
        if (!in_array('transliteration', $columns, true)) {
            $pdo->exec(
                "ALTER TABLE flashcards ADD COLUMN transliteration TEXT NOT NULL DEFAULT ''",
            );
        }
    },
];
