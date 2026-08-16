<?php

declare(strict_types=1);

return [
    'version' => '202608160004',
    'name' => 'compact_flashcard_review_storage',
    'up' => static function (\PDO $pdo): void {
        $pdo->exec(<<<'SQL'
            ALTER TABLE flashcard_review_events
                ADD COLUMN view_count INTEGER NOT NULL DEFAULT 1;

            CREATE TEMP TABLE backontrack_passive_review_batches AS
            SELECT
                MIN(id) AS keeper_id,
                owner,
                session,
                card,
                outcome,
                reviewed_at,
                front_snapshot,
                back_snapshot,
                tags_snapshot,
                SUM(view_count) AS total_views
            FROM flashcard_review_events
            WHERE outcome = 'passive'
            GROUP BY
                owner, session, card, outcome, reviewed_at,
                front_snapshot, back_snapshot, tags_snapshot
            HAVING COUNT(*) > 1;

            UPDATE flashcard_review_events
            SET view_count = (
                SELECT batches.total_views
                FROM backontrack_passive_review_batches AS batches
                WHERE batches.keeper_id = flashcard_review_events.id
            )
            WHERE id IN (
                SELECT keeper_id FROM backontrack_passive_review_batches
            );

            DELETE FROM flashcard_review_events
            WHERE outcome = 'passive'
              AND EXISTS (
                SELECT 1
                FROM backontrack_passive_review_batches AS batches
                WHERE batches.owner = flashcard_review_events.owner
                  AND batches.session = flashcard_review_events.session
                  AND batches.card = flashcard_review_events.card
                  AND batches.outcome = flashcard_review_events.outcome
                  AND batches.reviewed_at = flashcard_review_events.reviewed_at
                  AND batches.front_snapshot = flashcard_review_events.front_snapshot
                  AND batches.back_snapshot = flashcard_review_events.back_snapshot
                  AND batches.tags_snapshot = flashcard_review_events.tags_snapshot
                  AND batches.keeper_id <> flashcard_review_events.id
              );

            UPDATE sync_record_versions
            SET field_clocks = json_object(
                '*',
                COALESCE(
                    (
                        SELECT MAX(CAST(value AS TEXT))
                        FROM json_each(sync_record_versions.field_clocks)
                    ),
                    strftime('%s', 'now') || '000-0-server'
                )
            )
            WHERE resource = 'flashcard_review_events';

            DELETE FROM sync_record_versions
            WHERE resource = 'flashcard_review_events'
              AND deleted = TRUE
              AND NOT EXISTS (
                SELECT 1 FROM flashcard_review_events
                WHERE flashcard_review_events.owner = sync_record_versions.account_id
                  AND flashcard_review_events.id = sync_record_versions.record_id
              );

            DELETE FROM sync_operation_receipts
            WHERE EXISTS (
                SELECT 1 FROM sync_clients
                WHERE sync_clients.account_id = sync_operation_receipts.account_id
                  AND sync_clients.client_id = sync_operation_receipts.client_id
                  AND sync_clients.protocol_version < 2
            );
            DELETE FROM sync_clients WHERE protocol_version < 2;

            INSERT INTO sync_retention_watermarks (
                account_id, minimum_cursor, compacted_at
            )
            SELECT
                account_id,
                MAX(sequence),
                strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            FROM sync_change_log
            GROUP BY account_id
            ON CONFLICT(account_id) DO UPDATE SET
                minimum_cursor = MAX(
                    sync_retention_watermarks.minimum_cursor,
                    excluded.minimum_cursor
                ),
                compacted_at = excluded.compacted_at;

            DELETE FROM sync_change_log
            WHERE sequence <= COALESCE(
                (
                    SELECT minimum_cursor
                    FROM sync_retention_watermarks
                    WHERE sync_retention_watermarks.account_id = sync_change_log.account_id
                ),
                0
            );

            DROP TABLE backontrack_passive_review_batches;
            SQL);
    },
];
