<?php

declare(strict_types=1);

return [
    'version' => '202608070005',
    'name' => 'image_library',
    'up' => static function (\PDO $pdo): void {
        $columns = $pdo->query(
            'PRAGMA table_info(flashcards)',
        )->fetchAll(\PDO::FETCH_COLUMN, 1);
        if (!in_array('library_image_id', $columns, true)) {
            $pdo->exec(
                'ALTER TABLE flashcards ADD COLUMN library_image_id INTEGER NOT NULL DEFAULT 0',
            );
        }
        if (!in_array('image_metadata', $columns, true)) {
            $pdo->exec(
                "ALTER TABLE flashcards ADD COLUMN image_metadata JSON NOT NULL DEFAULT '{}'",
            );
        }

        $pdo->exec(<<<'SQL'
            CREATE TABLE IF NOT EXISTS image_sources (
                id TEXT PRIMARY KEY NOT NULL,
                name TEXT NOT NULL,
                language VARCHAR(35) NOT NULL DEFAULT '',
                source_url VARCHAR(2048) NOT NULL DEFAULT '',
                license_name TEXT NOT NULL DEFAULT '',
                license_url VARCHAR(2048) NOT NULL DEFAULT '',
                attribution TEXT NOT NULL DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS image_concepts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_key TEXT NOT NULL UNIQUE,
                canonical_name TEXT NOT NULL COLLATE NOCASE,
                part_of_speech TEXT NOT NULL,
                semantic_category TEXT NOT NULL DEFAULT '',
                definition TEXT NOT NULL DEFAULT '',
                search_query TEXT NOT NULL,
                search_text TEXT NOT NULL DEFAULT '',
                active BOOLEAN NOT NULL DEFAULT TRUE,
                pexels_searched BOOLEAN NOT NULL DEFAULT FALSE,
                pexels_searched_at TEXT NOT NULL DEFAULT '',
                pexels_result_count INTEGER NOT NULL DEFAULT 0,
                last_search_error TEXT NOT NULL DEFAULT '',
                CHECK (part_of_speech IN (
                    'noun', 'verb', 'adjective', 'adverb', 'preposition'
                ))
            );
            CREATE INDEX IF NOT EXISTS idx_image_concepts_pending
                ON image_concepts (active, pexels_searched, id);
            CREATE INDEX IF NOT EXISTS idx_image_concepts_name
                ON image_concepts (canonical_name COLLATE NOCASE);

            CREATE TABLE IF NOT EXISTS image_concept_terms (
                concept_id INTEGER NOT NULL,
                language VARCHAR(35) NOT NULL,
                term TEXT NOT NULL,
                source_id TEXT NOT NULL,
                PRIMARY KEY (concept_id, language, term, source_id),
                FOREIGN KEY (concept_id) REFERENCES image_concepts (id) ON DELETE CASCADE,
                FOREIGN KEY (source_id) REFERENCES image_sources (id) ON DELETE RESTRICT
            );
            CREATE INDEX IF NOT EXISTS idx_image_concept_terms_language_term
                ON image_concept_terms (language, term COLLATE NOCASE);

            CREATE TABLE IF NOT EXISTS image_assets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                provider TEXT NOT NULL,
                provider_id TEXT NOT NULL,
                filename VARCHAR(52) NOT NULL,
                content_sha256 VARCHAR(64) NOT NULL,
                source_url VARCHAR(2048) NOT NULL,
                download_url VARCHAR(2048) NOT NULL,
                photographer TEXT NOT NULL DEFAULT '',
                photographer_url VARCHAR(2048) NOT NULL DEFAULT '',
                photographer_id TEXT NOT NULL DEFAULT '',
                alt TEXT NOT NULL DEFAULT '',
                source_width INTEGER NOT NULL DEFAULT 0,
                source_height INTEGER NOT NULL DEFAULT 0,
                average_color VARCHAR(20) NOT NULL DEFAULT '',
                license_name TEXT NOT NULL,
                license_url VARCHAR(2048) NOT NULL,
                fetched_at TEXT NOT NULL,
                UNIQUE (provider, provider_id)
            );
            CREATE INDEX IF NOT EXISTS idx_image_assets_filename
                ON image_assets (filename);
            CREATE INDEX IF NOT EXISTS idx_image_assets_content_hash
                ON image_assets (content_sha256);

            CREATE TABLE IF NOT EXISTS image_concept_assets (
                concept_id INTEGER NOT NULL,
                image_id INTEGER NOT NULL,
                result_rank INTEGER NOT NULL,
                linked_at TEXT NOT NULL,
                PRIMARY KEY (concept_id, image_id),
                FOREIGN KEY (concept_id) REFERENCES image_concepts (id) ON DELETE CASCADE,
                FOREIGN KEY (image_id) REFERENCES image_assets (id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_image_concept_assets_rank
                ON image_concept_assets (concept_id, result_rank, image_id);

            CREATE VIRTUAL TABLE IF NOT EXISTS image_concepts_fts USING fts5(
                canonical_name,
                search_text,
                content = 'image_concepts',
                content_rowid = 'id',
                tokenize = 'unicode61 remove_diacritics 2'
            );

            CREATE TRIGGER IF NOT EXISTS image_concepts_fts_insert
            AFTER INSERT ON image_concepts BEGIN
                INSERT INTO image_concepts_fts(rowid, canonical_name, search_text)
                VALUES (new.id, new.canonical_name, new.search_text);
            END;
            CREATE TRIGGER IF NOT EXISTS image_concepts_fts_delete
            AFTER DELETE ON image_concepts BEGIN
                INSERT INTO image_concepts_fts(
                    image_concepts_fts, rowid, canonical_name, search_text
                ) VALUES (
                    'delete', old.id, old.canonical_name, old.search_text
                );
            END;
            CREATE TRIGGER IF NOT EXISTS image_concepts_fts_update
            AFTER UPDATE OF canonical_name, search_text ON image_concepts BEGIN
                INSERT INTO image_concepts_fts(
                    image_concepts_fts, rowid, canonical_name, search_text
                ) VALUES (
                    'delete', old.id, old.canonical_name, old.search_text
                );
                INSERT INTO image_concepts_fts(rowid, canonical_name, search_text)
                VALUES (new.id, new.canonical_name, new.search_text);
            END;
            SQL);
    },
];
