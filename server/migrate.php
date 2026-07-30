<?php

declare(strict_types=1);

use Mom\Api\ApiException;
use Mom\Api\Config;
use Mom\Api\Database;

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require dirname(__DIR__) . '/vendor/autoload.php';
require __DIR__ . '/src/ApiException.php';
require __DIR__ . '/src/Config.php';
require __DIR__ . '/src/MigrationRunner.php';
require __DIR__ . '/src/Database.php';

try {
    $config = Config::load(__DIR__);
    $database = new Database($config->databasePath);
    $versions = $database->pdo
        ->query('SELECT version FROM mom_schema_migrations ORDER BY version')
        ->fetchAll(PDO::FETCH_COLUMN);

    if ($database->migrationsApplied === []) {
        fwrite(STDOUT, "Database is already current.\n");
    } else {
        fwrite(
            STDOUT,
            sprintf(
                "Applied %d migration%s: %s\n",
                count($database->migrationsApplied),
                count($database->migrationsApplied) === 1 ? '' : 's',
                implode(', ', $database->migrationsApplied),
            ),
        );
    }
    fwrite(
        STDOUT,
        sprintf(
            "Current database version: %s (%d migration%s total).\n",
            $versions === [] ? 'none' : end($versions),
            count($versions),
            count($versions) === 1 ? '' : 's',
        ),
    );
} catch (ApiException $exception) {
    fwrite(STDERR, 'Migration failed: ' . $exception->getMessage() . PHP_EOL);
    exit(1);
} catch (Throwable $exception) {
    fwrite(STDERR, 'Migration failed unexpectedly: ' . $exception->getMessage() . PHP_EOL);
    exit(1);
}
