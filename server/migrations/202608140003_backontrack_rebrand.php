<?php

declare(strict_types=1);

return [
    'version' => '202608140003',
    'name' => 'backontrack_rebrand',
    'up' => static function (\PDO $pdo): void {
        $previousBrand = implode('', ['poly', 'mind']);
        $tables = $pdo
            ->query("SELECT name FROM sqlite_schema WHERE type = 'table'")
            ->fetchAll(\PDO::FETCH_COLUMN);
        $tableNames = array_fill_keys(array_map('strval', $tables), true);
        $tableSuffixes = [
            'rate_limits',
            'auth_tokens',
            'passkey_challenges',
            'passkeys',
        ];

        foreach ($tableSuffixes as $suffix) {
            $previousTable = $previousBrand . '_' . $suffix;
            $newTable = 'backontrack_' . $suffix;
            if (isset($tableNames[$previousTable]) && !isset($tableNames[$newTable])) {
                $pdo->exec("ALTER TABLE {$previousTable} RENAME TO {$newTable}");
            }
        }

        foreach (['auth_tokens_expiry', 'passkey_challenges_expiry', 'passkeys_user'] as $suffix) {
            $pdo->exec('DROP INDEX IF EXISTS idx_' . $previousBrand . '_' . $suffix);
        }

        $pdo->exec(<<<'SQL'
            CREATE INDEX IF NOT EXISTS idx_backontrack_auth_tokens_expiry
                ON backontrack_auth_tokens (expires_at);
            CREATE INDEX IF NOT EXISTS idx_backontrack_passkey_challenges_expiry
                ON backontrack_passkey_challenges (expires_at);
            CREATE INDEX IF NOT EXISTS idx_backontrack_passkeys_user
                ON backontrack_passkeys (user_id);
            SQL);

        if (isset($tableNames['image_sources'], $tableNames['image_concept_terms'])) {
            $sourceRenames = [
                'prepositions-1' => [
                    'name' => 'BackOnTrack common English preposition supplement',
                    'attribution' => 'Curated for the BackOnTrack image concept catalog.',
                ],
                'on-demand-searches-1' => [
                    'name' => 'BackOnTrack on-demand image searches',
                    'attribution' => null,
                ],
            ];
            foreach ($sourceRenames as $suffix => $details) {
                $previousId = $previousBrand . '-' . $suffix;
                $newId = 'backontrack-' . $suffix;
                $insertSource = $pdo->prepare(
                    'INSERT OR IGNORE INTO image_sources (
                        id, name, language, source_url, license_name, license_url, attribution
                     )
                     SELECT :new_id, :name, language, source_url, license_name, license_url,
                            COALESCE(:attribution, attribution)
                     FROM image_sources
                     WHERE id = :previous_id',
                );
                $insertSource->execute([
                    'new_id' => $newId,
                    'name' => $details['name'],
                    'attribution' => $details['attribution'],
                    'previous_id' => $previousId,
                ]);
                $updateTerms = $pdo->prepare(
                    'UPDATE image_concept_terms SET source_id = :new_id WHERE source_id = :previous_id',
                );
                $updateTerms->execute(['new_id' => $newId, 'previous_id' => $previousId]);
                $deleteSource = $pdo->prepare('DELETE FROM image_sources WHERE id = :previous_id');
                $deleteSource->execute(['previous_id' => $previousId]);
            }
        }

        if (isset($tableNames['image_concepts'])) {
            $previousSourceKeyPrefix = $previousBrand . ':preposition:';
            $updateSourceKeys = $pdo->prepare(
                "UPDATE image_concepts
                 SET source_key = 'backontrack:preposition:' || substr(source_key, :start)
                 WHERE source_key LIKE :pattern",
            );
            $updateSourceKeys->execute([
                'start' => strlen($previousSourceKeyPrefix) + 1,
                'pattern' => $previousSourceKeyPrefix . '%',
            ]);
        }

        $contentRenames = [
            $previousBrand => 'backontrack',
            ucfirst($previousBrand) => 'BackOnTrack',
            strtoupper($previousBrand) => 'BACKONTRACK',
        ];
        foreach ($tableNames as $table => $_present) {
            if (str_starts_with($table, 'sqlite_')) {
                continue;
            }
            $quotedTable = '"' . str_replace('"', '""', $table) . '"';
            $columns = $pdo->query("PRAGMA table_info({$quotedTable})")->fetchAll();
            foreach ($columns as $column) {
                $type = strtoupper((string) ($column['type'] ?? ''));
                if (
                    $type !== ''
                    && !str_contains($type, 'CHAR')
                    && !str_contains($type, 'TEXT')
                    && !str_contains($type, 'JSON')
                ) {
                    continue;
                }
                $columnName = (string) $column['name'];
                $quotedColumn = '"' . str_replace('"', '""', $columnName) . '"';
                $replaceContent = $pdo->prepare(
                    "UPDATE {$quotedTable}
                     SET {$quotedColumn} = replace({$quotedColumn}, :previous, :replacement)
                     WHERE instr({$quotedColumn}, :previous) > 0",
                );
                foreach ($contentRenames as $previous => $replacement) {
                    $replaceContent->execute([
                        'previous' => $previous,
                        'replacement' => $replacement,
                    ]);
                }
            }
        }

        $renameMigration = $pdo->prepare(
            'UPDATE backontrack_schema_migrations
             SET name = :name
             WHERE version = :version',
        );
        $renameMigration->execute([
            'name' => 'backontrack_rebrand',
            'version' => '202608120002',
        ]);

        $pdo->exec('ANALYZE');
    },
];
