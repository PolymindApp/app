<?php

declare(strict_types=1);

use BackOnTrack\Api\ApiException;
use BackOnTrack\Api\Config;
use BackOnTrack\Api\Database;
use BackOnTrack\Api\TaskWebPushDispatcher;

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require __DIR__ . '/src/ApiException.php';
require __DIR__ . '/src/Config.php';

try {
    require dirname(__DIR__) . '/vendor/autoload.php';
    require __DIR__ . '/src/Database.php';
    require __DIR__ . '/src/TaskWebPushDispatcher.php';

    $config = Config::load(__DIR__);
    $database = new Database($config->databasePath);
    $result = (new TaskWebPushDispatcher($config, $database))->dispatch();
    fwrite(STDOUT, json_encode($result, JSON_THROW_ON_ERROR) . PHP_EOL);
} catch (Throwable $exception) {
    $message = $exception instanceof ApiException
        ? $exception->getMessage()
        : 'Task Web Push dispatch failed: ' . $exception->getMessage();
    fwrite(STDERR, $message . PHP_EOL);
    exit(1);
}
