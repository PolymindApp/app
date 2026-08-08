<?php

declare(strict_types=1);

return [
    'version' => '202608080002',
    'name' => 'openai_connections',
    'up' => static function (\PDO $pdo): void {
        $pdo->exec(
            'CREATE TABLE mom_openai_connections (
                user_id TEXT PRIMARY KEY NOT NULL,
                encrypted_api_key TEXT NOT NULL,
                key_hint VARCHAR(8) NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
            )',
        );
    },
];
