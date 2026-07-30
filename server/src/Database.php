<?php

declare(strict_types=1);

namespace Mom\Api;

use PDO;
use PDOException;

final class Database
{
    public readonly PDO $pdo;

    public function __construct(string $path)
    {
        try {
            $this->pdo = new PDO('sqlite:' . $path, null, null, [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
            ]);
            $this->pdo->exec('PRAGMA busy_timeout = 5000');
            $this->pdo->exec('PRAGMA foreign_keys = ON');
            $this->ensureSupportTables();
            $this->assertCompatibleSchema();
        } catch (PDOException $exception) {
            throw new ApiException(500, 'Could not open the application database.', [], $exception);
        }
    }

    private function ensureSupportTables(): void
    {
        $this->pdo->exec(
            'CREATE TABLE IF NOT EXISTS mom_rate_limits (
                rate_key TEXT PRIMARY KEY NOT NULL,
                window_start INTEGER NOT NULL,
                hits INTEGER NOT NULL
            )',
        );
        $this->pdo->exec(
            "CREATE TABLE IF NOT EXISTS mom_passkey_challenges (
                id TEXT PRIMARY KEY NOT NULL,
                purpose TEXT NOT NULL CHECK (purpose IN ('register', 'login')),
                user_id TEXT,
                user_handle TEXT,
                challenge BLOB NOT NULL,
                expires_at INTEGER NOT NULL,
                created_at INTEGER NOT NULL
            )",
        );
        $this->pdo->exec(
            'CREATE INDEX IF NOT EXISTS idx_mom_passkey_challenges_expiry
             ON mom_passkey_challenges (expires_at)',
        );
        $this->pdo->exec(
            'CREATE TABLE IF NOT EXISTS mom_passkeys (
                credential_id TEXT PRIMARY KEY NOT NULL,
                user_id TEXT NOT NULL,
                user_handle TEXT NOT NULL,
                public_key TEXT NOT NULL,
                signature_counter INTEGER,
                transports TEXT NOT NULL DEFAULT \'[]\',
                backup_eligible INTEGER NOT NULL DEFAULT 0,
                backed_up INTEGER NOT NULL DEFAULT 0,
                created TEXT NOT NULL,
                last_used TEXT NOT NULL DEFAULT \'\',
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )',
        );
        $this->pdo->exec(
            'CREATE INDEX IF NOT EXISTS idx_mom_passkeys_user
             ON mom_passkeys (user_id)',
        );
    }

    private function assertCompatibleSchema(): void
    {
        $required = [
            'users',
            'tags',
            'tasks',
            'program_steps',
            'occurrences',
            'entries',
            'interval_templates',
            'interval_sessions',
        ];
        $placeholders = implode(',', array_fill(0, count($required), '?'));
        $statement = $this->pdo->prepare(
            "SELECT name FROM sqlite_schema WHERE type = 'table' AND name IN ({$placeholders})",
        );
        $statement->execute($required);
        $found = $statement->fetchAll(PDO::FETCH_COLUMN);
        $missing = array_values(array_diff($required, $found));
        if ($missing !== []) {
            throw new ApiException(500, 'The SQLite database does not have the expected Mom schema.');
        }
    }
}
