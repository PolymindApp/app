<?php

declare(strict_types=1);

namespace Mom\Api;

use DateTimeImmutable;
use DateTimeZone;
use JsonException;
use lbuchs\WebAuthn\WebAuthn;
use lbuchs\WebAuthn\WebAuthnException;
use PDO;
use PDOException;
use Throwable;

final class Api
{
    private const MAX_PAGE_SIZE = 200;
    private const PASSKEY_CHALLENGE_TTL = 300;

    public function __construct(
        private readonly Config $config,
        private readonly Database $database,
    ) {
    }

    public function run(): never
    {
        try {
            $this->setSecurityHeaders();
            $this->handleCors();

            $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
            if ($method === 'OPTIONS') {
                $this->respond(null, 204);
            }

            $path = $this->requestPath();
            if ($method === 'GET' && $path === '/health') {
                $this->respond(['status' => 'ok']);
            }
            if ($method === 'POST' && $path === '/auth/login') {
                $this->login();
            }
            if ($method === 'POST' && $path === '/auth/register') {
                $this->register();
            }
            if (($method === 'GET' || $method === 'PATCH') && $path === '/auth/account') {
                $this->account($method);
            }
            if (($method === 'POST' || $method === 'DELETE') && $path === '/auth/avatar') {
                $this->avatar($method);
            }
            if (
                $method === 'GET'
                && preg_match('#^/avatars/([a-f0-9]{48}\.jpg)$#', $path, $avatarMatches) === 1
            ) {
                $this->serveAvatar($avatarMatches[1]);
            }
            if (($method === 'GET' || $method === 'PATCH') && $path === '/auth/settings') {
                $this->userSettings($method);
            }
            if ($method === 'POST' && $path === '/auth/passkeys/register/options') {
                $this->passkeyRegistrationOptions();
            }
            if ($method === 'POST' && $path === '/auth/passkeys/register/verify') {
                $this->verifyPasskeyRegistration();
            }
            if ($method === 'GET' && $path === '/auth/passkeys/status') {
                $this->passkeyStatus();
            }
            if ($method === 'DELETE' && $path === '/auth/passkeys') {
                $this->deletePasskeys();
            }
            if ($method === 'POST' && $path === '/auth/passkeys/login/options') {
                $this->passkeyLoginOptions();
            }
            if ($method === 'POST' && $path === '/auth/passkeys/login/verify') {
                $this->verifyPasskeyLogin();
            }
            if (
                $method === 'POST'
                && preg_match(
                    '#^/interval-sessions/([a-zA-Z0-9_-]{1,64})/complete/?$#',
                    $path,
                    $intervalMatches,
                ) === 1
            ) {
                $this->completeIntervalSession($intervalMatches[1], $this->authenticate());
            }

            if (preg_match('#^/collections/([a-z_]+)/records/?$#', $path, $matches) === 1) {
                $collection = $this->requireCollection($matches[1]);
                $user = $this->authenticate();
                if ($method === 'GET') {
                    $this->listRecords($collection, $user);
                }
                if ($method === 'POST') {
                    $this->createRecord($collection, $user);
                }
            }

            if (preg_match(
                '#^/collections/([a-z_]+)/records/([a-zA-Z0-9_-]{1,64})/?$#',
                $path,
                $matches,
            ) === 1) {
                $collection = $this->requireCollection($matches[1]);
                $user = $this->authenticate();
                if ($method === 'GET') {
                    $this->getRecord($collection, $matches[2], $user);
                }
                if ($method === 'PATCH') {
                    $this->updateRecord($collection, $matches[2], $user);
                }
                if ($method === 'DELETE') {
                    $this->deleteRecord($collection, $matches[2], $user);
                }
            }

            throw new ApiException(404, 'Endpoint not found.');
        } catch (ApiException $exception) {
            $body = [
                'message' => $exception->getMessage(),
                'details' => (object) $exception->details,
            ];
            if ($this->config->debug && $exception->status >= 500) {
                $body['error'] = ApiException::debugPayload($exception);
            }
            $this->respond($body, $exception->status);
        } catch (Throwable $exception) {
            error_log(sprintf(
                '[mom-api] %s in %s:%d',
                $exception->getMessage(),
                $exception->getFile(),
                $exception->getLine(),
            ));
            $body = ['message' => 'An unexpected server error occurred.'];
            if ($this->config->debug) {
                $body['error'] = ApiException::debugPayload($exception);
            }
            $this->respond($body, 500);
        }
    }

    private function setSecurityHeaders(): void
    {
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        header('X-Content-Type-Options: nosniff');
        header('Referrer-Policy: no-referrer');
        header('X-Frame-Options: DENY');
    }

    private function handleCors(): void
    {
        $origin = trim($_SERVER['HTTP_ORIGIN'] ?? '');
        if ($origin === '') {
            return;
        }

        $allowed = in_array($origin, $this->config->allowedOrigins, true);
        if (!$allowed) {
            $originHost = parse_url($origin, PHP_URL_HOST);
            $originPort = parse_url($origin, PHP_URL_PORT);
            $requestHost = strtolower($_SERVER['HTTP_HOST'] ?? '');
            $candidate = strtolower((string) $originHost);
            if ($originPort !== null) {
                $candidate .= ':' . $originPort;
            }
            $allowed = $candidate !== '' && hash_equals($requestHost, $candidate);
        }

        if (!$allowed) {
            throw new ApiException(403, 'This request origin is not allowed.');
        }

        header('Access-Control-Allow-Origin: ' . $origin);
        header('Access-Control-Allow-Headers: Authorization, Content-Type');
        header('Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS');
        header('Access-Control-Max-Age: 600');
        header('Vary: Origin');
    }

