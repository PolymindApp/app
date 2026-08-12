<?php

declare(strict_types=1);

return [
    'version' => '202608120001',
    'name' => 'shared_review_set_card_sync',
    'up' => static function (\PDO $pdo): void {
        $modifiedAt = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

        $pdo->exec(
            "DROP TRIGGER IF EXISTS sync_review_set_share_insert;
            DROP TRIGGER IF EXISTS sync_review_set_share_update;
            DROP TRIGGER IF EXISTS sync_review_set_share_delete;

            CREATE TRIGGER sync_review_set_share_insert AFTER INSERT ON flashcard_review_set_shares BEGIN
                INSERT INTO sync_change_log (account_id, resource, record_id, action, changed_at)
                SELECT sets.owner, 'flashcard_review_set_shares', NEW.id, 'upsert', {$modifiedAt}
                FROM flashcard_review_sets AS sets WHERE sets.id = NEW.review_set;
                INSERT INTO sync_change_log (account_id, resource, record_id, action, changed_at)
                SELECT NEW.recipient, 'accessible_flashcard_review_sets', NEW.review_set, 'upsert', {$modifiedAt}
                WHERE NEW.recipient <> '';
                INSERT INTO sync_change_log (account_id, resource, record_id, action, changed_at)
                SELECT NEW.recipient, 'review_set_cards', NEW.review_set || ':' || cards.id, 'upsert', {$modifiedAt}
                FROM flashcards AS cards
                JOIN flashcard_review_sets AS sets ON sets.id = NEW.review_set
                WHERE NEW.recipient <> ''
                  AND cards.owner = sets.owner
                  AND (
                    json_array_length(sets.tags) = 0
                    OR EXISTS (
                        SELECT 1 FROM json_each(sets.tags) AS wanted
                        JOIN json_each(cards.tags) AS assigned ON assigned.value = wanted.value
                    )
                  );
            END;

            CREATE TRIGGER sync_review_set_share_update AFTER UPDATE ON flashcard_review_set_shares BEGIN
                INSERT INTO sync_change_log (account_id, resource, record_id, action, changed_at)
                SELECT sets.owner, 'flashcard_review_set_shares', NEW.id, 'upsert', {$modifiedAt}
                FROM flashcard_review_sets AS sets WHERE sets.id = NEW.review_set;
                INSERT INTO sync_change_log (account_id, resource, record_id, action, changed_at)
                SELECT OLD.recipient, 'accessible_flashcard_review_sets', OLD.review_set, 'delete', {$modifiedAt}
                WHERE OLD.recipient <> ''
                  AND (OLD.recipient <> NEW.recipient OR OLD.review_set <> NEW.review_set);
                INSERT INTO sync_change_log (account_id, resource, record_id, action, changed_at)
                SELECT OLD.recipient, 'review_set_cards', OLD.review_set || ':' || cards.id, 'delete', {$modifiedAt}
                FROM flashcards AS cards
                JOIN flashcard_review_sets AS sets ON sets.id = OLD.review_set
                WHERE OLD.recipient <> ''
                  AND (OLD.recipient <> NEW.recipient OR OLD.review_set <> NEW.review_set)
                  AND cards.owner = sets.owner;
                INSERT INTO sync_change_log (account_id, resource, record_id, action, changed_at)
                SELECT NEW.recipient, 'accessible_flashcard_review_sets', NEW.review_set, 'upsert', {$modifiedAt}
                WHERE NEW.recipient <> '';
                INSERT INTO sync_change_log (account_id, resource, record_id, action, changed_at)
                SELECT NEW.recipient, 'review_set_cards', NEW.review_set || ':' || cards.id, 'upsert', {$modifiedAt}
                FROM flashcards AS cards
                JOIN flashcard_review_sets AS sets ON sets.id = NEW.review_set
                WHERE NEW.recipient <> ''
                  AND cards.owner = sets.owner
                  AND (
                    json_array_length(sets.tags) = 0
                    OR EXISTS (
                        SELECT 1 FROM json_each(sets.tags) AS wanted
                        JOIN json_each(cards.tags) AS assigned ON assigned.value = wanted.value
                    )
                  );
            END;

            CREATE TRIGGER sync_review_set_share_delete AFTER DELETE ON flashcard_review_set_shares BEGIN
                INSERT INTO sync_change_log (account_id, resource, record_id, action, changed_at)
                SELECT sets.owner, 'flashcard_review_set_shares', OLD.id, 'delete', {$modifiedAt}
                FROM flashcard_review_sets AS sets WHERE sets.id = OLD.review_set;
                INSERT INTO sync_change_log (account_id, resource, record_id, action, changed_at)
                SELECT OLD.recipient, 'accessible_flashcard_review_sets', OLD.review_set, 'delete', {$modifiedAt}
                WHERE OLD.recipient <> '';
                INSERT INTO sync_change_log (account_id, resource, record_id, action, changed_at)
                SELECT OLD.recipient, 'review_set_cards', OLD.review_set || ':' || cards.id, 'delete', {$modifiedAt}
                FROM flashcards AS cards
                JOIN flashcard_review_sets AS sets ON sets.id = OLD.review_set
                WHERE OLD.recipient <> '' AND cards.owner = sets.owner;
            END;

            INSERT INTO sync_change_log (account_id, resource, record_id, action, changed_at)
            SELECT shares.recipient, 'review_set_cards', sets.id || ':' || cards.id, 'upsert', {$modifiedAt}
            FROM flashcard_review_set_shares AS shares
            JOIN flashcard_review_sets AS sets ON sets.id = shares.review_set
            JOIN flashcards AS cards ON cards.owner = sets.owner
            WHERE shares.recipient <> ''
              AND (
                json_array_length(sets.tags) = 0
                OR EXISTS (
                    SELECT 1 FROM json_each(sets.tags) AS wanted
                    JOIN json_each(cards.tags) AS assigned ON assigned.value = wanted.value
                )
              );",
        );
    },
];
