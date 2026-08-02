<?php

declare(strict_types=1);

return [
    'version' => '202608020002',
    'name' => 'task_entry_note_settings',
    'up' => static function (\PDO $pdo): void {
        $columns = $pdo->query('PRAGMA table_info(tasks)')->fetchAll(\PDO::FETCH_COLUMN, 1);
        if (!in_array('entry_notes_enabled', $columns, true)) {
            $pdo->exec(
                'ALTER TABLE tasks ADD COLUMN entry_notes_enabled BOOLEAN NOT NULL DEFAULT TRUE',
            );
        }
        if (!in_array('entry_note_suggestions_enabled', $columns, true)) {
            $pdo->exec(
                'ALTER TABLE tasks ADD COLUMN entry_note_suggestions_enabled BOOLEAN NOT NULL DEFAULT TRUE',
            );
        }
    },
];
