<?php

declare(strict_types=1);

namespace Polymind\Api;

use JsonException;
use PDO;
use RuntimeException;
use Throwable;

final class ImageConceptSeeder
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    /**
     * @return array{concepts: int, terms: int, sources: int, reset: int}
     */
    public function seed(string $path): array
    {
        $stream = fopen($path, 'rb');
        if ($stream === false) {
            throw new RuntimeException('The image concept seed could not be opened.');
        }

        $transactionOpen = false;
        try {
            $metadata = $this->readLine($stream, 1);
            if (($metadata['type'] ?? null) !== 'metadata' || !is_array($metadata['sources'] ?? null)) {
                throw new RuntimeException('The image concept seed metadata is invalid.');
            }

            $this->pdo->exec('BEGIN IMMEDIATE');
            $transactionOpen = true;
            $sourceCount = $this->upsertSources($metadata['sources']);
            $this->pdo->exec('UPDATE image_concepts SET active = FALSE');

            $find = $this->pdo->prepare(
                'SELECT id, search_query FROM image_concepts WHERE source_key = :source_key',
            );
            $insert = $this->pdo->prepare(
                'INSERT INTO image_concepts (
                    source_key, canonical_name, part_of_speech, semantic_category,
                    definition, search_query, search_text, active
                 ) VALUES (
                    :source_key, :canonical_name, :part_of_speech, :semantic_category,
                    :definition, :search_query, :search_text, TRUE
                 )',
            );
            $update = $this->pdo->prepare(<<<'SQL'
                UPDATE image_concepts
                 SET canonical_name = :canonical_name,
                     part_of_speech = :part_of_speech,
                     semantic_category = :semantic_category,
                     definition = :definition,
                     search_query = :search_query,
                     search_text = :search_text,
                     active = TRUE,
                     pexels_searched = CASE
                         WHEN search_query = :search_query THEN pexels_searched ELSE FALSE END,
                     pexels_searched_at = CASE
                         WHEN search_query = :search_query THEN pexels_searched_at ELSE '' END,
                     pexels_result_count = CASE
                         WHEN search_query = :search_query THEN pexels_result_count ELSE 0 END,
                     last_search_error = CASE
                         WHEN search_query = :search_query THEN last_search_error ELSE '' END
                 WHERE id = :id
                SQL);
            $deleteTerms = $this->pdo->prepare(
                'DELETE FROM image_concept_terms WHERE concept_id = :concept_id',
            );
            $insertTerm = $this->pdo->prepare(
                'INSERT OR IGNORE INTO image_concept_terms (
                    concept_id, language, term, source_id
                 ) VALUES (
                    :concept_id, :language, :term, :source_id
                 )',
            );

            $conceptCount = 0;
            $termCount = 0;
            $resetCount = 0;
            $lineNumber = 1;
            while (($line = fgets($stream)) !== false) {
                $lineNumber++;
                if (trim($line) === '') {
                    continue;
                }
                $concept = $this->decodeLine($line, $lineNumber);
                $values = $this->validateConcept($concept, $lineNumber);
                $terms = $values['terms'];
                unset($values['terms']);
                $searchText = implode("\n", array_values(array_unique([
                    $values['canonical_name'],
                    $values['search_query'],
                    ...array_column($terms, 'term'),
                ])));
                $values['search_text'] = $searchText;

                $find->execute(['source_key' => $values['source_key']]);
                $existing = $find->fetch();
                if (is_array($existing)) {
                    $values['id'] = (int) $existing['id'];
                    if (!hash_equals((string) $existing['search_query'], $values['search_query'])) {
                        $resetCount++;
                    }
                    $update->execute($values);
                    $conceptId = (int) $existing['id'];
                } else {
                    $insert->execute($values);
                    $conceptId = (int) $this->pdo->lastInsertId();
                }

                $deleteTerms->execute(['concept_id' => $conceptId]);
                foreach ($terms as $term) {
                    $insertTerm->execute([
                        'concept_id' => $conceptId,
                        'language' => $term['language'],
                        'term' => $term['term'],
                        'source_id' => $term['source_id'],
                    ]);
                    $termCount += $insertTerm->rowCount();
                }
                $conceptCount++;
            }
            if (!feof($stream)) {
                throw new RuntimeException('The image concept seed could not be read completely.');
            }

            $this->pdo->exec('COMMIT');
            $transactionOpen = false;
            return [
                'concepts' => $conceptCount,
                'terms' => $termCount,
                'sources' => $sourceCount,
                'reset' => $resetCount,
            ];
        } catch (Throwable $exception) {
            if ($transactionOpen) {
                $this->pdo->exec('ROLLBACK');
            }
            throw $exception;
        } finally {
            fclose($stream);
        }
    }

    private function upsertSources(array $sources): int
    {
        $statement = $this->pdo->prepare(
            'INSERT INTO image_sources (
                id, name, language, source_url, license_name, license_url, attribution
             ) VALUES (
                :id, :name, :language, :source_url, :license_name, :license_url, :attribution
             ) ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                language = excluded.language,
                source_url = excluded.source_url,
                license_name = excluded.license_name,
                license_url = excluded.license_url,
                attribution = excluded.attribution',
        );
        $count = 0;
        foreach ($sources as $id => $source) {
            if (!is_string($id) || !is_array($source)) {
                throw new RuntimeException('The image concept source metadata is invalid.');
            }
            $statement->execute([
                'id' => $id,
                'name' => $this->requiredString($source['name'] ?? null, 'source name'),
                'language' => $this->optionalString($source['language'] ?? ''),
                'source_url' => $this->optionalString($source['source_url'] ?? ''),
                'license_name' => $this->optionalString($source['license_name'] ?? ''),
                'license_url' => $this->optionalString($source['license_url'] ?? ''),
                'attribution' => $this->optionalString($source['attribution'] ?? ''),
            ]);
            $count++;
        }
        return $count;
    }

    private function validateConcept(array $concept, int $lineNumber): array
    {
        $partOfSpeech = $this->requiredString($concept['part_of_speech'] ?? null, 'part of speech');
        if (!in_array($partOfSpeech, ['noun', 'verb', 'adjective', 'adverb', 'preposition'], true)) {
            throw new RuntimeException("The image concept on line {$lineNumber} has an invalid part of speech.");
        }
        if (!is_array($concept['terms'] ?? null) || $concept['terms'] === []) {
            throw new RuntimeException("The image concept on line {$lineNumber} has no searchable terms.");
        }
        $terms = [];
        foreach ($concept['terms'] as $term) {
            if (!is_array($term)) {
                throw new RuntimeException("The image concept on line {$lineNumber} has an invalid term.");
            }
            $terms[] = [
                'language' => $this->requiredString($term['language'] ?? null, 'term language'),
                'term' => $this->requiredString($term['term'] ?? null, 'term'),
                'source_id' => $this->requiredString($term['source_id'] ?? null, 'term source'),
            ];
        }
        return [
            'source_key' => $this->requiredString($concept['source_key'] ?? null, 'source key'),
            'canonical_name' => $this->requiredString($concept['canonical_name'] ?? null, 'canonical name'),
            'part_of_speech' => $partOfSpeech,
            'semantic_category' => $this->optionalString($concept['semantic_category'] ?? ''),
            'definition' => $this->optionalString($concept['definition'] ?? ''),
            'search_query' => $this->requiredString($concept['search_query'] ?? null, 'search query'),
            'terms' => $terms,
        ];
    }

    /** @return array<string, mixed> */
    private function readLine(mixed $stream, int $lineNumber): array
    {
        $line = fgets($stream);
        if ($line === false) {
            throw new RuntimeException('The image concept seed is empty.');
        }
        return $this->decodeLine($line, $lineNumber);
    }

    /** @return array<string, mixed> */
    private function decodeLine(string $line, int $lineNumber): array
    {
        try {
            $decoded = json_decode($line, true, flags: JSON_THROW_ON_ERROR);
        } catch (JsonException $exception) {
            throw new RuntimeException(
                "The image concept seed contains invalid JSON on line {$lineNumber}.",
                previous: $exception,
            );
        }
        if (!is_array($decoded) || array_is_list($decoded)) {
            throw new RuntimeException("The image concept seed line {$lineNumber} is invalid.");
        }
        return $decoded;
    }

    private function requiredString(mixed $value, string $label): string
    {
        $result = $this->optionalString($value);
        if ($result === '') {
            throw new RuntimeException("The image concept {$label} is required.");
        }
        return $result;
    }

    private function optionalString(mixed $value): string
    {
        if (!is_string($value)) {
            throw new RuntimeException('The image concept seed contains a non-text value.');
        }
        return trim(preg_replace('/\s+/u', ' ', $value) ?? $value);
    }
}
