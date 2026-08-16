<?php

declare(strict_types=1);

return [
    'version' => '202608160002',
    'name' => 'task_schedule_time',
    'up' => static function (\PDO $pdo): void {
        $columns = $pdo->query('PRAGMA table_info(tasks)')->fetchAll(\PDO::FETCH_COLUMN, 1);
        if (!in_array('schedule_mode', $columns, true)) {
            $pdo->exec("ALTER TABLE tasks ADD COLUMN schedule_mode TEXT NOT NULL DEFAULT 'all_day'");
        }
        if (!in_array('scheduled_time', $columns, true)) {
            $pdo->exec("ALTER TABLE tasks ADD COLUMN scheduled_time TEXT NOT NULL DEFAULT ''");
        }
    },
];
