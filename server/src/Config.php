<?php

declare(strict_types=1);

namespace Mom\Api;

final class Config
{
    public function __construct(
        public readonly string $databasePath,
        public readonly string $secret,
        public readonly array $allowedOrigins,
        public readonly int $tokenTtl,
        public readonly int $maxBodyBytes,
        public readonly string $passkeyRpId,
        public readonly string $passkeyAndroidPackage,
        public readonly array $passkeyAndroidKeyHashes,
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
            if ($environment !== false && $environment !== '') {
                return $environment;
            }

            if (array_key_exists($name, $local)) {
                return $local[$name];
            }

            return $dotenv[$name] ?? $default;
        };

        $databasePath = (string) $value(
            'MOM_DB_PATH',
            'private/data.db',
        );
        if (!self::isAbsolutePath($databasePath)) {
            $databasePath = $projectRoot . '/' . ltrim($databasePath, '/\\');
        }
        $secret = (string) $value('MOM_API_SECRET', '');
        $origins = array_values(array_filter(array_map(
            'trim',
            explode(',', (string) $value('MOM_ALLOWED_ORIGINS', '')),
        )));
        $tokenTtl = (int) $value('MOM_TOKEN_TTL', 604800);
        $maxBodyBytes = (int) $value('MOM_MAX_BODY_BYTES', 2500000);
        $passkeyRpId = strtolower(trim((string) $value('MOM_PASSKEY_RP_ID', '')));
        $passkeyAndroidPackage = trim((string) $value('MOM_PASSKEY_ANDROID_PACKAGE', ''));
        $passkeyAndroidKeyHashes = array_values(array_unique(array_filter(array_map(
            'trim',
            explode(',', (string) $value('MOM_PASSKEY_ANDROID_KEY_HASHES', '')),
        ))));

        if ($secret === '' || strlen($secret) < 32) {
            throw new ApiException(500, 'MOM_API_SECRET must contain at least 32 characters.');
        }
        if (!is_file($databasePath) || !is_readable($databasePath) || !is_writable($databasePath)) {
            throw new ApiException(500, 'The configured SQLite database is not readable and writable.');
        }
        $databasePath = realpath($databasePath) ?: $databasePath;
        if (!is_writable(dirname($databasePath))) {
            throw new ApiException(500, 'The SQLite database directory must be writable.');
        }
        if ($tokenTtl < 300 || $tokenTtl > 2592000) {
            throw new ApiException(500, 'MOM_TOKEN_TTL must be between 300 and 2592000 seconds.');
        }
        if ($maxBodyBytes < 1024 || $maxBodyBytes > 10000000) {
            throw new ApiException(500, 'MOM_MAX_BODY_BYTES must be between 1024 and 10000000 bytes.');
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
            throw new ApiException(500, 'MOM_PASSKEY_RP_ID must be a valid domain name.');
        }
        if (
            $passkeyAndroidPackage !== ''
            && preg_match('/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/', $passkeyAndroidPackage) !== 1
        ) {
            throw new ApiException(500, 'MOM_PASSKEY_ANDROID_PACKAGE must be a valid Android package name.');
        }
        foreach ($passkeyAndroidKeyHashes as $keyHash) {
            if (preg_match('/^[A-Za-z0-9_-]{43}$/', $keyHash) !== 1) {
                throw new ApiException(
                    500,
                    'MOM_PASSKEY_ANDROID_KEY_HASHES contains an invalid signing certificate hash.',
                );
            }
        }

        return new self(
            $databasePath,
            $secret,
            $origins,
            $tokenTtl,
            $maxBodyBytes,
            $passkeyRpId,
            $passkeyAndroidPackage,
            $passkeyAndroidKeyHashes,
        );
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
