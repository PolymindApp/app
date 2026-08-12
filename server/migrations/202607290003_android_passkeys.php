<?php

declare(strict_types=1);

return [
    'version' => '202607290003',
    'name' => 'android_passkeys',
    'up' => static function (\PDO $pdo): void {
        $pdo->exec(<<<'SQL'
            CREATE TABLE IF NOT EXISTS polymind_passkey_challenges (
                id TEXT PRIMARY KEY NOT NULL,
                purpose TEXT NOT NULL CHECK (purpose IN ('register', 'login')),
                user_id TEXT,
                user_handle TEXT,
                challenge BLOB NOT NULL,
                expires_at INTEGER NOT NULL,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_polymind_passkey_challenges_expiry
                ON polymind_passkey_challenges (expires_at);

            CREATE TABLE IF NOT EXISTS polymind_passkeys (
                credential_id TEXT PRIMARY KEY NOT NULL,
                user_id TEXT NOT NULL,
                user_handle TEXT NOT NULL,
                public_key TEXT NOT NULL,
                signature_counter INTEGER,
                transports TEXT NOT NULL DEFAULT '[]',
                backup_eligible INTEGER NOT NULL DEFAULT 0,
                backed_up INTEGER NOT NULL DEFAULT 0,
                created TEXT NOT NULL,
                last_used TEXT NOT NULL DEFAULT '',
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_polymind_passkeys_user
                ON polymind_passkeys (user_id);
            SQL);
    },
];
