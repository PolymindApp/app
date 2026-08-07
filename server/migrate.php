<?php

declare(strict_types=1);

use Mom\Api\ApiException;
use Mom\Api\Config;
use Mom\Api\Database;

require __DIR__ . '/src/ApiException.php';
require __DIR__ . '/src/Config.php';

$isCli = PHP_SAPI === 'cli';

/**
 * @param array<string, mixed> $body
 */
function respondToMigrationRequest(int $status, array $body): never
{
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_SLASHES);
    exit;
}

if (!$isCli && strtoupper($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') {
    header('Allow: GET');
    respondToMigrationRequest(405, ['message' => 'Method not allowed.']);
}

try {
    $config = Config::load(__DIR__);

    if (!$isCli) {
        $providedKey = $_SERVER['HTTP_X_MOM_MIGRATION_KEY'] ?? '';
        if (
            !is_string($providedKey)
            || strlen($config->migrationKey) < 32
            || !hash_equals($config->migrationKey, $providedKey)
        ) {
            respondToMigrationRequest(401, ['message' => 'Migration authorization failed.']);
        }
    }

    require dirname(__DIR__) . '/vendor/autoload.php';
    require __DIR__ . '/src/MigrationRunner.php';
    require __DIR__ . '/src/Database.php';

    $database = new Database($config->databasePath);
    $versions = $database->pdo
        ->query('SELECT version FROM mom_schema_migrations ORDER BY version')
        ->fetchAll(PDO::FETCH_COLUMN);
    $appliedMigrations = $database->migrationsApplied;
    $currentVersion = $versions === [] ? null : (string) end($versions);

    if (!$isCli) {
        respondToMigrationRequest(200, [
            'status' => 'ok',
            'appliedMigrations' => $appliedMigrations,
            'currentVersion' => $currentVersion,
            'migrationCount' => count($versions),
        ]);
    }

    if ($appliedMigrations === []) {
        fwrite(STDOUT, "Database is already current.\n");
    } else {
        fwrite(
            STDOUT,
            sprintf(
                "Applied %d migration%s: %s\n",
                count($appliedMigrations),
                count($appliedMigrations) === 1 ? '' : 's',
                implode(', ', $appliedMigrations),
            ),
        );
    }
    fwrite(
        STDOUT,
        sprintf(
            "Current database version: %s (%d migration%s total).\n",
            $currentVersion ?? 'none',
            count($versions),
            count($versions) === 1 ? '' : 's',
        ),
    );
} catch (ApiException $exception) {
    if (!$isCli) {
        error_log('[mom-migration] ' . $exception->getMessage());
        respondToMigrationRequest(500, ['message' => 'Migration failed.']);
    }
    fwrite(STDERR, 'Migration failed: ' . $exception->getMessage() . PHP_EOL);
    exit(1);
} catch (Throwable $exception) {
    if (!$isCli) {
        error_log('[mom-migration] ' . $exception->getMessage());
        respondToMigrationRequest(500, ['message' => 'Migration failed unexpectedly.']);
    }
    fwrite(STDERR, 'Migration failed unexpectedly: ' . $exception->getMessage() . PHP_EOL);
    exit(1);
}
