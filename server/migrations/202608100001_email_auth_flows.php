<?php

declare(strict_types=1);

return [
    'version' => '202608100001',
    'name' => 'email_auth_flows',
    'up' => static function (\PDO $pdo): void {
        $pdo->exec(<<<'SQL'
            CREATE TABLE polymind_auth_tokens (
                token_hash TEXT PRIMARY KEY NOT NULL,
                user_id TEXT NOT NULL,
                purpose TEXT NOT NULL CHECK (purpose IN ('email_verification', 'password_reset')),
                expires_at INTEGER NOT NULL,
                created_at INTEGER NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                UNIQUE (user_id, purpose)
            );
            CREATE INDEX idx_polymind_auth_tokens_expiry
                ON polymind_auth_tokens (expires_at);

            UPDATE users SET verified = TRUE WHERE verified = FALSE;
            SQL);
    },
];
