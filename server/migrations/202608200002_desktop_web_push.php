<?php

declare(strict_types=1);

return [
    'version' => '202608200002',
    'name' => 'desktop_web_push',
    'up' => static function (\PDO $pdo): void {
        $pdo->exec(<<<'SQL'
            CREATE TABLE web_push_subscriptions (
                id TEXT PRIMARY KEY NOT NULL,
                account_id TEXT NOT NULL,
                endpoint TEXT NOT NULL UNIQUE,
                public_key TEXT NOT NULL,
                auth_token TEXT NOT NULL,
                content_encoding TEXT NOT NULL DEFAULT 'aes128gcm'
                    CHECK (content_encoding IN ('aes128gcm', 'aesgcm')),
                expiration_time INTEGER,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (account_id) REFERENCES users(id) ON DELETE CASCADE
            );
            CREATE INDEX idx_web_push_subscriptions_account
                ON web_push_subscriptions (account_id);

            CREATE TABLE task_web_push_deliveries (
                subscription_id TEXT NOT NULL,
                task_id TEXT NOT NULL,
                scheduled_date TEXT NOT NULL,
                reminder_time TEXT NOT NULL,
                reserved_at TEXT NOT NULL,
                sent_at TEXT NOT NULL DEFAULT '',
                PRIMARY KEY (subscription_id, task_id, scheduled_date, reminder_time),
                FOREIGN KEY (subscription_id) REFERENCES web_push_subscriptions(id) ON DELETE CASCADE,
                FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
            ) WITHOUT ROWID;
            CREATE INDEX idx_task_web_push_deliveries_date
                ON task_web_push_deliveries (scheduled_date);
            SQL);
    },
];
