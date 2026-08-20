<?php

declare(strict_types=1);

return [
    'version' => '202608200001',
    'name' => 'client_error_reporting',
    'up' => static function (\PDO $pdo): void {
        $pdo->exec(<<<'SQL'
            CREATE TABLE client_errors (
                id TEXT PRIMARY KEY NOT NULL,
                account_id TEXT NOT NULL,
                fingerprint TEXT NOT NULL,
                type TEXT NOT NULL CHECK (type IN ('javascript', 'network')),
                message TEXT NOT NULL,
                source TEXT NOT NULL DEFAULT '',
                method TEXT NOT NULL DEFAULT '',
                status INTEGER,
                stack TEXT NOT NULL DEFAULT '',
                occurrence_count INTEGER NOT NULL DEFAULT 1,
                first_occurred_at TEXT NOT NULL,
                last_occurred_at TEXT NOT NULL,
                first_received_at TEXT NOT NULL,
                last_received_at TEXT NOT NULL,
                platform TEXT NOT NULL DEFAULT '',
                app_version TEXT NOT NULL DEFAULT '',
                user_agent TEXT NOT NULL DEFAULT '',
                FOREIGN KEY (account_id) REFERENCES users(id) ON DELETE CASCADE,
                UNIQUE (account_id, fingerprint)
            );
            CREATE INDEX idx_client_errors_last_received
                ON client_errors (last_received_at DESC);
            CREATE INDEX idx_client_errors_type_count
                ON client_errors (type, occurrence_count DESC);
            SQL);
    },
];
