<?php

declare(strict_types=1);

return [
    'version' => '202608170004',
    'name' => 'archive_task_log_images',
    'up' => static function (\PDO $pdo): void {
        $pdo->exec(<<<'SQL'
            ALTER TABLE task_log_images
                ADD COLUMN active BOOLEAN NOT NULL DEFAULT TRUE;
            CREATE INDEX idx_task_log_images_task_active_usage
                ON task_log_images (task, active, usage_count DESC, updated_at DESC);
            SQL);
    },
];
