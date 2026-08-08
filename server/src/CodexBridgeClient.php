<?php

declare(strict_types=1);

namespace Mom\Api;

use JsonException;

final class CodexBridgeClient
{
    public function __construct(
        private readonly string $baseUrl,
        private readonly string $token,
        private readonly string $subjectSecret,
    ) {
    }

    /** @return array<string, mixed> */
    public function status(string $userId): array
    {
        if (!$this->available()) {
            return ['available' => false, 'connected' => false];
        }
        return $this->request('GET', $userId);
    }

    /** @return array<string, mixed> */
    public function startLogin(string $userId): array
    {
        if (!$this->available()) {
            throw new ApiException(503, 'ChatGPT sign-in is not configured on this server.');
        }
        return $this->request('POST', $userId);
    }

    /** @return array<string, mixed> */
    public function disconnect(string $userId): array
    {
        if (!$this->available()) {
            return ['available' => false, 'connected' => false];
        }
        return $this->request('DELETE', $userId);
    }

    private function available(): bool
    {
        return $this->baseUrl !== '' && $this->token !== '';
    }

    /** @return array<string, mixed> */
    private function request(string $method, string $userId): array
    {
        $subject = hash_hmac('sha256', $userId, $this->subjectSecret);
        $curl = curl_init($this->baseUrl . '/v1/connections/' . $subject);
        if ($curl === false) {
            throw new ApiException(502, 'The Codex bridge connection could not be initialized.');
        }
        curl_setopt_array($curl, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_HTTPHEADER => [
                'Accept: application/json',
                'Authorization: Bearer ' . $this->token,
            ],
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT => 20,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
            CURLOPT_USERAGENT => 'Polymind Codex bridge client',
        ]);
        try {
            $body = curl_exec($curl);
            if (!is_string($body)) {
                throw new ApiException(502, 'The Codex bridge could not be reached.');
            }
            $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        } finally {
            curl_close($curl);
        }

        try {
            $decoded = json_decode($body, true, 32, JSON_THROW_ON_ERROR);
        } catch (JsonException $exception) {
            throw new ApiException(502, 'The Codex bridge returned an invalid response.', [], $exception);
        }
        if (!is_array($decoded)) {
            throw new ApiException(502, 'The Codex bridge returned an invalid response.');
        }
        if ($status < 200 || $status >= 300) {
            $message = isset($decoded['message']) && is_string($decoded['message'])
                ? trim($decoded['message'])
                : '';
            throw new ApiException(
                $status === 429 ? 429 : 502,
                $message !== '' && $status !== 401
                    ? $message
                    : 'The Codex bridge rejected the request.',
            );
        }
        if (
            !array_key_exists('available', $decoded)
            || !is_bool($decoded['available'])
            || !array_key_exists('connected', $decoded)
            || !is_bool($decoded['connected'])
        ) {
            throw new ApiException(502, 'The Codex bridge returned an invalid account status.');
        }

        $result = [
            'available' => $decoded['available'],
            'connected' => $decoded['connected'],
        ];
        foreach (['pending'] as $field) {
            if (isset($decoded[$field]) && is_bool($decoded[$field])) {
                $result[$field] = $decoded[$field];
            }
        }
        foreach (['email', 'planType', 'verificationUrl', 'userCode', 'loginError'] as $field) {
            if (isset($decoded[$field]) && is_string($decoded[$field]) && $decoded[$field] !== '') {
                if ($field === 'verificationUrl' && !$this->isSafeHttpsUrl($decoded[$field])) {
                    throw new ApiException(502, 'The Codex bridge returned an invalid sign-in URL.');
                }
                $result[$field] = $decoded[$field];
            }
        }
        return $result;
    }

    private function isSafeHttpsUrl(string $value): bool
    {
        $parts = parse_url($value);
        return is_array($parts)
            && strtolower((string) ($parts['scheme'] ?? '')) === 'https'
            && (string) ($parts['host'] ?? '') !== ''
            && !isset($parts['user'])
            && !isset($parts['pass']);
    }
}