    private function requestPath(): string
    {
        $path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
        if (!is_string($path)) {
            return '/';
        }

        $scriptDirectory = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '')), '/');
        if ($scriptDirectory !== '' && $scriptDirectory !== '/' && str_starts_with($path, $scriptDirectory)) {
            $path = substr($path, strlen($scriptDirectory));
        }

        $normalized = '/' . trim(rawurldecode($path), '/');
        return $normalized === '/' ? '/' : rtrim($normalized, '/');
    }

    private function login(): never
    {
        $this->rateLimit('login-ip:' . $this->clientIp(), 12, 900);
        $body = $this->jsonBody();
        $email = $this->normalizeEmail($body['email'] ?? null);
        $password = $this->validatePassword($body['password'] ?? null, false);
        $this->rateLimit('login-email:' . hash('sha256', $email), 12, 900);

        $statement = $this->database->pdo->prepare(
            'SELECT * FROM users WHERE email = :email COLLATE NOCASE LIMIT 1',
        );
        $statement->execute(['email' => $email]);
        $user = $statement->fetch();

        $valid = is_array($user)
            ? password_verify($password, (string) $user['password'])
            : password_verify($password, '$2y$12$KIXxBtZ0U3U0KqAdA4pM8uA9cAhlY21NCI7T4f1WwdA4Qk9JR5vja');
        if (!$valid || !is_array($user)) {
            throw new ApiException(401, 'The email or password is incorrect.');
        }

        if (password_needs_rehash((string) $user['password'], PASSWORD_DEFAULT)) {
            $newHash = password_hash($password, PASSWORD_DEFAULT);
            $statement = $this->database->pdo->prepare(
                'UPDATE users SET password = :password, updated = :updated WHERE id = :id',
            );
            $statement->execute([
                'password' => $newHash,
                'updated' => $this->now(),
                'id' => $user['id'],
            ]);
        }

        $this->respond([
            'token' => $this->createToken($user),
            'record' => $this->publicUser($user),
        ]);
    }

    private function register(): never
    {
        $this->rateLimit('register-ip:' . $this->clientIp(), 5, 3600);
        $body = $this->jsonBody();
        $name = $this->validateText($body['name'] ?? null, 'name', 160, true);
        $email = $this->normalizeEmail($body['email'] ?? null);
        $password = $this->validatePassword($body['password'] ?? null, true);
        $passwordConfirm = $body['passwordConfirm'] ?? null;
        if (!is_string($passwordConfirm) || !hash_equals($password, $passwordConfirm)) {
            throw new ApiException(422, 'The password confirmation does not match.', [
                'passwordConfirm' => 'Passwords must match.',
            ]);
        }
        $timezone = $this->validateText(
            $body['timezone'] ?? 'UTC',
            'timezone',
            80,
            true,
        );
        if (!in_array($timezone, timezone_identifiers_list(), true)) {
            throw new ApiException(422, 'The supplied timezone is invalid.', [
                'timezone' => 'Use an IANA timezone identifier.',
            ]);
        }

        $id = $this->newId();
        $now = $this->now();
        $user = [
            'id' => $id,
            'avatar' => '',
            'created' => $now,
            'email' => $email,
            'email_visibility' => 0,
            'name' => $name,
            'password' => password_hash($password, PASSWORD_DEFAULT),
            'token_key' => $this->randomTokenVersionKey(),
            'updated' => $now,
            'verified' => 0,
            'timezone' => $timezone,
        ];

        try {
            $statement = $this->database->pdo->prepare(
                'INSERT INTO users (
                    id, avatar, created, email, email_visibility, name,
                    password, token_key, updated, verified, timezone
                ) VALUES (
                    :id, :avatar, :created, :email, :email_visibility, :name,
                    :password, :token_key, :updated, :verified, :timezone
                )',
            );
            $statement->execute($user);
        } catch (PDOException $exception) {
            if ($this->isConstraintViolation($exception)) {
                throw new ApiException(409, 'An account with that email already exists.');
            }
            throw $exception;
        }

        $this->respond($this->publicUser($user), 201);
    }

    private function account(string $method): never
    {
        $user = $this->authenticate();
        if ($method === 'GET') {
            $this->respond($this->publicUser($user));
        }

        $this->rateLimit('account-update:' . $user['id'], 30, 900);
        $body = $this->jsonBody();
        if (!array_key_exists('name', $body)) {
            throw new ApiException(422, 'A name is required.', [
                'name' => 'required',
            ]);
        }

        $name = $this->validateText($body['name'], 'name', 160, true);
        $updated = $this->now();
        $statement = $this->database->pdo->prepare(
            'UPDATE users SET name = :name, updated = :updated WHERE id = :id',
        );
        $statement->execute([
            'name' => $name,
            'updated' => $updated,
            'id' => $user['id'],
        ]);

        $user['name'] = $name;
        $user['updated'] = $updated;
        $this->respond($this->publicUser($user));
    }

    private function avatar(string $method): never
    {
        $user = $this->authenticate();
        $this->rateLimit('avatar-update:' . $user['id'], 20, 900);
        $oldFilename = $this->validAvatarFilename($user['avatar'] ?? null);
        $updated = $this->now();

        if ($method === 'DELETE') {
            $statement = $this->database->pdo->prepare(
                "UPDATE users SET avatar = '', updated = :updated WHERE id = :id",
            );
            $statement->execute([
                'updated' => $updated,
                'id' => $user['id'],
            ]);
            if ($oldFilename !== null) {
                $this->removeAvatarFile($oldFilename);
            }
            $user['avatar'] = '';
            $user['updated'] = $updated;
            $this->respond($this->publicUser($user));
        }

        $body = $this->jsonBody();
        $encoded = $body['image'] ?? null;
        if (
            !is_string($encoded)
            || !str_starts_with($encoded, 'data:image/jpeg;base64,')
        ) {
            throw new ApiException(422, 'Upload a valid compressed JPEG avatar.', [
                'image' => 'jpeg',
            ]);
        }
        $bytes = base64_decode(substr($encoded, 23), true);
        if ($bytes === false || strlen($bytes) < 100 || strlen($bytes) > 500000) {
            throw new ApiException(422, 'The compressed avatar is invalid or too large.', [
                'image' => 'max:500000',
            ]);
        }

        $details = @getimagesizefromstring($bytes);
        if (
            !is_array($details)
            || ($details['mime'] ?? null) !== 'image/jpeg'
            || ($details[0] ?? 0) < 1
            || ($details[0] ?? 0) > 256
            || ($details[1] ?? 0) !== ($details[0] ?? 0)
        ) {
            throw new ApiException(422, 'The avatar must be a square JPEG no larger than 256×256.', [
                'image' => 'square:max:256',
            ]);
        }

        $directory = $this->avatarDirectory();
        if (
            !is_dir($directory)
            && !mkdir($directory, 0700, true)
            && !is_dir($directory)
        ) {
            throw new ApiException(500, 'The private avatar directory could not be created.');
        }
        if (!is_writable($directory)) {
            throw new ApiException(500, 'The private avatar directory is not writable.');
        }

        $filename = bin2hex(random_bytes(24)) . '.jpg';
        $temporary = tempnam($directory, '.avatar-');
        if ($temporary === false) {
            throw new ApiException(500, 'A temporary avatar file could not be created.');
        }

        try {
            $written = file_put_contents($temporary, $bytes, LOCK_EX);
            if ($written !== strlen($bytes)) {
                throw new ApiException(500, 'The avatar could not be stored.');
            }
            @chmod($temporary, 0600);
            $destination = $directory . DIRECTORY_SEPARATOR . $filename;
            if (!rename($temporary, $destination)) {
                throw new ApiException(500, 'The avatar could not be finalized.');
            }
            $temporary = '';

            try {
                $statement = $this->database->pdo->prepare(
                    'UPDATE users SET avatar = :avatar, updated = :updated WHERE id = :id',
                );
                $statement->execute([
                    'avatar' => $filename,
                    'updated' => $updated,
                    'id' => $user['id'],
                ]);
            } catch (Throwable $exception) {
                @unlink($destination);
                throw $exception;
            }
        } finally {
            if ($temporary !== '' && is_file($temporary)) {
                @unlink($temporary);
            }
        }

        if ($oldFilename !== null && !hash_equals($oldFilename, $filename)) {
            $this->removeAvatarFile($oldFilename);
        }
        $user['avatar'] = $filename;
        $user['updated'] = $updated;
        $this->respond($this->publicUser($user));
    }

    private function serveAvatar(string $filename): never
    {
        $validated = $this->validAvatarFilename($filename);
        if ($validated === null) {
            throw new ApiException(404, 'Avatar not found.');
        }
        $path = $this->avatarDirectory() . DIRECTORY_SEPARATOR . $validated;
        if (!is_file($path) || !is_readable($path)) {
            throw new ApiException(404, 'Avatar not found.');
        }
        $contents = file_get_contents($path);
        if ($contents === false) {
            throw new ApiException(404, 'Avatar not found.');
        }

        header('Content-Type: image/jpeg');
        header('Cache-Control: public, max-age=31536000, immutable');
        header('Content-Length: ' . strlen($contents));
        header('Content-Disposition: inline; filename="avatar.jpg"');
        header('ETag: "' . substr($validated, 0, 48) . '"');
        echo $contents;
        exit;
    }

    private function avatarDirectory(): string
    {
        return dirname($this->config->databasePath) . DIRECTORY_SEPARATOR . 'avatars';
    }

    private function validAvatarFilename(mixed $value): ?string
    {
        return is_string($value) && preg_match('/^[a-f0-9]{48}\.jpg$/', $value) === 1
            ? $value
            : null;
    }

    private function removeAvatarFile(string $filename): void
    {
        $validated = $this->validAvatarFilename($filename);
        if ($validated === null) {
            return;
        }
        $path = $this->avatarDirectory() . DIRECTORY_SEPARATOR . $validated;
        if (is_file($path)) {
            @unlink($path);
        }
    }

    private function userSettings(string $method): never
    {
        $user = $this->authenticate();
        $settings = $this->decodeUserSettings($user['settings'] ?? '{}');
        if ($method === 'GET') {
            $this->respond(['settings' => (object) $settings]);
        }

        $body = $this->jsonBody();
        if (!array_key_exists('quickInterval', $body)) {
            throw new ApiException(422, 'At least one supported setting is required.', [
                'quickInterval' => 'required',
            ]);
        }
        $settings['quickInterval'] = $this->validateQuickIntervalSettings(
            $body['quickInterval'],
        );
        $encoded = json_encode(
            $settings,
            JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES,
        );
        $updated = $this->now();
        $statement = $this->database->pdo->prepare(
            'UPDATE users SET settings = :settings, updated = :updated WHERE id = :id',
        );
        $statement->execute([
            'settings' => $encoded,
            'updated' => $updated,
            'id' => $user['id'],
        ]);
        $this->respond(['settings' => $settings, 'updated' => $updated]);
    }

    private function validateQuickIntervalSettings(mixed $value): array
    {
        if (!is_array($value) || array_is_list($value)) {
            throw new ApiException(422, 'Quick interval settings must be an object.', [
                'quickInterval' => 'object',
            ]);
        }

        $integer = static function (
            string $field,
            int $minimum,
            int $maximum,
        ) use ($value): int {
            $candidate = $value[$field] ?? null;
            if (
                !is_int($candidate)
                || $candidate < $minimum
                || $candidate > $maximum
            ) {
                throw new ApiException(422, "The {$field} setting is invalid.", [
                    "quickInterval.{$field}" => "{$minimum}..{$maximum}",
                ]);
            }
            return $candidate;
        };
        $boolean = static function (string $field) use ($value): bool {
            $candidate = $value[$field] ?? null;
            if (!is_bool($candidate)) {
                throw new ApiException(422, "The {$field} setting is invalid.", [
                    "quickInterval.{$field}" => 'boolean',
                ]);
            }
            return $candidate;
        };
        $cues = $value['cues'] ?? null;
        if (!is_array($cues) || array_is_list($cues)) {
            throw new ApiException(422, 'Quick interval cue settings are invalid.', [
                'quickInterval.cues' => 'object',
            ]);
        }
        foreach (['soundEnabled', 'vibrationEnabled'] as $cue) {
            if (!is_bool($cues[$cue] ?? null)) {
                throw new ApiException(422, "The {$cue} cue setting is invalid.", [
                    "quickInterval.cues.{$cue}" => 'boolean',
                ]);
            }
        }

        return [
            'warmupSeconds' => $integer('warmupSeconds', 0, 3599),
            'workSeconds' => $integer('workSeconds', 1, 3599),
            'restSeconds' => $integer('restSeconds', 0, 3599),
            'rounds' => $integer('rounds', 1, 15),
            'cooldownSeconds' => $integer('cooldownSeconds', 0, 3599),
            'restAfterLastRound' => $boolean('restAfterLastRound'),
            'includeRest' => $boolean('includeRest'),
            'cues' => [
                'soundEnabled' => $cues['soundEnabled'],
                'vibrationEnabled' => $cues['vibrationEnabled'],
            ],
        ];
    }

    private function decodeUserSettings(mixed $value): array
    {
        if (!is_string($value) || trim($value) === '') {
            return [];
        }
        try {
            $settings = json_decode($value, true, flags: JSON_THROW_ON_ERROR);
        } catch (JsonException $exception) {
            throw new ApiException(500, 'The account contains invalid settings.', [], $exception);
        }
        if (!is_array($settings) || ($settings !== [] && array_is_list($settings))) {
            throw new ApiException(500, 'The account contains invalid settings.');
        }
        return $settings;
    }

    private function passkeyRegistrationOptions(): never
    {
        $user = $this->authenticate();
        $this->rateLimit('passkey-register:' . $user['id'], 10, 900);
        $webAuthn = $this->passkeyWebAuthn();

        $statement = $this->database->pdo->prepare(
            'SELECT user_handle FROM mom_passkeys WHERE user_id = :user_id LIMIT 1',
        );
        $statement->execute(['user_id' => $user['id']]);
        $encodedUserHandle = $statement->fetchColumn();
        $userHandle = is_string($encodedUserHandle)
            ? $this->decodePasskeyBinary($encodedUserHandle, 'stored user handle')
            : random_bytes(32);

        $statement = $this->database->pdo->prepare(
            'SELECT credential_id FROM mom_passkeys WHERE user_id = :user_id',
        );
        $statement->execute(['user_id' => $user['id']]);
        $excludeCredentialIds = array_map(
            fn (string $credentialId): string => $this->decodePasskeyBinary(
                $credentialId,
                'stored credential ID',
            ),
            $statement->fetchAll(PDO::FETCH_COLUMN),
        );

        $displayName = trim((string) $user['name']);
        if ($displayName === '') {
            $displayName = (string) $user['email'];
        }
        $options = $webAuthn->getCreateArgs(
            $userHandle,
            (string) $user['email'],
            $displayName,
            120,
            'required',
            'required',
            null,
            $excludeCredentialIds,
        );
        $ceremonyId = $this->savePasskeyChallenge(
            'register',
            $webAuthn->getChallenge()->getBinaryString(),
            (string) $user['id'],
            $this->base64UrlEncode($userHandle),
        );

        $this->respond([
            'ceremonyId' => $ceremonyId,
            'requestJson' => json_encode(
                $options->publicKey,
                JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES,
            ),
        ]);
    }

    private function verifyPasskeyRegistration(): never
    {
        $user = $this->authenticate();
        $this->rateLimit('passkey-register-verify:' . $user['id'], 10, 900);
        $body = $this->jsonBody();
        $credential = $this->passkeyCredential($body['credential'] ?? null, true);
        $ceremony = $this->consumePasskeyChallenge(
            $body['ceremonyId'] ?? null,
            'register',
        );
        if (!is_string($ceremony['user_id']) || !hash_equals((string) $user['id'], $ceremony['user_id'])) {
            throw new ApiException(401, 'This biometric setup request is not valid.');
        }

        $clientDataJson = $this->decodePasskeyBinary(
            $credential['response']['clientDataJSON'] ?? null,
            'clientDataJSON',
        );
        $attestationObject = $this->decodePasskeyBinary(
            $credential['response']['attestationObject'] ?? null,
            'attestationObject',
        );
        $rawCredentialId = $this->credentialIdFromPasskey($credential);
        $this->validateAndroidClientData($clientDataJson, 'webauthn.create');

        $webAuthn = $this->passkeyWebAuthn();
        try {
            $registration = $webAuthn->processCreate(
                $clientDataJson,
                $attestationObject,
                $ceremony['challenge'],
                true,
                true,
                false,
                false,
            );
        } catch (WebAuthnException) {
            throw new ApiException(422, 'The biometric setup could not be verified.');
        }

        if (!hash_equals($rawCredentialId, (string) $registration->credentialId)) {
            throw new ApiException(422, 'The biometric credential is inconsistent.');
        }

        $transports = $this->passkeyTransports($credential['response']['transports'] ?? []);
        $credentialId = $this->base64UrlEncode($rawCredentialId);
        $now = $this->now();
        try {
            $statement = $this->database->pdo->prepare(
                'INSERT INTO mom_passkeys (
                    credential_id, user_id, user_handle, public_key, signature_counter,
                    transports, backup_eligible, backed_up, created, last_used
                ) VALUES (
                    :credential_id, :user_id, :user_handle, :public_key, :signature_counter,
                    :transports, :backup_eligible, :backed_up, :created, \'\'
                )',
            );
            $statement->execute([
                'credential_id' => $credentialId,
                'user_id' => $user['id'],
                'user_handle' => $this->base64UrlEncode($this->decodePasskeyBinary(
                    $ceremony['user_handle'] ?? null,
                    'registration user handle',
                )),
                'public_key' => (string) $registration->credentialPublicKey,
                'signature_counter' => $registration->signatureCounter,
                'transports' => json_encode($transports, JSON_THROW_ON_ERROR),
                'backup_eligible' => $registration->isBackupEligible ? 1 : 0,
                'backed_up' => $registration->isBackedUp ? 1 : 0,
                'created' => $now,
            ]);
        } catch (PDOException $exception) {
            if ($this->isConstraintViolation($exception)) {
                throw new ApiException(409, 'Biometric sign-in is already connected.');
            }
            throw $exception;
        }

        $this->respond([
            'registered' => true,
            'credentialId' => $credentialId,
        ], 201);
    }

    private function passkeyStatus(): never
    {
        $user = $this->authenticate();
        $this->passkeyWebAuthn();

        $statement = $this->database->pdo->prepare(
            'SELECT 1 FROM mom_passkeys WHERE user_id = :user_id LIMIT 1',
        );
        $statement->execute(['user_id' => $user['id']]);

        $this->respond([
            'registered' => $statement->fetchColumn() !== false,
        ]);
    }

    private function deletePasskeys(): never
    {
        $user = $this->authenticate();
        $this->passkeyWebAuthn();
        $pdo = $this->database->pdo;
        $pdo->beginTransaction();

        try {
            $statement = $pdo->prepare(
                'DELETE FROM mom_passkeys WHERE user_id = :user_id',
            );
            $statement->execute(['user_id' => $user['id']]);
            $removed = $statement->rowCount();

            $statement = $pdo->prepare(
                'DELETE FROM mom_passkey_challenges
                 WHERE user_id = :user_id AND purpose = \'register\'',
            );
            $statement->execute(['user_id' => $user['id']]);
            $pdo->commit();
        } catch (\Throwable $exception) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $exception;
        }

        $this->respond([
            'registered' => false,
            'removed' => $removed,
        ]);
    }

    private function passkeyLoginOptions(): never
    {
        $this->rateLimit('passkey-login-options:' . $this->clientIp(), 30, 900);
        $webAuthn = $this->passkeyWebAuthn();
        $options = $webAuthn->getGetArgs(
            [],
            120,
            true,
            true,
            true,
            true,
            true,
            'required',
        );
        $ceremonyId = $this->savePasskeyChallenge(
            'login',
            $webAuthn->getChallenge()->getBinaryString(),
        );

        $this->respond([
            'ceremonyId' => $ceremonyId,
            'requestJson' => json_encode(
                $options->publicKey,
                JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES,
            ),
        ]);
    }

    private function verifyPasskeyLogin(): never
    {
        $this->rateLimit('passkey-login-verify:' . $this->clientIp(), 20, 900);
        $body = $this->jsonBody();
        $credential = $this->passkeyCredential($body['credential'] ?? null, false);
        $ceremony = $this->consumePasskeyChallenge(
            $body['ceremonyId'] ?? null,
            'login',
        );
        $clientDataJson = $this->decodePasskeyBinary(
            $credential['response']['clientDataJSON'] ?? null,
            'clientDataJSON',
        );
        $authenticatorData = $this->decodePasskeyBinary(
            $credential['response']['authenticatorData'] ?? null,
            'authenticatorData',
        );
        $signature = $this->decodePasskeyBinary(
            $credential['response']['signature'] ?? null,
            'signature',
        );
        $credentialId = $this->base64UrlEncode($this->credentialIdFromPasskey($credential));
        $this->validateAndroidClientData($clientDataJson, 'webauthn.get');

        $statement = $this->database->pdo->prepare(
            'SELECT
                users.*,
                mom_passkeys.user_handle AS passkey_user_handle,
                mom_passkeys.public_key AS passkey_public_key,
                mom_passkeys.signature_counter AS passkey_signature_counter
             FROM mom_passkeys
             INNER JOIN users ON users.id = mom_passkeys.user_id
             WHERE mom_passkeys.credential_id = :credential_id
             LIMIT 1',
        );
        $statement->execute(['credential_id' => $credentialId]);
        $user = $statement->fetch();
        if (!is_array($user)) {
            throw new ApiException(401, 'Biometric sign-in could not be verified.');
        }

        $providedUserHandle = $credential['response']['userHandle'] ?? null;
        if (
            !is_string($providedUserHandle)
            || !hash_equals((string) $user['passkey_user_handle'], $providedUserHandle)
        ) {
            throw new ApiException(401, 'Biometric sign-in could not be verified.');
        }

        $previousCounter = $user['passkey_signature_counter'] === null
            ? null
            : (int) $user['passkey_signature_counter'];
        $webAuthn = $this->passkeyWebAuthn();
        try {
            $webAuthn->processGet(
                $clientDataJson,
                $authenticatorData,
                $signature,
                (string) $user['passkey_public_key'],
                $ceremony['challenge'],
                $previousCounter,
                true,
                true,
            );
        } catch (WebAuthnException) {
            throw new ApiException(401, 'Biometric sign-in could not be verified.');
        }

        $statement = $this->database->pdo->prepare(
            'UPDATE mom_passkeys
             SET signature_counter = :signature_counter, last_used = :last_used
             WHERE credential_id = :credential_id',
        );
        $statement->bindValue(
            ':signature_counter',
            $webAuthn->getSignatureCounter(),
            $webAuthn->getSignatureCounter() === null ? PDO::PARAM_NULL : PDO::PARAM_INT,
        );
        $statement->bindValue(':last_used', $this->now());
        $statement->bindValue(':credential_id', $credentialId);
        $statement->execute();

        $this->respond([
            'token' => $this->createToken($user),
            'record' => $this->publicUser($user),
        ]);
    }

    private function passkeyWebAuthn(): WebAuthn
    {
        if (
            $this->config->passkeyRpId === ''
            || $this->config->passkeyAndroidPackage === ''
            || $this->config->passkeyAndroidKeyHashes === []
        ) {
            throw new ApiException(503, 'Biometric sign-in is not configured.');
        }

        $webAuthn = new WebAuthn('Mom', $this->config->passkeyRpId, ['none'], true);
        $webAuthn->addAndroidKeyHashes($this->config->passkeyAndroidKeyHashes);
        return $webAuthn;
    }

    private function savePasskeyChallenge(
        string $purpose,
        string $challenge,
        ?string $userId = null,
        ?string $userHandle = null,
    ): string {
        $now = time();
        $this->database->pdo->prepare(
            'DELETE FROM mom_passkey_challenges WHERE expires_at < :now',
        )->execute(['now' => $now]);

        $id = $this->base64UrlEncode(random_bytes(24));
        $statement = $this->database->pdo->prepare(
            'INSERT INTO mom_passkey_challenges (
                id, purpose, user_id, user_handle, challenge, expires_at, created_at
             ) VALUES (
                :id, :purpose, :user_id, :user_handle, :challenge, :expires_at, :created_at
             )',
        );
        $statement->bindValue(':id', $id);
        $statement->bindValue(':purpose', $purpose);
        $statement->bindValue(':user_id', $userId, $userId === null ? PDO::PARAM_NULL : PDO::PARAM_STR);
        $statement->bindValue(
            ':user_handle',
            $userHandle,
            $userHandle === null ? PDO::PARAM_NULL : PDO::PARAM_STR,
        );
        $statement->bindValue(':challenge', $challenge, PDO::PARAM_LOB);
        $statement->bindValue(':expires_at', $now + self::PASSKEY_CHALLENGE_TTL, PDO::PARAM_INT);
        $statement->bindValue(':created_at', $now, PDO::PARAM_INT);
        $statement->execute();
        return $id;
    }

    private function consumePasskeyChallenge(mixed $id, string $purpose): array
    {
        if (!is_string($id) || preg_match('/^[A-Za-z0-9_-]{32}$/', $id) !== 1) {
            throw new ApiException(422, 'The biometric request is invalid or expired.');
        }

        $pdo = $this->database->pdo;
        $pdo->beginTransaction();
        try {
            $statement = $pdo->prepare(
                'SELECT challenge, user_id, user_handle, expires_at
                 FROM mom_passkey_challenges
                 WHERE id = :id AND purpose = :purpose
                 LIMIT 1',
            );
            $statement->execute(['id' => $id, 'purpose' => $purpose]);
            $ceremony = $statement->fetch();
            if (!is_array($ceremony)) {
                $pdo->rollBack();
                throw new ApiException(422, 'The biometric request is invalid or expired.');
            }

            $delete = $pdo->prepare(
                'DELETE FROM mom_passkey_challenges WHERE id = :id AND purpose = :purpose',
            );
            $delete->execute(['id' => $id, 'purpose' => $purpose]);
            if ($delete->rowCount() !== 1) {
                $pdo->rollBack();
                throw new ApiException(422, 'The biometric request is invalid or expired.');
            }
            $pdo->commit();
        } catch (Throwable $exception) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $exception;
        }

        if ((int) $ceremony['expires_at'] < time()) {
            throw new ApiException(422, 'The biometric request is invalid or expired.');
        }
        if (!is_string($ceremony['challenge']) || $ceremony['challenge'] === '') {
            throw new ApiException(422, 'The biometric request is invalid or expired.');
        }
        return $ceremony;
    }

    private function passkeyCredential(mixed $value, bool $registration): array
    {
        if (!is_array($value) || array_is_list($value) || ($value['type'] ?? null) !== 'public-key') {
            throw new ApiException(422, 'A valid biometric credential is required.');
        }
        if (!is_array($value['response'] ?? null) || array_is_list($value['response'])) {
            throw new ApiException(422, 'A valid biometric response is required.');
        }

        $required = $registration
            ? ['clientDataJSON', 'attestationObject']
            : ['clientDataJSON', 'authenticatorData', 'signature', 'userHandle'];
        foreach ($required as $field) {
            if (!is_string($value['response'][$field] ?? null)) {
                throw new ApiException(422, 'The biometric response is incomplete.');
            }
        }
        return $value;
    }

    private function credentialIdFromPasskey(array $credential): string
    {
        $rawId = $this->decodePasskeyBinary($credential['rawId'] ?? null, 'rawId');
        $id = $this->decodePasskeyBinary($credential['id'] ?? null, 'id');
        if (!hash_equals($rawId, $id)) {
            throw new ApiException(422, 'The biometric credential is inconsistent.');
        }
        return $rawId;
    }

    private function decodePasskeyBinary(mixed $value, string $field): string
    {
        if (
            !is_string($value)
            || $value === ''
            || strlen($value) > 1500000
            || preg_match('/^[A-Za-z0-9_-]+$/', $value) !== 1
        ) {
            throw new ApiException(422, "The biometric {$field} field is invalid.");
        }
        $padding = strlen($value) % 4;
        if ($padding === 1) {
            throw new ApiException(422, "The biometric {$field} field is invalid.");
        }
        if ($padding !== 0) {
            $value .= str_repeat('=', 4 - $padding);
        }
        $decoded = base64_decode(strtr($value, '-_', '+/'), true);
        if ($decoded === false || $decoded === '') {
            throw new ApiException(422, "The biometric {$field} field is invalid.");
        }
        return $decoded;
    }

    private function validateAndroidClientData(string $clientDataJson, string $expectedType): void
    {
        try {
            $clientData = json_decode($clientDataJson, true, flags: JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            throw new ApiException(422, 'The biometric client data is invalid.');
        }

        $allowedOrigins = array_map(
            static fn (string $keyHash): string => 'android:apk-key-hash:' . $keyHash,
            $this->config->passkeyAndroidKeyHashes,
        );
        if (
            !is_array($clientData)
            || ($clientData['type'] ?? null) !== $expectedType
            || !is_string($clientData['origin'] ?? null)
            || !in_array($clientData['origin'], $allowedOrigins, true)
            || ($clientData['androidPackageName'] ?? null) !== $this->config->passkeyAndroidPackage
            || ($clientData['crossOrigin'] ?? false) === true
        ) {
            throw new ApiException(422, 'The biometric request did not come from the trusted Android app.');
        }
    }

    private function passkeyTransports(mixed $value): array
    {
        if (!is_array($value) || !array_is_list($value)) {
            return [];
        }
        $allowed = ['ble', 'hybrid', 'internal', 'nfc', 'usb'];
        return array_values(array_unique(array_filter(
            $value,
            static fn (mixed $transport): bool => is_string($transport)
                && in_array($transport, $allowed, true),
        )));
    }

    private function authenticate(): array
    {
        $authorization = trim($_SERVER['HTTP_AUTHORIZATION'] ?? '');
        if (!str_starts_with($authorization, 'Bearer ')) {
            throw new ApiException(401, 'Authentication is required.');
        }

        $token = trim(substr($authorization, 7));
        $parts = explode('.', $token);
        if (count($parts) !== 3) {
            throw new ApiException(401, 'The authentication token is invalid.');
        }

        [$encodedHeader, $encodedPayload, $providedSignature] = $parts;
        $expectedSignature = $this->base64UrlEncode(hash_hmac(
            'sha256',
            $encodedHeader . '.' . $encodedPayload,
            $this->config->secret,
            true,
        ));
        if (!hash_equals($expectedSignature, $providedSignature)) {
            throw new ApiException(401, 'The authentication token is invalid.');
        }

        try {
            $header = json_decode($this->base64UrlDecode($encodedHeader), true, flags: JSON_THROW_ON_ERROR);
            $payload = json_decode($this->base64UrlDecode($encodedPayload), true, flags: JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            throw new ApiException(401, 'The authentication token is invalid.');
        }

        if (
            !is_array($header)
            || ($header['alg'] ?? null) !== 'HS256'
            || ($header['typ'] ?? null) !== 'JWT'
            || !is_array($payload)
            || !is_string($payload['sub'] ?? null)
            || !is_int($payload['exp'] ?? null)
            || !is_string($payload['ver'] ?? null)
            || $payload['exp'] < time()
        ) {
            throw new ApiException(401, 'The authentication token is invalid or expired.');
        }

        $statement = $this->database->pdo->prepare('SELECT * FROM users WHERE id = :id LIMIT 1');
        $statement->execute(['id' => $payload['sub']]);
        $user = $statement->fetch();
        if (
            !is_array($user)
            || !hash_equals($this->tokenVersion((string) $user['token_key']), $payload['ver'])
        ) {
            throw new ApiException(401, 'The authentication token is no longer valid.');
        }

        return $user;
    }

    private function createToken(array $user): string
    {
        $header = $this->base64UrlEncode(json_encode(
            ['alg' => 'HS256', 'typ' => 'JWT'],
            JSON_THROW_ON_ERROR,
        ));
        $payload = $this->base64UrlEncode(json_encode([
            'sub' => $user['id'],
            'iat' => time(),
            'exp' => time() + $this->config->tokenTtl,
            'ver' => $this->tokenVersion((string) $user['token_key']),
        ], JSON_THROW_ON_ERROR));
        $signature = $this->base64UrlEncode(hash_hmac(
            'sha256',
            $header . '.' . $payload,
            $this->config->secret,
            true,
        ));

        return $header . '.' . $payload . '.' . $signature;
    }

    private function listRecords(array $collection, array $user): never
    {
        $page = $this->positiveIntegerQuery('page', 1);
        $perPage = min($this->positiveIntegerQuery('perPage', 30), self::MAX_PAGE_SIZE);
        [$where, $parameters] = $this->compileFilter(
            (string) ($_GET['filter'] ?? ''),
            $collection['config']['filter'],
        );
        $order = $this->compileSort(
            (string) ($_GET['sort'] ?? ''),
            $collection['config']['sort'],
        );

        $parameters['owner'] = $user['id'];
        $where = 'owner = :owner' . ($where === '' ? '' : ' AND (' . $where . ')');
        $table = $collection['name'];

        $count = $this->database->pdo->prepare("SELECT COUNT(*) FROM {$table} WHERE {$where}");
        $count->execute($parameters);
        $totalItems = (int) $count->fetchColumn();

        $offset = ($page - 1) * $perPage;
        $statement = $this->database->pdo->prepare(
            "SELECT * FROM {$table} WHERE {$where} ORDER BY {$order} LIMIT :limit OFFSET :offset",
        );
        foreach ($parameters as $key => $value) {
            $statement->bindValue(':' . $key, $value, $this->pdoType($value));
        }
        $statement->bindValue(':limit', $perPage, PDO::PARAM_INT);
        $statement->bindValue(':offset', $offset, PDO::PARAM_INT);
        $statement->execute();
        $items = array_map(
            fn (array $record): array => $this->normalizeRecord($collection, $record),
            $statement->fetchAll(),
        );

        $this->respond([
            'page' => $page,
            'perPage' => $perPage,
            'totalItems' => $totalItems,
            'totalPages' => max(1, (int) ceil($totalItems / $perPage)),
            'items' => $items,
        ]);
    }

    private function getRecord(array $collection, string $id, array $user): never
    {
        $record = $this->ownedRecord($collection['name'], $id, (string) $user['id']);
        $this->respond($this->normalizeRecord($collection, $record));
    }

    private function createRecord(array $collection, array $user): never
    {
        $body = $this->jsonBody();
        if ($collection['name'] === 'tasks') {
            $body += [
                'entry_notes_enabled' => false,
                'entry_note_suggestions_enabled' => false,
            ];
        }
        $values = $this->validateRecordInput($collection, $body, true);
        $values['id'] = $this->newId();
        $values['owner'] = $user['id'];
        if ($collection['name'] === 'interval_sessions') {
            $values['task_date'] = $this->dateKeyInTimezone(
                (string) $values['started_at'],
                (string) $user['timezone'],
            );
            $this->validateNewIntervalSession($values, $user);
        }
        if ($collection['name'] === 'entries') {
            $values['created_at'] = (new DateTimeImmutable('now'))->format('Y-m-d\TH:i:s.v\Z');
        }
        $this->validateRelations($collection['name'], $values, (string) $user['id']);

        $columns = array_keys($values);
        $placeholders = array_map(static fn (string $column): string => ':' . $column, $columns);
        $table = $collection['name'];

        try {
            $statement = $this->database->pdo->prepare(sprintf(
                'INSERT INTO %s (%s) VALUES (%s)',
                $table,
                implode(', ', $columns),
                implode(', ', $placeholders),
            ));
            $statement->execute($this->databaseValues($collection, $values));
        } catch (PDOException $exception) {
            if ($this->isConstraintViolation($exception)) {
                throw new ApiException(409, 'A conflicting record already exists.');
            }
            throw $exception;
        }

        $record = $this->ownedRecord($table, (string) $values['id'], (string) $user['id']);
        $this->respond($this->normalizeRecord($collection, $record), 201);
    }

    private function updateRecord(array $collection, string $id, array $user): never
    {
        $existing = $this->ownedRecord($collection['name'], $id, (string) $user['id']);
        $body = $this->jsonBody();
        if ($collection['name'] === 'interval_sessions') {
            if (
                array_key_exists('task', $body)
                || array_key_exists('program_step', $body)
                || array_key_exists('task_date', $body)
            ) {
                throw new ApiException(422, 'Interval task attribution cannot be changed after the session starts.');
            }
            if (($body['status'] ?? null) === 'completed') {
                throw new ApiException(422, 'Use the interval completion endpoint to complete a session.');
            }
        }
        $values = $this->validateRecordInput($collection, $body, false);
        if ($values === []) {
            throw new ApiException(422, 'At least one writable field is required.');
        }
        if ($collection['name'] === 'tracking_trackers') {
            $this->validateTrackerDefinitionUpdate($existing, $values, (string) $user['id']);
        }

        $combined = array_merge($this->normalizeRecord($collection, $existing), $values);
        $this->validateRelations($collection['name'], $combined, (string) $user['id']);
        $assignments = array_map(
            static fn (string $column): string => $column . ' = :' . $column,
            array_keys($values),
        );
        $parameters = $this->databaseValues($collection, $values);
        $parameters['id'] = $id;
        $parameters['owner'] = $user['id'];

        try {
            $statement = $this->database->pdo->prepare(sprintf(
                'UPDATE %s SET %s WHERE id = :id AND owner = :owner',
                $collection['name'],
                implode(', ', $assignments),
            ));
            $statement->execute($parameters);
        } catch (PDOException $exception) {
            if ($this->isConstraintViolation($exception)) {
                throw new ApiException(409, 'The update conflicts with an existing record.');
            }
            throw $exception;
        }

        $record = $this->ownedRecord($collection['name'], $id, (string) $user['id']);
        $this->respond($this->normalizeRecord($collection, $record));
    }

    private function completeIntervalSession(string $id, array $user): never
    {
        $body = $this->jsonBody();
        $allowedFields = ['runtime_state', 'elapsed_seconds', 'ended_at'];
        $unknown = array_values(array_diff(array_keys($body), $allowedFields));
        if ($unknown !== []) {
            throw new ApiException(422, 'The request contains unknown fields.', ['fields' => $unknown]);
        }
        $missing = array_values(array_diff($allowedFields, array_keys($body)));
        if ($missing !== []) {
            throw new ApiException(422, 'Required fields are missing.', ['fields' => $missing]);
        }

        $sessionCollection = $this->requireCollection('interval_sessions');
        $fields = $sessionCollection['config']['fields'];
        $runtime = $this->validateField('runtime_state', $body['runtime_state'], $fields['runtime_state']);
        $elapsedSeconds = $this->validateField(
            'elapsed_seconds',
            $body['elapsed_seconds'],
            $fields['elapsed_seconds'],
        );
        $endedAt = $this->validateField('ended_at', $body['ended_at'], $fields['ended_at']);
        if ($endedAt === '') {
            throw new ApiException(422, 'The ended_at field is required.', ['ended_at' => 'required']);
        }

        $owner = (string) $user['id'];
        $pdo = $this->database->pdo;
        $pdo->beginTransaction();
        try {
            $session = $this->ownedRecord('interval_sessions', $id, $owner);
            if ((string) $session['status'] === 'ended') {
                throw new ApiException(409, 'An ended interval session cannot be completed.');
            }

            if ((string) $session['status'] !== 'completed') {
                $statement = $pdo->prepare(
                    'UPDATE interval_sessions SET
                        status = :status,
                        runtime_state = :runtime_state,
                        elapsed_seconds = :elapsed_seconds,
                        ended_at = :ended_at
                     WHERE id = :id AND owner = :owner',
                );
                $statement->execute([
                    'status' => 'completed',
                    'runtime_state' => json_encode($runtime, JSON_THROW_ON_ERROR),
                    'elapsed_seconds' => $elapsedSeconds,
                    'ended_at' => $endedAt,
                    'id' => $id,
                    'owner' => $owner,
                ]);
            }

            $occurrence = $this->completeAttributedIntervalTask($session, $owner, $endedAt);
            $session = $this->ownedRecord('interval_sessions', $id, $owner);
            $pdo->commit();
        } catch (Throwable $exception) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $exception;
        }

        $this->respond([
            'session' => $this->normalizeRecord($sessionCollection, $session),
            'occurrence' => $occurrence,
        ]);
    }

    private function completeAttributedIntervalTask(
        array $session,
        string $owner,
        string $completedAt,
    ): ?array {
        $taskId = (string) ($session['task'] ?? '');
        $programStepId = (string) ($session['program_step'] ?? '');
        $taskDate = (string) ($session['task_date'] ?? '');
        if ($taskId === '' || $taskDate === '') {
            return null;
        }

        $statement = $this->database->pdo->prepare(
            'SELECT * FROM tasks WHERE id = :id AND owner = :owner LIMIT 1',
        );
        $statement->execute(['id' => $taskId, 'owner' => $owner]);
        $task = $statement->fetch();
        if (!is_array($task)) {
            return null;
        }

        $programStep = null;
        if ($programStepId !== '') {
            $statement = $this->database->pdo->prepare(
                'SELECT * FROM program_steps
                 WHERE id = :id AND task = :task AND owner = :owner LIMIT 1',
            );
            $statement->execute([
                'id' => $programStepId,
                'task' => $taskId,
                'owner' => $owner,
            ]);
            $programStep = $statement->fetch();
            if (!is_array($programStep)) {
                return null;
            }
        }

        $statement = $this->database->pdo->prepare(
            "SELECT * FROM occurrences
             WHERE task = :task AND program_step = :program_step AND scheduled_date = :scheduled_date
               AND owner = :owner
             LIMIT 1",
        );
        $statement->execute([
            'task' => $taskId,
            'program_step' => $programStepId,
            'scheduled_date' => $taskDate,
            'owner' => $owner,
        ]);
        $occurrence = $statement->fetch();

        if (is_array($occurrence)) {
            $update = $this->database->pdo->prepare(
                'UPDATE occurrences SET status = :status, completed_at = :completed_at
                 WHERE id = :id AND owner = :owner',
            );
            $update->execute([
                'status' => 'completed',
                'completed_at' => $completedAt,
                'id' => $occurrence['id'],
                'owner' => $owner,
            ]);
            $occurrence = $this->ownedRecord('occurrences', (string) $occurrence['id'], $owner);
        } else {
            $occurrenceId = $this->newId();
            $insert = $this->database->pdo->prepare(
                "INSERT INTO occurrences (
                    id, owner, task, program_step, scheduled_date, status, sealed,
                    completed_at, snapshot_name, snapshot_target, snapshot_unit
                 ) VALUES (
                    :id, :owner, :task, :program_step, :scheduled_date, 'completed', FALSE,
                    :completed_at, :snapshot_name, 1, ''
                 )",
            );
            $insert->execute([
                'id' => $occurrenceId,
                'owner' => $owner,
                'task' => $taskId,
                'program_step' => $programStepId,
                'scheduled_date' => $taskDate,
                'completed_at' => $completedAt,
                'snapshot_name' => (string) ($programStep['name'] ?? $task['name']),
            ]);
            $occurrence = $this->ownedRecord('occurrences', $occurrenceId, $owner);
        }

        return $this->normalizeRecord($this->requireCollection('occurrences'), $occurrence);
    }

    private function deleteRecord(array $collection, string $id, array $user): never
    {
        $owner = (string) $user['id'];
        $this->ownedRecord($collection['name'], $id, $owner);
        $pdo = $this->database->pdo;
        $pdo->beginTransaction();
        try {
            match ($collection['name']) {
                'tasks' => $this->deleteTask($id, $owner),
                'program_steps' => $this->deleteProgramStep($id, $owner),
                'occurrences' => $this->deleteOccurrence($id, $owner),
                'tags' => $this->deleteTag($id, $owner),
                'interval_templates' => $this->deleteIntervalTemplate($id, $owner),
                'tracking_trackers' => $this->deleteTrackingTracker($id, $owner),
                default => $this->deleteOwnedRow($collection['name'], $id, $owner),
            };
            $pdo->commit();
        } catch (Throwable $exception) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $exception;
        }

        $this->respond(null, 204);
    }

    private function deleteTask(string $id, string $owner): void
    {
        $statement = $this->database->pdo->prepare(
            "UPDATE interval_sessions SET task = '', program_step = ''
             WHERE task = :id AND owner = :owner",
        );
        $statement->execute(['id' => $id, 'owner' => $owner]);
        foreach (['entries', 'occurrences', 'program_steps'] as $table) {
            $statement = $this->database->pdo->prepare(
                "DELETE FROM {$table} WHERE task = :id AND owner = :owner",
            );
            $statement->execute(['id' => $id, 'owner' => $owner]);
        }
        $this->deleteOwnedRow('tasks', $id, $owner);
    }

    private function deleteProgramStep(string $id, string $owner): void
    {
        $statement = $this->database->pdo->prepare(
            "UPDATE interval_sessions SET program_step = ''
             WHERE program_step = :id AND owner = :owner",
        );
        $statement->execute(['id' => $id, 'owner' => $owner]);
        foreach (['entries', 'occurrences'] as $table) {
            $statement = $this->database->pdo->prepare(
                "DELETE FROM {$table} WHERE program_step = :id AND owner = :owner",
            );
            $statement->execute(['id' => $id, 'owner' => $owner]);
        }
        $this->deleteOwnedRow('program_steps', $id, $owner);
    }

    private function deleteOccurrence(string $id, string $owner): void
    {
        $statement = $this->database->pdo->prepare(
            'DELETE FROM entries WHERE occurrence = :id AND owner = :owner',
        );
        $statement->execute(['id' => $id, 'owner' => $owner]);
        $this->deleteOwnedRow('occurrences', $id, $owner);
    }

    private function deleteTag(string $id, string $owner): void
    {
        $statement = $this->database->pdo->prepare(
            'SELECT id, tags FROM tasks WHERE owner = :owner',
        );
        $statement->execute(['owner' => $owner]);
        $update = $this->database->pdo->prepare(
            'UPDATE tasks SET tags = :tags WHERE id = :id AND owner = :owner',
        );
        foreach ($statement->fetchAll() as $task) {
            $tags = json_decode((string) $task['tags'], true);
            if (!is_array($tags) || !in_array($id, $tags, true)) {
                continue;
            }
            $tags = array_values(array_filter($tags, static fn (mixed $tag): bool => $tag !== $id));
            $update->execute([
                'tags' => json_encode($tags, JSON_THROW_ON_ERROR),
                'id' => $task['id'],
                'owner' => $owner,
            ]);
        }
        $this->deleteOwnedRow('tags', $id, $owner);
    }

    private function deleteIntervalTemplate(string $id, string $owner): void
    {
        $statement = $this->database->pdo->prepare(
            'SELECT id, name FROM tasks
             WHERE interval_template = :id AND owner = :owner
             ORDER BY sort_order, name',
        );
        $statement->execute(['id' => $id, 'owner' => $owner]);
        $attachedTasks = $statement->fetchAll();
        $statement = $this->database->pdo->prepare(
            'SELECT program_steps.id, program_steps.name, tasks.name AS task_name
             FROM program_steps
             JOIN tasks ON tasks.id = program_steps.task AND tasks.owner = program_steps.owner
             WHERE program_steps.interval_template = :id AND program_steps.owner = :owner
             ORDER BY tasks.sort_order, program_steps.sort_order, program_steps.name',
        );
        $statement->execute(['id' => $id, 'owner' => $owner]);
        $attachedProgramSteps = $statement->fetchAll();
        if ($attachedTasks !== [] || $attachedProgramSteps !== []) {
            throw new ApiException(
                409,
                'This interval is attached to one or more tasks or program steps. Reassign them first.',
                [
                    'tasks' => array_map(static fn (array $task): array => [
                        'id' => (string) $task['id'],
                        'name' => (string) $task['name'],
                    ], $attachedTasks),
                    'programSteps' => array_map(static fn (array $step): array => [
                        'id' => (string) $step['id'],
                        'name' => (string) $step['name'],
                        'taskName' => (string) $step['task_name'],
                    ], $attachedProgramSteps),
                ],
            );
        }
        $statement = $this->database->pdo->prepare(
            "UPDATE interval_sessions SET template = '' WHERE template = :id AND owner = :owner",
        );
        $statement->execute(['id' => $id, 'owner' => $owner]);
        $this->deleteOwnedRow('interval_templates', $id, $owner);
    }

    private function deleteTrackingTracker(string $id, string $owner): void
    {
        $statement = $this->database->pdo->prepare(
            'DELETE FROM tracking_entries WHERE tracker = :id AND owner = :owner',
        );
        $statement->execute(['id' => $id, 'owner' => $owner]);
        $this->deleteOwnedRow('tracking_trackers', $id, $owner);
    }

    private function deleteOwnedRow(string $table, string $id, string $owner): void
    {
        $statement = $this->database->pdo->prepare(
            "DELETE FROM {$table} WHERE id = :id AND owner = :owner",
        );
        $statement->execute(['id' => $id, 'owner' => $owner]);
    }

    private function validateRecordInput(array $collection, array $body, bool $creating): array
    {
        unset($body['id'], $body['owner'], $body['created'], $body['updated']);
        $unknown = array_values(array_diff(array_keys($body), array_keys($collection['config']['fields'])));
        if ($unknown !== []) {
            throw new ApiException(422, 'The request contains unknown fields.', [
                'fields' => $unknown,
            ]);
        }

        if ($creating) {
            $missing = [];
            foreach ($collection['config']['required'] as $field) {
                if (!array_key_exists($field, $body)) {
                    $missing[] = $field;
                }
            }
            if ($missing !== []) {
                throw new ApiException(422, 'Required fields are missing.', ['fields' => $missing]);
            }
        }

        $validated = [];
        foreach ($body as $field => $value) {
            $validated[$field] = $this->validateField(
                $field,
                $value,
                $collection['config']['fields'][$field],
            );
        }

        return $validated;
    }

    private function validateField(string $field, mixed $value, array $rules): mixed
    {
        $required = (bool) ($rules['required'] ?? false);
        $allowEmpty = (bool) ($rules['allowEmpty'] ?? false);

        if (in_array($rules['type'], ['text', 'choice', 'date_key', 'time_key', 'timestamp', 'relation'], true)) {
            if (!is_string($value)) {
                throw new ApiException(422, "The {$field} field must be a string.", [$field => 'string']);
            }
            if ($value === '') {
                if ($required || !$allowEmpty && $rules['type'] === 'relation') {
                    throw new ApiException(422, "The {$field} field is required.", [$field => 'required']);
                }
                return '';
            }
        }

        return match ($rules['type']) {
            'text' => $this->validateText($value, $field, $rules['max'], $required),
            'choice' => $this->validateChoice($value, $field, $rules),
            'boolean' => $this->validateBoolean($value, $field),
            'integer' => $this->validateInteger($value, $field, $rules),
            'number' => $this->validateNumber($value, $field, $rules),
            'date_key' => $this->validateDateKey($value, $field),
            'time_key' => $this->validateTimeKey($value, $field),
            'timestamp' => $this->validateTimestamp($value, $field),
            'relation' => $this->validateRelationId($value, $field),
            'json', 'json_array', 'number_array' => $this->validateJson($value, $field, $rules),
            default => throw new ApiException(500, 'An API field is not configured correctly.'),
        };
    }

    private function validateText(
        mixed $value,
        string $field,
        int $max,
        bool $required = false,
    ): string {
        if (!is_string($value)) {
            throw new ApiException(422, "The {$field} field must be a string.", [$field => 'string']);
        }
        $value = trim($value);
        if ($required && $value === '') {
            throw new ApiException(422, "The {$field} field is required.", [$field => 'required']);
        }
        $length = function_exists('mb_strlen') ? mb_strlen($value) : strlen($value);
        if ($length > $max) {
            throw new ApiException(422, "The {$field} field is too long.", [$field => "max:{$max}"]);
        }

        return $value;
    }

    private function validateChoice(string $value, string $field, array $rules): string
    {
        if ($value === '' && ($rules['allowEmpty'] ?? false)) {
            return '';
        }
        if (!in_array($value, $rules['values'], true)) {
            throw new ApiException(422, "The {$field} field has an invalid value.", [
                $field => 'choice',
            ]);
        }
        return $value;
    }

    private function validateBoolean(mixed $value, string $field): bool
    {
        if (!is_bool($value)) {
            throw new ApiException(422, "The {$field} field must be true or false.", [
                $field => 'boolean',
            ]);
        }
        return $value;
    }

    private function validateInteger(mixed $value, string $field, array $rules): int
    {
        if (!is_int($value)) {
            throw new ApiException(422, "The {$field} field must be an integer.", [
                $field => 'integer',
            ]);
        }
        if (($rules['min'] ?? null) !== null && $value < $rules['min']) {
            throw new ApiException(422, "The {$field} field is too small.", [$field => 'min']);
        }
        if (($rules['max'] ?? null) !== null && $value > $rules['max']) {
            throw new ApiException(422, "The {$field} field is too large.", [$field => 'max']);
        }
        return $value;
    }

    private function validateNumber(mixed $value, string $field, array $rules): int|float
    {
        if (!is_int($value) && !is_float($value) || is_float($value) && !is_finite($value)) {
            throw new ApiException(422, "The {$field} field must be a finite number.", [
                $field => 'number',
            ]);
        }
        if (($rules['min'] ?? null) !== null && $value < $rules['min']) {
            throw new ApiException(422, "The {$field} field is too small.", [$field => 'min']);
        }
        if (($rules['max'] ?? null) !== null && $value > $rules['max']) {
            throw new ApiException(422, "The {$field} field is too large.", [$field => 'max']);
        }
        return $value;
    }

    private function validateDateKey(string $value, string $field): string
    {
        if ($value === '') {
            return '';
        }
        if (preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $value, $matches) !== 1) {
            throw new ApiException(422, "The {$field} field must use YYYY-MM-DD.", [
                $field => 'date',
            ]);
        }
        if (!checkdate((int) $matches[2], (int) $matches[3], (int) $matches[1])) {
            throw new ApiException(422, "The {$field} field is not a valid date.", [$field => 'date']);
        }
        return $value;
    }

    private function validateTimestamp(string $value, string $field): string
    {
        if ($value === '') {
            return '';
        }
        if (preg_match(
            '/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})?$/',
            $value,
        ) !== 1) {
            throw new ApiException(422, "The {$field} field is not an ISO timestamp.", [
                $field => 'timestamp',
            ]);
        }
        try {
            new DateTimeImmutable($value);
        } catch (Throwable) {
            throw new ApiException(422, "The {$field} field is not a valid timestamp.", [
                $field => 'timestamp',
            ]);
        }
        return $value;
    }

    private function validateTimeKey(string $value, string $field): string
    {
        if (preg_match('/^(?:[01]\d|2[0-3]):[0-5]\d$/', $value) !== 1) {
            throw new ApiException(422, "The {$field} field must use HH:MM.", [
                $field => 'time',
            ]);
        }
        return $value;
    }

    private function validateRelationId(string $value, string $field): string
    {
        if ($value === '') {
            return '';
        }
        if (preg_match('/^[a-zA-Z0-9_-]{1,64}$/', $value) !== 1) {
            throw new ApiException(422, "The {$field} field is not a valid record ID.", [
                $field => 'relation',
            ]);
        }
        return $value;
    }

    private function validateJson(mixed $value, string $field, array $rules): mixed
    {
        if ($rules['type'] === 'json_array' || $rules['type'] === 'number_array') {
            if (!is_array($value) || !array_is_list($value)) {
                throw new ApiException(422, "The {$field} field must be an array.", [
                    $field => 'array',
                ]);
            }
        } elseif (!is_array($value)) {
            throw new ApiException(422, "The {$field} field must be a JSON object or array.", [
                $field => 'json',
            ]);
        }

        if ($rules['type'] === 'number_array') {
            foreach ($value as $item) {
                if (!is_int($item) && !is_float($item) || is_float($item) && !is_finite($item)) {
                    throw new ApiException(422, "The {$field} field may contain only numbers.", [
                        $field => 'number_array',
                    ]);
                }
            }
        }

        $encoded = json_encode($value, JSON_THROW_ON_ERROR);
        if (strlen($encoded) > $rules['max']) {
            throw new ApiException(422, "The {$field} JSON value is too large.", [
                $field => 'max',
            ]);
        }
        return $value;
    }

    private function validateRelations(string $collection, array $record, string $owner): void
    {
        if ($collection === 'tracking_trackers') {
            $kind = (string) ($record['kind'] ?? '');
            $aggregation = (string) ($record['daily_aggregation'] ?? '');
            $validAggregation = match ($kind) {
                'yes_no' => $aggregation === 'last',
                'event' => $aggregation === 'count',
                'rating' => $aggregation === 'average',
                'duration' => $aggregation === 'sum',
                'number' => in_array($aggregation, ['last', 'average', 'sum'], true),
                default => false,
            };
            if (!$validAggregation) {
                throw new ApiException(422, 'The daily calculation does not match the tracker type.');
            }
            if (
                $kind === 'rating'
                && (float) ($record['scale_max'] ?? 0) <= (float) ($record['scale_min'] ?? 0)
            ) {
                throw new ApiException(422, 'A rating scale maximum must be greater than its minimum.');
            }
            return;
        }

        if ($collection === 'tasks') {
            foreach (($record['tags'] ?? []) as $tag) {
                if (!is_string($tag) || !$this->relationExists('tags', $tag, $owner)) {
                    throw new ApiException(422, 'A selected tag is invalid.');
                }
            }
            $intervalTemplate = (string) ($record['interval_template'] ?? '');
            if (($record['type'] ?? '') === 'interval') {
                if (!$this->relationExists('interval_templates', $intervalTemplate, $owner)) {
                    throw new ApiException(422, 'Select a valid interval for this task.');
                }
            } elseif ($intervalTemplate !== '') {
                throw new ApiException(422, 'Only interval tasks may have an attached interval.');
            }
            return;
        }

        if ($collection === 'program_steps') {
            $task = (string) ($record['task'] ?? '');
            if (!$this->relationExists('tasks', $task, $owner)) {
                throw new ApiException(422, 'The selected task is invalid.');
            }
            $parentTask = $this->ownedRecord('tasks', $task, $owner);
            if (($parentTask['type'] ?? '') !== 'program') {
                throw new ApiException(422, 'Program steps may only belong to a program task.');
            }

            $completionType = (string) ($record['completion_type'] ?? '');
            $intervalTemplate = (string) ($record['interval_template'] ?? '');
            $active = (bool) ($record['active'] ?? false);
            if ($completionType === 'interval') {
                if ($active && !$this->relationExists('interval_templates', $intervalTemplate, $owner)) {
                    throw new ApiException(422, 'Select a valid interval for this program step.');
                }
                if ($intervalTemplate !== '' && !$this->relationExists('interval_templates', $intervalTemplate, $owner)) {
                    throw new ApiException(422, 'The selected interval is invalid.');
                }
            } elseif ($intervalTemplate !== '') {
                throw new ApiException(422, 'Only interval program steps may have an attached interval.');
            }
            return;
        }

        if (in_array($collection, ['occurrences', 'entries'], true)) {
            if (
                $collection === 'entries'
                && preg_match('/[\r\n]/', (string) ($record['note'] ?? '')) === 1
            ) {
                throw new ApiException(422, 'Entry notes must be a single line.', [
                    'note' => 'single_line',
                ]);
            }

            $task = (string) ($record['task'] ?? '');
            if (!$this->relationExists('tasks', $task, $owner)) {
                throw new ApiException(422, 'The selected task is invalid.');
            }

            $step = (string) ($record['program_step'] ?? '');
            if ($step !== '' && !$this->relationMatchesTask('program_steps', $step, $task, $owner)) {
                throw new ApiException(422, 'The selected program step is invalid.');
            }

            $occurrence = (string) ($record['occurrence'] ?? '');
            if ($occurrence !== '' && !$this->relationMatchesTask('occurrences', $occurrence, $task, $owner)) {
                throw new ApiException(422, 'The selected occurrence is invalid.');
            }
            return;
        }

        if ($collection === 'interval_sessions') {
            $template = (string) ($record['template'] ?? '');
            if ($template !== '' && !$this->relationExists('interval_templates', $template, $owner)) {
                throw new ApiException(422, 'The selected interval template is invalid.');
            }
            $task = (string) ($record['task'] ?? '');
            $programStep = (string) ($record['program_step'] ?? '');
            if ($task === '' && $programStep !== '') {
                throw new ApiException(422, 'A program step interval must include its task.');
            }
            if (
                $task !== ''
                && !$this->intervalAttributionMatchesTemplate(
                    $task,
                    $programStep,
                    $template,
                    $owner,
                )
            ) {
                throw new ApiException(422, 'The selected task or program step is not attached to this interval.');
            }
            return;
        }

        if ($collection === 'tracking_entries') {
            $tracker = (string) ($record['tracker'] ?? '');
            if (!$this->relationExists('tracking_trackers', $tracker, $owner)) {
                throw new ApiException(422, 'The selected tracker is invalid.');
            }
            $definition = $this->ownedRecord('tracking_trackers', $tracker, $owner);
            $kind = (string) $definition['kind'];
            $value = (float) ($record['value'] ?? 0);
            if (in_array($kind, ['yes_no', 'event'], true) && $value !== 0.0 && $value !== 1.0) {
                throw new ApiException(422, 'This tracker accepts only an explicit yes/no value.');
            }
            if ($kind === 'duration' && $value < 0) {
                throw new ApiException(422, 'A tracked duration cannot be negative.');
            }
            if (
                $kind === 'rating'
                && ($value < (float) $definition['scale_min'] || $value > (float) $definition['scale_max'])
            ) {
                throw new ApiException(422, 'The rating is outside this tracker’s scale.');
            }
        }
    }

    private function validateTrackerDefinitionUpdate(array $existing, array $body, string $owner): void
    {
        $immutable = ['kind', 'unit', 'scale_min', 'scale_max', 'daily_aggregation'];
        $changed = array_filter(
            $immutable,
            static fn (string $field): bool => array_key_exists($field, $body)
                && (string) $body[$field] !== (string) ($existing[$field] ?? ''),
        );
        if ($changed === []) {
            return;
        }

        $statement = $this->database->pdo->prepare(
            'SELECT 1 FROM tracking_entries WHERE tracker = :tracker AND owner = :owner LIMIT 1',
        );
        $statement->execute(['tracker' => $existing['id'], 'owner' => $owner]);
        if ($statement->fetchColumn() !== false) {
            throw new ApiException(
                409,
                'This tracker already has entries, so its measurement settings cannot be changed.',
                ['fields' => array_values($changed)],
            );
        }
    }

    private function validateNewIntervalSession(array $record, array $user): void
    {
        if (($record['status'] ?? '') !== 'running') {
            throw new ApiException(422, 'A new interval session must start in the running state.');
        }

        $owner = (string) $user['id'];
        $statement = $this->database->pdo->prepare(
            "SELECT id FROM interval_sessions
             WHERE owner = :owner AND status IN ('running', 'paused')
             ORDER BY started_at DESC LIMIT 1",
        );
        $statement->execute(['owner' => $owner]);
        $activeSession = $statement->fetchColumn();
        if ($activeSession !== false) {
            throw new ApiException(
                409,
                'Another interval session is already active.',
                ['activeSession' => (string) $activeSession],
            );
        }

        $source = (string) ($record['source'] ?? '');
        $template = (string) ($record['template'] ?? '');
        $taskId = (string) ($record['task'] ?? '');
        $programStepId = (string) ($record['program_step'] ?? '');
        if ($source === 'template' && $template === '') {
            throw new ApiException(422, 'A saved interval session requires a template.');
        }
        if ($source === 'quick' && ($template !== '' || $taskId !== '' || $programStepId !== '')) {
            throw new ApiException(422, 'Quick intervals must run standalone.');
        }
        if ($taskId === '') {
            if ($programStepId !== '') {
                throw new ApiException(422, 'A program step interval must include its task.');
            }
            return;
        }
        if (!$this->intervalAttributionMatchesTemplate($taskId, $programStepId, $template, $owner)) {
            throw new ApiException(422, 'The selected task or program step is not attached to this interval.');
        }

        $statement = $this->database->pdo->prepare(
            'SELECT * FROM tasks WHERE id = :id AND owner = :owner LIMIT 1',
        );
        $statement->execute(['id' => $taskId, 'owner' => $owner]);
        $task = $statement->fetch();
        if (
            !is_array($task)
            || !(bool) $task['active']
            || !$this->intervalAttributionIsOpenOnDate(
                $task,
                $programStepId,
                (string) $record['task_date'],
                $owner,
            )
        ) {
            throw new ApiException(409, 'The selected task or program step is not open for this date.');
        }
    }

    private function intervalAttributionMatchesTemplate(
        string $taskId,
        string $programStepId,
        string $templateId,
        string $owner,
    ): bool
    {
        if ($taskId === '' || $templateId === '') {
            return false;
        }
        if ($programStepId === '') {
            $statement = $this->database->pdo->prepare(
                "SELECT 1 FROM tasks
                 WHERE id = :id AND owner = :owner AND type = 'interval'
                   AND interval_template = :template
                 LIMIT 1",
            );
            $statement->execute([
                'id' => $taskId,
                'owner' => $owner,
                'template' => $templateId,
            ]);
            return $statement->fetchColumn() !== false;
        }

        $statement = $this->database->pdo->prepare(
            "SELECT 1 FROM program_steps
             JOIN tasks ON tasks.id = program_steps.task AND tasks.owner = program_steps.owner
             WHERE program_steps.id = :program_step
               AND program_steps.task = :task
               AND program_steps.owner = :owner
               AND program_steps.active = TRUE
               AND program_steps.completion_type = 'interval'
               AND program_steps.interval_template = :template
               AND tasks.type = 'program'
             LIMIT 1",
        );
        $statement->execute([
            'program_step' => $programStepId,
            'task' => $taskId,
            'owner' => $owner,
            'template' => $templateId,
        ]);
        return $statement->fetchColumn() !== false;
    }

    private function intervalAttributionIsOpenOnDate(
        array $task,
        string $programStepId,
        string $dateKey,
        string $owner,
    ): bool
    {
        $statement = $this->database->pdo->prepare(
            "SELECT status FROM occurrences
             WHERE task = :task AND program_step = :program_step AND scheduled_date = :scheduled_date
               AND owner = :owner
             LIMIT 1",
        );
        $statement->execute([
            'task' => $task['id'],
            'program_step' => $programStepId,
            'scheduled_date' => $dateKey,
            'owner' => $owner,
        ]);
        $status = $statement->fetchColumn();
        if ($status !== false) {
            return $status === 'pending';
        }
        if ($programStepId !== '') {
            $statement = $this->database->pdo->prepare(
                'SELECT * FROM program_steps
                 WHERE id = :id AND task = :task AND owner = :owner AND active = TRUE
                 LIMIT 1',
            );
            $statement->execute([
                'id' => $programStepId,
                'task' => $task['id'],
                'owner' => $owner,
            ]);
            $programStep = $statement->fetch();
            return is_array($programStep)
                && $this->programStepScheduledOnDate($task, $programStep, $dateKey);
        }
        return $this->taskScheduledOnDate($task, $dateKey);
    }

    private function programStepScheduledOnDate(array $task, array $step, string $dateKey): bool
    {
        $startDate = (string) ($task['start_date'] ?? '');
        $endDate = (string) ($task['end_date'] ?? '');
        if ($startDate === '' || $dateKey < $startDate || ($endDate !== '' && $dateKey > $endDate)) {
            return false;
        }

        $cycleLength = max(1, (int) ($task['cycle_length'] ?? 0));
        $start = new DateTimeImmutable($startDate . 'T12:00:00');
        $date = new DateTimeImmutable($dateKey . 'T12:00:00');
        $elapsed = (int) $start->diff($date)->format('%r%a');
        if ($elapsed < 0 || (!(bool) ($task['program_repeat'] ?? false) && $elapsed >= $cycleLength)) {
            return false;
        }

        $cycleDays = $this->decodeJsonColumn($step['cycle_days'] ?? '[]');
        if (!is_array($cycleDays)) {
            return false;
        }
        $cycleDay = ($elapsed % $cycleLength) + 1;
        return in_array($cycleDay, array_map('intval', $cycleDays), true);
    }

    private function taskScheduledOnDate(array $task, string $dateKey): bool
    {
        $startDate = (string) ($task['start_date'] ?? '');
        $endDate = (string) ($task['end_date'] ?? '');
        if ($startDate === '' || $dateKey < $startDate || $endDate !== '' && $dateKey > $endDate) {
            return false;
        }

        $recurrence = (string) ($task['recurrence_type'] ?? '');
        if ($recurrence === 'daily') {
            return true;
        }

        $weekdays = $this->decodeJsonColumn($task['weekdays'] ?? '[]');
        if (!is_array($weekdays)) {
            return false;
        }
        $date = new DateTimeImmutable($dateKey . 'T12:00:00');
        $weekday = (int) $date->format('w');
        if (!in_array($weekday, array_map('intval', $weekdays), true)) {
            return false;
        }
        if ($recurrence === 'weekdays') {
            return true;
        }
        if ($recurrence !== 'interval_weeks') {
            return false;
        }

        $start = new DateTimeImmutable($startDate . 'T12:00:00');
        $startWeek = $start->modify('monday this week');
        $dateWeek = $date->modify('monday this week');
        $days = (int) $startWeek->diff($dateWeek)->format('%r%a');
        $weeks = intdiv($days, 7);
        return $weeks >= 0 && $weeks % max(1, (int) $task['interval_weeks']) === 0;
    }

    private function dateKeyInTimezone(string $timestamp, string $timezone): string
    {
        return (new DateTimeImmutable($timestamp))
            ->setTimezone(new DateTimeZone($timezone))
            ->format('Y-m-d');
    }

    private function relationExists(string $table, string $id, string $owner): bool
    {
        if ($id === '') {
            return false;
        }
        $statement = $this->database->pdo->prepare(
            "SELECT 1 FROM {$table} WHERE id = :id AND owner = :owner LIMIT 1",
        );
        $statement->execute(['id' => $id, 'owner' => $owner]);
        return $statement->fetchColumn() !== false;
    }

    private function relationMatchesTask(string $table, string $id, string $task, string $owner): bool
    {
        $statement = $this->database->pdo->prepare(
            "SELECT 1 FROM {$table}
             WHERE id = :id AND task = :task AND owner = :owner LIMIT 1",
        );
        $statement->execute(['id' => $id, 'task' => $task, 'owner' => $owner]);
        return $statement->fetchColumn() !== false;
    }

    private function compileSort(string $sort, array $allowedFields): string
    {
        if ($sort === '') {
            return 'id ASC';
        }
        if (strlen($sort) > 200) {
            throw new ApiException(422, 'The sort expression is too long.');
        }

        $parts = [];
        foreach (explode(',', $sort) as $rawField) {
            $rawField = trim($rawField);
            $direction = str_starts_with($rawField, '-') ? 'DESC' : 'ASC';
            $field = ltrim($rawField, '+-');
            if (!in_array($field, $allowedFields, true)) {
                throw new ApiException(422, 'The requested sort field is not allowed.');
            }
            $parts[] = $field . ' ' . $direction;
        }

        return implode(', ', $parts) . ', id ASC';
    }

    private function compileFilter(string $filter, array $allowedFields): array
    {
        $filter = trim($filter);
        if ($filter === '') {
            return ['', []];
        }
        if (strlen($filter) > 500) {
            throw new ApiException(422, 'The filter expression is too long.');
        }

        $parameters = [];
        $groups = [];
        foreach (preg_split('/\s*\|\|\s*/', $filter) ?: [] as $orIndex => $orExpression) {
            $clauses = [];
            foreach (preg_split('/\s*&&\s*/', $orExpression) ?: [] as $andIndex => $expression) {
                if (preg_match(
                    '/^([a-z_][a-z0-9_]*)\s*(=|!=|>=|<=|>|<)\s*(?:"([^"]*)"|(-?\d+(?:\.\d+)?)|(true|false))$/',
                    trim($expression),
                    $matches,
                    PREG_UNMATCHED_AS_NULL,
                ) !== 1) {
                    throw new ApiException(422, 'The filter expression is invalid.');
                }
                $field = $matches[1];
                if (!in_array($field, $allowedFields, true)) {
                    throw new ApiException(422, 'The requested filter field is not allowed.');
                }
                $key = 'filter_' . $orIndex . '_' . $andIndex;
                if ($matches[3] !== null) {
                    $value = $matches[3];
                } elseif ($matches[4] !== null) {
                    $value = str_contains($matches[4], '.') ? (float) $matches[4] : (int) $matches[4];
                } else {
                    $value = $matches[5] === 'true' ? 1 : 0;
                }
                $parameters[$key] = $value;
                $operator = $matches[2] === '!=' ? '<>' : $matches[2];
                $clauses[] = "{$field} {$operator} :{$key}";
            }
            $groups[] = '(' . implode(' AND ', $clauses) . ')';
        }

        return [implode(' OR ', $groups), $parameters];
    }

    private function normalizeRecord(array $collection, array $record): array
    {
        foreach ($collection['config']['fields'] as $field => $rules) {
            if (!array_key_exists($field, $record)) {
                continue;
            }
            $record[$field] = match ($rules['type']) {
                'boolean' => (bool) $record[$field],
                'integer' => (int) $record[$field],
                'number' => (float) $record[$field],
                'json', 'json_array', 'number_array' => $this->decodeJsonColumn($record[$field]),
                default => $record[$field],
            };
        }

        return $record;
    }

    private function databaseValues(array $collection, array $values): array
    {
        foreach ($values as $field => $value) {
            $type = $collection['config']['fields'][$field]['type'] ?? null;
            if (in_array($type, ['json', 'json_array', 'number_array'], true)) {
                $values[$field] = json_encode($value, JSON_THROW_ON_ERROR);
            } elseif ($type === 'boolean') {
                $values[$field] = $value ? 1 : 0;
            }
        }
        return $values;
    }

    private function decodeJsonColumn(mixed $value): mixed
    {
        if ($value === null) {
            return null;
        }
        try {
            return json_decode((string) $value, true, flags: JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            throw new ApiException(500, 'The database contains an invalid JSON value.');
        }
    }

    private function ownedRecord(string $table, string $id, string $owner): array
    {
        $statement = $this->database->pdo->prepare(
            "SELECT * FROM {$table} WHERE id = :id AND owner = :owner LIMIT 1",
        );
        $statement->execute(['id' => $id, 'owner' => $owner]);
        $record = $statement->fetch();
        if (!is_array($record)) {
            throw new ApiException(404, 'Record not found.');
        }
        return $record;
    }

    private function requireCollection(string $name): array
    {
        $config = Schema::collection($name);
        if ($config === null) {
            throw new ApiException(404, 'Collection not found.');
        }
        return ['name' => $name, 'config' => $config];
    }

    private function jsonBody(): array
    {
        $contentLength = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
        if ($contentLength > $this->config->maxBodyBytes) {
            throw new ApiException(413, 'The request body is too large.');
        }
        $raw = file_get_contents('php://input', false, null, 0, $this->config->maxBodyBytes + 1);
        if ($raw === false || strlen($raw) > $this->config->maxBodyBytes) {
            throw new ApiException(413, 'The request body is too large.');
        }
        try {
            $body = json_decode($raw, true, flags: JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            throw new ApiException(400, 'The request body must contain valid JSON.');
        }
        if (!is_array($body) || array_is_list($body)) {
            throw new ApiException(400, 'The request body must be a JSON object.');
        }
        return $body;
    }

    private function normalizeEmail(mixed $value): string
    {
        if (!is_string($value)) {
            throw new ApiException(422, 'A valid email address is required.', ['email' => 'email']);
        }
        $email = strtolower(trim($value));
        if (strlen($email) > 254 || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
            throw new ApiException(422, 'A valid email address is required.', ['email' => 'email']);
        }
        return $email;
    }

    private function validatePassword(mixed $value, bool $enforceMinimum): string
    {
        if (!is_string($value) || strlen($value) > 128) {
            throw new ApiException(422, 'The password is invalid.', ['password' => 'password']);
        }
        if ($enforceMinimum && strlen($value) < 8) {
            throw new ApiException(422, 'Use a password containing at least 8 characters.', [
                'password' => 'min:8',
            ]);
        }
        return $value;
    }

    private function publicUser(array $user): array
    {
        $avatar = $this->validAvatarFilename($user['avatar'] ?? null);
        return [
            'id' => $user['id'],
            'email' => $user['email'],
            'verified' => (bool) $user['verified'],
            'name' => $user['name'],
            'avatar' => $avatar === null ? '' : '/avatars/' . $avatar,
            'timezone' => $user['timezone'],
            'settings' => (object) $this->decodeUserSettings($user['settings'] ?? '{}'),
            'created' => $user['created'],
            'updated' => $user['updated'],
        ];
    }

    private function rateLimit(string $key, int $maximum, int $windowSeconds): void
    {
        $now = time();
        $cutoff = $now - $windowSeconds;
        $rateKey = hash_hmac('sha256', $key, $this->config->secret);
        $statement = $this->database->pdo->prepare(
            'INSERT INTO mom_rate_limits (rate_key, window_start, hits)
             VALUES (:rate_key, :now, 1)
             ON CONFLICT(rate_key) DO UPDATE SET
                hits = CASE WHEN window_start <= :cutoff THEN 1 ELSE hits + 1 END,
                window_start = CASE WHEN window_start <= :cutoff THEN :now ELSE window_start END',
        );
        $statement->execute(['rate_key' => $rateKey, 'now' => $now, 'cutoff' => $cutoff]);

        $statement = $this->database->pdo->prepare(
            'SELECT window_start, hits FROM mom_rate_limits WHERE rate_key = :rate_key',
        );
        $statement->execute(['rate_key' => $rateKey]);
        $limit = $statement->fetch();
        if (is_array($limit) && (int) $limit['hits'] > $maximum) {
            header('Retry-After: ' . max(1, (int) $limit['window_start'] + $windowSeconds - $now));
            throw new ApiException(429, 'Too many attempts. Please try again later.');
        }

        if (random_int(1, 100) === 1) {
            $cleanup = $this->database->pdo->prepare(
                'DELETE FROM mom_rate_limits WHERE window_start < :expired',
            );
            $cleanup->execute(['expired' => $now - 86400]);
        }
    }

    private function positiveIntegerQuery(string $name, int $default): int
    {
        if (!isset($_GET[$name])) {
            return $default;
        }
        $value = filter_var($_GET[$name], FILTER_VALIDATE_INT, [
            'options' => ['min_range' => 1],
        ]);
        if ($value === false) {
            throw new ApiException(422, "The {$name} query parameter must be a positive integer.");
        }
        return (int) $value;
    }

    private function clientIp(): string
    {
        return (string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown');
    }

    private function newId(): string
    {
        return 'r' . bin2hex(random_bytes(7));
    }

    private function randomTokenVersionKey(): string
    {
        return substr($this->base64UrlEncode(random_bytes(38)), 0, 50);
    }

    private function tokenVersion(string $tokenVersionKey): string
    {
        return substr(hash_hmac('sha256', $tokenVersionKey, $this->config->secret), 0, 24);
    }

    private function now(): string
    {
        return (new DateTimeImmutable('now'))->format('Y-m-d H:i:s.v\Z');
    }

    private function base64UrlEncode(string $value): string
    {
        return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
    }

    private function base64UrlDecode(string $value): string
    {
        $padding = strlen($value) % 4;
        if ($padding !== 0) {
            $value .= str_repeat('=', 4 - $padding);
        }
        $decoded = base64_decode(strtr($value, '-_', '+/'), true);
        if ($decoded === false) {
            throw new ApiException(401, 'The authentication token is invalid.');
        }
        return $decoded;
    }

    private function pdoType(mixed $value): int
    {
        return match (true) {
            is_int($value) => PDO::PARAM_INT,
            is_bool($value) => PDO::PARAM_BOOL,
            $value === null => PDO::PARAM_NULL,
            default => PDO::PARAM_STR,
        };
    }

    private function isConstraintViolation(PDOException $exception): bool
    {
        return $exception->getCode() === '23000'
            || str_contains(strtolower($exception->getMessage()), 'constraint');
    }

    private function respond(mixed $body, int $status = 200): never
    {
        http_response_code($status);
        if ($status !== 204) {
            echo json_encode($body, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
        }
        exit;
    }
}
