<?php

declare(strict_types=1);

return [
    'version' => '202607290002',
    'name' => 'api_rate_limiting',
    'up' => static function (\PDO $pdo): void {
        $pdo->exec(
            'CREATE TABLE IF NOT EXISTS mom_rate_limits (
                rate_key TEXT PRIMARY KEY NOT NULL,
                window_start INTEGER NOT NULL,
                hits INTEGER NOT NULL
            )',
        );
    },
];
