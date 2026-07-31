<?php

declare(strict_types=1);

return [
    'version' => '202607310002',
    'name' => 'tracking',
    'up' => static function (\PDO $pdo): void {
        $pdo->exec(<<<'SQL'
            CREATE TABLE IF NOT EXISTS tracking_trackers (
                id TEXT PRIMARY KEY NOT NULL DEFAULT ('r' || lower(hex(randomblob(7)))),
                owner TEXT NOT NULL,
                name TEXT NOT NULL DEFAULT '',
                description TEXT NOT NULL DEFAULT '',
                role TEXT NOT NULL DEFAULT 'factor',
                kind TEXT NOT NULL DEFAULT 'yes_no',
                category TEXT NOT NULL DEFAULT 'other',
                unit TEXT NOT NULL DEFAULT '',
                scale_min NUMERIC NOT NULL DEFAULT 0,
                scale_max NUMERIC NOT NULL DEFAULT 0,
                favorable_direction TEXT NOT NULL DEFAULT 'neutral',
                daily_aggregation TEXT NOT NULL DEFAULT 'last',
                active BOOLEAN NOT NULL DEFAULT TRUE,
                sort_order NUMERIC NOT NULL DEFAULT 0,
                color TEXT NOT NULL DEFAULT '#C7F464',
                icon TEXT NOT NULL DEFAULT 'mdi-checkbox-marked-circle-outline',
                reminder_enabled BOOLEAN NOT NULL DEFAULT FALSE,
                reminder_time TEXT NOT NULL DEFAULT '20:00',
                reminder_show_name BOOLEAN NOT NULL DEFAULT FALSE
            );
            CREATE INDEX IF NOT EXISTS idx_tracking_trackers_owner_active_order
                ON tracking_trackers (owner, active, sort_order);

            CREATE TABLE IF NOT EXISTS tracking_entries (
                id TEXT PRIMARY KEY NOT NULL DEFAULT ('r' || lower(hex(randomblob(7)))),
                owner TEXT NOT NULL,
                tracker TEXT NOT NULL DEFAULT '',
                occurred_at TEXT NOT NULL DEFAULT '',
                local_date TEXT NOT NULL DEFAULT '',
                timezone_offset INTEGER NOT NULL DEFAULT 0,
                value NUMERIC NOT NULL DEFAULT 0,
                note TEXT NOT NULL DEFAULT ''
            );
            CREATE INDEX IF NOT EXISTS idx_tracking_entries_owner_date
                ON tracking_entries (owner, local_date);
            CREATE INDEX IF NOT EXISTS idx_tracking_entries_tracker_occurred
                ON tracking_entries (tracker, occurred_at);
            SQL);
    },
];
