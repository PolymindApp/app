<?php

declare(strict_types=1);

namespace Mom\Api;

use JsonException;
use PDO;
use RuntimeException;

final class OpenAIConnection
{
    private const CIPHER = 'aes-256-gcm';
    private const ENCRYPTION_VERSION = 1;
    private const IV_BYTES = 12;
    private const TAG_BYTES = 16;

    public function __construct(
        private readonly PDO $pdo,
        private readonly string $encryptionSecret,
        private readonly string $apiBaseUrl,
    ) {
    }

    /** @return array{connected: bool, keyHint?: string, updated?: string} */
    public function status(string $userId): array
    {
        $statement = $this->pdo->prepare(
            'SELECT key_hint, updated_at
             FROM mom_openai_connections
             WHERE user_id = :user_id',
        );
        $statement->execute(['user_id' => $userId]);
        $connection = $statement->fetch();
        if (!is_array($connection)) {
            return ['connected' => false];
        }

        return [
            'connected' => true,
            'keyHint' => (string) $connection['key_hint'],
            'updated' => (string) $connection['updated_at'],
        ];
    }

    /** @return array{connected: true, keyHint: string, updated: string} */
    public function connect(string $userId, mixed $value, string $now): array
    {
        $apiKey = $this->validateApiKey($value);
        $this->verifyApiKey($apiKey);
        $keyHint = substr($apiKey, -4);
        $encrypted = $this->encrypt($apiKey, $userId);
        $statement = $this->pdo->prepare(
            'INSERT INTO mom_openai_connections (
                user_id, encrypted_api_key, key_hint, created_at, updated_at
             ) VALUES (
                :user_id, :encrypted_api_key, :key_hint, :created_at, :updated_at
             )
             ON CONFLICT(user_id) DO UPDATE SET
                encrypted_api_key = excluded.encrypted_api_key,
                key_hint = excluded.key_hint,
                updated_at = excluded.updated_at',
        );
        $statement->execute([
            'user_id' => $userId,
            'encrypted_api_key' => $encrypted,
            'key_hint' => $keyHint,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        return [
            'connected' => true,
            'keyHint' => $keyHint,
            'updated' => $now,
        ];
    }

    /** @return array{connected: false, removed: int} */
    public function disconnect(string $userId): array
    {
        $statement = $this->pdo->prepare(
            'DELETE FROM mom_openai_connections WHERE user_id = :user_id',
        );
        $statement->execute(['user_id' => $userId]);

        return [
            'connected' => false,
            'removed' => $statement->rowCount(),
        ];
    }

    public function apiKeyForUser(string $userId): string
    {
        $statement = $this->pdo->prepare(
            'SELECT encrypted_api_key
             FROM mom_openai_connections
             WHERE user_id = :user_id',
        );
        $statement->execute(['user_id' => $userId]);
        $encrypted = $statement->fetchColumn();
        if (!is_string($encrypted) || $encrypted === '') {
            throw new ApiException(409, 'Connect OpenAI in Settings before using an OpenAI command.');
        }

        return $this->decrypt($encrypted, $userId);
    }

    private function validateApiKey(mixed $value): string
    {
        if (!is_string($value)) {
            throw new ApiException(422, 'Enter an OpenAI API key.', ['apiKey' => 'required']);
        }
        $apiKey = trim($value);
        if (
            strlen($apiKey) < 20
            || strlen($apiKey) > 512
            || preg_match('/^sk-[A-Za-z0-9._-]+$/', $apiKey) !== 1
        ) {
            throw new ApiException(422, 'Enter a valid OpenAI API key.', ['apiKey' => 'format']);
        }
        return $apiKey;
    }

    private function verifyApiKey(string $apiKey): void
    {
        $curl = curl_init($this->apiBaseUrl . '/models');
        if ($curl === false) {
            throw new ApiException(502, 'The OpenAI connection could not be initialized.');
        }
        curl_setopt_array($curl, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => [
                'Accept: application/json',
                'Authorization: Bearer ' . $apiKey,
            ],
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_TIMEOUT => 20,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_USERAGENT => 'Polymind OpenAI connection',
        ]);
        try {
            $body = curl_exec($curl);
            if (!is_string($body)) {
                throw new ApiException(502, 'OpenAI could not be reached. Try again shortly.');
            }
            $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        } finally {
            curl_close($curl);
        }

        if ($status === 401) {
            throw new ApiException(422, 'OpenAI rejected this API key.', ['apiKey' => 'invalid']);
        }
        if ($status === 403) {
            throw new ApiException(
                422,
                'This API key does not have the required OpenAI access.',
                ['apiKey' => 'permission'],
            );
        }
        if ($status === 429) {
            throw new ApiException(429, 'OpenAI is rate limiting this API key. Try again shortly.');
        }
        if ($status < 200 || $status >= 300) {
            throw new ApiException(502, 'OpenAI could not verify this API key. Try again shortly.');
        }

        try {
            $decoded = json_decode($body, true, flags: JSON_THROW_ON_ERROR);
        } catch (JsonException $exception) {
            throw new ApiException(502, 'OpenAI returned an invalid verification response.', [], $exception);
        }
        if (!is_array($decoded) || !is_array($decoded['data'] ?? null)) {
            throw new ApiException(502, 'OpenAI returned an invalid verification response.');
        }
    }

    private function encrypt(string $apiKey, string $userId): string
    {
        $iv = random_bytes(self::IV_BYTES);
        $tag = '';
        $ciphertext = openssl_encrypt(
            $apiKey,
            self::CIPHER,
            $this->encryptionKey(),
            OPENSSL_RAW_DATA,
            $iv,
            $tag,
            $userId,
            self::TAG_BYTES,
        );
        if (!is_string($ciphertext) || strlen($tag) !== self::TAG_BYTES) {
            throw new RuntimeException('The OpenAI API key could not be encrypted.');
        }

        return base64_encode(chr(self::ENCRYPTION_VERSION) . $iv . $tag . $ciphertext);
    }

    private function decrypt(string $encrypted, string $userId): string
    {
        $payload = base64_decode($encrypted, true);
        if (
            !is_string($payload)
            || strlen($payload) <= 1 + self::IV_BYTES + self::TAG_BYTES
            || ord($payload[0]) !== self::ENCRYPTION_VERSION
        ) {
            throw new RuntimeException('The stored OpenAI API key is invalid.');
        }
        $iv = substr($payload, 1, self::IV_BYTES);
        $tag = substr($payload, 1 + self::IV_BYTES, self::TAG_BYTES);
        $ciphertext = substr($payload, 1 + self::IV_BYTES + self::TAG_BYTES);
        $apiKey = openssl_decrypt(
            $ciphertext,
            self::CIPHER,
            $this->encryptionKey(),
            OPENSSL_RAW_DATA,
            $iv,
            $tag,
            $userId,
        );
        if (!is_string($apiKey) || $apiKey === '') {
            throw new RuntimeException('The stored OpenAI API key could not be decrypted.');
        }
        return $apiKey;
    }

    private function encryptionKey(): string
    {
        return hash_hkdf('sha256', $this->encryptionSecret, 32, 'mom-openai-api-key-v1');
    }
}
