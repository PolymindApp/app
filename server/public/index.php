<?php

declare(strict_types=1);

use Mom\Api\Api;
use Mom\Api\ApiException;
use Mom\Api\Config;
use Mom\Api\Database;

require dirname(__DIR__, 2) . '/vendor/autoload.php';
require dirname(__DIR__) . '/src/ApiException.php';
require dirname(__DIR__) . '/src/Config.php';
require dirname(__DIR__) . '/src/MigrationRunner.php';
require dirname(__DIR__) . '/src/Database.php';
require dirname(__DIR__) . '/src/Schema.php';
require dirname(__DIR__) . '/src/Api.php';

try {
    $config = Config::load(dirname(__DIR__));
    $database = new Database($config->databasePath);
    (new Api($config, $database))->run();
} catch (ApiException $exception) {
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    http_response_code($exception->status);
    echo json_encode([
        'message' => $exception->getMessage(),
        'details' => (object) $exception->details,
    ], JSON_UNESCAPED_SLASHES);
} catch (Throwable $exception) {
    error_log('[mom-api/bootstrap] ' . $exception->getMessage());
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    http_response_code(500);
    echo json_encode(['message' => 'The API could not start.']);
}
