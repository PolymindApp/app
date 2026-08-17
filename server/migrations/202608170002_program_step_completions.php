<?php

declare(strict_types=1);

return [
    'version' => '202608170002',
    'name' => 'program_step_completions',
    'up' => static function (\PDO $pdo): void {
        $pdo->exec(<<<'SQL'
            ALTER TABLE program_steps
                ADD COLUMN completions JSON NOT NULL DEFAULT '[]';
            ALTER TABLE occurrences
                ADD COLUMN completion_state JSON NOT NULL DEFAULT '{}';
            ALTER TABLE entries
                ADD COLUMN program_step_completion TEXT NOT NULL DEFAULT '';
            ALTER TABLE interval_sessions
                ADD COLUMN program_step_completion TEXT NOT NULL DEFAULT '';
            ALTER TABLE flashcard_review_sessions
                ADD COLUMN program_step_completion TEXT NOT NULL DEFAULT '';

            UPDATE program_steps
            SET completions = json_array(json_object(
                'id', 'completion-legacy',
                'type', completion_type,
                'targetValue', target_value,
                'targetOperator', target_operator,
                'unit', unit,
                'customUnit', custom_unit,
                'intervalTemplate', interval_template,
                'flashcardReviewSet', flashcard_review_set
            ))
            WHERE completion_type <> 'day_off';

            UPDATE occurrences
            SET completion_state = json_object('completion-legacy', json('true'))
            WHERE program_step <> '' AND status = 'completed';

            UPDATE entries
            SET program_step_completion = 'completion-legacy'
            WHERE program_step <> '';
            UPDATE interval_sessions
            SET program_step_completion = 'completion-legacy'
            WHERE program_step <> '';
            UPDATE flashcard_review_sessions
            SET program_step_completion = 'completion-legacy'
            WHERE program_step <> '';
            SQL);
    },
];
