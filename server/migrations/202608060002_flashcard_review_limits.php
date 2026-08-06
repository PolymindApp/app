<?php

declare(strict_types=1);

return [
    'version' => '202608060002',
    'name' => 'flashcard_review_limits',
    'up' => static function (\PDO $pdo): void {
        $columns = $pdo->query(
            "PRAGMA table_info(flashcard_review_sets)",
        )->fetchAll(\PDO::FETCH_COLUMN, 1);
        if (!in_array('max_cards', $columns, true)) {
            $pdo->exec(
                'ALTER TABLE flashcard_review_sets ADD COLUMN max_cards INTEGER NOT NULL DEFAULT 20',
            );
        }
    },
];
