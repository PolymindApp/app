<?php

declare(strict_types=1);

return [
    'version' => '202608170003',
    'name' => 'task_log_images',
    'up' => static function (\PDO $pdo): void {
        $pdo->exec(<<<'SQL'
            ALTER TABLE tasks
                ADD COLUMN log_with_images_enabled BOOLEAN NOT NULL DEFAULT FALSE;
            UPDATE tasks
            SET log_with_images_enabled = entry_notes_enabled;
            ALTER TABLE tasks DROP COLUMN entry_notes_enabled;
            ALTER TABLE tasks DROP COLUMN entry_note_suggestions_enabled;

            ALTER TABLE entries
                ADD COLUMN label VARCHAR(160) NOT NULL DEFAULT '';
            ALTER TABLE entries
                ADD COLUMN task_log_image TEXT NOT NULL DEFAULT '';

            CREATE TABLE task_log_images (
                id TEXT PRIMARY KEY NOT NULL DEFAULT ('r' || lower(hex(randomblob(7)))),
                owner TEXT NOT NULL,
                task TEXT NOT NULL DEFAULT '',
                label VARCHAR(160) NOT NULL DEFAULT '',
                amount NUMERIC NOT NULL DEFAULT 0,
                unit TEXT NOT NULL DEFAULT '',
                image_url TEXT NOT NULL DEFAULT '',
                image_file VARCHAR(52) NOT NULL DEFAULT '',
                usage_count INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL DEFAULT ''
            );
            CREATE INDEX idx_task_log_images_task_usage
                ON task_log_images (task, usage_count DESC, updated_at DESC);

            CREATE TRIGGER sync_task_log_images_insert AFTER INSERT ON task_log_images BEGIN
                INSERT INTO sync_record_versions (
                    account_id, resource, record_id, revision, field_clocks, deleted
                ) VALUES (
                    NEW.owner, 'task_log_images', NEW.id, 1,
                    json_object('*', (strftime('%s', 'now') || '000-0-server')), FALSE
                ) ON CONFLICT(account_id, resource, record_id) DO UPDATE SET
                    revision = sync_record_versions.revision + 1,
                    field_clocks = excluded.field_clocks,
                    deleted = FALSE;
                INSERT INTO sync_change_log (account_id, resource, record_id, action, changed_at)
                VALUES (
                    NEW.owner, 'task_log_images', NEW.id, 'upsert',
                    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                );
            END;

            CREATE TRIGGER sync_task_log_images_update AFTER UPDATE ON task_log_images BEGIN
                INSERT INTO sync_record_versions (
                    account_id, resource, record_id, revision, field_clocks, deleted
                ) VALUES (
                    NEW.owner, 'task_log_images', NEW.id, 1,
                    json_object('*', (strftime('%s', 'now') || '000-0-server')), FALSE
                ) ON CONFLICT(account_id, resource, record_id) DO UPDATE SET
                    revision = sync_record_versions.revision + 1,
                    field_clocks = excluded.field_clocks,
                    deleted = FALSE;
                INSERT INTO sync_change_log (account_id, resource, record_id, action, changed_at)
                VALUES (
                    NEW.owner, 'task_log_images', NEW.id, 'upsert',
                    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                );
            END;

            CREATE TRIGGER sync_task_log_images_delete AFTER DELETE ON task_log_images BEGIN
                INSERT INTO sync_record_versions (
                    account_id, resource, record_id, revision, field_clocks, deleted
                ) VALUES (
                    OLD.owner, 'task_log_images', OLD.id, 1,
                    json_object('*', (strftime('%s', 'now') || '000-0-server')), TRUE
                ) ON CONFLICT(account_id, resource, record_id) DO UPDATE SET
                    revision = sync_record_versions.revision + 1,
                    field_clocks = excluded.field_clocks,
                    deleted = TRUE;
                INSERT INTO sync_change_log (account_id, resource, record_id, action, changed_at)
                VALUES (
                    OLD.owner, 'task_log_images', OLD.id, 'delete',
                    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                );
            END;
            SQL);
    },
];
