<?php

declare(strict_types=1);

namespace Polymind\Api;

final class Config
{
    public function __construct(
        public readonly string $databasePath,
        public readonly string $secret,
        public readonly string $migrationKey,
        public readonly array $allowedOrigins,
        public readonly int $tokenTtl,
        public readonly int $maxBodyBytes,
        public readonly string $passkeyRpId,
        public readonly string $passkeyAndroidPackage,
        public readonly array $passkeyAndroidKeyHashes,
        public readonly string $appUrl,
        public readonly string $mailHost,
        public readonly int $mailPort,
        public readonly string $mailUsername,
        public readonly string $mailPassword,
        public readonly string $mailEncryption,
        public readonly string $mailFromAddress,
        public readonly string $mailFromName,
        public readonly bool $debug,
    ) {
    }

    public static function load(string $serverRoot): self
    {
        $projectRoot = dirname($serverRoot);
        $dotenv = self::readDotenv($projectRoot . '/.env');
        $localPath = $serverRoot . '/config.local.php';
        $local = [];
        if (is_file($localPath)) {
            $loaded = require $localPath;
            if (!is_array($loaded)) {
                throw new ApiException(500, 'The local API configuration is invalid.');
            }
            $local = $loaded;
        }

        $value = static function (string $name, mixed $default = null) use ($dotenv, $local): mixed {
            $environment = getenv($name);
            if ($environment !== false) {
                return $environment;
            }

            if (array_key_exists($name, $local)) {
                return $local[$name];
            }

            return $dotenv[$name] ?? $default;
        };

        $databasePath = (string) $value(
            'POLYMIND_DB_PATH',
            'private/data.db',
        );
        if (!self::isAbsolutePath($databasePath)) {
            $databasePath = $projectRoot . '/' . ltrim($databasePath, '/\\');
        }
        $secret = (string) $value('POLYMIND_API_SECRET', '');
        $migrationKey = trim((string) $value('POLYMIND_MIGRATION_KEY', ''));
        $origins = array_values(array_filter(array_map(
            'trim',
            explode(',', (string) $value('POLYMIND_ALLOWED_ORIGINS', '')),
        )));
        $tokenTtl = (int) $value('POLYMIND_TOKEN_TTL', 604800);
        $maxBodyBytes = (int) $value('POLYMIND_MAX_BODY_BYTES', 2500000);
        $passkeyRpId = strtolower(trim((string) $value('POLYMIND_PASSKEY_RP_ID', '')));
        $passkeyAndroidPackage = trim((string) $value('POLYMIND_PASSKEY_ANDROID_PACKAGE', ''));
        $passkeyAndroidKeyHashes = array_values(array_unique(array_filter(array_map(
            'trim',
            explode(',', (string) $value('POLYMIND_PASSKEY_ANDROID_KEY_HASHES', '')),
        ))));
        $appUrl = rtrim(trim((string) $value('POLYMIND_APP_URL', '')), '/');
        $mailHost = trim((string) $value('POLYMIND_MAIL_HOST', ''));
        $mailPort = (int) $value('POLYMIND_MAIL_PORT', 587);
        $mailUsername = trim((string) $value('POLYMIND_MAIL_USERNAME', ''));
        $mailPassword = (string) $value('POLYMIND_MAIL_PASSWORD', '');
        $mailEncryption = strtolower(trim((string) $value('POLYMIND_MAIL_ENCRYPTION', 'tls')));
        if ($mailEncryption === 'none') {
            $mailEncryption = '';
        }
        $mailFromAddress = strtolower(trim((string) $value('POLYMIND_MAIL_FROM_ADDRESS', '')));
        $mailFromName = trim((string) $value('POLYMIND_MAIL_FROM_NAME', 'Polymind'));
        $debug = strtolower(trim((string) $value('DEBUG', ''))) === 'dev';

        if ($secret === '' || strlen($secret) < 32) {
            throw new ApiException(500, 'POLYMIND_API_SECRET must contain at least 32 characters.');
        }
        if (!is_file($databasePath) || !is_readable($databasePath) || !is_writable($databasePath)) {
            throw new ApiException(500, 'The configured SQLite database is not readable and writable.');
        }
        $databasePath = realpath($databasePath) ?: $databasePath;
        if (!is_writable(dirname($databasePath))) {
            throw new ApiException(500, 'The SQLite database directory must be writable.');
        }
        if ($tokenTtl < 300 || $tokenTtl > 2592000) {
            throw new ApiException(500, 'POLYMIND_TOKEN_TTL must be between 300 and 2592000 seconds.');
        }
        if ($maxBodyBytes < 1024 || $maxBodyBytes > 10000000) {
            throw new ApiException(500, 'POLYMIND_MAX_BODY_BYTES must be between 1024 and 10000000 bytes.');
        }
        $configuredPasskeyValues = [
            $passkeyRpId !== '',
            $passkeyAndroidPackage !== '',
            $passkeyAndroidKeyHashes !== [],
        ];
        if (count(array_unique($configuredPasskeyValues, SORT_REGULAR)) !== 1) {
            throw new ApiException(
                500,
                'All Android passkey settings must be configured together.',
            );
        }
        if (
            $passkeyRpId !== ''
            && (
                strlen($passkeyRpId) > 253
                || filter_var($passkeyRpId, FILTER_VALIDATE_DOMAIN, FILTER_FLAG_HOSTNAME) === false
            )
        ) {
            throw new ApiException(500, 'POLYMIND_PASSKEY_RP_ID must be a valid domain name.');
        }
        if (
            $passkeyAndroidPackage !== ''
            && preg_match('/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/', $passkeyAndroidPackage) !== 1
        ) {
            throw new ApiException(500, 'POLYMIND_PASSKEY_ANDROID_PACKAGE must be a valid Android package name.');
        }
        foreach ($passkeyAndroidKeyHashes as $keyHash) {
            if (preg_match('/^[A-Za-z0-9_-]{43}$/', $keyHash) !== 1) {
                throw new ApiException(
                    500,
                    'POLYMIND_PASSKEY_ANDROID_KEY_HASHES contains an invalid signing certificate hash.',
                );
            }
        }
        if ($appUrl !== '') {
            $appUrlParts = parse_url($appUrl);
            $appUrlHost = is_array($appUrlParts)
                ? strtolower((string) ($appUrlParts['host'] ?? ''))
                : '';
            $appUrlScheme = is_array($appUrlParts)
                ? strtolower((string) ($appUrlParts['scheme'] ?? ''))
                : '';
            if (
                !is_array($appUrlParts)
                || $appUrlHost === ''
                || !in_array($appUrlScheme, ['http', 'https'], true)
                || (
                    $appUrlScheme !== 'https'
                    && !in_array($appUrlHost, ['127.0.0.1', 'localhost'], true)
                )
                || isset($appUrlParts['user'])
                || isset($appUrlParts['pass'])
                || isset($appUrlParts['query'])
                || isset($appUrlParts['fragment'])
            ) {
                throw new ApiException(500, 'POLYMIND_APP_URL must be an HTTPS application URL.');
            }
        }
        if ($mailPort < 1 || $mailPort > 65535) {
            throw new ApiException(500, 'POLYMIND_MAIL_PORT must be between 1 and 65535.');
        }
        if (!in_array($mailEncryption, ['', 'tls', 'ssl'], true)) {
            throw new ApiException(500, 'POLYMIND_MAIL_ENCRYPTION must be tls, ssl, or none.');
        }
        if (($mailUsername === '') !== ($mailPassword === '')) {
            throw new ApiException(
                500,
                'POLYMIND_MAIL_USERNAME and POLYMIND_MAIL_PASSWORD must be configured together.',
            );
        }
        if (
            $mailFromAddress !== ''
            && filter_var($mailFromAddress, FILTER_VALIDATE_EMAIL) === false
        ) {
            throw new ApiException(500, 'POLYMIND_MAIL_FROM_ADDRESS must be a valid email address.');
        }
        if (strlen($mailFromName) > 160) {
            throw new ApiException(500, 'POLYMIND_MAIL_FROM_NAME is too long.');
        }

        return new self(
            $databasePath,
            $secret,
            $migrationKey,
            $origins,
            $tokenTtl,
            $maxBodyBytes,
            $passkeyRpId,
            $passkeyAndroidPackage,
            $passkeyAndroidKeyHashes,
            $appUrl,
            $mailHost,
            $mailPort,
            $mailUsername,
            $mailPassword,
            $mailEncryption,
            $mailFromAddress,
            $mailFromName,
            $debug,
        );
    }

