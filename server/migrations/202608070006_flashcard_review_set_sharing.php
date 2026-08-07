<?php

declare(strict_types=1);

return [
    'version' => '202608070006',
    'name' => 'flashcard_review_set_sharing',
    'up' => static function (\PDO $pdo): void {
        $sessionColumns = $pdo->query(
            'PRAGMA table_info(flashcard_review_sessions)',
        )->fetchAll(\PDO::FETCH_COLUMN, 1);
        if (!in_array('source_owner', $sessionColumns, true)) {
            $pdo->exec(
                "ALTER TABLE flashcard_review_sessions ADD COLUMN source_owner TEXT NOT NULL DEFAULT ''",
            );
        }

        $pdo->exec(<<<'SQL'
            CREATE TABLE IF NOT EXISTS flashcard_review_set_shares (
                id TEXT PRIMARY KEY NOT NULL,
                review_set TEXT NOT NULL,
                recipient TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'readonly',
                created_at TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL DEFAULT '',
                CHECK (role IN ('readonly', 'editor')),
                UNIQUE (review_set, recipient)
            );
            CREATE INDEX IF NOT EXISTS idx_flashcard_review_set_shares_recipient
                ON flashcard_review_set_shares (recipient, review_set);
            CREATE INDEX IF NOT EXISTS idx_flashcard_review_set_shares_set
                ON flashcard_review_set_shares (review_set, recipient);

            CREATE TABLE IF NOT EXISTS flashcard_review_set_preferences (
                review_set TEXT NOT NULL,
                account TEXT NOT NULL,
                mode TEXT NOT NULL DEFAULT 'manual',
                card_sides TEXT NOT NULL DEFAULT 'both',
                indefinite BOOLEAN NOT NULL DEFAULT FALSE,
                max_cards INTEGER NOT NULL DEFAULT 20,
                front_seconds INTEGER NOT NULL DEFAULT 5,
                back_seconds INTEGER NOT NULL DEFAULT 5,
                back_speech_repeat_count INTEGER NOT NULL DEFAULT 1,
                speech_enabled BOOLEAN NOT NULL DEFAULT FALSE,
                front_language VARCHAR(35) NOT NULL DEFAULT '',
                back_language VARCHAR(35) NOT NULL DEFAULT '',
                sort_mode TEXT NOT NULL DEFAULT 'difficult',
                updated_at TEXT NOT NULL DEFAULT '',
                PRIMARY KEY (review_set, account)
            );
            CREATE INDEX IF NOT EXISTS idx_flashcard_review_set_preferences_account
                ON flashcard_review_set_preferences (account, review_set);

            CREATE TABLE IF NOT EXISTS flashcard_review_card_stats (
                reviewer TEXT NOT NULL,
                card TEXT NOT NULL,
                last_reviewed_at TEXT NOT NULL DEFAULT '',
                passive_views INTEGER NOT NULL DEFAULT 0,
                success_count INTEGER NOT NULL DEFAULT 0,
                error_count INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL DEFAULT '',
                PRIMARY KEY (reviewer, card)
            );
            CREATE INDEX IF NOT EXISTS idx_flashcard_review_card_stats_card
                ON flashcard_review_card_stats (card, reviewer);

            INSERT OR IGNORE INTO flashcard_review_set_preferences (
                review_set, account, mode, card_sides, indefinite, max_cards,
                front_seconds, back_seconds, back_speech_repeat_count,
                speech_enabled, front_language, back_language, sort_mode, updated_at
            )
            SELECT id, owner, mode, card_sides, indefinite, max_cards,
                   front_seconds, back_seconds, back_speech_repeat_count,
                   speech_enabled, front_language, back_language, sort_mode, updated_at
            FROM flashcard_review_sets;

            INSERT OR IGNORE INTO flashcard_review_card_stats (
                reviewer, card, last_reviewed_at, passive_views,
                success_count, error_count, updated_at
            )
            SELECT owner, id, last_reviewed_at, passive_views,
                   success_count, error_count, updated_at
            FROM flashcards;

            UPDATE flashcard_review_sessions
               SET source_owner = COALESCE(
                   NULLIF((SELECT owner FROM flashcard_review_sets
                           WHERE flashcard_review_sets.id = flashcard_review_sessions.review_set), ''),
                   owner
               )
             WHERE source_owner = '';
            SQL);
    },
];
