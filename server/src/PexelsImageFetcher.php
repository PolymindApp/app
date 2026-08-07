<?php

declare(strict_types=1);

namespace Mom\Api;

use JsonException;
use PDO;
use RuntimeException;
use Throwable;

final class PexelsImageFetcher
{
    private const API_URL = 'https://api.pexels.com/v1/search';
    private const MAX_DOWNLOAD_BYTES = 10000000;
    private const IMAGE_SIZE = 256;

    private readonly string $imageDirectory;
    private readonly string $apiUrl;
    private readonly array $allowedImageHosts;

    public function __construct(
        private readonly PDO $pdo,
        private readonly string $apiKey,
        string $databasePath,
        ?string $apiUrl = null,
    ) {
        if ($apiKey === '') {
            throw new RuntimeException('MOM_PEXELS_API_KEY is required.');
        }
        $this->imageDirectory = dirname($databasePath) . DIRECTORY_SEPARATOR . 'flashcard-images';
        $this->apiUrl = $apiUrl ?: self::API_URL;
        $apiHost = strtolower((string) parse_url($this->apiUrl, PHP_URL_HOST));
        $this->allowedImageHosts = array_values(array_unique(array_filter([
            'images.pexels.com',
            $apiHost,
        ])));
    }

    /**
     * @param null|callable(string): void $progress
     * @return array<string, int|string|bool|null>
     */
    public function fetch(int $limit = 100, ?callable $progress = null): array
    {
        if ($limit < 0 || $limit > 10000) {
            throw new RuntimeException('The fetch limit must be between 0 and 10000.');
        }
        $sql = 'SELECT id, canonical_name, search_query
                FROM image_concepts
                WHERE active = TRUE AND pexels_searched = FALSE
                ORDER BY id';
        if ($limit > 0) {
            $sql .= ' LIMIT :limit';
        }
        $statement = $this->pdo->prepare($sql);
        if ($limit > 0) {
            $statement->bindValue(':limit', $limit, PDO::PARAM_INT);
        }
        $statement->execute();
        return $this->fetchConceptRows($statement->fetchAll(), $progress);
    }

    /**
     * @param null|callable(string): void $progress
     * @return array<string, int|string|bool|null>
     */
    public function fetchConcept(int $conceptId, ?callable $progress = null): array
    {
        if ($conceptId < 1) {
            throw new RuntimeException('The image concept id must be positive.');
        }
        $statement = $this->pdo->prepare(
            'SELECT id, canonical_name, search_query
             FROM image_concepts
             WHERE id = :id AND active = TRUE AND pexels_searched = FALSE
             LIMIT 1',
        );
        $statement->execute(['id' => $conceptId]);
        return $this->fetchConceptRows($statement->fetchAll(), $progress);
    }

    /**
     * @param list<array<string, mixed>> $concepts
     * @param null|callable(string): void $progress
     * @return array<string, int|string|bool|null>
     */
    private function fetchConceptRows(array $concepts, ?callable $progress): array
    {
        $summary = [
            'selected_concepts' => count($concepts),
            'searched_concepts' => 0,
            'new_assets' => 0,
            'reused_assets' => 0,
            'skipped_results' => 0,
            'remaining_quota' => null,
            'quota_reset' => null,
            'stopped' => false,
            'stop_reason' => '',
        ];
        foreach ($concepts as $position => $concept) {
            if ($progress !== null) {
                $progress(sprintf(
                    '[%d/%d] Searching Pexels for “%s”…',
                    $position + 1,
                    count($concepts),
                    (string) $concept['canonical_name'],
                ));
            }
            try {
                $response = $this->search((string) $concept['search_query']);
                $photos = $response['photos'];
                $processed = [];
                $skipped = 0;
                foreach ($photos as $rank => $photo) {
                    try {
                        $processed[] = $this->preparePhoto($photo, $rank + 1);
                    } catch (Throwable $exception) {
                        $skipped++;
                        if ($progress !== null) {
                            $progress('  Skipped result ' . ($rank + 1) . ': ' . $exception->getMessage());
                        }
                    }
                }
                if ($photos !== [] && $processed === []) {
                    throw new RuntimeException('Pexels returned photos, but none could be stored.');
                }

                $stored = $this->storeConceptResults(
                    (int) $concept['id'],
                    count($photos),
                    $processed,
                    $skipped,
                );
                $summary['searched_concepts']++;
                $summary['new_assets'] += $stored['new'];
                $summary['reused_assets'] += $stored['reused'];
                $summary['skipped_results'] += $skipped;
                $summary['remaining_quota'] = $response['remaining_quota'];
                $summary['quota_reset'] = $response['quota_reset'];
                if ($progress !== null) {
                    $progress(sprintf(
                        '  Stored %d result%s%s.',
                        count($processed),
                        count($processed) === 1 ? '' : 's',
                        $skipped > 0 ? "; skipped {$skipped}" : '',
                    ));
                }
                if ($response['remaining_quota'] === 0) {
                    $summary['stopped'] = true;
                    $summary['stop_reason'] = 'Pexels request quota exhausted.';
                    break;
                }
            } catch (Throwable $exception) {
                $this->recordSearchError((int) $concept['id'], $exception->getMessage());
                $summary['stopped'] = true;
                $summary['stop_reason'] = $exception->getMessage();
                break;
            }
        }
        $summary['pending_concepts'] = (int) $this->pdo->query(
            'SELECT COUNT(*) FROM image_concepts WHERE active = TRUE AND pexels_searched = FALSE',
        )->fetchColumn();
        return $summary;
    }

