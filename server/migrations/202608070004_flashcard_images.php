<?php

declare(strict_types=1);

return [
    'version' => '202608070004',
    'name' => 'flashcard_images',
    'up' => static function (\PDO $pdo): void {
        $columns = $pdo->query(
            'PRAGMA table_info(flashcards)',
        )->fetchAll(\PDO::FETCH_COLUMN, 1);
        if (!in_array('image_url', $columns, true)) {
            $pdo->exec(
                "ALTER TABLE flashcards ADD COLUMN image_url VARCHAR(2048) NOT NULL DEFAULT ''",
            );
        }
        if (!in_array('image_file', $columns, true)) {
            $pdo->exec(
                "ALTER TABLE flashcards ADD COLUMN image_file VARCHAR(52) NOT NULL DEFAULT ''",
            );
        }
    },
];
