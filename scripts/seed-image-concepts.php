<?php

declare(strict_types=1);

use Polymind\Api\Config;
use Polymind\Api\Database;
use Polymind\Api\ImageConceptSeeder;

$projectRoot = dirname(__DIR__);
$serverRoot = $projectRoot . '/server';

require $serverRoot . '/src/ApiException.php';
require $serverRoot . '/src/Config.php';
require $projectRoot . '/vendor/autoload.php';
require $serverRoot . '/src/MigrationRunner.php';
require $serverRoot . '/src/Database.php';
require $serverRoot . '/src/ImageConceptSeeder.php';

try {
    $config = Config::load($serverRoot);
    $database = new Database($config->databasePath);
    $path = $serverRoot . '/seeds/image-concepts.jsonl';
    $result = (new ImageConceptSeeder($database->pdo))->seed($path);
    fwrite(STDOUT, sprintf(
        "Seeded %d image concepts and %d localized terms from %d sources (%d searches reset).\n",
        $result['concepts'],
        $result['terms'],
        $result['sources'],
        $result['reset'],
    ));
} catch (Throwable $exception) {
    fwrite(STDERR, 'Image concept seeding failed: ' . $exception->getMessage() . PHP_EOL);
    exit(1);
}