    /** @return array{photos: list<array<string, mixed>>, remaining_quota: ?int, quota_reset: ?int} */
    private function search(string $query): array
    {
        $url = $this->apiUrl . '?' . http_build_query([
            'query' => $query,
            'orientation' => 'square',
            'locale' => 'en-US',
            'page' => 1,
            'per_page' => 30,
        ], '', '&', PHP_QUERY_RFC3986);
        $headers = [];
        $curl = curl_init($url);
        if ($curl === false) {
            throw new RuntimeException('The Pexels request could not be initialized.');
        }
        curl_setopt_array($curl, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => [
                'Accept: application/json',
                'Authorization: ' . $this->apiKey,
            ],
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_TIMEOUT => 30,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_USERAGENT => 'Mom flashcard image library',
            CURLOPT_HEADERFUNCTION => static function ($curl, string $line) use (&$headers): int {
                $separator = strpos($line, ':');
                if ($separator !== false) {
                    $headers[strtolower(trim(substr($line, 0, $separator)))] = trim(substr($line, $separator + 1));
                }
                return strlen($line);
            },
        ]);
        try {
            $body = curl_exec($curl);
            if (!is_string($body)) {
                throw new RuntimeException('The Pexels request failed: ' . curl_error($curl));
            }
            $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        } finally {
            curl_close($curl);
        }
        if ($status === 401 || $status === 403) {
            throw new RuntimeException('Pexels rejected the configured API key.');
        }
        if ($status === 429) {
            throw new RuntimeException('Pexels request quota exhausted.');
        }
        if ($status < 200 || $status >= 300) {
            throw new RuntimeException("Pexels search failed with HTTP {$status}.");
        }
        try {
            $decoded = json_decode($body, true, flags: JSON_THROW_ON_ERROR);
        } catch (JsonException $exception) {
            throw new RuntimeException('Pexels returned invalid JSON.', previous: $exception);
        }
        if (!is_array($decoded) || !is_array($decoded['photos'] ?? null)) {
            throw new RuntimeException('Pexels returned an invalid photo search response.');
        }
        $photos = array_values(array_filter(
            array_slice($decoded['photos'], 0, 30),
            'is_array',
        ));
        return [
            'photos' => $photos,
            'remaining_quota' => isset($headers['x-ratelimit-remaining'])
                ? max(0, (int) $headers['x-ratelimit-remaining'])
                : null,
            'quota_reset' => isset($headers['x-ratelimit-reset'])
                ? (int) $headers['x-ratelimit-reset']
                : null,
        ];
    }

    /** @return array<string, mixed> */
    private function preparePhoto(array $photo, int $rank): array
    {
        $providerId = $this->scalarString($photo['id'] ?? null);
        $sourceUrl = $this->httpsUrl($photo['url'] ?? null, ['www.pexels.com'], 'photo page');
        $downloadUrl = $this->httpsUrl(
            is_array($photo['src'] ?? null) ? ($photo['src']['medium'] ?? null) : null,
            $this->allowedImageHosts,
            'photo download',
            $this->apiUrl !== self::API_URL,
        );
        $photographerUrl = $this->optionalHttpsUrl(
            $photo['photographer_url'] ?? '',
            ['www.pexels.com'],
        );
        $rawPhotographerId = $photo['photographer_id'] ?? '';
        $photographerId = is_string($rawPhotographerId) || is_int($rawPhotographerId)
            ? mb_substr(trim((string) $rawPhotographerId), 0, 100)
            : '';
        $existing = $this->assetByProviderId($providerId);
        if (
            is_array($existing)
            && preg_match('/^[a-f0-9]{48}\.jpg$/', (string) $existing['filename']) === 1
            && is_file($this->imageDirectory . DIRECTORY_SEPARATOR . $existing['filename'])
        ) {
            $file = [
                'filename' => (string) $existing['filename'],
                'content_sha256' => (string) $existing['content_sha256'],
                'created' => false,
            ];
        } else {
            $file = $this->downloadAndStore($downloadUrl);
        }
        return [
            'provider_id' => $providerId,
            'filename' => $file['filename'],
            'content_sha256' => $file['content_sha256'],
            'file_created' => $file['created'],
            'source_url' => $sourceUrl,
            'download_url' => $downloadUrl,
            'photographer' => $this->optionalString($photo['photographer'] ?? ''),
            'photographer_url' => $photographerUrl,
            'photographer_id' => $photographerId,
            'alt' => $this->optionalString($photo['alt'] ?? ''),
            'source_width' => max(0, (int) ($photo['width'] ?? 0)),
            'source_height' => max(0, (int) ($photo['height'] ?? 0)),
            'average_color' => preg_match('/^#[0-9a-f]{6}$/i', (string) ($photo['avg_color'] ?? '')) === 1
                ? strtoupper((string) $photo['avg_color'])
                : '',
            'rank' => $rank,
        ];
    }

    /** @return array{filename: string, content_sha256: string, created: bool} */
    private function downloadAndStore(string $url): array
    {
        $curl = curl_init($url);
        if ($curl === false) {
            throw new RuntimeException('The image download could not be initialized.');
        }
        curl_setopt_array($curl, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_TIMEOUT => 30,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_MAXFILESIZE => self::MAX_DOWNLOAD_BYTES,
            CURLOPT_HTTPHEADER => ['Accept: image/*'],
            CURLOPT_USERAGENT => 'Mom flashcard image library',
        ]);
        try {
            $bytes = curl_exec($curl);
            if (!is_string($bytes)) {
                throw new RuntimeException('The image download failed: ' . curl_error($curl));
            }
            $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
            $contentType = strtolower((string) curl_getinfo($curl, CURLINFO_CONTENT_TYPE));
        } finally {
            curl_close($curl);
        }
        if ($status < 200 || $status >= 300) {
            throw new RuntimeException("The image download failed with HTTP {$status}.");
        }
        if (strlen($bytes) < 100 || strlen($bytes) > self::MAX_DOWNLOAD_BYTES) {
            throw new RuntimeException('The downloaded image has an invalid size.');
        }
        if ($contentType !== '' && !str_starts_with($contentType, 'image/')) {
            throw new RuntimeException('The downloaded response is not an image.');
        }
        $jpeg = $this->squareJpeg($bytes);
        $hash = hash('sha256', $jpeg);
        $filename = substr($hash, 0, 48) . '.jpg';
        $this->ensureImageDirectory();
        $destination = $this->imageDirectory . DIRECTORY_SEPARATOR . $filename;
        if (is_file($destination)) {
            return ['filename' => $filename, 'content_sha256' => $hash, 'created' => false];
        }
        $temporary = tempnam($this->imageDirectory, '.pexels-');
        if ($temporary === false) {
            throw new RuntimeException('A temporary cached image could not be created.');
        }
        try {
            $written = file_put_contents($temporary, $jpeg, LOCK_EX);
            if ($written !== strlen($jpeg)) {
                throw new RuntimeException('The cached image could not be written.');
            }
            chmod($temporary, 0600);
            if (!rename($temporary, $destination)) {
                if (!is_file($destination)) {
                    throw new RuntimeException('The cached image could not be finalized.');
                }
                unlink($temporary);
            }
            $temporary = '';
        } finally {
            if ($temporary !== '' && is_file($temporary)) {
                unlink($temporary);
            }
        }
        return ['filename' => $filename, 'content_sha256' => $hash, 'created' => true];
    }

    private function squareJpeg(string $bytes): string
    {
        $details = @getimagesizefromstring($bytes);
        $source = @imagecreatefromstring($bytes);
        if (!is_array($details) || $source === false || $details[0] < 1 || $details[1] < 1) {
            throw new RuntimeException('The downloaded image data is invalid.');
        }
        $size = min((int) $details[0], (int) $details[1]);
        $sourceX = (int) floor(((int) $details[0] - $size) / 2);
        $sourceY = (int) floor(((int) $details[1] - $size) / 2);
        $target = imagecreatetruecolor(self::IMAGE_SIZE, self::IMAGE_SIZE);
        if ($target === false) {
            imagedestroy($source);
            throw new RuntimeException('The cached image canvas could not be created.');
        }
        imagefill($target, 0, 0, imagecolorallocate($target, 255, 255, 255));
        imagecopyresampled(
            $target,
            $source,
            0,
            0,
            $sourceX,
            $sourceY,
            self::IMAGE_SIZE,
            self::IMAGE_SIZE,
            $size,
            $size,
        );
        ob_start();
        $encoded = imagejpeg($target, null, 86);
        $jpeg = ob_get_clean();
        imagedestroy($target);
        imagedestroy($source);
        if (!$encoded || !is_string($jpeg) || strlen($jpeg) < 100) {
            throw new RuntimeException('The cached image could not be encoded.');
        }
        return $jpeg;
    }

    /**
     * @param list<array<string, mixed>> $photos
     * @return array{new: int, reused: int}
     */
    private function storeConceptResults(int $conceptId, int $resultCount, array $photos, int $skipped): array
    {
        $createdFiles = array_values(array_unique(array_map(
            static fn (array $photo): string => $photo['file_created'] ? $photo['filename'] : '',
            $photos,
        )));
        $createdFiles = array_values(array_filter($createdFiles));
        $transactionOpen = false;
        try {
            $this->pdo->exec('BEGIN IMMEDIATE');
            $transactionOpen = true;
            $clearLinks = $this->pdo->prepare(
                'DELETE FROM image_concept_assets WHERE concept_id = :concept_id',
            );
            $clearLinks->execute(['concept_id' => $conceptId]);
            $upsert = $this->pdo->prepare(<<<'SQL'
                INSERT INTO image_assets (
                    provider, provider_id, filename, content_sha256, source_url,
                    download_url, photographer, photographer_url, photographer_id,
                    alt, source_width, source_height, average_color,
                    license_name, license_url, fetched_at
                 ) VALUES (
                    'pexels', :provider_id, :filename, :content_sha256, :source_url,
                    :download_url, :photographer, :photographer_url, :photographer_id,
                    :alt, :source_width, :source_height, :average_color,
                    'Pexels License', 'https://www.pexels.com/license/', :fetched_at
                 ) ON CONFLICT(provider, provider_id) DO UPDATE SET
                    filename = excluded.filename,
                    content_sha256 = excluded.content_sha256,
                    source_url = excluded.source_url,
                    download_url = excluded.download_url,
                    photographer = excluded.photographer,
                    photographer_url = excluded.photographer_url,
                    photographer_id = excluded.photographer_id,
                    alt = excluded.alt,
                    source_width = excluded.source_width,
                    source_height = excluded.source_height,
                    average_color = excluded.average_color,
                    license_name = excluded.license_name,
                    license_url = excluded.license_url,
                    fetched_at = excluded.fetched_at
                SQL);
            $find = $this->pdo->prepare(
                "SELECT id FROM image_assets WHERE provider = 'pexels' AND provider_id = :provider_id",
            );
            $link = $this->pdo->prepare(
                'INSERT INTO image_concept_assets (concept_id, image_id, result_rank, linked_at)
                 VALUES (:concept_id, :image_id, :result_rank, :linked_at)
                 ON CONFLICT(concept_id, image_id) DO UPDATE SET
                    result_rank = excluded.result_rank,
                    linked_at = excluded.linked_at',
            );
            $new = 0;
            $reused = 0;
            $now = gmdate('Y-m-d\TH:i:s\Z');
            foreach ($photos as $photo) {
                $existing = $this->assetByProviderId((string) $photo['provider_id']);
                $parameters = $photo;
                unset($parameters['rank'], $parameters['file_created']);
                $parameters['fetched_at'] = $now;
                $upsert->execute($parameters);
                $find->execute(['provider_id' => $photo['provider_id']]);
                $imageId = (int) $find->fetchColumn();
                $link->execute([
                    'concept_id' => $conceptId,
                    'image_id' => $imageId,
                    'result_rank' => $photo['rank'],
                    'linked_at' => $now,
                ]);
                if (is_array($existing)) {
                    $reused++;
                } else {
                    $new++;
                }
            }
            $complete = $this->pdo->prepare(
                'UPDATE image_concepts
                 SET pexels_searched = TRUE,
                     pexels_searched_at = :searched_at,
                     pexels_result_count = :result_count,
                     last_search_error = :last_search_error
                 WHERE id = :id',
            );
            $complete->execute([
                'searched_at' => $now,
                'result_count' => $resultCount,
                'last_search_error' => $skipped > 0 ? "Skipped {$skipped} invalid result(s)." : '',
                'id' => $conceptId,
            ]);
            $this->pdo->exec('COMMIT');
            $transactionOpen = false;
            return ['new' => $new, 'reused' => $reused];
        } catch (Throwable $exception) {
            if ($transactionOpen) {
                $this->pdo->exec('ROLLBACK');
            }
            foreach ($createdFiles as $filename) {
                $statement = $this->pdo->prepare(
                    'SELECT COUNT(*) FROM image_assets WHERE filename = :filename',
                );
                $statement->execute(['filename' => $filename]);
                if ((int) $statement->fetchColumn() === 0) {
                    $path = $this->imageDirectory . DIRECTORY_SEPARATOR . $filename;
                    if (is_file($path)) {
                        unlink($path);
                    }
                }
            }
            throw $exception;
        }
    }

    private function recordSearchError(int $conceptId, string $message): void
    {
        $statement = $this->pdo->prepare(
            'UPDATE image_concepts SET last_search_error = :message WHERE id = :id',
        );
        $statement->execute([
            'message' => mb_substr($message, 0, 500),
            'id' => $conceptId,
        ]);
    }

    private function assetByProviderId(string $providerId): array|false
    {
        $statement = $this->pdo->prepare(
            "SELECT * FROM image_assets WHERE provider = 'pexels' AND provider_id = :provider_id",
        );
        $statement->execute(['provider_id' => $providerId]);
        return $statement->fetch();
    }

    private function ensureImageDirectory(): void
    {
        if (
            !is_dir($this->imageDirectory)
            && !mkdir($this->imageDirectory, 0700, true)
            && !is_dir($this->imageDirectory)
        ) {
            throw new RuntimeException('The private flashcard image directory could not be created.');
        }
        if (!is_writable($this->imageDirectory)) {
            throw new RuntimeException('The private flashcard image directory is not writable.');
        }
    }

    private function httpsUrl(mixed $value, array $hosts, string $label, bool $allowHttp = false): string
    {
        if (!is_string($value) || filter_var($value, FILTER_VALIDATE_URL) === false) {
            throw new RuntimeException("The Pexels {$label} URL is invalid.");
        }
        $parts = parse_url($value);
        $scheme = strtolower((string) ($parts['scheme'] ?? ''));
        $host = strtolower((string) ($parts['host'] ?? ''));
        if (
            !is_array($parts)
            || (!($allowHttp && $scheme === 'http') && $scheme !== 'https')
            || !in_array($host, $hosts, true)
            || isset($parts['user'])
            || isset($parts['pass'])
        ) {
            throw new RuntimeException("The Pexels {$label} URL is not allowed.");
        }
        return $value;
    }

    private function optionalHttpsUrl(mixed $value, array $hosts): string
    {
        if ($value === '' || $value === null) {
            return '';
        }
        return $this->httpsUrl($value, $hosts, 'photographer profile');
    }

    private function scalarString(mixed $value): string
    {
        if (!is_string($value) && !is_int($value)) {
            throw new RuntimeException('Pexels returned an invalid identifier.');
        }
        $result = trim((string) $value);
        if ($result === '' || strlen($result) > 100) {
            throw new RuntimeException('Pexels returned an invalid identifier.');
        }
        return $result;
    }

    private function optionalString(mixed $value): string
    {
        if (!is_string($value)) {
            return '';
        }
        return mb_substr(trim(preg_replace('/\s+/u', ' ', $value) ?? $value), 0, 2000);
    }
}
