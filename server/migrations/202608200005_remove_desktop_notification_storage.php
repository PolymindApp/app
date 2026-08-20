<?php

declare(strict_types=1);

return [
    'version' => '202608200005',
    'name' => 'remove_desktop_notification_storage',
    'up' => static function (\PDO $pdo): void {
        $pdo->exec(<<<'SQL'
            DROP TABLE IF EXISTS task_web_push_deliveries;
            DROP TABLE IF EXISTS web_push_subscriptions;
            SQL);
    },
];
