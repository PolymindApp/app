<?php

declare(strict_types=1);

return [
    'version' => '202608200007',
    'name' => 'archive_tasks',
    'up' => static function (\PDO $pdo): void {
        $pdo->exec(<<<'SQL'
            ALTER TABLE tasks
                ADD COLUMN archived BOOLEAN NOT NULL DEFAULT FALSE;
            CREATE INDEX idx_tasks_owner_archived_order
                ON tasks (owner, archived, sort_order);
            SQL);
    },
];
