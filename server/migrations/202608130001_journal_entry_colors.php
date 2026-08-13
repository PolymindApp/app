<?php

declare(strict_types=1);

return [
    'version' => '202608130001',
    'name' => 'journal_entry_colors',
    'up' => static function (\PDO $pdo): void {
        $columns = $pdo->query(
            'PRAGMA table_info(journal_entries)',
        )->fetchAll(\PDO::FETCH_COLUMN, 1);
        if (!in_array('color', $columns, true)) {
            $pdo->exec(
                "ALTER TABLE journal_entries ADD COLUMN color VARCHAR(20) NOT NULL DEFAULT '#C7F464'",
            );
        }
    },
];
