<?php

declare(strict_types=1);

use Mom\Api\Config;
use Mom\Api\Database;
use Mom\Api\PexelsImageFetcher;

$limit = 100;
foreach (array_slice($argv, 1) as $argument) {
    if (preg_match('/^--limit=(\d+)$/', $argument, $matches) === 1) {
        $limit = (int) $matches[1];
        continue;
    }
    fwrite(STDERR, "Usage: php scripts/fetch-pexels-images.php [--limit=100]\n");
    exit(2);
}

$projectRoot = dirname(__DIR__);
$serverRoot = $projectRoot . '/server';
require $serverRoot . '/src/ApiException.php';
require $serverRoot . '/src/Config.php';
require $projectRoot . '/vendor/autoload.php';
require $serverRoot . '/src/MigrationRunner.php';
require $serverRoot . '/src/Database.php';
require $serverRoot . '/src/PexelsImageFetcher.php';

try {
    $config = Config::load($serverRoot);
    $database = new Database($config->databasePath);
    $testApiUrl = getenv('MOM_PEXELS_API_BASE_URL');
    $fetcher = new PexelsImageFetcher(
        $database->pdo,
        $config->pexelsApiKey,
        $config->databasePath,
        is_string($testApiUrl) && $testApiUrl !== '' ? $testApiUrl : null,
    );
    $summary = $fetcher->fetch($limit, static function (string $message): void {
        fwrite(STDOUT, $message . PHP_EOL);
    });
    fwrite(STDOUT, sprintf(
        "Searched %d/%d concepts; %d new and %d reused assets; %d pending.\n",
        $summary['searched_concepts'],
        $summary['selected_concepts'],
        $summary['new_assets'],
        $summary['reused_assets'],
        $summary['pending_concepts'],
    ));
    if ($summary['remaining_quota'] !== null) {
        fwrite(STDOUT, sprintf(
            "Pexels requests remaining: %d%s.\n",
            $summary['remaining_quota'],
            $summary['quota_reset'] === null
                ? ''
                : '; resets ' . gmdate('Y-m-d H:i:s\Z', $summary['quota_reset']),
        ));
    }
    if ($summary['stopped']) {
        fwrite(STDERR, 'Fetching stopped: ' . $summary['stop_reason'] . PHP_EOL);
        exit(1);
    }
} catch (Throwable $exception) {
    fwrite(STDERR, 'Pexels image fetching failed: ' . $exception->getMessage() . PHP_EOL);
    exit(1);
}
