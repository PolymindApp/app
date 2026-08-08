<?php

declare(strict_types=1);

return [
    'version' => '202608080004',
    'name' => 'remove_openai_api_connections',
    'up' => static function (\PDO $pdo): void {
        $pdo->exec('DROP TABLE IF EXISTS mom_openai_connections');
    },
];
