<?php

declare(strict_types=1);

use BackOnTrack\Api\ApiException;
use BackOnTrack\Api\Config;
use BackOnTrack\Api\Database;
use BackOnTrack\Api\MigrationRunner;

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

/** @return array{files: int, bytes: int} */
function removeRetiredFlashcardMedia(string $databasePath): array
{
    $directory = dirname($databasePath) . DIRECTORY_SEPARATOR . 'flashcard-images';
    if (is_link($directory) || is_file($directory)) {
        $bytes = is_file($directory) ? (int) (filesize($directory) ?: 0) : 0;
        if (!unlink($directory)) {
            throw new ApiException(500, 'The retired flashcard media path could not be removed.');
        }
        return ['files' => 1, 'bytes' => $bytes];
    }
    if (!is_dir($directory)) {
        return ['files' => 0, 'bytes' => 0];
    }

    $files = 0;
    $bytes = 0;
    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($directory, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::CHILD_FIRST,
    );
    foreach ($iterator as $item) {
        $path = $item->getPathname();
        if ($item->isLink() || $item->isFile()) {
            if ($item->isFile()) {
                $bytes += $item->getSize();
            }
            if (!unlink($path)) {
                throw new ApiException(500, 'A retired flashcard media file could not be removed.');
            }
            $files++;
            continue;
        }
        if ($item->isDir() && !rmdir($path)) {
            throw new ApiException(500, 'A retired flashcard media directory could not be removed.');
        }
    }
    if (!rmdir($directory)) {
        throw new ApiException(500, 'The retired flashcard media directory could not be removed.');
    }
    return ['files' => $files, 'bytes' => $bytes];
}

if (!$isCli && strtoupper($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') {
    header('Allow: GET');
    respondToMigrationRequest(405, ['message' => 'Method not allowed.']);
}

try {
    $config = Config::load(__DIR__);

    if (!$isCli) {
        $providedKey = $_SERVER['HTTP_X_BACKONTRACK_MIGRATION_KEY'] ?? '';
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

    $database = new Database($config->databasePath, false);
    $journalMode = strtolower((string) $database->pdo->query('PRAGMA journal_mode = WAL')->fetchColumn());
    if ($journalMode !== 'wal') {
        throw new ApiException(500, 'The SQLite database could not enable WAL mode.');
    }
    $runner = new MigrationRunner($database->pdo, __DIR__ . '/migrations');
    $appliedMigrations = $runner->migrate();
    $database->assertCompatibleSchema();
    $database->pdo->exec('PRAGMA optimize');
    $retiredMedia = removeRetiredFlashcardMedia($config->databasePath);
    $versions = $database->pdo
        ->query('SELECT version FROM backontrack_schema_migrations ORDER BY version')
        ->fetchAll(PDO::FETCH_COLUMN);
    $currentVersion = $versions === [] ? null : (string) end($versions);

    if (!$isCli) {
        respondToMigrationRequest(200, [
            'status' => 'ok',
            'appliedMigrations' => $appliedMigrations,
            'currentVersion' => $currentVersion,
            'migrationCount' => count($versions),
            'retiredMediaRemoved' => $retiredMedia,
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
    if ($retiredMedia['files'] > 0) {
        fwrite(
            STDOUT,
            sprintf(
                "Removed %d retired media file%s (%d bytes).\n",
                $retiredMedia['files'],
                $retiredMedia['files'] === 1 ? '' : 's',
                $retiredMedia['bytes'],
            ),
        );
    }
} catch (ApiException $exception) {
    if (!$isCli) {
        error_log('[backontrack-migration] ' . $exception->getMessage());
        respondToMigrationRequest(500, ['message' => 'Migration failed.']);
    }
    fwrite(STDERR, 'Migration failed: ' . $exception->getMessage() . PHP_EOL);
    exit(1);
} catch (Throwable $exception) {
    if (!$isCli) {
        error_log('[backontrack-migration] ' . $exception->getMessage());
        respondToMigrationRequest(500, ['message' => 'Migration failed unexpectedly.']);
    }
    fwrite(STDERR, 'Migration failed unexpectedly: ' . $exception->getMessage() . PHP_EOL);
    exit(1);
}
