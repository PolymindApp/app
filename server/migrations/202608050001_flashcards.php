<?php

declare(strict_types=1);

return [
    'version' => '202608050001',
    'name' => 'flashcards',
    'up' => static function (\PDO $pdo): void {
        $taskColumns = $pdo->query("PRAGMA table_info(tasks)")->fetchAll(\PDO::FETCH_COLUMN, 1);
        if (!in_array('flashcard_review_set', $taskColumns, true)) {
            $pdo->exec(
                "ALTER TABLE tasks ADD COLUMN flashcard_review_set TEXT NOT NULL DEFAULT ''",
            );
        }

        $stepColumns = $pdo->query("PRAGMA table_info(program_steps)")->fetchAll(\PDO::FETCH_COLUMN, 1);
        if (!in_array('flashcard_review_set', $stepColumns, true)) {
            $pdo->exec(
                "ALTER TABLE program_steps ADD COLUMN flashcard_review_set TEXT NOT NULL DEFAULT ''",
            );
        }

        $pdo->exec(<<<'SQL'
            CREATE INDEX IF NOT EXISTS idx_tasks_owner_flashcard_review_set
                ON tasks (owner, flashcard_review_set);
            CREATE INDEX IF NOT EXISTS idx_program_steps_owner_flashcard_review_set
                ON program_steps (owner, flashcard_review_set);

            CREATE TABLE IF NOT EXISTS flashcard_tags (
                id TEXT PRIMARY KEY NOT NULL DEFAULT ('r' || lower(hex(randomblob(7)))),
                owner TEXT NOT NULL,
                name VARCHAR(50) NOT NULL DEFAULT '' COLLATE NOCASE
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_flashcard_tags_owner_name
                ON flashcard_tags (owner, name COLLATE NOCASE);

            CREATE TABLE IF NOT EXISTS flashcards (
                id TEXT PRIMARY KEY NOT NULL DEFAULT ('r' || lower(hex(randomblob(7)))),
                owner TEXT NOT NULL,
                front TEXT NOT NULL DEFAULT '',
                back TEXT NOT NULL DEFAULT '',
                tags JSON NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL DEFAULT '',
                last_reviewed_at TEXT NOT NULL DEFAULT '',
                passive_views INTEGER NOT NULL DEFAULT 0,
                success_count INTEGER NOT NULL DEFAULT 0,
                error_count INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_flashcards_owner_created
                ON flashcards (owner, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_flashcards_owner_reviewed
                ON flashcards (owner, last_reviewed_at);

            CREATE TABLE IF NOT EXISTS flashcard_review_sets (
                id TEXT PRIMARY KEY NOT NULL DEFAULT ('r' || lower(hex(randomblob(7)))),
                owner TEXT NOT NULL,
                name VARCHAR(160) NOT NULL DEFAULT '',
                tags JSON NOT NULL DEFAULT '[]',
                mode TEXT NOT NULL DEFAULT 'manual',
                front_seconds INTEGER NOT NULL DEFAULT 5,
                back_seconds INTEGER NOT NULL DEFAULT 5,
                sort_mode TEXT NOT NULL DEFAULT 'difficult',
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL DEFAULT ''
            );
            CREATE INDEX IF NOT EXISTS idx_flashcard_review_sets_owner_order
                ON flashcard_review_sets (owner, sort_order, name);

            CREATE TABLE IF NOT EXISTS flashcard_review_sessions (
                id TEXT PRIMARY KEY NOT NULL DEFAULT ('r' || lower(hex(randomblob(7)))),
                owner TEXT NOT NULL,
                review_set TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'running',
                snapshot_name VARCHAR(160) NOT NULL DEFAULT '',
                mode_snapshot TEXT NOT NULL DEFAULT 'manual',
                sort_snapshot TEXT NOT NULL DEFAULT 'difficult',
                tags_snapshot JSON NOT NULL DEFAULT '[]',
                front_seconds_snapshot INTEGER NOT NULL DEFAULT 5,
                back_seconds_snapshot INTEGER NOT NULL DEFAULT 5,
                queue_state JSON NOT NULL DEFAULT '[]',
                started_at TEXT NOT NULL DEFAULT '',
                ended_at TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL DEFAULT '',
                elapsed_seconds INTEGER NOT NULL DEFAULT 0,
                total_cards INTEGER NOT NULL DEFAULT 0,
                viewed_count INTEGER NOT NULL DEFAULT 0,
                success_count INTEGER NOT NULL DEFAULT 0,
                error_count INTEGER NOT NULL DEFAULT 0,
                ejected_count INTEGER NOT NULL DEFAULT 0,
                task TEXT NOT NULL DEFAULT '',
                program_step TEXT NOT NULL DEFAULT '',
                task_date TEXT NOT NULL DEFAULT ''
            );
            CREATE INDEX IF NOT EXISTS idx_flashcard_review_sessions_owner_started
                ON flashcard_review_sessions (owner, started_at DESC);
            CREATE INDEX IF NOT EXISTS idx_flashcard_review_sessions_owner_status
                ON flashcard_review_sessions (owner, status);
            CREATE INDEX IF NOT EXISTS idx_flashcard_review_sessions_owner_task_date
                ON flashcard_review_sessions (owner, task, task_date);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_flashcard_review_sessions_one_active
                ON flashcard_review_sessions (owner)
                WHERE status IN ('running', 'paused');

            CREATE TABLE IF NOT EXISTS flashcard_review_events (
                id TEXT PRIMARY KEY NOT NULL DEFAULT ('r' || lower(hex(randomblob(7)))),
                owner TEXT NOT NULL,
                session TEXT NOT NULL DEFAULT '',
                card TEXT NOT NULL DEFAULT '',
                outcome TEXT NOT NULL DEFAULT '',
                reviewed_at TEXT NOT NULL DEFAULT '',
                front_snapshot TEXT NOT NULL DEFAULT '',
                back_snapshot TEXT NOT NULL DEFAULT '',
                tags_snapshot JSON NOT NULL DEFAULT '[]'
            );
            CREATE INDEX IF NOT EXISTS idx_flashcard_review_events_owner_session
                ON flashcard_review_events (owner, session, reviewed_at);
            CREATE INDEX IF NOT EXISTS idx_flashcard_review_events_owner_card
                ON flashcard_review_events (owner, card, reviewed_at DESC);
            SQL);
    },
];
