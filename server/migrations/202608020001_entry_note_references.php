<?php

declare(strict_types=1);

return [
    'version' => '202608020001',
    'name' => 'entry_note_references',
    'up' => static function (\PDO $pdo): void {
        $pdo->exec(<<<'SQL'
            DROP INDEX IF EXISTS idx_entries_owner_date;

            ALTER TABLE entries RENAME TO entries_before_note_references;

            CREATE TABLE entries (
                id TEXT PRIMARY KEY NOT NULL DEFAULT ('r' || lower(hex(randomblob(7)))),
                owner TEXT NOT NULL,
                task TEXT NOT NULL DEFAULT '',
                occurrence TEXT NOT NULL DEFAULT '',
                program_step TEXT NOT NULL DEFAULT '',
                entry_date TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT '',
                value NUMERIC NOT NULL DEFAULT 0,
                kind TEXT NOT NULL DEFAULT '',
                unit TEXT NOT NULL DEFAULT '',
                note VARCHAR(255) NOT NULL DEFAULT ''
                    CHECK (length(note) <= 255 AND instr(note, char(10)) = 0 AND instr(note, char(13)) = 0)
            );

            INSERT INTO entries (
                id, owner, task, occurrence, program_step, entry_date, created_at,
                value, kind, unit, note
            )
            SELECT
                id, owner, task, occurrence, program_step, entry_date,
                CASE
                    WHEN entry_date = '' THEN '1970-01-01T00:00:00.000000000Z'
                    ELSE entry_date || 'T00:00:00.' || printf('%09d', rowid) || 'Z'
                END,
                value, kind, unit,
                substr(replace(replace(note, char(13), ' '), char(10), ' '), 1, 255)
            FROM entries_before_note_references;

            DROP TABLE entries_before_note_references;

            CREATE INDEX idx_entries_owner_date ON entries (owner, entry_date);
            CREATE INDEX idx_entries_task_created ON entries (task, created_at DESC);
            SQL);
    },
];
