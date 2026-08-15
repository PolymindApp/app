<?php

declare(strict_types=1);

return [
    'version' => '202608120002',
    'name' => 'backontrack_rebrand',
    'up' => static function (\PDO $pdo): void {
        $tables = $pdo
            ->query("SELECT name FROM sqlite_schema WHERE type = 'table'")
            ->fetchAll(\PDO::FETCH_COLUMN);
        $tableNames = array_fill_keys(array_map('strval', $tables), true);
        $renames = [
            'mom_rate_limits' => 'backontrack_rate_limits',
            'mom_auth_tokens' => 'backontrack_auth_tokens',
            'mom_passkey_challenges' => 'backontrack_passkey_challenges',
            'mom_passkeys' => 'backontrack_passkeys',
        ];

        foreach ($renames as $legacyTable => $backontrackTable) {
            if (isset($tableNames[$legacyTable]) && !isset($tableNames[$backontrackTable])) {
                $pdo->exec("ALTER TABLE {$legacyTable} RENAME TO {$backontrackTable}");
            }
        }

        $pdo->exec(<<<'SQL'
            DROP INDEX IF EXISTS idx_mom_auth_tokens_expiry;
            DROP INDEX IF EXISTS idx_mom_passkey_challenges_expiry;
            DROP INDEX IF EXISTS idx_mom_passkeys_user;

            CREATE INDEX IF NOT EXISTS idx_backontrack_auth_tokens_expiry
                ON backontrack_auth_tokens (expires_at);
            CREATE INDEX IF NOT EXISTS idx_backontrack_passkey_challenges_expiry
                ON backontrack_passkey_challenges (expires_at);
            CREATE INDEX IF NOT EXISTS idx_backontrack_passkeys_user
                ON backontrack_passkeys (user_id);

            INSERT OR IGNORE INTO image_sources (
                id, name, language, source_url, license_name, license_url, attribution
            )
            SELECT
                'backontrack-prepositions-1',
                'BackOnTrack common English preposition supplement',
                language,
                source_url,
                license_name,
                license_url,
                'Curated for the BackOnTrack image concept catalog.'
            FROM image_sources
            WHERE id = 'mom-prepositions-1';

            INSERT OR IGNORE INTO image_sources (
                id, name, language, source_url, license_name, license_url, attribution
            )
            SELECT
                'backontrack-on-demand-searches-1',
                'BackOnTrack on-demand image searches',
                language,
                source_url,
                license_name,
                license_url,
                attribution
            FROM image_sources
            WHERE id = 'mom-on-demand-searches-1';

            UPDATE image_concept_terms
            SET source_id = 'backontrack-prepositions-1'
            WHERE source_id = 'mom-prepositions-1';

            UPDATE image_concept_terms
            SET source_id = 'backontrack-on-demand-searches-1'
            WHERE source_id = 'mom-on-demand-searches-1';

            DELETE FROM image_sources
            WHERE id IN ('mom-prepositions-1', 'mom-on-demand-searches-1');

            UPDATE image_concepts
            SET source_key = 'backontrack:preposition:' || substr(source_key, 17)
            WHERE source_key LIKE 'mom:preposition:%';
            SQL);
    },
];
