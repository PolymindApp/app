<?php

declare(strict_types=1);

return [
    'version' => '202608080001',
    'name' => 'flashcard_review_set_email_invitations',
    'up' => static function (\PDO $pdo): void {
        $columns = $pdo->query(
            'PRAGMA table_info(flashcard_review_set_shares)',
        )->fetchAll(\PDO::FETCH_COLUMN, 1);
        if (!in_array('recipient_email', $columns, true)) {
            $pdo->exec(
                "ALTER TABLE flashcard_review_set_shares
                 ADD COLUMN recipient_email TEXT NOT NULL DEFAULT '' COLLATE NOCASE",
            );
        }

        $pdo->exec(<<<'SQL'
            UPDATE flashcard_review_set_shares
               SET recipient_email = COALESCE(
                   (SELECT users.email
                      FROM users
                     WHERE users.id = flashcard_review_set_shares.recipient),
                   ''
               )
             WHERE recipient_email = '';

            CREATE UNIQUE INDEX IF NOT EXISTS idx_flashcard_review_set_shares_email
                ON flashcard_review_set_shares (review_set, recipient_email COLLATE NOCASE)
                WHERE recipient_email <> '';
            SQL);
    },
];
