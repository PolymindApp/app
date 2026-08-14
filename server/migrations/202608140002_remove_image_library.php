<?php

declare(strict_types=1);

return [
    'version' => '202608140002',
    'name' => 'remove_image_library',
    'up' => static function (\PDO $pdo): void {
        $pdo->exec(<<<'SQL'
            DROP TRIGGER IF EXISTS image_concepts_fts_insert;
            DROP TRIGGER IF EXISTS image_concepts_fts_delete;
            DROP TRIGGER IF EXISTS image_concepts_fts_update;
            DROP TABLE IF EXISTS image_concepts_fts;
            DROP TABLE IF EXISTS image_concept_assets;
            DROP TABLE IF EXISTS image_assets;
            DROP TABLE IF EXISTS image_concept_terms;
            DROP TABLE IF EXISTS image_concepts;
            DROP TABLE IF EXISTS image_sources;
            SQL);

        $columns = $pdo->query(
            'PRAGMA table_info(flashcards)',
        )->fetchAll(\PDO::FETCH_COLUMN, 1);
        if (in_array('library_image_id', $columns, true)) {
            $pdo->exec('ALTER TABLE flashcards DROP COLUMN library_image_id');
        }
        if (in_array('image_metadata', $columns, true)) {
            $pdo->exec('ALTER TABLE flashcards DROP COLUMN image_metadata');
        }
    },
];
