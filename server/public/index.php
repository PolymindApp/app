<?php

declare(strict_types=1);

use Polymind\Api\Api;
use Polymind\Api\ApiException;
use Polymind\Api\Config;
use Polymind\Api\Database;

require dirname(__DIR__) . '/src/ApiException.php';

$serverRoot = dirname(__DIR__);
$debug = false;

try {
    require $serverRoot . '/src/Config.php';
    $debug = Config::debugEnabled($serverRoot);
    require dirname($serverRoot) . '/vendor/autoload.php';
    require $serverRoot . '/src/Mailer.php';
    require $serverRoot . '/src/MigrationRunner.php';
    require $serverRoot . '/src/Database.php';
    require $serverRoot . '/src/Schema.php';
    require $serverRoot . '/src/SyncService.php';
    require $serverRoot . '/src/Api.php';

    $config = Config::load($serverRoot);
    $database = new Database($config->databasePath);
    (new Api($config, $database))->run();
} catch (ApiException $exception) {
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    http_response_code($exception->status);
    $body = [
        'message' => $exception->getMessage(),
        'details' => (object) $exception->details,
    ];
    if ($debug && $exception->status >= 500) {
        $body['error'] = ApiException::debugPayload($exception);
    }
    echo json_encode($body, JSON_UNESCAPED_SLASHES);
} catch (Throwable $exception) {
    error_log('[polymind-api/bootstrap] ' . $exception->getMessage());
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    http_response_code(500);
    $body = ['message' => 'The API could not start.'];
    if ($debug) {
        $body['error'] = ApiException::debugPayload($exception);
    }
    echo json_encode($body, JSON_UNESCAPED_SLASHES);
}
