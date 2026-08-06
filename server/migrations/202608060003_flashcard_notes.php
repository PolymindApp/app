<?php

declare(strict_types=1);

return [
    'version' => '202608060003',
    'name' => 'flashcard_notes',
    'up' => static function (\PDO $pdo): void {
        $columns = $pdo->query(
            'PRAGMA table_info(flashcards)',
        )->fetchAll(\PDO::FETCH_COLUMN, 1);
        if (!in_array('note', $columns, true)) {
            $pdo->exec(
                "ALTER TABLE flashcards ADD COLUMN note VARCHAR(2000) NOT NULL DEFAULT ''",
            );
        }
    },
];
