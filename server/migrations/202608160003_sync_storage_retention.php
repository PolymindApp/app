<?php

declare(strict_types=1);

return [
    'version' => '202608160003',
    'name' => 'sync_storage_retention',
    'up' => static function (\PDO $pdo): void {
        $pdo->exec(<<<'SQL'
            ALTER TABLE sync_operation_receipts RENAME TO sync_operation_receipts_legacy;

            CREATE TABLE sync_operation_receipts (
                receipt_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                account_id TEXT NOT NULL,
                client_id TEXT NOT NULL,
                operation_id TEXT NOT NULL,
                response JSON NOT NULL,
                applied_at TEXT NOT NULL,
                UNIQUE (account_id, client_id, operation_id)
            );
            CREATE INDEX idx_sync_operation_receipts_client_sequence
                ON sync_operation_receipts (account_id, client_id, receipt_sequence);
            CREATE INDEX idx_sync_operation_receipts_applied
                ON sync_operation_receipts (applied_at);

            INSERT INTO sync_operation_receipts (
                account_id, client_id, operation_id, response, applied_at
            )
            SELECT account_id, client_id, operation_id,
                json_object(
                    'operationId', json_extract(response, '$.operationId'),
                    'status', json_extract(response, '$.status'),
                    'resourceType', json_extract(response, '$.resource.resource'),
                    'resourceId', json_extract(response, '$.resource.id'),
                    'resourceDeleted', json_extract(response, '$.resource.deleted'),
                    'replacementId', json_extract(response, '$.replacementId'),
                    'error', json_extract(response, '$.error')
                ),
                applied_at
            FROM sync_operation_receipts_legacy
            ORDER BY applied_at, rowid;

            DROP TABLE sync_operation_receipts_legacy;

            ALTER TABLE sync_clients
                ADD COLUMN confirmed_receipt_sequence INTEGER NOT NULL DEFAULT 0;

            CREATE TABLE sync_retention_watermarks (
                account_id TEXT PRIMARY KEY NOT NULL,
                minimum_cursor INTEGER NOT NULL DEFAULT 0,
                compacted_at TEXT NOT NULL
            );
            SQL);
    },
];
