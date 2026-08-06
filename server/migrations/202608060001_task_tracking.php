<?php

declare(strict_types=1);

return [
    'version' => '202608060001',
    'name' => 'task_tracking',
    'up' => static function (\PDO $pdo): void {
        $taskColumns = $pdo->query("PRAGMA table_info(tasks)")->fetchAll(\PDO::FETCH_COLUMN, 1);
        if (!in_array('tracking_trackers', $taskColumns, true)) {
            $pdo->exec(
                "ALTER TABLE tasks ADD COLUMN tracking_trackers JSON NOT NULL DEFAULT '[]'",
            );
        }
    },
];
