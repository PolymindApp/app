<?php

declare(strict_types=1);

return [
    'version' => '202608120003',
    'name' => 'journal_entry_images',
    'up' => static function (\PDO $pdo): void {
        $columns = $pdo->query(
            'PRAGMA table_info(journal_entries)',
        )->fetchAll(\PDO::FETCH_COLUMN, 1);
        if (!in_array('image_url', $columns, true)) {
            $pdo->exec(
                "ALTER TABLE journal_entries ADD COLUMN image_url TEXT NOT NULL DEFAULT ''",
            );
        }
        if (!in_array('image_file', $columns, true)) {
            $pdo->exec(
                "ALTER TABLE journal_entries ADD COLUMN image_file VARCHAR(52) NOT NULL DEFAULT ''",
            );
        }
    },
];
