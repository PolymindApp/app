<?php

declare(strict_types=1);

return [
    'version' => '202607300001',
    'name' => 'user_settings',
    'up' => static function (\PDO $pdo): void {
        $columns = $pdo->query('PRAGMA table_info(users)')->fetchAll(\PDO::FETCH_COLUMN, 1);
        if (in_array('settings', $columns, true)) {
            return;
        }
        $pdo->exec(
            "ALTER TABLE users ADD COLUMN settings JSON NOT NULL DEFAULT '{}'",
        );
    },
];
