<?php

declare(strict_types=1);

return [
    'version' => '202608090002',
    'name' => 'task_reminders',
    'up' => static function (\PDO $pdo): void {
        $pdo->exec(
            "ALTER TABLE tasks ADD COLUMN reminder_enabled BOOLEAN NOT NULL DEFAULT FALSE;
             ALTER TABLE tasks ADD COLUMN reminder_times JSON NOT NULL DEFAULT '[]';
             ALTER TABLE tracking_trackers DROP COLUMN reminder_enabled;
             ALTER TABLE tracking_trackers DROP COLUMN reminder_time;
             ALTER TABLE tracking_trackers DROP COLUMN reminder_show_name;",
        );
    },
];
