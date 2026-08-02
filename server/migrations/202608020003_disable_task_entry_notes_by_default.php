<?php

declare(strict_types=1);

return [
    'version' => '202608020003',
    'name' => 'disable_task_entry_notes_by_default',
    'up' => static function (\PDO $pdo): void {
        $pdo->exec(
            'UPDATE tasks
             SET entry_notes_enabled = FALSE,
                 entry_note_suggestions_enabled = FALSE',
        );
    },
];
