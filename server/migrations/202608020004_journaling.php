<?php

declare(strict_types=1);

return [
    'version' => '202608020004',
    'name' => 'journaling',
    'up' => static function (\PDO $pdo): void {
        $pdo->exec(<<<'SQL'
            CREATE TABLE journal_entries (
                id TEXT PRIMARY KEY NOT NULL DEFAULT ('r' || lower(hex(randomblob(7)))),
                owner TEXT NOT NULL,
                title VARCHAR(160) NOT NULL DEFAULT '',
                body TEXT NOT NULL DEFAULT '',
                occurred_at TEXT NOT NULL DEFAULT '',
                local_date TEXT NOT NULL DEFAULT '',
                timezone_offset INTEGER NOT NULL DEFAULT 0,
                task TEXT NOT NULL DEFAULT '',
                tracker TEXT NOT NULL DEFAULT '',
                task_snapshot VARCHAR(160) NOT NULL DEFAULT '',
                tracker_snapshot VARCHAR(160) NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL DEFAULT ''
            );

            CREATE INDEX idx_journal_entries_owner_date
                ON journal_entries (owner, local_date, occurred_at DESC);
            CREATE INDEX idx_journal_entries_task_date
                ON journal_entries (task, local_date, occurred_at DESC);
            CREATE INDEX idx_journal_entries_tracker_date
                ON journal_entries (tracker, local_date, occurred_at DESC);
            SQL);
    },
];