    public static function debugEnabled(string $serverRoot): bool
    {
        $environment = getenv('DEBUG');
        if ($environment !== false && $environment !== '') {
            return strtolower(trim($environment)) === 'dev';
        }

        $projectRoot = dirname($serverRoot);
        $dotenv = self::readDotenv($projectRoot . '/.env');

        return strtolower(trim((string) ($dotenv['DEBUG'] ?? ''))) === 'dev';
    }

    private static function readDotenv(string $path): array
    {
        if (!is_file($path) || !is_readable($path)) {
            return [];
        }

        $values = [];
        $lines = file($path, FILE_IGNORE_NEW_LINES);
        if ($lines === false) {
            throw new ApiException(500, 'The root .env file could not be read.');
        }

        foreach ($lines as $lineNumber => $line) {
            $line = trim($line);
            if ($line === '' || str_starts_with($line, '#')) {
                continue;
            }
            if (str_starts_with($line, 'export ')) {
                $line = trim(substr($line, 7));
            }
            $separator = strpos($line, '=');
            if ($separator === false) {
                throw new ApiException(
                    500,
                    sprintf('The root .env file is invalid on line %d.', $lineNumber + 1),
                );
            }

            $name = trim(substr($line, 0, $separator));
            $rawValue = trim(substr($line, $separator + 1));
            if (preg_match('/^[A-Z_][A-Z0-9_]*$/', $name) !== 1) {
                throw new ApiException(
                    500,
                    sprintf('The root .env file has an invalid name on line %d.', $lineNumber + 1),
                );
            }

            if (
                strlen($rawValue) >= 2
                && (
                    $rawValue[0] === '"' && str_ends_with($rawValue, '"')
                    || $rawValue[0] === "'" && str_ends_with($rawValue, "'")
                )
            ) {
                $rawValue = substr($rawValue, 1, -1);
            }
            $values[$name] = $rawValue;
        }

        return $values;
    }

    private static function isAbsolutePath(string $path): bool
    {
        return str_starts_with($path, '/')
            || str_starts_with($path, '\\\\')
            || preg_match('/^[A-Za-z]:[\\\\\\/]/', $path) === 1;
    }
}
