<?php

declare(strict_types=1);

return [
    'version' => '202608090001',
    'name' => 'offline_sync',
    'up' => static function (\PDO $pdo): void {
        $pdo->exec(
            "CREATE TABLE sync_record_versions (
                account_id TEXT NOT NULL,
                resource TEXT NOT NULL,
                record_id TEXT NOT NULL,
                revision INTEGER NOT NULL DEFAULT 1,
                field_clocks JSON NOT NULL DEFAULT '{}',
                deleted BOOLEAN NOT NULL DEFAULT FALSE,
                modified_at TEXT NOT NULL DEFAULT '',
                PRIMARY KEY (account_id, resource, record_id)
            );
            CREATE INDEX idx_sync_record_versions_resource
                ON sync_record_versions (account_id, resource, deleted, record_id);

            CREATE TABLE sync_change_log (
                sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                account_id TEXT NOT NULL,
                resource TEXT NOT NULL,
                record_id TEXT NOT NULL,
                action TEXT NOT NULL CHECK (action IN ('upsert', 'delete')),
                changed_at TEXT NOT NULL
            );
            CREATE INDEX idx_sync_change_log_account_sequence
                ON sync_change_log (account_id, sequence);

            CREATE TABLE sync_operation_receipts (
                account_id TEXT NOT NULL,
                client_id TEXT NOT NULL,
                operation_id TEXT NOT NULL,
                response JSON NOT NULL,
                applied_at TEXT NOT NULL,
                PRIMARY KEY (account_id, client_id, operation_id)
            );

            CREATE TABLE sync_clients (
                account_id TEXT NOT NULL,
                client_id TEXT NOT NULL,
                acknowledged_cursor INTEGER NOT NULL DEFAULT 0,
                protocol_version INTEGER NOT NULL DEFAULT 1,
                last_seen_at TEXT NOT NULL,
                PRIMARY KEY (account_id, client_id)
            );

            ALTER TABLE interval_sessions ADD COLUMN client_id TEXT NOT NULL DEFAULT '';
            ALTER TABLE flashcard_review_sessions ADD COLUMN client_id TEXT NOT NULL DEFAULT '';
            CREATE INDEX idx_interval_sessions_owner_client_status
                ON interval_sessions (owner, client_id, status);
            DROP INDEX IF EXISTS idx_flashcard_review_sessions_one_active;
            CREATE UNIQUE INDEX idx_flashcard_review_sessions_one_active_device
                ON flashcard_review_sessions (owner, client_id)
                WHERE client_id <> '' AND status IN ('running', 'paused');
            CREATE INDEX idx_flashcard_review_sessions_owner_client_status
                ON flashcard_review_sessions (owner, client_id, status);",
        );

        $ownedResources = [
            'tags',
            'flashcard_tags',
            'flashcards',
            'flashcard_review_sets',
            'tasks',
            'program_steps',
            'occurrences',
            'entries',
            'interval_templates',
            'interval_sessions',
            'flashcard_review_sessions',
            'flashcard_review_events',
            'tracking_trackers',
            'tracking_entries',
            'journal_entries',
        ];
        $modifiedAt = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
        $clock = "(strftime('%s', 'now') || '000-0-server')";

        foreach ($ownedResources as $resource) {
            $trigger = 'sync_' . $resource;
            $pdo->exec(
                "CREATE TRIGGER {$trigger}_insert AFTER INSERT ON {$resource} BEGIN
                    INSERT INTO sync_record_versions (
                        account_id, resource, record_id, revision, field_clocks, deleted, modified_at
                    ) VALUES (
                        NEW.owner, '{$resource}', NEW.id, 1,
                        json_object('*', {$clock}), FALSE, {$modifiedAt}
                    ) ON CONFLICT(account_id, resource, record_id) DO UPDATE SET
                        revision = sync_record_versions.revision + 1,
                        field_clocks = excluded.field_clocks,
                        deleted = FALSE,
                        modified_at = excluded.modified_at;
                    INSERT INTO sync_change_log (account_id, resource, record_id, action, changed_at)
                    VALUES (NEW.owner, '{$resource}', NEW.id, 'upsert', {$modifiedAt});
                END;

                CREATE TRIGGER {$trigger}_update AFTER UPDATE ON {$resource} BEGIN
                    INSERT INTO sync_record_versions (
                        account_id, resource, record_id, revision, field_clocks, deleted, modified_at
                    ) VALUES (
                        NEW.owner, '{$resource}', NEW.id, 1,
                        json_object('*', {$clock}), FALSE, {$modifiedAt}
                    ) ON CONFLICT(account_id, resource, record_id) DO UPDATE SET
                        revision = sync_record_versions.revision + 1,
                        field_clocks = excluded.field_clocks,
                        deleted = FALSE,
                        modified_at = excluded.modified_at;
                    INSERT INTO sync_change_log (account_id, resource, record_id, action, changed_at)
                    VALUES (NEW.owner, '{$resource}', NEW.id, 'upsert', {$modifiedAt});
                END;

                CREATE TRIGGER {$trigger}_delete AFTER DELETE ON {$resource} BEGIN
                    INSERT INTO sync_record_versions (
                        account_id, resource, record_id, revision, field_clocks, deleted, modified_at
                    ) VALUES (
                        OLD.owner, '{$resource}', OLD.id, 1,
                        json_object('*', {$clock}), TRUE, {$modifiedAt}
                    ) ON CONFLICT(account_id, resource, record_id) DO UPDATE SET
                        revision = sync_record_versions.revision + 1,
                        field_clocks = excluded.field_clocks,
                        deleted = TRUE,
                        modified_at = excluded.modified_at;
                    INSERT INTO sync_change_log (account_id, resource, record_id, action, changed_at)
                    VALUES (OLD.owner, '{$resource}', OLD.id, 'delete', {$modifiedAt});
                END;",
            );

            $pdo->exec(
                "INSERT OR IGNORE INTO sync_record_versions (
                    account_id, resource, record_id, revision, field_clocks, deleted, modified_at
                )
                SELECT owner, '{$resource}', id, 1, json_object('*', {$clock}), FALSE, {$modifiedAt}
                FROM {$resource}",
            );
        }

        $pdo->exec(
            "CREATE TRIGGER sync_users_update AFTER UPDATE ON users BEGIN
                INSERT INTO sync_record_versions (
                    account_id, resource, record_id, revision, field_clocks, deleted, modified_at
                ) VALUES (
                    NEW.id, 'users', NEW.id, 1, json_object('*', {$clock}), FALSE, {$modifiedAt}
                ) ON CONFLICT(account_id, resource, record_id) DO UPDATE SET
                    revision = sync_record_versions.revision + 1,
                    field_clocks = excluded.field_clocks,
                    deleted = FALSE,
                    modified_at = excluded.modified_at;
                INSERT INTO sync_change_log (account_id, resource, record_id, action, changed_at)
                VALUES (NEW.id, 'users', NEW.id, 'upsert', {$modifiedAt});
            END;

            CREATE TRIGGER sync_review_set_share_insert AFTER INSERT ON flashcard_review_set_shares BEGIN
                INSERT INTO sync_change_log (account_id, resource, record_id, action, changed_at)
                SELECT sets.owner, 'flashcard_review_set_shares', NEW.id, 'upsert', {$modifiedAt}
                FROM flashcard_review_sets AS sets WHERE sets.id = NEW.review_set;
                INSERT INTO sync_change_log (account_id, resource, record_id, action, changed_at)
                SELECT NEW.recipient, 'accessible_flashcard_review_sets', NEW.review_set, 'upsert', {$modifiedAt}
                WHERE NEW.recipient <> '';
            END;
            CREATE TRIGGER sync_review_set_share_update AFTER UPDATE ON flashcard_review_set_shares BEGIN
                INSERT INTO sync_change_log (account_id, resource, record_id, action, changed_at)
                SELECT sets.owner, 'flashcard_review_set_shares', NEW.id, 'upsert', {$modifiedAt}
                FROM flashcard_review_sets AS sets WHERE sets.id = NEW.review_set;
                INSERT INTO sync_change_log (account_id, resource, record_id, action, changed_at)
                SELECT NEW.recipient, 'accessible_flashcard_review_sets', NEW.review_set, 'upsert', {$modifiedAt}
                WHERE NEW.recipient <> '';
            END;
            CREATE TRIGGER sync_review_set_share_delete AFTER DELETE ON flashcard_review_set_shares BEGIN
                INSERT INTO sync_change_log (account_id, resource, record_id, action, changed_at)
                SELECT sets.owner, 'flashcard_review_set_shares', OLD.id, 'delete', {$modifiedAt}
                FROM flashcard_review_sets AS sets WHERE sets.id = OLD.review_set;
                INSERT INTO sync_change_log (account_id, resource, record_id, action, changed_at)
                SELECT OLD.recipient, 'accessible_flashcard_review_sets', OLD.review_set, 'delete', {$modifiedAt}
                WHERE OLD.recipient <> '';
            END;

            CREATE TRIGGER sync_review_set_preferences_insert AFTER INSERT ON flashcard_review_set_preferences BEGIN
                INSERT INTO sync_change_log (account_id, resource, record_id, action, changed_at)
                VALUES (NEW.account, 'accessible_flashcard_review_sets', NEW.review_set, 'upsert', {$modifiedAt});
            END;
            CREATE TRIGGER sync_review_set_preferences_update AFTER UPDATE ON flashcard_review_set_preferences BEGIN
                INSERT INTO sync_change_log (account_id, resource, record_id, action, changed_at)
                VALUES (NEW.account, 'accessible_flashcard_review_sets', NEW.review_set, 'upsert', {$modifiedAt});
            END;
            CREATE TRIGGER sync_review_set_preferences_delete AFTER DELETE ON flashcard_review_set_preferences BEGIN
                INSERT INTO sync_change_log (account_id, resource, record_id, action, changed_at)
                VALUES (OLD.account, 'accessible_flashcard_review_sets', OLD.review_set, 'upsert', {$modifiedAt});
            END;

            CREATE TRIGGER sync_accessible_review_set_insert AFTER INSERT ON flashcard_review_sets BEGIN
                INSERT INTO sync_change_log (account_id, resource, record_id, action, changed_at)
                VALUES (NEW.owner, 'accessible_flashcard_review_sets', NEW.id, 'upsert', {$modifiedAt});
            END;
            CREATE TRIGGER sync_accessible_review_set_update AFTER UPDATE ON flashcard_review_sets BEGIN
                INSERT INTO sync_change_log (account_id, resource, record_id, action, changed_at)
                VALUES (NEW.owner, 'accessible_flashcard_review_sets', NEW.id, 'upsert', {$modifiedAt});
                INSERT INTO sync_change_log (account_id, resource, record_id, action, changed_at)
                SELECT recipient, 'accessible_flashcard_review_sets', NEW.id, 'upsert', {$modifiedAt}
                FROM flashcard_review_set_shares
                WHERE review_set = NEW.id AND recipient <> '';
            END;
            CREATE TRIGGER sync_accessible_review_set_delete AFTER DELETE ON flashcard_review_sets BEGIN
                INSERT INTO sync_change_log (account_id, resource, record_id, action, changed_at)
                VALUES (OLD.owner, 'accessible_flashcard_review_sets', OLD.id, 'delete', {$modifiedAt});
            END;

            CREATE TRIGGER sync_shared_card_insert AFTER INSERT ON flashcards BEGIN
                INSERT INTO sync_change_log (account_id, resource, record_id, action, changed_at)
                SELECT shares.recipient, 'review_set_cards', sets.id || ':' || NEW.id, 'upsert', {$modifiedAt}
                FROM flashcard_review_sets AS sets
                JOIN flashcard_review_set_shares AS shares ON shares.review_set = sets.id
                WHERE sets.owner = NEW.owner
                  AND shares.recipient <> ''
                  AND (
                    json_array_length(sets.tags) = 0
                    OR EXISTS (
                        SELECT 1 FROM json_each(sets.tags) AS wanted
                        JOIN json_each(NEW.tags) AS assigned ON assigned.value = wanted.value
                    )
                  );
            END;
            CREATE TRIGGER sync_shared_card_update AFTER UPDATE ON flashcards BEGIN
                INSERT INTO sync_change_log (account_id, resource, record_id, action, changed_at)
                SELECT shares.recipient, 'review_set_cards', sets.id || ':' || OLD.id, 'delete', {$modifiedAt}
                FROM flashcard_review_sets AS sets
                JOIN flashcard_review_set_shares AS shares ON shares.review_set = sets.id
                WHERE sets.owner = OLD.owner
                  AND shares.recipient <> ''
                  AND (
                    json_array_length(sets.tags) = 0
                    OR EXISTS (
                        SELECT 1 FROM json_each(sets.tags) AS wanted
                        JOIN json_each(OLD.tags) AS assigned ON assigned.value = wanted.value
                    )
                  );
                INSERT INTO sync_change_log (account_id, resource, record_id, action, changed_at)
                SELECT shares.recipient, 'review_set_cards', sets.id || ':' || NEW.id, 'upsert', {$modifiedAt}
                FROM flashcard_review_sets AS sets
                JOIN flashcard_review_set_shares AS shares ON shares.review_set = sets.id
                WHERE sets.owner = NEW.owner
                  AND shares.recipient <> ''
                  AND (
                    json_array_length(sets.tags) = 0
                    OR EXISTS (
                        SELECT 1 FROM json_each(sets.tags) AS wanted
                        JOIN json_each(NEW.tags) AS assigned ON assigned.value = wanted.value
                    )
                  );
            END;
            CREATE TRIGGER sync_shared_card_delete AFTER DELETE ON flashcards BEGIN
                INSERT INTO sync_change_log (account_id, resource, record_id, action, changed_at)
                SELECT shares.recipient, 'review_set_cards', sets.id || ':' || OLD.id, 'delete', {$modifiedAt}
                FROM flashcard_review_sets AS sets
                JOIN flashcard_review_set_shares AS shares ON shares.review_set = sets.id
                WHERE sets.owner = OLD.owner
                  AND shares.recipient <> ''
                  AND (
                    json_array_length(sets.tags) = 0
                    OR EXISTS (
                        SELECT 1 FROM json_each(sets.tags) AS wanted
                        JOIN json_each(OLD.tags) AS assigned ON assigned.value = wanted.value
                    )
                  );
            END;",
        );
    },
];
