<?php

declare(strict_types=1);

namespace Mom\Api;

use PDO;
use Throwable;

final class MigrationRunner
{
    /** @var array<string, array{nameHash: string, checksum: string}> */
    private const RETIRED_MIGRATIONS = [
        '202608080002' => [
            'nameHash' => '0e54961221f7d9f01e1804d9663ebab4165070412ac100e6843f0d839c37d31b',
            'checksum' => 'f660c92d2c2f17bf3fa3356a7476a43cc83e9f690b300f76d1dd46c145af860c',
        ],
        '202608080004' => [
            'nameHash' => '83b98131967a2faca3ac177272e0172d48cc70636892ec23ef4e11a5db31d167',
            'checksum' => 'bce1f8a527b66b15457f54eefb06859db00f0f332bfd3078163a1bfcaeb51af4',
        ],
    ];

    public function __construct(
        private readonly PDO $pdo,
        private readonly string $directory,
    ) {
    }

    /**
     * Apply every pending migration in one SQLite write transaction.
     *
     * @return list<string> Versions applied by this run.
     */
    public function migrate(): array
    {
        $migrations = $this->discoverMigrations();
        $this->ensureMigrationTable();
        $transactionOpen = false;

        try {
            // IMMEDIATE prevents two PHP requests from selecting the same pending migration.
            $this->pdo->exec('BEGIN IMMEDIATE');
            $transactionOpen = true;
            $applied = $this->loadAppliedMigrations();
            $this->validateAppliedMigrations($applied, $migrations);

            $insert = $this->pdo->prepare(
                'INSERT INTO mom_schema_migrations (
                    version, name, checksum, applied_at
                 ) VALUES (
                    :version, :name, :checksum, :applied_at
                 )',
            );
            $newVersions = [];
            foreach ($migrations as $version => $migration) {
                if (isset($applied[$version])) {
                    continue;
                }

                ($migration['up'])($this->pdo);
                $insert->execute([
                    'version' => $version,
                    'name' => $migration['name'],
                    'checksum' => $migration['checksum'],
                    'applied_at' => gmdate('Y-m-d H:i:s\Z'),
                ]);
                $newVersions[] = $version;
            }

            $this->pdo->exec('COMMIT');
            $transactionOpen = false;
            return $newVersions;
        } catch (Throwable $exception) {
            if ($transactionOpen) {
                try {
                    $this->pdo->exec('ROLLBACK');
                } catch (Throwable) {
                    // Preserve the original migration failure.
                }
            }
            if ($exception instanceof ApiException) {
                throw $exception;
            }
            throw new ApiException(
                500,
                'The database migration could not be completed.',
                [],
                $exception,
            );
        }
    }

    private function ensureMigrationTable(): void
    {
        try {
            $this->pdo->exec(
                'CREATE TABLE IF NOT EXISTS mom_schema_migrations (
                    version TEXT PRIMARY KEY NOT NULL,
                    name TEXT NOT NULL,
                    checksum TEXT NOT NULL,
                    applied_at TEXT NOT NULL
                )',
            );
        } catch (Throwable $exception) {
            throw new ApiException(
                500,
                'The database migration history could not be initialized.',
                [],
                $exception,
            );
        }
    }

    /**
     * @return array<string, array{name: string, checksum: string, up: callable}>
     */
    private function discoverMigrations(): array
    {
        if (!is_dir($this->directory) || !is_readable($this->directory)) {
            throw new ApiException(500, 'The database migration directory is unavailable.');
        }

        $paths = glob($this->directory . '/*.php');
        if ($paths === false || $paths === []) {
            throw new ApiException(500, 'No database migrations are available.');
        }

        $migrations = [];
        foreach ($paths as $path) {
            $filename = basename($path);
            if (preg_match('/^(\d{12})_([a-z0-9_]+)\.php$/', $filename, $matches) !== 1) {
                throw new ApiException(500, 'A database migration filename is invalid.');
            }

            $definition = require $path;
            $version = $matches[1];
            $name = $matches[2];
            if (
                !is_array($definition)
                || ($definition['version'] ?? null) !== $version
                || ($definition['name'] ?? null) !== $name
                || !is_callable($definition['up'] ?? null)
            ) {
                throw new ApiException(500, "Database migration {$version} is invalid.");
            }
            if (isset($migrations[$version])) {
                throw new ApiException(500, "Database migration {$version} is duplicated.");
            }

            $checksum = hash_file('sha256', $path);
            if (!is_string($checksum)) {
                throw new ApiException(500, "Database migration {$version} could not be read.");
            }
            $migrations[$version] = [
                'name' => $name,
                'checksum' => $checksum,
                'up' => $definition['up'],
            ];
        }

        ksort($migrations, SORT_STRING);
        return $migrations;
    }

    /**
     * @return array<string, array{name: string, checksum: string}>
     */
    private function loadAppliedMigrations(): array
    {
        $statement = $this->pdo->query(
            'SELECT version, name, checksum FROM mom_schema_migrations ORDER BY version',
        );
        $applied = [];
        foreach ($statement->fetchAll() as $migration) {
            $applied[(string) $migration['version']] = [
                'name' => (string) $migration['name'],
                'checksum' => (string) $migration['checksum'],
            ];
        }
        return $applied;
    }

    /**
     * @param array<string, array{name: string, checksum: string}> $applied
     * @param array<string, array{name: string, checksum: string, up: callable}> $available
     */
    private function validateAppliedMigrations(array $applied, array $available): void
    {
        foreach ($applied as $version => $migration) {
            if (!isset($available[$version])) {
                $retired = self::RETIRED_MIGRATIONS[$version] ?? null;
                if (
                    $retired !== null
                    && hash_equals($retired['nameHash'], hash('sha256', $migration['name']))
                    && hash_equals($retired['checksum'], $migration['checksum'])
                ) {
                    continue;
                }
                throw new ApiException(
                    500,
                    "Applied database migration {$version} is missing from this deployment.",
                );
            }
            if (
                !hash_equals($available[$version]['name'], $migration['name'])
                || !hash_equals($available[$version]['checksum'], $migration['checksum'])
            ) {
                throw new ApiException(
                    500,
                    "Applied database migration {$version} has been modified.",
                );
            }
        }
    }
}
