<?php

declare(strict_types=1);

return [
    'version' => '202608170001',
    'name' => 'optimize_sync_storage',
    'up' => static function (\PDO $pdo): void {
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

        // These triggers write sync_record_versions, so pause them while that table
        // is rebuilt and while legacy image data is removed from session snapshots.
        foreach ($ownedResources as $resource) {
            $trigger = 'sync_' . $resource;
            $pdo->exec(
                "DROP TRIGGER IF EXISTS {$trigger}_insert;
                 DROP TRIGGER IF EXISTS {$trigger}_update;
                 DROP TRIGGER IF EXISTS {$trigger}_delete;",
            );
        }
        $pdo->exec('DROP TRIGGER IF EXISTS sync_users_update');

        $stripImages = static function (mixed $value) use (&$stripImages): mixed {
            if (!is_array($value)) {
                return $value;
            }
            unset($value['image'], $value['image_url'], $value['image_file']);
            foreach ($value as $key => $item) {
                $value[$key] = $stripImages($item);
            }
            return $value;
        };
        foreach ([
            ['table' => 'flashcard_review_sessions', 'column' => 'queue_state'],
            ['table' => 'interval_sessions', 'column' => 'flashcard_snapshot'],
        ] as $snapshot) {
            $select = $pdo->query(
                "SELECT id, {$snapshot['column']} AS snapshot FROM {$snapshot['table']} "
                . "WHERE {$snapshot['column']} <> ''",
            );
            $update = $pdo->prepare(
                "UPDATE {$snapshot['table']} SET {$snapshot['column']} = :snapshot WHERE id = :id",
            );
            foreach ($select->fetchAll() as $row) {
                $decoded = json_decode((string) $row['snapshot'], true);
                if (!is_array($decoded)) {
                    continue;
                }
                $cleaned = json_encode(
                    $stripImages($decoded),
                    JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES,
                );
                if ($cleaned !== (string) $row['snapshot']) {
                    $update->execute(['snapshot' => $cleaned, 'id' => $row['id']]);
                }
            }
        }

        $flashcardColumns = $pdo
            ->query('PRAGMA table_info(flashcards)')
            ->fetchAll(\PDO::FETCH_COLUMN, 1);
        if (in_array('image_url', $flashcardColumns, true)) {
            $pdo->exec('ALTER TABLE flashcards DROP COLUMN image_url');
        }
        if (in_array('image_file', $flashcardColumns, true)) {
            $pdo->exec('ALTER TABLE flashcards DROP COLUMN image_file');
        }

        // Uniform per-field clocks are equivalent to one wildcard clock. This is
        // the common shape produced by local creates and is substantially smaller.
        $pdo->exec(<<<'SQL'
            UPDATE sync_record_versions
            SET field_clocks = json_object(
                '*',
                (SELECT CAST(value AS TEXT) FROM json_each(sync_record_versions.field_clocks) LIMIT 1)
            )
            WHERE json_valid(field_clocks)
              AND json_type(field_clocks) = 'object'
              AND NOT EXISTS (
                  SELECT 1 FROM json_each(sync_record_versions.field_clocks) WHERE key = '*'
              )
              AND (SELECT COUNT(*) FROM json_each(sync_record_versions.field_clocks)) > 1
              AND (SELECT COUNT(DISTINCT CAST(value AS TEXT))
                   FROM json_each(sync_record_versions.field_clocks)) = 1;

            ALTER TABLE sync_record_versions RENAME TO sync_record_versions_legacy;
            CREATE TABLE sync_record_versions (
                account_id TEXT NOT NULL,
                resource TEXT NOT NULL,
                record_id TEXT NOT NULL,
                revision INTEGER NOT NULL DEFAULT 1,
                field_clocks JSON NOT NULL DEFAULT '{}',
                deleted BOOLEAN NOT NULL DEFAULT FALSE,
                PRIMARY KEY (account_id, resource, record_id)
            ) WITHOUT ROWID;
            INSERT INTO sync_record_versions (
                account_id, resource, record_id, revision, field_clocks, deleted
            )
            SELECT account_id, resource, record_id, revision, field_clocks, deleted
            FROM sync_record_versions_legacy;
            DROP TABLE sync_record_versions_legacy;

            DROP INDEX IF EXISTS idx_sync_operation_receipts_applied;
            CREATE INDEX idx_sync_operation_receipts_account_applied
                ON sync_operation_receipts (account_id, applied_at);

            DROP INDEX IF EXISTS idx_flashcard_review_set_shares_set;
            CREATE INDEX idx_entries_owner_occurrence
                ON entries (owner, occurrence) WHERE occurrence <> '';
            CREATE INDEX idx_entries_owner_program_step_date
                ON entries (owner, program_step, entry_date) WHERE program_step <> '';
            CREATE INDEX idx_interval_sessions_owner_active_started
                ON interval_sessions (owner, started_at DESC)
                WHERE status IN ('running', 'paused');
            CREATE INDEX idx_tasks_owner_active_type_order
                ON tasks (owner, type, sort_order)
                WHERE active = TRUE;
            SQL);

        $changedAt = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
        $clock = "(strftime('%s', 'now') || '000-0-server')";
        foreach ($ownedResources as $resource) {
            $trigger = 'sync_' . $resource;
            $pdo->exec(
                "CREATE TRIGGER {$trigger}_insert AFTER INSERT ON {$resource} BEGIN
                    INSERT INTO sync_record_versions (
                        account_id, resource, record_id, revision, field_clocks, deleted
                    ) VALUES (
                        NEW.owner, '{$resource}', NEW.id, 1,
                        json_object('*', {$clock}), FALSE
                    ) ON CONFLICT(account_id, resource, record_id) DO UPDATE SET
                        revision = sync_record_versions.revision + 1,
                        field_clocks = excluded.field_clocks,
                        deleted = FALSE;
                    INSERT INTO sync_change_log (account_id, resource, record_id, action, changed_at)
                    VALUES (NEW.owner, '{$resource}', NEW.id, 'upsert', {$changedAt});
                END;

                CREATE TRIGGER {$trigger}_update AFTER UPDATE ON {$resource} BEGIN
                    INSERT INTO sync_record_versions (
                        account_id, resource, record_id, revision, field_clocks, deleted
                    ) VALUES (
                        NEW.owner, '{$resource}', NEW.id, 1,
                        json_object('*', {$clock}), FALSE
                    ) ON CONFLICT(account_id, resource, record_id) DO UPDATE SET
                        revision = sync_record_versions.revision + 1,
                        field_clocks = excluded.field_clocks,
                        deleted = FALSE;
                    INSERT INTO sync_change_log (account_id, resource, record_id, action, changed_at)
                    VALUES (NEW.owner, '{$resource}', NEW.id, 'upsert', {$changedAt});
                END;

                CREATE TRIGGER {$trigger}_delete AFTER DELETE ON {$resource} BEGIN
                    INSERT INTO sync_record_versions (
                        account_id, resource, record_id, revision, field_clocks, deleted
                    ) VALUES (
                        OLD.owner, '{$resource}', OLD.id, 1,
                        json_object('*', {$clock}), TRUE
                    ) ON CONFLICT(account_id, resource, record_id) DO UPDATE SET
                        revision = sync_record_versions.revision + 1,
                        field_clocks = excluded.field_clocks,
                        deleted = TRUE;
                    INSERT INTO sync_change_log (account_id, resource, record_id, action, changed_at)
                    VALUES (OLD.owner, '{$resource}', OLD.id, 'delete', {$changedAt});
                END;",
            );
        }

        $pdo->exec(
            "CREATE TRIGGER sync_users_update AFTER UPDATE ON users BEGIN
                INSERT INTO sync_record_versions (
                    account_id, resource, record_id, revision, field_clocks, deleted
                ) VALUES (
                    NEW.id, 'users', NEW.id, 1, json_object('*', {$clock}), FALSE
                ) ON CONFLICT(account_id, resource, record_id) DO UPDATE SET
                    revision = sync_record_versions.revision + 1,
                    field_clocks = excluded.field_clocks,
                    deleted = FALSE;
                INSERT INTO sync_change_log (account_id, resource, record_id, action, changed_at)
                VALUES (NEW.id, 'users', NEW.id, 'upsert', {$changedAt});
            END;",
        );
    },
];
