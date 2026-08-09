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
    private const MAX_FLASHCARD_IMPORT_ROWS = 500;
    private const PASSKEY_CHALLENGE_TTL = 300;
    private const MAIN_MENU_ITEMS = ['tasks', 'intervals', 'flashcards', 'tracking', 'journal'];
    private const FLASHCARD_REVIEW_SETTING_FIELDS = [
        'mode', 'card_sides', 'indefinite', 'max_cards', 'front_seconds', 'back_seconds',
        'back_speech_repeat_count', 'note_before_back',
        'speech_enabled', 'front_language', 'back_language',
        'sort_mode',
    ];
    private readonly CodexBridgeClient $codexBridge;
    private readonly SyncService $syncService;

    public function __construct(
        private readonly Config $config,
        private readonly Database $database,
    ) {
        $this->codexBridge = new CodexBridgeClient(
            $config->codexBridgeUrl,
            $config->codexBridgeToken,
            $config->secret,
        );
        $this->syncService = new SyncService($database, $config);
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
            if (
                ($method === 'POST' || $method === 'DELETE')
                && preg_match(
                    '#^/flashcards/([a-zA-Z0-9_-]{1,64})/image/?$#',
                    $path,
                    $flashcardImageMatches,
                ) === 1
            ) {
                $this->flashcardImage(
                    $method,
                    $flashcardImageMatches[1],
                    $this->authenticate(),
                );
            }
            if (
                $method === 'GET'
                && preg_match(
                    '#^/flashcard-images/([a-f0-9]{48}\.jpg)$#',
                    $path,
                    $flashcardImageFileMatches,
                ) === 1
            ) {
                $this->serveFlashcardImage($flashcardImageFileMatches[1]);
            }
            if ($method === 'GET' && $path === '/image-library/search') {
                $this->searchImageLibrary($this->authenticate());
            }
            if (
                $method === 'POST'
                && preg_match(
                    '#^/flashcards/([a-zA-Z0-9_-]{1,64})/library-image/?$#',
                    $path,
                    $flashcardLibraryImageMatches,
                ) === 1
            ) {
                $this->setFlashcardLibraryImage(
                    $flashcardLibraryImageMatches[1],
                    $this->authenticate(),
                );
            }
            if (($method === 'GET' || $method === 'PATCH') && $path === '/auth/settings') {
                $this->userSettings($method);
            }
            if ($method === 'POST' && $path === '/sync/bootstrap') {
                $this->respond($this->syncService->bootstrap(
                    $this->authenticate(),
                    $this->jsonBody(),
                ));
            }
            if ($method === 'POST' && $path === '/sync/exchange') {
                $this->respond($this->syncService->exchange(
                    $this->authenticate(),
                    $this->jsonBody(),
                ));
            }
            if (
                in_array($method, ['GET', 'POST', 'DELETE'], true)
                && $path === '/auth/chatgpt'
            ) {
                $this->chatGPTConnection($method);
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
            if (
                $method === 'PATCH'
                && preg_match(
                    '#^/interval-sessions/([a-zA-Z0-9_-]{1,64})/flashcards/?$#',
                    $path,
                    $intervalFlashcardMatches,
                ) === 1
            ) {
                $this->updateIntervalFlashcards($intervalFlashcardMatches[1], $this->authenticate());
            }
            if ($method === 'GET' && $path === '/flashcard-review-sets') {
                $this->listAccessibleFlashcardReviewSets($this->authenticate());
            }
            if (
                $method === 'PATCH'
                && preg_match(
                    '#^/flashcard-review-sets/([a-zA-Z0-9_-]{1,64})/preferences/?$#',
                    $path,
                    $reviewSetPreferenceMatches,
                ) === 1
            ) {
                $this->updateFlashcardReviewSetPreferences(
                    $reviewSetPreferenceMatches[1],
                    $this->authenticate(),
                );
            }
            if (
                ($method === 'GET' || $method === 'POST')
                && preg_match(
                    '#^/flashcard-review-sets/([a-zA-Z0-9_-]{1,64})/shares/?$#',
                    $path,
                    $reviewSetShareMatches,
                ) === 1
            ) {
                $this->flashcardReviewSetShares(
                    $method,
                    $reviewSetShareMatches[1],
                    $this->authenticate(),
                );
            }
            if (
                ($method === 'PATCH' || $method === 'DELETE')
                && preg_match(
                    '#^/flashcard-review-set-shares/([a-zA-Z0-9_-]{1,64})/?$#',
                    $path,
                    $reviewSetShareRecordMatches,
                ) === 1
            ) {
                $this->flashcardReviewSetShareRecord(
                    $method,
                    $reviewSetShareRecordMatches[1],
                    $this->authenticate(),
                );
            }
            if (
                $method === 'POST'
                && preg_match(
                    '#^/flashcard-review-sets/([a-zA-Z0-9_-]{1,64})/copies/?$#',
                    $path,
                    $reviewSetCopyMatches,
                ) === 1
            ) {
                $this->copySharedFlashcardReviewSet(
                    $reviewSetCopyMatches[1],
                    $this->authenticate(),
                );
            }
            if (
                $method === 'POST'
                && preg_match(
                    '#^/flashcard-review-sets/([a-zA-Z0-9_-]{1,64})/cards/import/?$#',
                    $path,
                    $sharedCardImportMatches,
                ) === 1
            ) {
                $this->importSharedFlashcards(
                    $sharedCardImportMatches[1],
                    $this->authenticate(),
                );
            }
            if (
                $method === 'POST'
                && preg_match(
                    '#^/flashcard-review-sets/([a-zA-Z0-9_-]{1,64})/cards/bulk/?$#',
                    $path,
                    $sharedCardBulkMatches,
                ) === 1
            ) {
                $this->bulkUpdateSharedFlashcards(
                    $sharedCardBulkMatches[1],
                    $this->authenticate(),
                );
            }
            if (
                ($method === 'POST' || $method === 'DELETE')
                && preg_match(
                    '#^/flashcard-review-sets/([a-zA-Z0-9_-]{1,64})/cards/([a-zA-Z0-9_-]{1,64})/image/?$#',
                    $path,
                    $sharedCardImageMatches,
                ) === 1
            ) {
                $this->sharedFlashcardImage(
                    $method,
                    $sharedCardImageMatches[1],
                    $sharedCardImageMatches[2],
                    $this->authenticate(),
                );
            }
            if (
                $method === 'POST'
                && preg_match(
                    '#^/flashcard-review-sets/([a-zA-Z0-9_-]{1,64})/cards/([a-zA-Z0-9_-]{1,64})/library-image/?$#',
                    $path,
                    $sharedCardLibraryImageMatches,
                ) === 1
            ) {
                $this->setSharedFlashcardLibraryImage(
                    $sharedCardLibraryImageMatches[1],
                    $sharedCardLibraryImageMatches[2],
                    $this->authenticate(),
                );
            }
            if (
                ($method === 'PATCH' || $method === 'DELETE')
                && preg_match(
                    '#^/flashcard-review-sets/([a-zA-Z0-9_-]{1,64})/cards/([a-zA-Z0-9_-]{1,64})/?$#',
                    $path,
                    $sharedCardRecordMatches,
                ) === 1
            ) {
                $this->sharedFlashcardRecord(
                    $method,
                    $sharedCardRecordMatches[1],
                    $sharedCardRecordMatches[2],
                    $this->authenticate(),
                );
            }
            if (
                ($method === 'GET' || $method === 'POST')
                && preg_match(
                    '#^/flashcard-review-sets/([a-zA-Z0-9_-]{1,64})/cards/?$#',
                    $path,
                    $sharedCardsMatches,
                ) === 1
            ) {
                $this->sharedFlashcards(
                    $method,
                    $sharedCardsMatches[1],
                    $this->authenticate(),
                );
            }
            if (
                $method === 'POST'
                && preg_match(
                    '#^/flashcard-review-sets/([a-zA-Z0-9_-]{1,64})/sessions/?$#',
                    $path,
                    $flashcardSetMatches,
                ) === 1
            ) {
                $this->startFlashcardReviewSession(
                    $flashcardSetMatches[1],
                    $this->authenticate(),
                );
            }
            if (
                $method === 'PATCH'
                && preg_match(
                    '#^/flashcard-review-sessions/([a-zA-Z0-9_-]{1,64})/settings/?$#',
                    $path,
                    $flashcardSessionSettingsMatches,
                ) === 1
            ) {
                $this->updateFlashcardReviewSessionSettings(
                    $flashcardSessionSettingsMatches[1],
                    $this->authenticate(),
                );
            }
            if ($method === 'POST' && $path === '/flashcards/import') {
                $this->importFlashcards($this->authenticate());
            }
            if ($method === 'POST' && $path === '/flashcards/bulk') {
                $this->bulkUpdateFlashcards($this->authenticate());
            }
            if (
                $method === 'POST'
                && preg_match(
                    '#^/flashcard-review-sessions/([a-zA-Z0-9_-]{1,64})/actions/?$#',
                    $path,
                    $flashcardSessionMatches,
                ) === 1
            ) {
                $this->actOnFlashcardReviewSession(
                    $flashcardSessionMatches[1],
                    $this->authenticate(),
                );
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

    private function flashcardImage(string $method, string $id, array $user): never
    {
        $owner = (string) $user['id'];
        $this->rateLimit('flashcard-image-update:' . $owner, 60, 900);
        $card = $this->ownedRecord('flashcards', $id, $owner);
        $oldFilename = $this->validAvatarFilename($card['image_file'] ?? null);
        $updated = $this->now();

        if ($method === 'DELETE') {
            $statement = $this->database->pdo->prepare(
                "UPDATE flashcards
                 SET image_url = '', image_file = '', library_image_id = 0,
                     image_metadata = '{}', updated_at = :updated_at
                 WHERE id = :id AND owner = :owner",
            );
            $statement->execute([
                'updated_at' => $updated,
                'id' => $id,
                'owner' => $owner,
            ]);
            $card = $this->ownedRecord('flashcards', $id, $owner);
            $this->syncFlashcardWithActiveReviewQueues($card, $owner, false);
            if ($oldFilename !== null) {
                $this->removeFlashcardImageFileIfUnused($oldFilename);
            }
            $this->respond($this->normalizeRecord(
                $this->requireCollection('flashcards'),
                $card,
            ));
        }

        $bytes = $this->compressedSquareJpegBytes($this->jsonBody(), 'card image');
        $directory = $this->flashcardImageDirectory();
        $filename = $this->storeSquareJpeg($bytes, $directory, 'card image');
        $destination = $directory . DIRECTORY_SEPARATOR . $filename;

        try {
            $statement = $this->database->pdo->prepare(
                "UPDATE flashcards
                 SET image_url = '', image_file = :image_file, library_image_id = 0,
                     image_metadata = '{}', updated_at = :updated_at
                 WHERE id = :id AND owner = :owner",
            );
            $statement->execute([
                'image_file' => $filename,
                'updated_at' => $updated,
                'id' => $id,
                'owner' => $owner,
            ]);
        } catch (Throwable $exception) {
            @unlink($destination);
            throw $exception;
        }

        $card = $this->ownedRecord('flashcards', $id, $owner);
        $this->syncFlashcardWithActiveReviewQueues($card, $owner, false);
        if ($oldFilename !== null && !hash_equals($oldFilename, $filename)) {
            $this->removeFlashcardImageFileIfUnused($oldFilename);
        }
        $this->respond($this->normalizeRecord(
            $this->requireCollection('flashcards'),
            $card,
        ));
    }

    private function serveFlashcardImage(string $filename): never
    {
        $validated = $this->validAvatarFilename($filename);
        if ($validated === null) {
            throw new ApiException(404, 'Card image not found.');
        }
        $path = $this->flashcardImageDirectory() . DIRECTORY_SEPARATOR . $validated;
        if (!is_file($path) || !is_readable($path)) {
            throw new ApiException(404, 'Card image not found.');
        }
        $contents = file_get_contents($path);
        if ($contents === false) {
            throw new ApiException(404, 'Card image not found.');
        }

        header('Content-Type: image/jpeg');
        header('Cache-Control: public, max-age=31536000, immutable');
        header('Content-Length: ' . strlen($contents));
        header('Content-Disposition: inline; filename="flashcard.jpg"');
        header('ETag: "' . substr($validated, 0, 48) . '"');
        echo $contents;
        exit;
    }

    private function searchImageLibrary(array $user): never
    {
        $query = trim((string) ($_GET['query'] ?? ''));
        if ($query === '' || mb_strlen($query) > 100) {
            throw new ApiException(422, 'Enter an image search containing up to 100 characters.', [
                'query' => 'required|max:100',
            ]);
        }
        $page = $this->positiveIntegerQuery('page', 1);
        $perPage = min($this->positiveIntegerQuery('perPage', 30), 60);
        $tokens = array_values(array_filter(preg_split('/[\s\p{P}\p{S}]+/u', $query) ?: []));
        if ($tokens === []) {
            throw new ApiException(422, 'Enter a searchable word or phrase.', ['query' => 'search']);
        }
        $match = implode(' AND ', array_map(
            static fn (string $token): string => '"' . str_replace('"', '""', $token) . '"*',
            array_slice($tokens, 0, 10),
        ));
        $rankedSql = <<<'SQL'
            WITH matching_concepts AS (
                SELECT image_concepts.id,
                       bm25(image_concepts_fts, 8.0, 1.0) AS search_rank
                FROM image_concepts_fts
                JOIN image_concepts ON image_concepts.id = image_concepts_fts.rowid
                WHERE image_concepts_fts MATCH :query
                  AND image_concepts.active = TRUE
            ), ranked_assets AS (
                SELECT image_assets.*,
                       image_concepts.id AS concept_id,
                       image_concepts.canonical_name,
                       image_concepts.part_of_speech,
                       image_concepts.definition AS concept_definition,
                       image_concept_assets.result_rank,
                       matching_concepts.search_rank,
                       ROW_NUMBER() OVER (
                           PARTITION BY image_assets.id
                           ORDER BY matching_concepts.search_rank,
                                    image_concept_assets.result_rank,
                                    image_concepts.id
                       ) AS match_number
                FROM matching_concepts
                JOIN image_concepts ON image_concepts.id = matching_concepts.id
                JOIN image_concept_assets
                  ON image_concept_assets.concept_id = image_concepts.id
                JOIN image_assets ON image_assets.id = image_concept_assets.image_id
            )
            SQL;
        $count = $this->database->pdo->prepare(
            $rankedSql . ' SELECT COUNT(*) FROM ranked_assets WHERE match_number = 1',
        );
        $count->execute(['query' => $match]);
        $totalItems = (int) $count->fetchColumn();
        if ($totalItems === 0) {
            $this->populateImageLibrarySearch($query, $match, $user);
            $count->execute(['query' => $match]);
            $totalItems = (int) $count->fetchColumn();
        }
        $offset = ($page - 1) * $perPage;
        $statement = $this->database->pdo->prepare(
            $rankedSql .
            ' SELECT * FROM ranked_assets
              WHERE match_number = 1
              ORDER BY search_rank, result_rank, id
              LIMIT :limit OFFSET :offset',
        );
        $statement->bindValue(':query', $match);
        $statement->bindValue(':limit', $perPage, PDO::PARAM_INT);
        $statement->bindValue(':offset', $offset, PDO::PARAM_INT);
        $statement->execute();
        $items = array_map(static fn (array $asset): array => [
            'id' => (int) $asset['id'],
            'image_url' => '/flashcard-images/' . $asset['filename'],
            'alt' => (string) $asset['alt'],
            'photographer' => (string) $asset['photographer'],
            'photographer_url' => (string) $asset['photographer_url'],
            'source_url' => (string) $asset['source_url'],
            'license_name' => (string) $asset['license_name'],
            'license_url' => (string) $asset['license_url'],
            'concept' => [
                'id' => (int) $asset['concept_id'],
                'name' => (string) $asset['canonical_name'],
                'part_of_speech' => (string) $asset['part_of_speech'],
                'definition' => (string) $asset['concept_definition'],
            ],
        ], $statement->fetchAll());
        $this->respond([
            'page' => $page,
            'perPage' => $perPage,
            'totalItems' => $totalItems,
            'totalPages' => max(1, (int) ceil($totalItems / $perPage)),
            'items' => $items,
        ]);
    }

    private function populateImageLibrarySearch(string $query, string $match, array $user): void
    {
        $pending = $this->database->pdo->prepare(
            'SELECT image_concepts.id
             FROM image_concepts_fts
             JOIN image_concepts ON image_concepts.id = image_concepts_fts.rowid
             WHERE image_concepts_fts MATCH :query
               AND image_concepts.active = TRUE
               AND image_concepts.pexels_searched = FALSE
             ORDER BY bm25(image_concepts_fts, 8.0, 1.0), image_concepts.id
             LIMIT 1',
        );
        $pending->execute(['query' => $match]);
        $conceptId = $pending->fetchColumn();

        if ($conceptId === false) {
            $existing = $this->database->pdo->prepare(
                'SELECT image_concepts.id
                 FROM image_concepts_fts
                 JOIN image_concepts ON image_concepts.id = image_concepts_fts.rowid
                 WHERE image_concepts_fts MATCH :query
                   AND image_concepts.active = TRUE
                 LIMIT 1',
            );
            $existing->execute(['query' => $match]);
            if ($existing->fetchColumn() !== false) {
                return;
            }
        }

        if ($this->config->pexelsApiKey === '') {
            throw new ApiException(503, 'Pexels image fetching is not configured.');
        }
        $this->rateLimit('image-library-fetch:' . $user['id'], 60, 3600);

        if ($conceptId === false) {
            $conceptId = $this->createImageSearchConcept($query);
        }

        $configuredApiUrl = getenv('MOM_PEXELS_API_BASE_URL');
        $apiUrl = is_string($configuredApiUrl) && trim($configuredApiUrl) !== ''
            ? trim($configuredApiUrl)
            : null;
        $fetcher = new PexelsImageFetcher(
            $this->database->pdo,
            $this->config->pexelsApiKey,
            $this->config->databasePath,
            $apiUrl,
        );
        $summary = $fetcher->fetchConcept((int) $conceptId);
        if (($summary['stopped'] ?? false) && (int) ($summary['searched_concepts'] ?? 0) === 0) {
            error_log('[mom-api/image-library] ' . (string) ($summary['stop_reason'] ?? 'Unknown error'));
            throw new ApiException(502, 'The image search could not be fetched from Pexels.');
        }
    }

    private function createImageSearchConcept(string $query): int
    {
        $normalized = trim((string) preg_replace('/\s+/u', ' ', $query));
        $sourceId = 'mom-on-demand-searches-1';
        $sourceKey = 'on-demand:' . hash('sha256', mb_strtolower($normalized, 'UTF-8'));
        $pdo = $this->database->pdo;
        $pdo->beginTransaction();
        try {
            $source = $pdo->prepare(
                'INSERT INTO image_sources (
                    id, name, language, source_url, license_name, license_url, attribution
                 ) VALUES (
                    :id, :name, :language, :source_url, :license_name, :license_url, :attribution
                 ) ON CONFLICT(id) DO NOTHING',
            );
            $source->execute([
                'id' => $sourceId,
                'name' => 'Mom on-demand image searches',
                'language' => 'und',
                'source_url' => '',
                'license_name' => 'User-entered search terms',
                'license_url' => '',
                'attribution' => '',
            ]);

            $concept = $pdo->prepare(
                'INSERT INTO image_concepts (
                    source_key, canonical_name, part_of_speech, semantic_category,
                    definition, search_query, search_text, active, pexels_searched
                 ) VALUES (
                    :source_key, :canonical_name, :part_of_speech, :semantic_category,
                    :definition, :search_query, :search_text, TRUE, FALSE
                 ) ON CONFLICT(source_key) DO UPDATE SET active = TRUE',
            );
            $concept->execute([
                'source_key' => $sourceKey,
                'canonical_name' => $normalized,
                'part_of_speech' => 'noun',
                'semantic_category' => 'on-demand search',
                'definition' => 'Image search created on demand.',
                'search_query' => $normalized,
                'search_text' => $normalized,
            ]);

            $select = $pdo->prepare('SELECT id FROM image_concepts WHERE source_key = :source_key');
            $select->execute(['source_key' => $sourceKey]);
            $conceptId = $select->fetchColumn();
            if ($conceptId === false) {
                throw new ApiException(500, 'The image search cache could not be created.');
            }

            $term = $pdo->prepare(
                'INSERT OR IGNORE INTO image_concept_terms (
                    concept_id, language, term, source_id
                 ) VALUES (:concept_id, :language, :term, :source_id)',
            );
            $term->execute([
                'concept_id' => (int) $conceptId,
                'language' => 'und',
                'term' => $normalized,
                'source_id' => $sourceId,
            ]);
            $pdo->commit();
            return (int) $conceptId;
        } catch (Throwable $exception) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $exception;
        }
    }

    private function setFlashcardLibraryImage(string $id, array $user): never
    {
        $owner = (string) $user['id'];
        $this->rateLimit('flashcard-library-image-update:' . $owner, 600, 900);
        $card = $this->ownedRecord('flashcards', $id, $owner);
        $body = $this->jsonBody();
        $this->allowOnlyFields($body, ['image_id']);
        $imageId = $body['image_id'] ?? null;
        if (!is_int($imageId) || $imageId < 1) {
            throw new ApiException(422, 'Select a valid library image.', ['image_id' => 'integer']);
        }
        $statement = $this->database->pdo->prepare(
            "SELECT * FROM image_assets WHERE id = :id AND provider = 'pexels' LIMIT 1",
        );
        $statement->execute(['id' => $imageId]);
        $asset = $statement->fetch();
        if (!is_array($asset)) {
            throw new ApiException(404, 'Library image not found.');
        }
        $filename = $this->validAvatarFilename($asset['filename'] ?? null);
        if (
            $filename === null
            || !is_file($this->flashcardImageDirectory() . DIRECTORY_SEPARATOR . $filename)
        ) {
            throw new ApiException(409, 'The cached library image is unavailable.');
        }
        $oldFilename = $this->validAvatarFilename($card['image_file'] ?? null);
        $metadata = [
            'id' => (int) $asset['id'],
            'provider' => (string) $asset['provider'],
            'alt' => (string) $asset['alt'],
            'photographer' => (string) $asset['photographer'],
            'photographer_url' => (string) $asset['photographer_url'],
            'source_url' => (string) $asset['source_url'],
            'license_name' => (string) $asset['license_name'],
            'license_url' => (string) $asset['license_url'],
        ];
        $updated = $this->now();
        $statement = $this->database->pdo->prepare(
            "UPDATE flashcards
             SET image_url = '', image_file = :image_file,
                 library_image_id = :library_image_id, image_metadata = :image_metadata,
                 updated_at = :updated_at
             WHERE id = :id AND owner = :owner",
        );
        $statement->execute([
            'image_file' => $filename,
            'library_image_id' => $imageId,
            'image_metadata' => json_encode($metadata, JSON_THROW_ON_ERROR),
            'updated_at' => $updated,
            'id' => $id,
            'owner' => $owner,
        ]);
        $card = $this->ownedRecord('flashcards', $id, $owner);
        $this->syncFlashcardWithActiveReviewQueues($card, $owner, false);
        if ($oldFilename !== null && !hash_equals($oldFilename, $filename)) {
            $this->removeFlashcardImageFileIfUnused($oldFilename);
        }
        $this->respond($this->normalizeRecord(
            $this->requireCollection('flashcards'),
            $card,
        ));
    }

    private function compressedSquareJpegBytes(array $body, string $label): string
    {
        $encoded = $body['image'] ?? null;
        if (!is_string($encoded) || !str_starts_with($encoded, 'data:image/jpeg;base64,')) {
            throw new ApiException(422, "Upload a valid compressed JPEG {$label}.", [
                'image' => 'jpeg',
            ]);
        }
        $bytes = base64_decode(substr($encoded, 23), true);
        if ($bytes === false || strlen($bytes) < 100 || strlen($bytes) > 500000) {
            throw new ApiException(422, "The compressed {$label} is invalid or too large.", [
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
            throw new ApiException(
                422,
                "The {$label} must be a square JPEG no larger than 256×256.",
                ['image' => 'square:max:256'],
            );
        }
        return $bytes;
    }

    private function storeSquareJpeg(string $bytes, string $directory, string $label): string
    {
        if (!is_dir($directory) && !mkdir($directory, 0700, true) && !is_dir($directory)) {
            throw new ApiException(500, "The private {$label} directory could not be created.");
        }
        if (!is_writable($directory)) {
            throw new ApiException(500, "The private {$label} directory is not writable.");
        }

        $filename = bin2hex(random_bytes(24)) . '.jpg';
        $temporary = tempnam($directory, '.image-');
        if ($temporary === false) {
            throw new ApiException(500, "A temporary {$label} file could not be created.");
        }
        try {
            $written = file_put_contents($temporary, $bytes, LOCK_EX);
            if ($written !== strlen($bytes)) {
                throw new ApiException(500, "The {$label} could not be stored.");
            }
            @chmod($temporary, 0600);
            $destination = $directory . DIRECTORY_SEPARATOR . $filename;
            if (!rename($temporary, $destination)) {
                throw new ApiException(500, "The {$label} could not be finalized.");
            }
            $temporary = '';
        } finally {
            if ($temporary !== '' && is_file($temporary)) {
                @unlink($temporary);
            }
        }
        return $filename;
    }

    private function validateFlashcardImageUrl(mixed $value): string
    {
        if (!is_string($value)) {
            throw new ApiException(422, 'The card image URL is invalid.', ['image_url' => 'url']);
        }
        $url = trim($value);
        if ($url === '') {
            return '';
        }
        $parts = parse_url($url);
        if (
            filter_var($url, FILTER_VALIDATE_URL) === false
            || !is_array($parts)
            || !in_array(strtolower((string) ($parts['scheme'] ?? '')), ['http', 'https'], true)
            || ($parts['host'] ?? '') === ''
            || isset($parts['user'])
            || isset($parts['pass'])
        ) {
            throw new ApiException(
                422,
                'Use a complete HTTP or HTTPS card image URL.',
                ['image_url' => 'url'],
            );
        }
        return $url;
    }

    private function flashcardImagePath(array $card): string
    {
        $filename = $this->validAvatarFilename($card['image_file'] ?? null);
        return $filename === null
            ? (string) ($card['image_url'] ?? '')
            : '/flashcard-images/' . $filename;
    }

    private function flashcardImageDirectory(): string
    {
        return dirname($this->config->databasePath) . DIRECTORY_SEPARATOR . 'flashcard-images';
    }

    private function removeFlashcardImageFileIfUnused(string $filename): void
    {
        $validated = $this->validAvatarFilename($filename);
        if ($validated === null) {
            return;
        }
        $statement = $this->database->pdo->prepare(
            'SELECT
                (SELECT COUNT(*) FROM flashcards WHERE image_file = :filename)
                + (SELECT COUNT(*) FROM image_assets WHERE filename = :filename)
                + (SELECT COUNT(*) FROM flashcard_review_sessions WHERE queue_state LIKE :needle)
                + (SELECT COUNT(*) FROM interval_sessions WHERE flashcard_snapshot LIKE :needle)',
        );
        $statement->execute([
            'filename' => $validated,
            'needle' => '%' . $validated . '%',
        ]);
        if ((int) $statement->fetchColumn() > 0) {
            return;
        }
        $path = $this->flashcardImageDirectory() . DIRECTORY_SEPARATOR . $validated;
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
        if (
            !array_key_exists('quickInterval', $body)
            && !array_key_exists('stepSource', $body)
            && !array_key_exists('mainMenuOrder', $body)
            && !array_key_exists('mainMenuHidden', $body)
        ) {
            throw new ApiException(422, 'At least one supported setting is required.', [
                'quickInterval' => 'required',
                'stepSource' => 'required',
                'mainMenuOrder' => 'required',
                'mainMenuHidden' => 'required',
            ]);
        }
        if (array_key_exists('quickInterval', $body)) {
            $settings['quickInterval'] = $this->validateQuickIntervalSettings(
                $body['quickInterval'],
            );
        }
        if (array_key_exists('stepSource', $body)) {
            if ($body['stepSource'] !== 'health_connect') {
                throw new ApiException(422, 'The step source setting is invalid.', [
                    'stepSource' => 'health_connect',
                ]);
            }
            $settings['stepSource'] = 'health_connect';
        }
        if (array_key_exists('mainMenuOrder', $body)) {
            $settings['mainMenuOrder'] = $this->validateMainMenuOrder(
                $body['mainMenuOrder'],
            );
        }
        if (array_key_exists('mainMenuHidden', $body)) {
            $settings['mainMenuHidden'] = $this->validateHiddenMainMenuItems(
                $body['mainMenuHidden'],
            );
        }
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

    private function chatGPTConnection(string $method): never
    {
        $user = $this->authenticate();
        if ($method === 'GET') {
            $this->respond($this->codexBridge->status((string) $user['id']));
        }
        if ($method === 'DELETE') {
            $this->respond($this->codexBridge->disconnect((string) $user['id']));
        }

        $this->rateLimit('chatgpt-connect:' . $user['id'], 10, 900);
        $this->respond($this->codexBridge->startLogin((string) $user['id']));
    }

    private function validateMainMenuOrder(mixed $value): array
    {
        if (!is_array($value) || !array_is_list($value)) {
            throw new ApiException(422, 'The main menu order is invalid.', [
                'mainMenuOrder' => 'permutation',
            ]);
        }

        $received = $value;
        sort($received);
        $sortedExpected = self::MAIN_MENU_ITEMS;
        sort($sortedExpected);
        if ($received !== $sortedExpected) {
            throw new ApiException(422, 'The main menu order is invalid.', [
                'mainMenuOrder' => 'permutation',
            ]);
        }

        return array_values($value);
    }

    private function validateHiddenMainMenuItems(mixed $value): array
    {
        if (!is_array($value) || !array_is_list($value)) {
            throw new ApiException(422, 'The hidden main menu items are invalid.', [
                'mainMenuHidden' => 'unique subset',
            ]);
        }

        $hidden = [];
        foreach ($value as $item) {
            if (
                !is_string($item)
                || !in_array($item, self::MAIN_MENU_ITEMS, true)
                || in_array($item, $hidden, true)
            ) {
                throw new ApiException(422, 'The hidden main menu items are invalid.', [
                    'mainMenuHidden' => 'unique subset',
                ]);
            }
            $hidden[] = $item;
        }
        if (count($hidden) >= count(self::MAIN_MENU_ITEMS)) {
            throw new ApiException(422, 'Keep at least one main menu item visible.', [
                'mainMenuHidden' => 'at least one visible',
            ]);
        }

        return $hidden;
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

        $webAuthn = new WebAuthn('Polymind', $this->config->passkeyRpId, ['none'], true);
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

        $this->claimPendingFlashcardReviewSetShares($user);
        return $user;
    }

    private function claimPendingFlashcardReviewSetShares(array $user): void
    {
        $account = (string) ($user['id'] ?? '');
        $email = (string) ($user['email'] ?? '');
        if ($account === '' || $email === '') {
            return;
        }

        $pdo = $this->database->pdo;
        $pending = $pdo->prepare(
            "SELECT 1 FROM flashcard_review_set_shares
             WHERE recipient_email = :email COLLATE NOCASE
               AND recipient LIKE 'pending:%'
             LIMIT 1",
        );
        $pending->execute(['email' => $email]);
        if ($pending->fetchColumn() === false) {
            return;
        }

        $transactionOpen = false;
        try {
            $pdo->exec('BEGIN IMMEDIATE');
            $transactionOpen = true;
            $statement = $pdo->prepare(
                "SELECT flashcard_review_sets.*,
                        flashcard_review_set_shares.id AS share_id,
                        flashcard_review_set_shares.recipient AS pending_recipient
                 FROM flashcard_review_set_shares
                 JOIN flashcard_review_sets
                   ON flashcard_review_sets.id = flashcard_review_set_shares.review_set
                 WHERE flashcard_review_set_shares.recipient_email = :email COLLATE NOCASE
                   AND flashcard_review_set_shares.recipient LIKE 'pending:%'",
            );
            $statement->execute(['email' => $email]);
            $shares = $statement->fetchAll();
            $claim = $pdo->prepare(
                'UPDATE flashcard_review_set_shares
                 SET recipient = :recipient
                 WHERE id = :id AND recipient = :pending_recipient',
            );
            $removePendingPreferences = $pdo->prepare(
                'DELETE FROM flashcard_review_set_preferences
                 WHERE review_set = :review_set AND account = :pending_recipient',
            );
            foreach ($shares as $share) {
                $pendingRecipient = (string) $share['pending_recipient'];
                $settings = $this->effectiveFlashcardReviewSettings($share, $pendingRecipient);
                $this->saveFlashcardReviewSetPreferences(
                    (string) $share['id'],
                    $account,
                    $settings,
                );
                $removePendingPreferences->execute([
                    'review_set' => $share['id'],
                    'pending_recipient' => $pendingRecipient,
                ]);
                $claim->execute([
                    'recipient' => $account,
                    'id' => $share['share_id'],
                    'pending_recipient' => $pendingRecipient,
                ]);
            }
            $pdo->exec('COMMIT');
            $transactionOpen = false;
        } catch (Throwable $exception) {
            if ($transactionOpen) {
                $pdo->exec('ROLLBACK');
            }
            throw $exception;
        }
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
        if (in_array($collection['name'], ['flashcard_review_sessions', 'flashcard_review_events'], true)) {
            throw new ApiException(405, 'This collection is written through the review session endpoints.');
        }
        if ($collection['name'] === 'tasks') {
            $body += [
                'entry_notes_enabled' => false,
                'entry_note_suggestions_enabled' => false,
            ];
        }
        if ($collection['name'] === 'flashcards') {
            $this->rejectFields($body, [
                'created_at', 'updated_at', 'last_reviewed_at',
                'passive_views', 'success_count', 'error_count', 'image_file',
                'library_image_id', 'image_metadata',
            ]);
        }
        if ($collection['name'] === 'flashcard_review_sets') {
            $this->rejectFields($body, ['created_at', 'updated_at']);
        }
        if ($collection['name'] === 'interval_sessions') {
            $this->rejectFields($body, ['flashcard_snapshot']);
        }
        if ($collection['name'] === 'journal_entries') {
            $body = $this->normalizeJournalTrackerInput($body);
            $body += ['tracker' => []];
        }
        $values = $this->validateRecordInput($collection, $body, true);
        if ($collection['name'] === 'flashcards') {
            $values['image_url'] = $this->validateFlashcardImageUrl(
                $values['image_url'] ?? '',
            );
        }
        $values['id'] = $this->newId();
        $values['owner'] = $user['id'];
        if ($collection['name'] === 'interval_sessions') {
            if (($values['task_date'] ?? '') === '') {
                $values['task_date'] = $this->dateKeyInTimezone(
                    (string) $values['started_at'],
                    (string) $user['timezone'],
                );
            }
            $this->validateNewIntervalSession($values, $user);
        }
        if ($collection['name'] === 'entries') {
            $values['created_at'] = (new DateTimeImmutable('now'))->format('Y-m-d\TH:i:s.v\Z');
        }
        if ($collection['name'] === 'flashcards') {
            $now = (new DateTimeImmutable('now'))->format('Y-m-d\TH:i:s.v\Z');
            $values += [
                'note' => '',
                'image_url' => '',
                'image_file' => '',
                'library_image_id' => 0,
                'image_metadata' => new \stdClass(),
                'tags' => [],
                'created_at' => $now,
                'updated_at' => $now,
                'last_reviewed_at' => '',
                'passive_views' => 0,
                'success_count' => 0,
                'error_count' => 0,
            ];
        }
        if ($collection['name'] === 'flashcard_review_sets') {
            $now = (new DateTimeImmutable('now'))->format('Y-m-d\TH:i:s.v\Z');
            $values += [
                'tags' => [],
                'card_sides' => 'both',
                'indefinite' => false,
                'max_cards' => 20,
                'front_seconds' => 5,
                'back_seconds' => 5,
                'back_speech_repeat_count' => 1,
                'note_before_back' => false,
                'speech_enabled' => false,
                'front_language' => '',
                'back_language' => '',
                'sort_order' => 0,
                'created_at' => $now,
                'updated_at' => $now,
            ];
            $this->validateFlashcardSpeechSettings($values);
        }
        $this->validateRelations($collection['name'], $values, (string) $user['id']);
        if ($collection['name'] === 'interval_sessions') {
            $values['flashcard_snapshot'] = $this->intervalFlashcardSnapshot(
                (string) ($values['template'] ?? ''),
                (string) $user['id'],
            );
        }
        if ($collection['name'] === 'journal_entries') {
            $now = (new DateTimeImmutable('now'))->format('Y-m-d\TH:i:s.v\Z');
            $values = array_merge(
                $values,
                $this->journalContextSnapshots($values, (string) $user['id']),
                ['created_at' => $now, 'updated_at' => $now],
            );
        }

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
        if ($table === 'flashcards') {
            $this->syncFlashcardWithActiveReviewQueues($record, (string) $user['id'], true);
        } elseif ($table === 'flashcard_review_sets') {
            $this->saveFlashcardReviewSetPreferences(
                (string) $record['id'],
                (string) $user['id'],
                array_intersect_key(
                    $this->normalizeRecord($collection, $record),
                    array_flip(self::FLASHCARD_REVIEW_SETTING_FIELDS),
                ),
            );
        }
        $this->respond($this->normalizeRecord($collection, $record), 201);
    }

    private function updateRecord(array $collection, string $id, array $user): never
    {
        $existing = $this->ownedRecord($collection['name'], $id, (string) $user['id']);
        $body = $this->jsonBody();
        if (in_array($collection['name'], ['flashcard_review_sessions', 'flashcard_review_events'], true)) {
            throw new ApiException(405, 'This collection is written through the review session endpoints.');
        }
        if ($collection['name'] === 'flashcards') {
            $this->allowOnlyFields($body, ['front', 'back', 'note', 'image_url', 'tags']);
        }
        if ($collection['name'] === 'flashcard_review_sets') {
            $this->allowOnlyFields($body, [
                'name', 'tags', 'mode', 'card_sides', 'indefinite',
                'max_cards', 'front_seconds', 'back_seconds',
                'back_speech_repeat_count',
                'note_before_back',
                'speech_enabled', 'front_language', 'back_language',
                'sort_mode', 'sort_order',
            ]);
        }
        if ($collection['name'] === 'interval_sessions') {
            $this->rejectFields($body, ['flashcard_snapshot']);
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
        if ($collection['name'] === 'journal_entries') {
            $body = $this->normalizeJournalTrackerInput($body);
        }
        $values = $this->validateRecordInput($collection, $body, false);
        if ($values === []) {
            throw new ApiException(422, 'At least one writable field is required.');
        }
        if ($collection['name'] === 'tracking_trackers') {
            $this->validateTrackerDefinitionUpdate($existing, $values, (string) $user['id']);
        }
        $oldFlashcardImage = null;
        if ($collection['name'] === 'flashcards' && array_key_exists('image_url', $values)) {
            $values['image_url'] = $this->validateFlashcardImageUrl($values['image_url']);
            $oldFlashcardImage = $this->validAvatarFilename($existing['image_file'] ?? null);
            $values['image_file'] = '';
            $values['library_image_id'] = 0;
            $values['image_metadata'] = new \stdClass();
        }

        $combined = array_merge($this->normalizeRecord($collection, $existing), $values);
        if ($collection['name'] === 'flashcard_review_sets') {
            $this->validateFlashcardSpeechSettings($combined);
        }
        $this->validateRelations($collection['name'], $combined, (string) $user['id']);
        if ($collection['name'] === 'journal_entries') {
            if (array_key_exists('task', $values)) {
                $values['task_snapshot'] = $this->journalContextName(
                    'tasks',
                    (string) $values['task'],
                    (string) $user['id'],
                );
            }
            if (array_key_exists('tracker', $values)) {
                $values['tracker_snapshot'] = json_encode(
                    $this->journalTrackerSnapshots($values['tracker'], (string) $user['id']),
                    JSON_THROW_ON_ERROR,
                );
            }
            $values['updated_at'] = (new DateTimeImmutable('now'))->format('Y-m-d\TH:i:s.v\Z');
        }
        if (in_array($collection['name'], ['flashcards', 'flashcard_review_sets'], true)) {
            $values['updated_at'] = (new DateTimeImmutable('now'))->format('Y-m-d\TH:i:s.v\Z');
        }
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
        if ($collection['name'] === 'flashcards') {
            $this->syncFlashcardWithActiveReviewQueues($record, (string) $user['id'], false);
            if ($oldFlashcardImage !== null) {
                $this->removeFlashcardImageFileIfUnused($oldFlashcardImage);
            }
        } elseif (
            $collection['name'] === 'flashcard_review_sets'
            && array_intersect(array_keys($values), self::FLASHCARD_REVIEW_SETTING_FIELDS) !== []
        ) {
            $this->saveFlashcardReviewSetPreferences(
                $id,
                (string) $user['id'],
                array_intersect_key($combined, array_flip(self::FLASHCARD_REVIEW_SETTING_FIELDS)),
            );
        }
        $this->respond($this->normalizeRecord($collection, $record));
    }

    private function validateFlashcardSpeechSettings(array $values): void
    {
        if ((bool) ($values['indefinite'] ?? false) && ($values['mode'] ?? '') !== 'passive') {
            throw new ApiException(422, 'Only Passive Review sets can run indefinitely.', [
                'indefinite' => 'passive-only',
            ]);
        }
        foreach (['front_language', 'back_language'] as $field) {
            $language = (string) ($values[$field] ?? '');
            if (
                $language !== ''
                && preg_match('/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/', $language) !== 1
            ) {
                throw new ApiException(422, 'The speech language is invalid.', [
                    $field => 'language-tag',
                ]);
            }
            if ((bool) ($values['speech_enabled'] ?? false) && $language === '') {
                throw new ApiException(422, 'Select a language for both card sides.', [
                    $field => 'required',
                ]);
            }
        }
    }

    private function syncFlashcardWithActiveReviewQueues(
        array $card,
        string $owner,
        bool $addWhenEligible,
    ): void {
        $cardTags = $this->decodeJsonColumn($card['tags'] ?? '[]');
        $cardTags = is_array($cardTags) ? array_values($cardTags) : [];
        $snapshot = [
            'id' => (string) $card['id'],
            'front' => (string) $card['front'],
            'back' => (string) $card['back'],
            'note' => (string) ($card['note'] ?? ''),
            'image' => $this->flashcardImagePath($card),
            'tags' => $cardTags,
        ];
        $statement = $this->database->pdo->prepare(
            "SELECT * FROM flashcard_review_sessions
             WHERE source_owner = :owner AND status IN ('running', 'paused')",
        );
        $statement->execute(['owner' => $owner]);
        $update = $this->database->pdo->prepare(
            'UPDATE flashcard_review_sessions
             SET queue_state = :queue_state, total_cards = :total_cards, updated_at = :updated_at
             WHERE id = :id AND owner = :owner',
        );
        foreach ($statement->fetchAll() as $session) {
            $queue = $this->decodeJsonColumn($session['queue_state'] ?? '[]');
            if (!is_array($queue) || !array_is_list($queue)) {
                continue;
            }
            $index = array_search(
                (string) $card['id'],
                array_map(static fn (mixed $item): string => is_array($item)
                    ? (string) ($item['id'] ?? '')
                    : '', $queue),
                true,
            );
            $changed = false;
            if ($index !== false) {
                $queue[$index] = $snapshot;
                $changed = true;
            } elseif ($addWhenEligible) {
                $selectedTags = $this->decodeJsonColumn($session['tags_snapshot'] ?? '[]');
                $selectedTags = is_array($selectedTags) ? $selectedTags : [];
                $matches = $selectedTags === [] || array_intersect($selectedTags, $cardTags) !== [];
                $maxCards = (int) ($session['max_cards_snapshot'] ?? 20);
                if ($matches && (int) $session['total_cards'] < $maxCards) {
                    $queue[] = $snapshot;
                    $changed = true;
                }
            }
            if (!$changed) {
                continue;
            }
            $processed = (int) $session['viewed_count'] + (int) $session['ejected_count'];
            $totalCards = (bool) $session['indefinite_snapshot']
                ? count($queue)
                : $processed + count($queue);
            $update->execute([
                'queue_state' => json_encode(array_values($queue), JSON_THROW_ON_ERROR),
                'total_cards' => $totalCards,
                'updated_at' => (new DateTimeImmutable('now'))->format('Y-m-d\TH:i:s.v\Z'),
                'id' => $session['id'],
                'owner' => $session['owner'],
            ]);
        }
    }

    private function importFlashcards(array $user): never
    {
        $body = $this->jsonBody();
        $this->allowOnlyFields($body, ['rows']);
        $rows = $body['rows'] ?? null;
        if (!is_array($rows) || !array_is_list($rows) || $rows === []) {
            throw new ApiException(422, 'Add at least one flashcard row.', ['rows' => 'required']);
        }
        if (count($rows) > self::MAX_FLASHCARD_IMPORT_ROWS) {
            throw new ApiException(
                422,
                'Too many flashcards were included in one import.',
                ['rows' => 'max:' . self::MAX_FLASHCARD_IMPORT_ROWS],
            );
        }

        $validatedRows = [];
        $tagNames = [];
        foreach ($rows as $index => $row) {
            $rowNumber = $index + 1;
            if (!is_array($row) || array_is_list($row)) {
                throw new ApiException(422, "Flashcard row {$rowNumber} is invalid.");
            }
            $unknown = array_values(array_diff(array_keys($row), ['front', 'back', 'note', 'tags']));
            if ($unknown !== []) {
                throw new ApiException(422, "Flashcard row {$rowNumber} contains unknown fields.", [
                    'fields' => $unknown,
                ]);
            }
            $front = $this->validateText($row['front'] ?? null, 'front', 5000, true);
            $back = $this->validateText($row['back'] ?? null, 'back', 5000, true);
            $note = $this->validateText($row['note'] ?? '', 'note', 2000);
            $rowTags = $row['tags'] ?? [];
            if (!is_array($rowTags) || !array_is_list($rowTags) || count($rowTags) > 50) {
                throw new ApiException(422, "Flashcard row {$rowNumber} has invalid tags.");
            }

            $normalizedTags = [];
            foreach ($rowTags as $tag) {
                $name = $this->validateText($tag, 'tag', 50, true);
                $key = $this->caseInsensitiveKey($name);
                $normalizedTags[$key] = $name;
                $tagNames[$key] ??= $name;
            }
            $validatedRows[] = [
                'front' => $front,
                'back' => $back,
                'note' => $note,
                'tag_keys' => array_keys($normalizedTags),
            ];
        }
        if (count($tagNames) > self::MAX_FLASHCARD_IMPORT_ROWS) {
            throw new ApiException(422, 'Too many unique tags were included in one import.');
        }

        $owner = (string) $user['id'];
        $pdo = $this->database->pdo;
        $tagCollection = $this->requireCollection('flashcard_tags');
        $cardCollection = $this->requireCollection('flashcards');
        $createdTags = [];
        $createdCards = [];
        $pdo->beginTransaction();
        try {
            $existingStatement = $pdo->prepare(
                'SELECT * FROM flashcard_tags WHERE owner = :owner ORDER BY name',
            );
            $existingStatement->execute(['owner' => $owner]);
            $tagsByKey = [];
            foreach ($existingStatement->fetchAll() as $tag) {
                $tagsByKey[$this->caseInsensitiveKey((string) $tag['name'])] = $tag;
            }

            $insertTag = $pdo->prepare(
                'INSERT INTO flashcard_tags (id, owner, name) VALUES (:id, :owner, :name)',
            );
            foreach ($tagNames as $key => $name) {
                if (isset($tagsByKey[$key])) {
                    continue;
                }
                $tag = ['id' => $this->newId(), 'owner' => $owner, 'name' => $name];
                $insertTag->execute($tag);
                $tagsByKey[$key] = $tag;
                $createdTags[] = $tag;
            }

            $insertCard = $pdo->prepare(
                'INSERT INTO flashcards (
                    id, owner, front, back, note, tags, created_at, updated_at,
                    last_reviewed_at, passive_views, success_count, error_count
                 ) VALUES (
                    :id, :owner, :front, :back, :note, :tags, :created_at, :updated_at,
                    :last_reviewed_at, :passive_views, :success_count, :error_count
                 )',
            );
            $now = (new DateTimeImmutable('now'))->format('Y-m-d\TH:i:s.v\Z');
            foreach ($validatedRows as $row) {
                $tagIds = array_map(
                    static fn (string $key): string => (string) $tagsByKey[$key]['id'],
                    $row['tag_keys'],
                );
                $card = [
                    'id' => $this->newId(),
                    'owner' => $owner,
                    'front' => $row['front'],
                    'back' => $row['back'],
                    'note' => $row['note'],
                    'tags' => json_encode($tagIds, JSON_THROW_ON_ERROR),
                    'created_at' => $now,
                    'updated_at' => $now,
                    'last_reviewed_at' => '',
                    'passive_views' => 0,
                    'success_count' => 0,
                    'error_count' => 0,
                ];
                $insertCard->execute($card);
                $createdCards[] = $card;
            }
            $pdo->commit();
        } catch (Throwable $exception) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            if ($exception instanceof PDOException && $this->isConstraintViolation($exception)) {
                throw new ApiException(409, 'The import conflicts with an existing tag.');
            }
            throw $exception;
        }

        $this->respond([
            'cards' => array_map(
                fn (array $card): array => $this->normalizeRecord($cardCollection, $card),
                $createdCards,
            ),
            'tags' => array_map(
                fn (array $tag): array => $this->normalizeRecord($tagCollection, $tag),
                $createdTags,
            ),
        ], 201);
    }

    private function bulkUpdateFlashcards(array $user): never
    {
        $body = $this->jsonBody();
        $this->allowOnlyFields($body, ['action', 'card_ids', 'tag_ids']);
        $action = $body['action'] ?? null;
        $allowedActions = ['add_tags', 'set_tags', 'remove_tags', 'clear_tags', 'delete'];
        if (!is_string($action) || !in_array($action, $allowedActions, true)) {
            throw new ApiException(422, 'Select a valid flashcard bulk action.', [
                'action' => 'choice',
            ]);
        }

        $cardIds = $this->validateFlashcardBulkIds(
            $body['card_ids'] ?? null,
            'card_ids',
            false,
        );
        $tagIds = $this->validateFlashcardBulkIds(
            $body['tag_ids'] ?? [],
            'tag_ids',
            true,
        );
        if (in_array($action, ['add_tags', 'set_tags', 'remove_tags'], true) && $tagIds === []) {
            throw new ApiException(422, 'Select at least one flashcard tag.', [
                'tag_ids' => 'required',
            ]);
        }

        $owner = (string) $user['id'];
        foreach ($cardIds as $cardId) {
            $this->ownedRecord('flashcards', $cardId, $owner);
        }
        foreach ($tagIds as $tagId) {
            if (!$this->relationExists('flashcard_tags', $tagId, $owner)) {
                throw new ApiException(422, 'A selected flashcard tag is invalid.', [
                    'tag_ids' => 'relation',
                ]);
            }
        }

        $pdo = $this->database->pdo;
        $cardCollection = $this->requireCollection('flashcards');
        $updatedCards = [];
        $deletedIds = [];
        $pdo->beginTransaction();
        try {
            if ($action === 'delete') {
                foreach ($cardIds as $cardId) {
                    $this->deleteFlashcard($cardId, $owner);
                    $deletedIds[] = $cardId;
                }
            } else {
                $update = $pdo->prepare(
                    'UPDATE flashcards
                     SET tags = :tags, updated_at = :updated_at
                     WHERE id = :id AND owner = :owner',
                );
                $updatedAt = (new DateTimeImmutable('now'))->format('Y-m-d\TH:i:s.v\Z');
                foreach ($cardIds as $cardId) {
                    $card = $this->ownedRecord('flashcards', $cardId, $owner);
                    $currentTags = $this->decodeJsonColumn($card['tags'] ?? '[]');
                    if (!is_array($currentTags)) {
                        $currentTags = [];
                    }
                    $currentTags = array_values(array_filter(
                        $currentTags,
                        static fn (mixed $tag): bool => is_string($tag),
                    ));
                    $nextTags = match ($action) {
                        'add_tags' => array_values(array_unique([...$currentTags, ...$tagIds])),
                        'set_tags' => $tagIds,
                        'remove_tags' => array_values(array_filter(
                            $currentTags,
                            static fn (string $tag): bool => !in_array($tag, $tagIds, true),
                        )),
                        'clear_tags' => [],
                    };
                    $update->execute([
                        'tags' => json_encode($nextTags, JSON_THROW_ON_ERROR),
                        'updated_at' => $updatedAt,
                        'id' => $cardId,
                        'owner' => $owner,
                    ]);
                    $updatedCards[] = $this->ownedRecord('flashcards', $cardId, $owner);
                }
            }
            $pdo->commit();
        } catch (Throwable $exception) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $exception;
        }

        $this->respond([
            'cards' => array_map(
                fn (array $card): array => $this->normalizeRecord($cardCollection, $card),
                $updatedCards,
            ),
            'deleted_ids' => $deletedIds,
        ]);
    }

    private function validateFlashcardBulkIds(mixed $value, string $field, bool $allowEmpty): array
    {
        if (!is_array($value) || !array_is_list($value)) {
            throw new ApiException(422, "The {$field} field must be an array.", [
                $field => 'array',
            ]);
        }
        if ((!$allowEmpty && $value === []) || count($value) > self::MAX_FLASHCARD_IMPORT_ROWS) {
            throw new ApiException(422, "The {$field} field has an invalid number of items.", [
                $field => $value === [] ? 'required' : 'max:' . self::MAX_FLASHCARD_IMPORT_ROWS,
            ]);
        }

        $ids = [];
        foreach ($value as $id) {
            if (!is_string($id)) {
                throw new ApiException(422, "The {$field} field contains an invalid record ID.", [
                    $field => 'relation',
                ]);
            }
            $id = $this->validateRelationId($id, $field);
            if ($id === '') {
                throw new ApiException(422, "The {$field} field contains an invalid record ID.", [
                    $field => 'relation',
                ]);
            }
            $ids[$id] = $id;
        }
        return array_values($ids);
    }

    private function listAccessibleFlashcardReviewSets(array $user): never
    {
        $account = (string) $user['id'];
        $statement = $this->database->pdo->prepare(
            "SELECT flashcard_review_sets.*,
                    flashcard_review_set_shares.id AS share_id,
                    CASE WHEN flashcard_review_sets.owner = :account
                         THEN 'owner' ELSE flashcard_review_set_shares.role END AS access_role,
                    users.name AS owner_name,
                    users.avatar AS owner_avatar
             FROM flashcard_review_sets
             JOIN users ON users.id = flashcard_review_sets.owner
             LEFT JOIN flashcard_review_set_shares
               ON flashcard_review_set_shares.review_set = flashcard_review_sets.id
              AND flashcard_review_set_shares.recipient = :account
             WHERE flashcard_review_sets.owner = :account
                OR flashcard_review_set_shares.recipient = :account
             ORDER BY CASE WHEN flashcard_review_sets.owner = :account THEN 0 ELSE 1 END,
                      flashcard_review_sets.sort_order,
                      flashcard_review_sets.name",
        );
        $statement->execute(['account' => $account]);
        $this->respond(array_map(
            fn (array $record): array => $this->accessibleReviewSetResponse($record, $account),
            $statement->fetchAll(),
        ));
    }

    private function updateFlashcardReviewSetPreferences(string $id, array $user): never
    {
        $account = (string) $user['id'];
        $reviewSet = $this->accessibleFlashcardReviewSet($id, $account);
        $body = $this->jsonBody();
        $settings = $this->validatedFlashcardReviewSettings($body);
        $this->saveFlashcardReviewSetPreferences($id, $account, $settings);

        if ((string) $reviewSet['owner'] === $account) {
            $assignments = array_map(
                static fn (string $field): string => $field . ' = :' . $field,
                self::FLASHCARD_REVIEW_SETTING_FIELDS,
            );
            $statement = $this->database->pdo->prepare(
                'UPDATE flashcard_review_sets SET ' . implode(', ', $assignments) . ', updated_at = :updated_at
                 WHERE id = :id AND owner = :owner',
            );
            $statement->execute([
                ...$this->booleanDatabaseSettings($settings),
                'updated_at' => $this->now(),
                'id' => $id,
                'owner' => $account,
            ]);
        }

        $this->respond($this->accessibleReviewSetResponse(
            $this->accessibleFlashcardReviewSet($id, $account),
            $account,
        ));
    }

    private function flashcardReviewSetShares(string $method, string $id, array $user): never
    {
        $owner = (string) $user['id'];
        $reviewSet = $this->ownedRecord('flashcard_review_sets', $id, $owner);
        if ($method === 'GET') {
            $statement = $this->database->pdo->prepare(
                'SELECT * FROM flashcard_review_set_shares
                 WHERE flashcard_review_set_shares.review_set = :review_set
                 ORDER BY flashcard_review_set_shares.recipient_email',
            );
            $statement->execute(['review_set' => $id]);
            $this->respond(array_map(
                fn (array $share): array => $this->flashcardReviewSetShareResponse($share),
                $statement->fetchAll(),
            ));
        }

        $this->rateLimit('review-set-share:' . $owner, 60, 900);
        $body = $this->jsonBody();
        $this->allowOnlyFields($body, ['email', 'role']);
        if (!array_key_exists('email', $body) || !array_key_exists('role', $body)) {
            throw new ApiException(422, 'An email address and role are required.');
        }
        $email = $this->normalizeEmail($body['email']);
        $role = $this->validateFlashcardShareRole($body['role']);
        $statement = $this->database->pdo->prepare(
            'SELECT * FROM users WHERE email = :email COLLATE NOCASE LIMIT 1',
        );
        $statement->execute(['email' => $email]);
        $recipient = $statement->fetch();
        if (is_array($recipient) && hash_equals($owner, (string) $recipient['id'])) {
            throw new ApiException(422, 'That account could not be added.');
        }

        $now = $this->now();
        $shareId = $this->newId();
        $recipientId = is_array($recipient)
            ? (string) $recipient['id']
            : 'pending:' . bin2hex(random_bytes(16));
        $pdo = $this->database->pdo;
        $pdo->beginTransaction();
        try {
            $statement = $pdo->prepare(
                'INSERT INTO flashcard_review_set_shares (
                    id, review_set, recipient, recipient_email, role, created_at, updated_at
                 ) VALUES (
                    :id, :review_set, :recipient, :recipient_email, :role, :created_at, :updated_at
                 )',
            );
            $statement->execute([
                'id' => $shareId,
                'review_set' => $id,
                'recipient' => $recipientId,
                'recipient_email' => $email,
                'role' => $role,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
            $settings = $this->effectiveFlashcardReviewSettings($reviewSet, $owner);
            $this->saveFlashcardReviewSetPreferences(
                $id,
                $recipientId,
                $settings,
            );
            $pdo->commit();
        } catch (PDOException $exception) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            if ($this->isConstraintViolation($exception)) {
                throw new ApiException(409, 'This Review set is already shared with that email address.');
            }
            throw $exception;
        } catch (Throwable $exception) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $exception;
        }

        $this->respond($this->flashcardReviewSetShareResponse([
            'id' => $shareId,
            'review_set' => $id,
            'recipient_email' => $email,
            'role' => $role,
            'created_at' => $now,
            'updated_at' => $now,
        ]), 201);
    }

    private function flashcardReviewSetShareRecord(string $method, string $id, array $user): never
    {
        $statement = $this->database->pdo->prepare(
            'SELECT flashcard_review_set_shares.*, flashcard_review_sets.owner
             FROM flashcard_review_set_shares
             JOIN flashcard_review_sets
               ON flashcard_review_sets.id = flashcard_review_set_shares.review_set
             WHERE flashcard_review_set_shares.id = :id LIMIT 1',
        );
        $statement->execute(['id' => $id]);
        $share = $statement->fetch();
        if (!is_array($share)) {
            throw new ApiException(404, 'Share not found.');
        }
        $account = (string) $user['id'];
        $isOwner = hash_equals((string) $share['owner'], $account);
        $isRecipient = hash_equals((string) $share['recipient'], $account);
        if (!$isOwner && !$isRecipient) {
            throw new ApiException(404, 'Share not found.');
        }

        if ($method === 'PATCH') {
            if (!$isOwner) {
                throw new ApiException(403, 'Only the Review set owner can change access.');
            }
            $body = $this->jsonBody();
            $this->allowOnlyFields($body, ['role']);
            $role = $this->validateFlashcardShareRole($body['role'] ?? null);
            $statement = $this->database->pdo->prepare(
                'UPDATE flashcard_review_set_shares SET role = :role, updated_at = :updated_at
                 WHERE id = :id',
            );
            $updatedAt = $this->now();
            $statement->execute(['role' => $role, 'updated_at' => $updatedAt, 'id' => $id]);
            $share['role'] = $role;
            $share['updated_at'] = $updatedAt;
            $this->respond($this->flashcardReviewSetShareResponse($share));
        }

        $pdo = $this->database->pdo;
        $pdo->beginTransaction();
        try {
            $this->detachFlashcardReviewSetFromAccount(
                (string) $share['review_set'],
                (string) $share['recipient'],
            );
            $statement = $pdo->prepare(
                'DELETE FROM flashcard_review_set_preferences
                 WHERE review_set = :review_set AND account = :account',
            );
            $statement->execute([
                'review_set' => $share['review_set'],
                'account' => $share['recipient'],
            ]);
            $statement = $pdo->prepare('DELETE FROM flashcard_review_set_shares WHERE id = :id');
            $statement->execute(['id' => $id]);
            $pdo->commit();
        } catch (Throwable $exception) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $exception;
        }
        $this->respond(null, 204);
    }

    private function copySharedFlashcardReviewSet(string $id, array $user): never
    {
        $account = (string) $user['id'];
        $reviewSet = $this->accessibleFlashcardReviewSet($id, $account);
        if ((string) $reviewSet['owner'] === $account) {
            throw new ApiException(422, 'Only a shared Review set can be copied.');
        }
        $cards = $this->matchingSourceFlashcards($reviewSet);
        if ($cards === []) {
            throw new ApiException(409, 'No flashcards match this Review set.');
        }

        $settings = $this->effectiveFlashcardReviewSettings($reviewSet, $account);
        $copyName = $this->uniqueReviewSetCopyName((string) $reviewSet['name'], $account);
        $scopeTagName = $this->uniqueFlashcardTagName($copyName, $account);
        $scopeTagId = $this->newId();
        $newSetId = $this->newId();
        $now = $this->now();
        $sourceTags = $this->flashcardTagNameMap((string) $reviewSet['owner']);
        $referencedSourceTags = [];
        foreach ($cards as $card) {
            $cardTags = $this->decodeJsonColumn($card['tags'] ?? '[]');
            foreach (is_array($cardTags) ? $cardTags : [] as $tagId) {
                if (is_string($tagId) && isset($sourceTags[$tagId])) {
                    $referencedSourceTags[$tagId] = true;
                }
            }
        }
        $recipientTags = $this->flashcardTagIdMap($account);
        $mappedTags = [];
        $createdFiles = [];
        $pdo = $this->database->pdo;
        $pdo->beginTransaction();
        try {
            $statement = $pdo->prepare(
                'INSERT INTO flashcard_tags (id, owner, name) VALUES (:id, :owner, :name)',
            );
            $statement->execute(['id' => $scopeTagId, 'owner' => $account, 'name' => $scopeTagName]);
            $recipientTags[mb_strtolower($scopeTagName)] = $scopeTagId;

            foreach (array_keys($referencedSourceTags) as $sourceTagId) {
                $tagName = $sourceTags[$sourceTagId];
                $key = mb_strtolower($tagName);
                if (isset($recipientTags[$key])) {
                    $mappedTags[$sourceTagId] = $recipientTags[$key];
                    continue;
                }
                $tagId = $this->newId();
                $statement->execute(['id' => $tagId, 'owner' => $account, 'name' => $tagName]);
                $recipientTags[$key] = $tagId;
                $mappedTags[$sourceTagId] = $tagId;
            }

            $setStatement = $pdo->prepare(
                'INSERT INTO flashcard_review_sets (
                    id, owner, name, tags, mode, card_sides, indefinite, max_cards,
                    front_seconds, back_seconds, back_speech_repeat_count,
                    note_before_back,
                    speech_enabled, front_language, back_language, sort_mode,
                    sort_order, created_at, updated_at
                 ) VALUES (
                    :id, :owner, :name, :tags, :mode, :card_sides, :indefinite, :max_cards,
                    :front_seconds, :back_seconds, :back_speech_repeat_count,
                    :note_before_back,
                    :speech_enabled, :front_language, :back_language, :sort_mode,
                    :sort_order, :created_at, :updated_at
                 )',
            );
            $setStatement->execute([
                'id' => $newSetId,
                'owner' => $account,
                'name' => $copyName,
                'tags' => json_encode([$scopeTagId], JSON_THROW_ON_ERROR),
                ...$this->booleanDatabaseSettings($settings),
                'sort_order' => $this->nextFlashcardReviewSetOrder($account),
                'created_at' => $now,
                'updated_at' => $now,
            ]);
            $this->saveFlashcardReviewSetPreferences($newSetId, $account, $settings);

            $cardStatement = $pdo->prepare(
                'INSERT INTO flashcards (
                    id, owner, front, back, note, image_url, image_file,
                    library_image_id, image_metadata, tags, created_at, updated_at,
                    last_reviewed_at, passive_views, success_count, error_count
                 ) VALUES (
                    :id, :owner, :front, :back, :note, :image_url, :image_file,
                    :library_image_id, :image_metadata, :tags, :created_at, :updated_at,
                    :last_reviewed_at, 0, 0, 0
                 )',
            );
            foreach ($cards as $card) {
                $cardTags = $this->decodeJsonColumn($card['tags'] ?? '[]');
                $copiedTags = [$scopeTagId];
                foreach (is_array($cardTags) ? $cardTags : [] as $tagId) {
                    if (is_string($tagId) && isset($mappedTags[$tagId])) {
                        $copiedTags[] = $mappedTags[$tagId];
                    }
                }
                $imageFile = (string) ($card['image_file'] ?? '');
                $libraryImageId = (int) ($card['library_image_id'] ?? 0);
                if ($imageFile !== '' && $libraryImageId === 0) {
                    $imageFile = $this->duplicateFlashcardImageFile($imageFile);
                    if ($imageFile !== '') {
                        $createdFiles[] = $imageFile;
                    }
                }
                $cardStatement->execute([
                    'id' => $this->newId(),
                    'owner' => $account,
                    'front' => $card['front'],
                    'back' => $card['back'],
                    'note' => $card['note'] ?? '',
                    'image_url' => $card['image_url'] ?? '',
                    'image_file' => $imageFile,
                    'library_image_id' => $libraryImageId,
                    'image_metadata' => $card['image_metadata'] ?? '{}',
                    'tags' => json_encode(array_values(array_unique($copiedTags)), JSON_THROW_ON_ERROR),
                    'created_at' => $now,
                    'updated_at' => $now,
                    'last_reviewed_at' => '',
                ]);
            }
            $pdo->commit();
        } catch (Throwable $exception) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            foreach ($createdFiles as $filename) {
                $this->removeFlashcardImageFileIfUnused($filename);
            }
            throw $exception;
        }

        $this->respond($this->accessibleReviewSetResponse(
            $this->accessibleFlashcardReviewSet($newSetId, $account),
            $account,
        ), 201);
    }

    private function sharedFlashcards(string $method, string $id, array $user): never
    {
        $account = (string) $user['id'];
        $reviewSet = $this->accessibleFlashcardReviewSet($id, $account);
        if ($method === 'GET') {
            $this->respond(array_map(
                fn (array $card): array => $this->flashcardResponseForReviewer($card, $account),
                $this->matchingSourceFlashcards($reviewSet),
            ));
        }
        $this->requireFlashcardReviewSetEditor($reviewSet, $account);
        $body = $this->jsonBody();
        $this->allowOnlyFields($body, ['front', 'back', 'note', 'image_url']);
        $fields = $this->requireCollection('flashcards')['config']['fields'];
        $front = $this->validateField('front', $body['front'] ?? null, $fields['front']);
        $back = $this->validateField('back', $body['back'] ?? null, $fields['back']);
        $note = $this->validateField('note', $body['note'] ?? '', $fields['note']);
        $imageUrl = $this->validateFlashcardImageUrl($body['image_url'] ?? '');
        $tags = $this->reviewSetTagIds($reviewSet);
        $now = $this->now();
        $cardId = $this->newId();
        $statement = $this->database->pdo->prepare(
            "INSERT INTO flashcards (
                id, owner, front, back, note, image_url, image_file,
                library_image_id, image_metadata, tags, created_at, updated_at,
                last_reviewed_at, passive_views, success_count, error_count
             ) VALUES (
                :id, :owner, :front, :back, :note, :image_url, '', 0, '{}',
                :tags, :created_at, :updated_at, '', 0, 0, 0
             )",
        );
        $statement->execute([
            'id' => $cardId,
            'owner' => $reviewSet['owner'],
            'front' => $front,
            'back' => $back,
            'note' => $note,
            'image_url' => $imageUrl,
            'tags' => json_encode($tags, JSON_THROW_ON_ERROR),
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        $card = $this->ownedRecord('flashcards', $cardId, (string) $reviewSet['owner']);
        $this->syncFlashcardWithActiveReviewQueues($card, (string) $reviewSet['owner'], true);
        $this->respond($this->flashcardResponseForReviewer($card, $account), 201);
    }

    private function importSharedFlashcards(string $reviewSetId, array $user): never
    {
        $account = (string) $user['id'];
        $reviewSet = $this->accessibleFlashcardReviewSet($reviewSetId, $account);
        $this->requireFlashcardReviewSetEditor($reviewSet, $account);
        $body = $this->jsonBody();
        $this->allowOnlyFields($body, ['rows']);
        $rows = $body['rows'] ?? null;
        if (!is_array($rows) || !array_is_list($rows) || $rows === []) {
            throw new ApiException(422, 'Add at least one flashcard row.', ['rows' => 'required']);
        }
        if (count($rows) > self::MAX_FLASHCARD_IMPORT_ROWS) {
            throw new ApiException(
                422,
                'Too many flashcards were included in one import.',
                ['rows' => 'max:' . self::MAX_FLASHCARD_IMPORT_ROWS],
            );
        }

        $validatedRows = [];
        foreach ($rows as $index => $row) {
            $rowNumber = $index + 1;
            if (!is_array($row) || array_is_list($row)) {
                throw new ApiException(422, "Flashcard row {$rowNumber} is invalid.");
            }
            $unknown = array_values(array_diff(array_keys($row), ['front', 'back', 'note', 'tags']));
            if ($unknown !== []) {
                throw new ApiException(422, "Flashcard row {$rowNumber} contains unknown fields.", [
                    'fields' => $unknown,
                ]);
            }
            $rowTags = $row['tags'] ?? [];
            if (!is_array($rowTags) || !array_is_list($rowTags) || count($rowTags) > 50) {
                throw new ApiException(422, "Flashcard row {$rowNumber} has invalid tags.");
            }
            foreach ($rowTags as $tag) {
                $this->validateText($tag, 'tag', 50, true);
            }
            $validatedRows[] = [
                'front' => $this->validateText($row['front'] ?? null, 'front', 5000, true),
                'back' => $this->validateText($row['back'] ?? null, 'back', 5000, true),
                'note' => $this->validateText($row['note'] ?? '', 'note', 2000),
            ];
        }

        $owner = (string) $reviewSet['owner'];
        $tags = json_encode($this->reviewSetTagIds($reviewSet), JSON_THROW_ON_ERROR);
        $now = $this->now();
        $createdCards = [];
        $statement = $this->database->pdo->prepare(
            "INSERT INTO flashcards (
                id, owner, front, back, note, image_url, image_file,
                library_image_id, image_metadata, tags, created_at, updated_at,
                last_reviewed_at, passive_views, success_count, error_count
             ) VALUES (
                :id, :owner, :front, :back, :note, '', '', 0, '{}',
                :tags, :created_at, :updated_at, '', 0, 0, 0
             )",
        );
        $pdo = $this->database->pdo;
        $pdo->beginTransaction();
        try {
            foreach ($validatedRows as $row) {
                $cardId = $this->newId();
                $statement->execute([
                    'id' => $cardId,
                    'owner' => $owner,
                    'front' => $row['front'],
                    'back' => $row['back'],
                    'note' => $row['note'],
                    'tags' => $tags,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
                $createdCards[] = $this->ownedRecord('flashcards', $cardId, $owner);
            }
            $pdo->commit();
        } catch (Throwable $exception) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $exception;
        }
        foreach ($createdCards as $card) {
            $this->syncFlashcardWithActiveReviewQueues($card, $owner, true);
        }
        $this->respond([
            'cards' => array_map(
                fn (array $card): array => $this->flashcardResponseForReviewer($card, $account),
                $createdCards,
            ),
            'tags' => [],
        ], 201);
    }

    private function bulkUpdateSharedFlashcards(string $reviewSetId, array $user): never
    {
        $account = (string) $user['id'];
        $reviewSet = $this->accessibleFlashcardReviewSet($reviewSetId, $account);
        $this->requireFlashcardReviewSetEditor($reviewSet, $account);
        $body = $this->jsonBody();
        $this->allowOnlyFields($body, ['action', 'card_ids']);
        if (($body['action'] ?? null) !== 'delete') {
            throw new ApiException(422, 'Select a valid Review set card bulk action.', [
                'action' => 'choice',
            ]);
        }
        $cardIds = $this->validateFlashcardBulkIds(
            $body['card_ids'] ?? null,
            'card_ids',
            false,
        );
        foreach ($cardIds as $cardId) {
            $this->matchingSourceFlashcard($reviewSet, $cardId);
        }

        $owner = (string) $reviewSet['owner'];
        $pdo = $this->database->pdo;
        $pdo->beginTransaction();
        try {
            foreach ($cardIds as $cardId) {
                $this->deleteFlashcard($cardId, $owner);
            }
            $pdo->commit();
        } catch (Throwable $exception) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $exception;
        }
        $this->respond(['cards' => [], 'deleted_ids' => $cardIds]);
    }

    private function sharedFlashcardRecord(
        string $method,
        string $reviewSetId,
        string $cardId,
        array $user,
    ): never {
        $account = (string) $user['id'];
        $reviewSet = $this->accessibleFlashcardReviewSet($reviewSetId, $account);
        $this->requireFlashcardReviewSetEditor($reviewSet, $account);
        $card = $this->matchingSourceFlashcard($reviewSet, $cardId);
        if ($method === 'DELETE') {
            $this->deleteFlashcard($cardId, (string) $reviewSet['owner']);
            $this->respond(null, 204);
        }

        $body = $this->jsonBody();
        $this->allowOnlyFields($body, ['front', 'back', 'note', 'image_url']);
        $fields = $this->requireCollection('flashcards')['config']['fields'];
        $values = [];
        foreach (['front', 'back', 'note'] as $field) {
            if (array_key_exists($field, $body)) {
                $values[$field] = $this->validateField($field, $body[$field], $fields[$field]);
            }
        }
        $oldImage = null;
        if (array_key_exists('image_url', $body)) {
            $values['image_url'] = $this->validateFlashcardImageUrl($body['image_url']);
            $values['image_file'] = '';
            $values['library_image_id'] = 0;
            $values['image_metadata'] = '{}';
            $oldImage = $this->validAvatarFilename($card['image_file'] ?? null);
        }
        if ($values === []) {
            throw new ApiException(422, 'At least one writable field is required.');
        }
        $values['updated_at'] = $this->now();
        $assignments = array_map(
            static fn (string $field): string => $field . ' = :' . $field,
            array_keys($values),
        );
        $statement = $this->database->pdo->prepare(
            'UPDATE flashcards SET ' . implode(', ', $assignments) . '
             WHERE id = :id AND owner = :owner',
        );
        $statement->execute([
            ...$values,
            'id' => $cardId,
            'owner' => $reviewSet['owner'],
        ]);
        $card = $this->ownedRecord('flashcards', $cardId, (string) $reviewSet['owner']);
        $this->syncFlashcardWithActiveReviewQueues($card, (string) $reviewSet['owner'], false);
        if ($oldImage !== null) {
            $this->removeFlashcardImageFileIfUnused($oldImage);
        }
        $this->respond($this->flashcardResponseForReviewer($card, $account));
    }

    private function sharedFlashcardImage(
        string $method,
        string $reviewSetId,
        string $cardId,
        array $user,
    ): never {
        $account = (string) $user['id'];
        $reviewSet = $this->accessibleFlashcardReviewSet($reviewSetId, $account);
        $this->requireFlashcardReviewSetEditor($reviewSet, $account);
        $card = $this->matchingSourceFlashcard($reviewSet, $cardId);
        $sourceOwner = (string) $reviewSet['owner'];
        $this->rateLimit('flashcard-image-update:' . $account, 60, 900);
        $oldFilename = $this->validAvatarFilename($card['image_file'] ?? null);
        $updated = $this->now();
        if ($method === 'DELETE') {
            $statement = $this->database->pdo->prepare(
                "UPDATE flashcards SET image_url = '', image_file = '', library_image_id = 0,
                    image_metadata = '{}', updated_at = :updated_at
                 WHERE id = :id AND owner = :owner",
            );
            $statement->execute(['updated_at' => $updated, 'id' => $cardId, 'owner' => $sourceOwner]);
        } else {
            $bytes = $this->compressedSquareJpegBytes($this->jsonBody(), 'card image');
            $filename = $this->storeSquareJpeg($bytes, $this->flashcardImageDirectory(), 'card image');
            try {
                $statement = $this->database->pdo->prepare(
                    "UPDATE flashcards SET image_url = '', image_file = :image_file,
                        library_image_id = 0, image_metadata = '{}', updated_at = :updated_at
                     WHERE id = :id AND owner = :owner",
                );
                $statement->execute([
                    'image_file' => $filename,
                    'updated_at' => $updated,
                    'id' => $cardId,
                    'owner' => $sourceOwner,
                ]);
            } catch (Throwable $exception) {
                @unlink($this->flashcardImageDirectory() . DIRECTORY_SEPARATOR . $filename);
                throw $exception;
            }
        }
        $card = $this->ownedRecord('flashcards', $cardId, $sourceOwner);
        $this->syncFlashcardWithActiveReviewQueues($card, $sourceOwner, false);
        if ($oldFilename !== null && ($method === 'DELETE' || !hash_equals($oldFilename, (string) $card['image_file']))) {
            $this->removeFlashcardImageFileIfUnused($oldFilename);
        }
        $this->respond($this->flashcardResponseForReviewer($card, $account));
    }

    private function setSharedFlashcardLibraryImage(
        string $reviewSetId,
        string $cardId,
        array $user,
    ): never {
        $account = (string) $user['id'];
        $reviewSet = $this->accessibleFlashcardReviewSet($reviewSetId, $account);
        $this->requireFlashcardReviewSetEditor($reviewSet, $account);
        $card = $this->matchingSourceFlashcard($reviewSet, $cardId);
        $body = $this->jsonBody();
        $this->allowOnlyFields($body, ['image_id']);
        $imageId = $body['image_id'] ?? null;
        if (!is_int($imageId) || $imageId < 1) {
            throw new ApiException(422, 'Select a valid library image.', ['image_id' => 'integer']);
        }
        $statement = $this->database->pdo->prepare(
            "SELECT * FROM image_assets WHERE id = :id AND provider = 'pexels' LIMIT 1",
        );
        $statement->execute(['id' => $imageId]);
        $asset = $statement->fetch();
        if (!is_array($asset)) {
            throw new ApiException(404, 'Library image not found.');
        }
        $filename = $this->validAvatarFilename($asset['filename'] ?? null);
        if ($filename === null || !is_file($this->flashcardImageDirectory() . DIRECTORY_SEPARATOR . $filename)) {
            throw new ApiException(409, 'The cached library image is unavailable.');
        }
        $metadata = [
            'id' => (int) $asset['id'],
            'provider' => (string) $asset['provider'],
            'alt' => (string) $asset['alt'],
            'photographer' => (string) $asset['photographer'],
            'photographer_url' => (string) $asset['photographer_url'],
            'source_url' => (string) $asset['source_url'],
            'license_name' => (string) $asset['license_name'],
            'license_url' => (string) $asset['license_url'],
        ];
        $sourceOwner = (string) $reviewSet['owner'];
        $oldFilename = $this->validAvatarFilename($card['image_file'] ?? null);
        $statement = $this->database->pdo->prepare(
            "UPDATE flashcards SET image_url = '', image_file = :image_file,
                library_image_id = :library_image_id, image_metadata = :image_metadata,
                updated_at = :updated_at WHERE id = :id AND owner = :owner",
        );
        $statement->execute([
            'image_file' => $filename,
            'library_image_id' => $imageId,
            'image_metadata' => json_encode($metadata, JSON_THROW_ON_ERROR),
            'updated_at' => $this->now(),
            'id' => $cardId,
            'owner' => $sourceOwner,
        ]);
        $card = $this->ownedRecord('flashcards', $cardId, $sourceOwner);
        $this->syncFlashcardWithActiveReviewQueues($card, $sourceOwner, false);
        if ($oldFilename !== null && !hash_equals($oldFilename, $filename)) {
            $this->removeFlashcardImageFileIfUnused($oldFilename);
        }
        $this->respond($this->flashcardResponseForReviewer($card, $account));
    }

    private function startFlashcardReviewSession(string $reviewSetId, array $user): never
    {
        $body = $this->jsonBody();
        $this->allowOnlyFields($body, ['task', 'program_step', 'task_date']);

        $sessionCollection = $this->requireCollection('flashcard_review_sessions');
        $fields = $sessionCollection['config']['fields'];
        $taskId = $this->validateField('task', $body['task'] ?? '', $fields['task']);
        $programStepId = $this->validateField(
            'program_step',
            $body['program_step'] ?? '',
            $fields['program_step'],
        );
        $taskDate = $this->validateField(
            'task_date',
            $body['task_date'] ?? '',
            $fields['task_date'],
        );

        $owner = (string) $user['id'];
        $reviewSet = $this->accessibleFlashcardReviewSet($reviewSetId, $owner);
        $reviewSet = array_merge(
            $reviewSet,
            $this->effectiveFlashcardReviewSettings($reviewSet, $owner),
        );
        $sourceOwner = (string) $reviewSet['owner'];
        if ($taskId === '') {
            if ($programStepId !== '' || $taskDate !== '') {
                throw new ApiException(422, 'Task details require an attached Review set task.');
            }
        } else {
            if ($taskDate === '') {
                $taskDate = (new DateTimeImmutable('now', new DateTimeZone((string) $user['timezone'])))
                    ->format('Y-m-d');
            }
            if (!$this->flashcardAttributionMatchesReviewSet(
                $taskId,
                $programStepId,
                $reviewSetId,
                $owner,
            )) {
                throw new ApiException(
                    422,
                    'The selected task or program step is not attached to this Review set.',
                );
            }
            $task = $this->ownedRecord('tasks', $taskId, $owner);
            if (
                !(bool) $task['active']
                || !$this->intervalAttributionIsOpenOnDate($task, $programStepId, $taskDate, $owner)
            ) {
                throw new ApiException(409, 'The selected task or program step is not open for this date.');
            }
        }

        $statement = $this->database->pdo->prepare(
            "SELECT id FROM flashcard_review_sessions
             WHERE owner = :owner AND status IN ('running', 'paused')
             ORDER BY started_at DESC LIMIT 1",
        );
        $statement->execute(['owner' => $owner]);
        $activeSession = $statement->fetchColumn();
        if ($activeSession !== false) {
            throw new ApiException(409, 'Another flashcard review is already active.', [
                'activeSession' => (string) $activeSession,
            ]);
        }

        $selection = $this->flashcardReviewSelection($reviewSet, $sourceOwner, $owner);
        $selectedTags = $selection['tags'];
        $sortMode = $selection['sortMode'];
        $queue = $selection['queue'];

        $now = (new DateTimeImmutable('now'))->format('Y-m-d\TH:i:s.v\Z');
        $sessionId = $this->newId();
        try {
            $statement = $this->database->pdo->prepare(
                'INSERT INTO flashcard_review_sessions (
                    id, owner, source_owner, review_set, status, snapshot_name, mode_snapshot, card_sides_snapshot,
                    sort_snapshot, indefinite_snapshot, max_cards_snapshot, tags_snapshot,
                    front_seconds_snapshot, back_seconds_snapshot,
                    back_speech_repeat_count_snapshot,
                    note_before_back_snapshot,
                    speech_enabled_snapshot, front_language_snapshot, back_language_snapshot, queue_state,
                    started_at, ended_at, updated_at, elapsed_seconds, total_cards, viewed_count,
                    success_count, error_count, ejected_count, task, program_step, task_date
                 ) VALUES (
                    :id, :owner, :source_owner, :review_set, :status, :snapshot_name, :mode_snapshot,
                    :card_sides_snapshot, :sort_snapshot, :indefinite_snapshot, :max_cards_snapshot,
                    :tags_snapshot, :front_seconds_snapshot, :back_seconds_snapshot,
                    :back_speech_repeat_count_snapshot,
                    :note_before_back_snapshot,
                    :speech_enabled_snapshot, :front_language_snapshot, :back_language_snapshot, :queue_state,
                    :started_at, :ended_at, :updated_at, 0, :total_cards, 0, 0, 0, 0,
                    :task, :program_step, :task_date
                 )',
            );
            $statement->execute([
                'id' => $sessionId,
                'owner' => $owner,
                'source_owner' => $sourceOwner,
                'review_set' => $reviewSetId,
                'status' => 'running',
                'snapshot_name' => (string) $reviewSet['name'],
                'mode_snapshot' => (string) $reviewSet['mode'],
                'card_sides_snapshot' => (string) $reviewSet['card_sides'],
                'sort_snapshot' => $sortMode,
                'indefinite_snapshot' => (bool) $reviewSet['indefinite'],
                'max_cards_snapshot' => (int) $reviewSet['max_cards'],
                'tags_snapshot' => json_encode(array_values($selectedTags), JSON_THROW_ON_ERROR),
                'front_seconds_snapshot' => (int) $reviewSet['front_seconds'],
                'back_seconds_snapshot' => (int) $reviewSet['back_seconds'],
                'back_speech_repeat_count_snapshot' => (
                    (string) $reviewSet['mode'] === 'passive'
                    && (bool) $reviewSet['speech_enabled']
                ) ? (int) $reviewSet['back_speech_repeat_count'] : 1,
                'note_before_back_snapshot' => (bool) $reviewSet['note_before_back'],
                'speech_enabled_snapshot' => (bool) $reviewSet['speech_enabled'],
                'front_language_snapshot' => (string) $reviewSet['front_language'],
                'back_language_snapshot' => (string) $reviewSet['back_language'],
                'queue_state' => json_encode($queue, JSON_THROW_ON_ERROR),
                'started_at' => $now,
                'ended_at' => '',
                'updated_at' => $now,
                'total_cards' => count($queue),
                'task' => $taskId,
                'program_step' => $programStepId,
                'task_date' => $taskDate,
            ]);
        } catch (PDOException $exception) {
            if ($this->isConstraintViolation($exception)) {
                throw new ApiException(409, 'Another flashcard review is already active.');
            }
            throw $exception;
        }

        $session = $this->ownedRecord('flashcard_review_sessions', $sessionId, $owner);
        $this->respond($this->normalizeRecord($sessionCollection, $session), 201);
    }

    private function actOnFlashcardReviewSession(string $id, array $user): never
    {
        $body = $this->jsonBody();
        $this->allowOnlyFields($body, ['action', 'elapsed_seconds']);
        if (!array_key_exists('action', $body) || !array_key_exists('elapsed_seconds', $body)) {
            throw new ApiException(422, 'The action and elapsed_seconds fields are required.');
        }
        if (!is_string($body['action'])) {
            throw new ApiException(422, 'The action field must be a string.');
        }
        $action = $body['action'];
        $validActions = [
            'success', 'error', 'view', 'previous', 'next', 'push', 'eject', 'pause', 'resume', 'end',
        ];
        if (!in_array($action, $validActions, true)) {
            throw new ApiException(422, 'The review action is invalid.');
        }
        $elapsedSeconds = $this->validateInteger(
            $body['elapsed_seconds'],
            'elapsed_seconds',
            ['min' => 0, 'max' => null],
        );

        $owner = (string) $user['id'];
        $pdo = $this->database->pdo;
        $pdo->beginTransaction();
        try {
            $session = $this->ownedRecord('flashcard_review_sessions', $id, $owner);
            $status = (string) $session['status'];
            if (in_array($status, ['completed', 'ended'], true)) {
                throw new ApiException(409, 'This flashcard review has already ended.');
            }
            if ($elapsedSeconds < (int) $session['elapsed_seconds']) {
                throw new ApiException(422, 'Review time cannot move backwards.');
            }

            $mode = (string) $session['mode_snapshot'];
            $indefinite = $mode === 'passive' && (bool) $session['indefinite_snapshot'];
            if (in_array($action, ['success', 'error'], true) && $mode !== 'manual') {
                throw new ApiException(422, 'Passive reviews are viewed rather than graded.');
            }
            if ($action === 'view' && $mode !== 'passive') {
                throw new ApiException(422, 'Manual reviews must be graded as Success or Error.');
            }

            $queue = $this->decodeJsonColumn($session['queue_state'] ?? '[]');
            if (!is_array($queue) || !array_is_list($queue)) {
                throw new ApiException(500, 'The review queue is invalid.');
            }
            $now = (new DateTimeImmutable('now'))->format('Y-m-d\TH:i:s.v\Z');
            $endedAt = '';
            $viewedCount = (int) $session['viewed_count'];
            $successCount = (int) $session['success_count'];
            $errorCount = (int) $session['error_count'];
            $ejectedCount = (int) $session['ejected_count'];
            $totalCards = (int) $session['total_cards'];
            $occurrence = null;

            if ($action === 'pause') {
                if ($status !== 'running') {
                    throw new ApiException(409, 'This flashcard review is already paused.');
                }
                $status = 'paused';
            } elseif ($action === 'resume') {
                if ($status !== 'paused') {
                    throw new ApiException(409, 'This flashcard review is already running.');
                }
                $status = 'running';
            } elseif ($action === 'end') {
                // A looping review has no natural end-of-queue. Once at least one card has
                // been processed, stopping it is the successful way to finish the session
                // and any task or program step that launched it.
                $status = $indefinite && ($viewedCount + $ejectedCount) > 0
                    ? 'completed'
                    : 'ended';
                $endedAt = $now;
            } else {
                if ($status !== 'running') {
                    throw new ApiException(409, 'Resume this flashcard review before continuing.');
                }
                if ($queue === []) {
                    throw new ApiException(409, 'This flashcard review has no remaining cards.');
                }

                if ($action === 'previous') {
                    if (count($queue) > 1) {
                        $previous = array_pop($queue);
                        array_unshift($queue, $previous);
                    }
                } elseif ($action === 'next' || $action === 'push') {
                    if (count($queue) > 1) {
                        $current = array_shift($queue);
                        $queue[] = $current;
                    }
                } else {
                    $current = array_shift($queue);
                    if (!is_array($current)) {
                        throw new ApiException(500, 'The current review card is invalid.');
                    }
                    if ($action === 'eject') {
                        $ejectedCount++;
                        $this->recordFlashcardReviewEvent(
                            $id,
                            $current,
                            'ejected',
                            $now,
                            $owner,
                        );
                    } else {
                        $viewedCount++;
                        if ($action === 'success') {
                            $successCount++;
                        } elseif ($action === 'error') {
                            $errorCount++;
                        }
                        $this->recordFlashcardReviewEvent(
                            $id,
                            $current,
                            $action === 'view' ? 'passive' : $action,
                            $now,
                            $owner,
                        );
                        if ($action === 'view' && $indefinite) {
                            $queue[] = $current;
                        }
                    }
                    if ($queue === []) {
                        $status = 'completed';
                        $endedAt = $now;
                    }
                }
            }

            if ($indefinite) {
                // Ejected cards permanently leave a looping queue, so its cycle size must
                // follow the live queue rather than the original session snapshot.
                $totalCards = count($queue);
            }

            $statement = $pdo->prepare(
                'UPDATE flashcard_review_sessions SET
                    status = :status,
                    queue_state = :queue_state,
                    updated_at = :updated_at,
                    ended_at = :ended_at,
                    elapsed_seconds = :elapsed_seconds,
                    viewed_count = :viewed_count,
                    success_count = :success_count,
                    error_count = :error_count,
                    ejected_count = :ejected_count,
                    total_cards = :total_cards
                 WHERE id = :id AND owner = :owner',
            );
            $statement->execute([
                'status' => $status,
                'queue_state' => json_encode(array_values($queue), JSON_THROW_ON_ERROR),
                'updated_at' => $now,
                'ended_at' => $endedAt,
                'elapsed_seconds' => $elapsedSeconds,
                'viewed_count' => $viewedCount,
                'success_count' => $successCount,
                'error_count' => $errorCount,
                'ejected_count' => $ejectedCount,
                'total_cards' => $totalCards,
                'id' => $id,
                'owner' => $owner,
            ]);
            if ($status === 'completed') {
                $occurrence = $this->completeAttributedIntervalTask($session, $owner, $endedAt);
            }
            $session = $this->ownedRecord('flashcard_review_sessions', $id, $owner);
            $pdo->commit();
        } catch (Throwable $exception) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $exception;
        }

        $this->respond([
            'session' => $this->normalizeRecord(
                $this->requireCollection('flashcard_review_sessions'),
                $session,
            ),
            'occurrence' => $occurrence,
        ]);
    }

    private function updateFlashcardReviewSessionSettings(string $id, array $user): never
    {
        $body = $this->jsonBody();
        $fields = [
            'mode', 'card_sides', 'indefinite', 'max_cards', 'front_seconds', 'back_seconds',
            'back_speech_repeat_count', 'note_before_back',
            'speech_enabled', 'front_language', 'back_language',
            'sort_mode',
        ];
        $this->allowOnlyFields($body, $fields);
        foreach ($fields as $field) {
            if (!array_key_exists($field, $body)) {
                throw new ApiException(422, 'Every session setting is required.', [
                    $field => 'required',
                ]);
            }
        }

        $reviewSetFields = $this->requireCollection('flashcard_review_sets')['config']['fields'];
        $settings = [];
        foreach ($fields as $field) {
            $settings[$field] = $this->validateField($field, $body[$field], $reviewSetFields[$field]);
        }
        if ($settings['mode'] !== 'passive') {
            $settings['indefinite'] = false;
        }
        $this->validateFlashcardSpeechSettings($settings);

        $owner = (string) $user['id'];
        $pdo = $this->database->pdo;
        $pdo->beginTransaction();
        try {
            $session = $this->ownedRecord('flashcard_review_sessions', $id, $owner);
            if (!in_array((string) $session['status'], ['running', 'paused'], true)) {
                throw new ApiException(409, 'Only an active flashcard review can be adjusted.');
            }

            $indefinite = $settings['mode'] === 'passive' && (bool) $settings['indefinite'];
            $processed = (int) $session['viewed_count'] + (int) $session['ejected_count'];
            if (!$indefinite && (int) $settings['max_cards'] <= $processed) {
                throw new ApiException(
                    422,
                    'The card limit must leave at least one card in this session.',
                    ['max_cards' => 'min:' . ($processed + 1)],
                );
            }

            $selection = $this->flashcardReviewSelection([
                'tags' => $session['tags_snapshot'],
                'sort_mode' => $settings['sort_mode'],
                'max_cards' => 100,
            ], (string) ($session['source_owner'] ?: $owner), $owner);
            $eventStatement = $pdo->prepare(
                'SELECT card, outcome FROM flashcard_review_events
                 WHERE session = :session AND owner = :owner AND card != :empty',
            );
            $eventStatement->execute(['session' => $id, 'owner' => $owner, 'empty' => '']);
            $excluded = [];
            foreach ($eventStatement->fetchAll() as $event) {
                if (!$indefinite || (string) $event['outcome'] === 'ejected') {
                    $excluded[(string) $event['card']] = true;
                }
            }
            $queue = array_values(array_filter(
                $selection['queue'],
                static fn (array $card): bool => !isset($excluded[(string) $card['id']]),
            ));
            $remainingLimit = $indefinite
                ? (int) $settings['max_cards']
                : (int) $settings['max_cards'] - $processed;
            $queue = array_slice($queue, 0, $remainingLimit);
            if ($queue === []) {
                throw new ApiException(409, 'No eligible cards remain for these session settings.');
            }
            $totalCards = $indefinite ? count($queue) : $processed + count($queue);
            $now = (new DateTimeImmutable('now'))->format('Y-m-d\TH:i:s.v\Z');

            $statement = $pdo->prepare(
                'UPDATE flashcard_review_sessions SET
                    mode_snapshot = :mode_snapshot,
                    card_sides_snapshot = :card_sides_snapshot,
                    indefinite_snapshot = :indefinite_snapshot,
                    max_cards_snapshot = :max_cards_snapshot,
                    sort_snapshot = :sort_snapshot,
                    front_seconds_snapshot = :front_seconds_snapshot,
                    back_seconds_snapshot = :back_seconds_snapshot,
                    back_speech_repeat_count_snapshot = :back_speech_repeat_count_snapshot,
                    note_before_back_snapshot = :note_before_back_snapshot,
                    speech_enabled_snapshot = :speech_enabled_snapshot,
                    front_language_snapshot = :front_language_snapshot,
                    back_language_snapshot = :back_language_snapshot,
                    queue_state = :queue_state,
                    total_cards = :total_cards,
                    updated_at = :updated_at
                 WHERE id = :id AND owner = :owner',
            );
            $statement->execute([
                'mode_snapshot' => $settings['mode'],
                'card_sides_snapshot' => $settings['card_sides'],
                'indefinite_snapshot' => $indefinite,
                'max_cards_snapshot' => $settings['max_cards'],
                'sort_snapshot' => $settings['sort_mode'],
                'front_seconds_snapshot' => $settings['front_seconds'],
                'back_seconds_snapshot' => $settings['back_seconds'],
                'back_speech_repeat_count_snapshot' => $settings['back_speech_repeat_count'],
                'note_before_back_snapshot' => $settings['note_before_back'],
                'speech_enabled_snapshot' => $settings['speech_enabled'],
                'front_language_snapshot' => $settings['front_language'],
                'back_language_snapshot' => $settings['back_language'],
                'queue_state' => json_encode($queue, JSON_THROW_ON_ERROR),
                'total_cards' => $totalCards,
                'updated_at' => $now,
                'id' => $id,
                'owner' => $owner,
            ]);
            $session = $this->ownedRecord('flashcard_review_sessions', $id, $owner);
            $pdo->commit();
        } catch (Throwable $exception) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $exception;
        }

        $this->respond($this->normalizeRecord(
            $this->requireCollection('flashcard_review_sessions'),
            $session,
        ));
    }

    private function recordFlashcardReviewEvent(
        string $sessionId,
        array $card,
        string $outcome,
        string $reviewedAt,
        string $owner,
    ): void {
        $cardId = (string) ($card['id'] ?? '');
        $tags = is_array($card['tags'] ?? null) ? array_values($card['tags']) : [];
        $statement = $this->database->pdo->prepare(
            'INSERT INTO flashcard_review_events (
                id, owner, session, card, outcome, reviewed_at,
                front_snapshot, back_snapshot, tags_snapshot
             ) VALUES (
                :id, :owner, :session, :card, :outcome, :reviewed_at,
                :front_snapshot, :back_snapshot, :tags_snapshot
             )',
        );
        $statement->execute([
            'id' => $this->newId(),
            'owner' => $owner,
            'session' => $sessionId,
            'card' => $cardId,
            'outcome' => $outcome,
            'reviewed_at' => $reviewedAt,
            'front_snapshot' => (string) ($card['front'] ?? ''),
            'back_snapshot' => (string) ($card['back'] ?? ''),
            'tags_snapshot' => json_encode($tags, JSON_THROW_ON_ERROR),
        ]);

        $counter = match ($outcome) {
            'success' => 'success_count',
            'error' => 'error_count',
            'passive' => 'passive_views',
            default => null,
        };
        if ($counter === null) {
            return;
        }
        $cardStatement = $this->database->pdo->prepare(
            'SELECT owner FROM flashcards WHERE id = :id LIMIT 1',
        );
        $cardStatement->execute(['id' => $cardId]);
        $cardOwner = $cardStatement->fetchColumn();
        if ($cardOwner === false) {
            return;
        }
        $statement = $this->database->pdo->prepare(
            "INSERT INTO flashcard_review_card_stats (
                reviewer, card, last_reviewed_at, passive_views,
                success_count, error_count, updated_at
             ) VALUES (
                :reviewer, :card, :reviewed_at,
                :passive_views, :success_count, :error_count, :reviewed_at
             )
             ON CONFLICT(reviewer, card) DO UPDATE SET
                {$counter} = {$counter} + 1,
                last_reviewed_at = excluded.last_reviewed_at,
                updated_at = excluded.updated_at",
        );
        $statement->execute([
            'reviewer' => $owner,
            'card' => $cardId,
            'reviewed_at' => $reviewedAt,
            'passive_views' => $counter === 'passive_views' ? 1 : 0,
            'success_count' => $counter === 'success_count' ? 1 : 0,
            'error_count' => $counter === 'error_count' ? 1 : 0,
        ]);
        if (hash_equals((string) $cardOwner, $owner)) {
            $statement = $this->database->pdo->prepare(
                "UPDATE flashcards SET {$counter} = {$counter} + 1,
                    last_reviewed_at = :reviewed_at, updated_at = :reviewed_at
                 WHERE id = :id AND owner = :owner",
            );
            $statement->execute([
                'reviewed_at' => $reviewedAt,
                'id' => $cardId,
                'owner' => $owner,
            ]);
        }
    }

    private function sortFlashcardsForReview(array &$cards, string $sortMode): void
    {
        if ($sortMode === 'random') {
            shuffle($cards);
            return;
        }

        usort($cards, static function (array $left, array $right) use ($sortMode): int {
            $leftCreated = (string) ($left['created_at'] ?? '');
            $rightCreated = (string) ($right['created_at'] ?? '');
            $leftReviewed = (string) ($left['last_reviewed_at'] ?? '');
            $rightReviewed = (string) ($right['last_reviewed_at'] ?? '');

            if ($sortMode === 'recently_added') {
                return strcmp($rightCreated, $leftCreated) ?: strcmp((string) $left['id'], (string) $right['id']);
            }
            if ($sortMode === 'least_recent') {
                if (($leftReviewed === '') !== ($rightReviewed === '')) {
                    return $leftReviewed === '' ? -1 : 1;
                }
                return strcmp($leftReviewed, $rightReviewed)
                    ?: strcmp($rightCreated, $leftCreated);
            }
            if ($sortMode === 'never_reviewed') {
                if (($leftReviewed === '') !== ($rightReviewed === '')) {
                    return $leftReviewed === '' ? -1 : 1;
                }
                return $leftReviewed === ''
                    ? strcmp($rightCreated, $leftCreated)
                    : strcmp($leftReviewed, $rightReviewed);
            }

            $leftAttempts = (int) $left['success_count'] + (int) $left['error_count'];
            $rightAttempts = (int) $right['success_count'] + (int) $right['error_count'];
            $leftDifficulty = $leftAttempts > 0 ? (int) $left['error_count'] / $leftAttempts : -1;
            $rightDifficulty = $rightAttempts > 0 ? (int) $right['error_count'] / $rightAttempts : -1;
            return ($rightDifficulty <=> $leftDifficulty)
                ?: ((int) $right['error_count'] <=> (int) $left['error_count'])
                ?: strcmp($leftReviewed, $rightReviewed)
                ?: strcmp((string) $left['id'], (string) $right['id']);
        });
    }

    private function flashcardReviewSelection(
        array $reviewSet,
        string $sourceOwner,
        ?string $reviewer = null,
    ): array
    {
        $selectedTags = $this->decodeJsonColumn($reviewSet['tags'] ?? '[]');
        if (!is_array($selectedTags)) {
            $selectedTags = [];
        }
        $statement = $this->database->pdo->prepare(
            'SELECT * FROM flashcards WHERE owner = :owner',
        );
        $statement->execute(['owner' => $sourceOwner]);
        $cards = array_values(array_filter(
            $statement->fetchAll(),
            function (array $card) use ($selectedTags): bool {
                if ($selectedTags === []) {
                    return true;
                }
                $cardTags = $this->decodeJsonColumn($card['tags'] ?? '[]');
                return is_array($cardTags) && array_intersect($selectedTags, $cardTags) !== [];
            },
        ));
        if ($reviewer !== null) {
            $stats = $this->flashcardStatsMap($reviewer, array_column($cards, 'id'));
            $cards = array_map(
                static function (array $card) use ($stats): array {
                    $cardStats = $stats[(string) $card['id']] ?? null;
                    return array_merge($card, [
                        'last_reviewed_at' => $cardStats['last_reviewed_at'] ?? '',
                        'passive_views' => (int) ($cardStats['passive_views'] ?? 0),
                        'success_count' => (int) ($cardStats['success_count'] ?? 0),
                        'error_count' => (int) ($cardStats['error_count'] ?? 0),
                    ]);
                },
                $cards,
            );
        }
        if ($cards === []) {
            throw new ApiException(409, 'No flashcards match this Review set.');
        }

        $sortMode = (string) $reviewSet['sort_mode'];
        $this->sortFlashcardsForReview($cards, $sortMode);
        $cards = array_slice($cards, 0, (int) $reviewSet['max_cards']);
        $queue = array_map(function (array $card): array {
            $tags = $this->decodeJsonColumn($card['tags'] ?? '[]');
            return [
                'id' => (string) $card['id'],
                'front' => (string) $card['front'],
                'back' => (string) $card['back'],
                'note' => (string) ($card['note'] ?? ''),
                'image' => $this->flashcardImagePath($card),
                'tags' => is_array($tags) ? array_values($tags) : [],
            ];
        }, $cards);

        return [
            'tags' => array_values($selectedTags),
            'sortMode' => $sortMode,
            'queue' => $queue,
        ];
    }

    private function intervalFlashcardSnapshot(string $templateId, string $owner): array
    {
        if ($templateId === '') {
            return [];
        }
        $template = $this->ownedRecord('interval_templates', $templateId, $owner);
        $reviewSetId = (string) ($template['flashcard_review_set'] ?? '');
        if ($reviewSetId === '') {
            return [];
        }

        $reviewSet = $this->accessibleFlashcardReviewSet($reviewSetId, $owner);
        $reviewSet = array_merge(
            $reviewSet,
            $this->effectiveFlashcardReviewSettings($reviewSet, $owner),
        );
        $selection = $this->flashcardReviewSelection(
            $reviewSet,
            (string) $reviewSet['owner'],
            $owner,
        );
        $isPassive = (string) $reviewSet['mode'] === 'passive';
        return [
            'reviewSet' => $reviewSetId,
            'name' => (string) $reviewSet['name'],
            'tags' => $selection['tags'],
            'sortMode' => $selection['sortMode'],
            'cardSides' => (string) $reviewSet['card_sides'],
            'frontSeconds' => $isPassive ? (int) $reviewSet['front_seconds'] : 5,
            'backSeconds' => $isPassive ? (int) $reviewSet['back_seconds'] : 5,
            'backSpeechRepeatCount' => $isPassive && (bool) $reviewSet['speech_enabled']
                ? (int) $reviewSet['back_speech_repeat_count']
                : 1,
            'noteBeforeBack' => (bool) $reviewSet['note_before_back'],
            'speechEnabled' => (bool) $reviewSet['speech_enabled'],
            'frontLanguage' => (string) $reviewSet['front_language'],
            'backLanguage' => (string) $reviewSet['back_language'],
            'cards' => $selection['queue'],
        ];
    }

    private function flashcardAttributionMatchesReviewSet(
        string $taskId,
        string $programStepId,
        string $reviewSetId,
        string $owner,
    ): bool {
        if ($taskId === '' || $reviewSetId === '') {
            return false;
        }
        if ($programStepId === '') {
            $statement = $this->database->pdo->prepare(
                "SELECT 1 FROM tasks
                 WHERE id = :id AND owner = :owner AND type = 'flashcards'
                   AND flashcard_review_set = :review_set
                 LIMIT 1",
            );
            $statement->execute([
                'id' => $taskId,
                'owner' => $owner,
                'review_set' => $reviewSetId,
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
               AND program_steps.completion_type = 'flashcards'
               AND program_steps.flashcard_review_set = :review_set
               AND tasks.type = 'program'
             LIMIT 1",
        );
        $statement->execute([
            'program_step' => $programStepId,
            'task' => $taskId,
            'owner' => $owner,
            'review_set' => $reviewSetId,
        ]);
        return $statement->fetchColumn() !== false;
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

    private function updateIntervalFlashcards(string $id, array $user): never
    {
        $body = $this->jsonBody();
        $this->allowOnlyFields($body, ['flashcard_snapshot']);
        if (!array_key_exists('flashcard_snapshot', $body)) {
            throw new ApiException(422, 'The flashcard snapshot is required.', [
                'flashcard_snapshot' => 'required',
            ]);
        }

        $collection = $this->requireCollection('interval_sessions');
        $snapshot = $this->validateField(
            'flashcard_snapshot',
            $body['flashcard_snapshot'],
            $collection['config']['fields']['flashcard_snapshot'],
        );
        $owner = (string) $user['id'];
        $session = $this->ownedRecord('interval_sessions', $id, $owner);
        if (!in_array((string) $session['status'], ['running', 'paused'], true)) {
            throw new ApiException(409, 'Only an active interval can change its flashcards.');
        }

        $existing = $this->decodeJsonColumn($session['flashcard_snapshot'] ?? '{}');
        if (!is_array($existing) || (string) ($existing['reviewSet'] ?? '') === '') {
            throw new ApiException(409, 'This interval does not have a flashcard context.');
        }
        if (
            !is_array($snapshot)
            || (string) ($snapshot['reviewSet'] ?? '') !== (string) $existing['reviewSet']
            || !isset($snapshot['cards'])
            || !is_array($snapshot['cards'])
            || !array_is_list($snapshot['cards'])
        ) {
            throw new ApiException(422, 'The flashcard snapshot is invalid.', [
                'flashcard_snapshot' => 'invalid',
            ]);
        }

        $statement = $this->database->pdo->prepare(
            'UPDATE interval_sessions SET flashcard_snapshot = :flashcard_snapshot
             WHERE id = :id AND owner = :owner',
        );
        $statement->execute([
            'flashcard_snapshot' => json_encode($snapshot, JSON_THROW_ON_ERROR),
            'id' => $id,
            'owner' => $owner,
        ]);
        $session = $this->ownedRecord('interval_sessions', $id, $owner);
        $this->respond($this->normalizeRecord($collection, $session));
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
        if (in_array($collection['name'], ['flashcard_review_sessions', 'flashcard_review_events'], true)) {
            throw new ApiException(405, 'Flashcard review history cannot be deleted directly.');
        }
        $pdo = $this->database->pdo;
        $pdo->beginTransaction();
        try {
            match ($collection['name']) {
                'tasks' => $this->deleteTask($id, $owner),
                'program_steps' => $this->deleteProgramStep($id, $owner),
                'occurrences' => $this->deleteOccurrence($id, $owner),
                'tags' => $this->deleteTag($id, $owner),
                'flashcard_tags' => $this->deleteFlashcardTag($id, $owner),
                'flashcards' => $this->deleteFlashcard($id, $owner),
                'flashcard_review_sets' => $this->deleteFlashcardReviewSet($id, $owner),
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
            "UPDATE journal_entries SET task = '' WHERE task = :id AND owner = :owner",
        );
        $statement->execute(['id' => $id, 'owner' => $owner]);
        $statement = $this->database->pdo->prepare(
            "UPDATE interval_sessions SET task = '', program_step = ''
             WHERE task = :id AND owner = :owner",
        );
        $statement->execute(['id' => $id, 'owner' => $owner]);
        $statement = $this->database->pdo->prepare(
            "UPDATE flashcard_review_sessions SET task = '', program_step = ''
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
        $statement = $this->database->pdo->prepare(
            "UPDATE flashcard_review_sessions SET program_step = ''
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

    private function deleteFlashcardTag(string $id, string $owner): void
    {
        foreach (['flashcards', 'flashcard_review_sets'] as $table) {
            $statement = $this->database->pdo->prepare(
                "SELECT id, tags FROM {$table} WHERE owner = :owner",
            );
            $statement->execute(['owner' => $owner]);
            $update = $this->database->pdo->prepare(
                "UPDATE {$table} SET tags = :tags WHERE id = :id AND owner = :owner",
            );
            foreach ($statement->fetchAll() as $record) {
                $tags = $this->decodeJsonColumn($record['tags'] ?? '[]');
                if (!is_array($tags) || !in_array($id, $tags, true)) {
                    continue;
                }
                $update->execute([
                    'tags' => json_encode(
                        array_values(array_filter($tags, static fn (mixed $tag): bool => $tag !== $id)),
                        JSON_THROW_ON_ERROR,
                    ),
                    'id' => $record['id'],
                    'owner' => $owner,
                ]);
            }
        }
        $this->deleteOwnedRow('flashcard_tags', $id, $owner);
    }

    private function deleteFlashcard(string $id, string $owner): void
    {
        $card = $this->ownedRecord('flashcards', $id, $owner);
        $imageFile = $this->validAvatarFilename($card['image_file'] ?? null);
        $statement = $this->database->pdo->prepare(
            "UPDATE flashcard_review_events SET card = '' WHERE card = :id",
        );
        $statement->execute(['id' => $id]);
        $statement = $this->database->pdo->prepare(
            'DELETE FROM flashcard_review_card_stats WHERE card = :id',
        );
        $statement->execute(['id' => $id]);
        $this->deleteOwnedRow('flashcards', $id, $owner);
        if ($imageFile !== null) {
            $this->removeFlashcardImageFileIfUnused($imageFile);
        }
    }

    private function deleteFlashcardReviewSet(string $id, string $owner): void
    {
        $statement = $this->database->pdo->prepare(
            'SELECT id, name FROM tasks
             WHERE flashcard_review_set = :id AND owner = :owner
             ORDER BY sort_order, name',
        );
        $statement->execute(['id' => $id, 'owner' => $owner]);
        $attachedTasks = $statement->fetchAll();
        $statement = $this->database->pdo->prepare(
            'SELECT program_steps.id, program_steps.name, tasks.name AS task_name
             FROM program_steps
             JOIN tasks ON tasks.id = program_steps.task AND tasks.owner = program_steps.owner
             WHERE program_steps.flashcard_review_set = :id AND program_steps.owner = :owner
             ORDER BY tasks.sort_order, program_steps.sort_order, program_steps.name',
        );
        $statement->execute(['id' => $id, 'owner' => $owner]);
        $attachedProgramSteps = $statement->fetchAll();
        $statement = $this->database->pdo->prepare(
            'SELECT id, name FROM interval_templates
             WHERE flashcard_review_set = :id AND owner = :owner
             ORDER BY sort_order, name',
        );
        $statement->execute(['id' => $id, 'owner' => $owner]);
        $attachedIntervals = $statement->fetchAll();
        if ($attachedTasks !== [] || $attachedProgramSteps !== [] || $attachedIntervals !== []) {
            throw new ApiException(
                409,
                'This Review set is attached to one or more tasks, program steps, or intervals. Reassign them first.',
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
                    'intervals' => array_map(static fn (array $interval): array => [
                        'id' => (string) $interval['id'],
                        'name' => (string) $interval['name'],
                    ], $attachedIntervals),
                ],
            );
        }
        $statement = $this->database->pdo->prepare(
            'SELECT recipient FROM flashcard_review_set_shares WHERE review_set = :id',
        );
        $statement->execute(['id' => $id]);
        foreach ($statement->fetchAll(PDO::FETCH_COLUMN) as $recipient) {
            $this->detachFlashcardReviewSetFromAccount($id, (string) $recipient);
        }
        $statement = $this->database->pdo->prepare(
            "UPDATE flashcard_review_sessions SET review_set = '' WHERE review_set = :id",
        );
        $statement->execute(['id' => $id]);
        $statement = $this->database->pdo->prepare(
            'DELETE FROM flashcard_review_set_preferences WHERE review_set = :id',
        );
        $statement->execute(['id' => $id]);
        $statement = $this->database->pdo->prepare(
            'DELETE FROM flashcard_review_set_shares WHERE review_set = :id',
        );
        $statement->execute(['id' => $id]);
        $this->deleteOwnedRow('flashcard_review_sets', $id, $owner);
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
            "SELECT tasks.id, tasks.name
             FROM tasks, json_each(tasks.tracking_trackers)
             WHERE tasks.owner = :owner AND json_each.value = :id
             ORDER BY tasks.sort_order, tasks.name",
        );
        $statement->execute(['id' => $id, 'owner' => $owner]);
        $attachedTasks = $statement->fetchAll();
        if ($attachedTasks !== []) {
            throw new ApiException(
                409,
                'This tracker is attached to one or more tasks. Reassign them first.',
                [
                    'tasks' => array_map(static fn (array $task): array => [
                        'id' => (string) $task['id'],
                        'name' => (string) $task['name'],
                    ], $attachedTasks),
                ],
            );
        }
        $statement = $this->database->pdo->prepare(
            'SELECT id, tracker FROM journal_entries WHERE owner = :owner',
        );
        $statement->execute(['owner' => $owner]);
        $updateJournal = $this->database->pdo->prepare(
            'UPDATE journal_entries SET tracker = :tracker WHERE id = :id AND owner = :owner',
        );
        foreach ($statement->fetchAll() as $journalEntry) {
            $trackers = $this->journalTrackerIds($journalEntry['tracker'] ?? '');
            if (!in_array($id, $trackers, true)) {
                continue;
            }
            $updateJournal->execute([
                'tracker' => json_encode(
                    array_values(array_filter($trackers, static fn (string $tracker): bool => $tracker !== $id)),
                    JSON_THROW_ON_ERROR,
                ),
                'id' => $journalEntry['id'],
                'owner' => $owner,
            ]);
        }
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

    private function rejectFields(array $body, array $fields): void
    {
        $rejected = array_values(array_intersect(array_keys($body), $fields));
        if ($rejected !== []) {
            throw new ApiException(422, 'The request contains read-only fields.', [
                'fields' => $rejected,
            ]);
        }
    }

    private function allowOnlyFields(array $body, array $fields): void
    {
        $rejected = array_values(array_diff(array_keys($body), [...$fields, 'id', 'owner']));
        if ($rejected !== []) {
            throw new ApiException(422, 'The request contains read-only fields.', [
                'fields' => $rejected,
            ]);
        }
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
        if (in_array($collection, ['flashcards', 'flashcard_review_sets'], true)) {
            foreach (($record['tags'] ?? []) as $tag) {
                if (!is_string($tag) || !$this->relationExists('flashcard_tags', $tag, $owner)) {
                    throw new ApiException(422, 'A selected flashcard tag is invalid.');
                }
            }
            return;
        }

        if ($collection === 'interval_templates') {
            $reviewSet = (string) ($record['flashcard_review_set'] ?? '');
            if (
                $reviewSet !== ''
                && !$this->flashcardReviewSetIsAccessible($reviewSet, $owner)
            ) {
                throw new ApiException(422, 'The selected Review set is invalid.');
            }
            return;
        }

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
            $reminderTimes = $record['reminder_times'] ?? [];
            foreach ($reminderTimes as $time) {
                if (!is_string($time) || preg_match('/^(?:[01]\d|2[0-3]):[0-5]\d$/', $time) !== 1) {
                    throw new ApiException(422, 'Reminder times must use HH:MM.');
                }
            }
            if (count($reminderTimes) !== count(array_unique($reminderTimes))) {
                throw new ApiException(422, 'Each task reminder must use a different time.');
            }
            if (($record['reminder_enabled'] ?? false) && $reminderTimes === []) {
                throw new ApiException(422, 'Add at least one time for an enabled task reminder.');
            }
            $intervalTemplate = (string) ($record['interval_template'] ?? '');
            $flashcardReviewSet = (string) ($record['flashcard_review_set'] ?? '');
            $trackingTrackers = $record['tracking_trackers'] ?? [];
            if (($record['type'] ?? '') === 'interval') {
                if (!$this->relationExists('interval_templates', $intervalTemplate, $owner)) {
                    throw new ApiException(422, 'Select a valid interval for this task.');
                }
            } elseif ($intervalTemplate !== '') {
                throw new ApiException(422, 'Only interval tasks may have an attached interval.');
            }
            if (($record['type'] ?? '') === 'flashcards') {
                if (!$this->flashcardReviewSetIsAccessible($flashcardReviewSet, $owner)) {
                    throw new ApiException(422, 'Select a valid Review set for this task.');
                }
            } elseif ($flashcardReviewSet !== '') {
                throw new ApiException(422, 'Only Review set tasks may have an attached Review set.');
            }
            if (($record['type'] ?? '') === 'tracking') {
                if (!is_array($trackingTrackers) || $trackingTrackers === []) {
                    throw new ApiException(422, 'Select at least one tracker for this task.');
                }
                foreach ($trackingTrackers as $tracker) {
                    if (!is_string($tracker) || !$this->relationExists('tracking_trackers', $tracker, $owner)) {
                        throw new ApiException(422, 'A selected tracker is invalid.');
                    }
                }
                if (count($trackingTrackers) !== count(array_unique($trackingTrackers))) {
                    throw new ApiException(422, 'Each tracker may only be selected once.');
                }
            } elseif ($trackingTrackers !== []) {
                throw new ApiException(422, 'Only tracking tasks may have attached trackers.');
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
            $flashcardReviewSet = (string) ($record['flashcard_review_set'] ?? '');
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
            if ($completionType === 'flashcards') {
                if (
                    $active
                    && !$this->flashcardReviewSetIsAccessible($flashcardReviewSet, $owner)
                ) {
                    throw new ApiException(422, 'Select a valid Review set for this program step.');
                }
                if (
                    $flashcardReviewSet !== ''
                    && !$this->flashcardReviewSetIsAccessible($flashcardReviewSet, $owner)
                ) {
                    throw new ApiException(422, 'The selected Review set is invalid.');
                }
            } elseif ($flashcardReviewSet !== '') {
                throw new ApiException(
                    422,
                    'Only Review set program steps may have an attached Review set.',
                );
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
            return;
        }

        if ($collection === 'journal_entries') {
            $task = (string) ($record['task'] ?? '');
            if ($task !== '' && !$this->relationExists('tasks', $task, $owner)) {
                throw new ApiException(422, 'The selected journal task is invalid.');
            }
            $trackers = $record['tracker'] ?? [];
            if (!is_array($trackers) || !array_is_list($trackers)) {
                throw new ApiException(422, 'The selected journal trackers are invalid.');
            }
            foreach ($trackers as $tracker) {
                if (
                    !is_string($tracker)
                    || $tracker === ''
                    || !$this->relationExists('tracking_trackers', $tracker, $owner)
                ) {
                    throw new ApiException(422, 'A selected journal tracker is invalid.');
                }
            }
            if (count(array_unique($trackers)) !== count($trackers)) {
                throw new ApiException(422, 'A journal tracker can only be attached once.');
            }
        }
    }

    /** @return array{task_snapshot: string, tracker_snapshot: string} */
    private function journalContextSnapshots(array $record, string $owner): array
    {
        return [
            'task_snapshot' => $this->journalContextName(
                'tasks',
                (string) ($record['task'] ?? ''),
                $owner,
            ),
            'tracker_snapshot' => json_encode(
                $this->journalTrackerSnapshots($record['tracker'] ?? [], $owner),
                JSON_THROW_ON_ERROR,
            ),
        ];
    }

    private function normalizeJournalTrackerInput(array $body): array
    {
        if (!array_key_exists('tracker', $body) || !is_string($body['tracker'])) {
            return $body;
        }
        $body['tracker'] = $body['tracker'] === '' ? [] : [$body['tracker']];
        return $body;
    }

    /** @return array<string, string> */
    private function journalTrackerSnapshots(mixed $trackers, string $owner): array
    {
        if (!is_array($trackers)) {
            return [];
        }
        $snapshots = [];
        foreach ($trackers as $tracker) {
            if (!is_string($tracker) || $tracker === '') {
                continue;
            }
            $snapshots[$tracker] = $this->journalContextName(
                'tracking_trackers',
                $tracker,
                $owner,
            );
        }
        return $snapshots;
    }

    /** @return string[] */
    private function journalTrackerIds(mixed $value): array
    {
        if (is_array($value)) {
            return array_values(array_filter($value, static fn (mixed $id): bool => is_string($id) && $id !== ''));
        }
        $stored = (string) $value;
        if ($stored === '') {
            return [];
        }
        try {
            $decoded = json_decode($stored, true, flags: JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            return [$stored];
        }
        if (!is_array($decoded) || !array_is_list($decoded)) {
            throw new ApiException(500, 'The database contains invalid journal tracker data.');
        }
        return array_values(array_filter($decoded, static fn (mixed $id): bool => is_string($id) && $id !== ''));
    }

    /** @return array<string, string> */
    private function journalStoredTrackerSnapshots(mixed $value, array $trackers): array
    {
        if (is_array($value)) {
            $decoded = $value;
        } else {
            $stored = (string) $value;
            if ($stored === '') {
                return [];
            }
            try {
                $decoded = json_decode($stored, true, flags: JSON_THROW_ON_ERROR);
            } catch (JsonException) {
                return [$trackers[0] ?? 'detached:0' => $stored];
            }
        }
        if (!is_array($decoded)) {
            throw new ApiException(500, 'The database contains invalid journal tracker snapshots.');
        }
        if (array_is_list($decoded)) {
            $snapshots = [];
            foreach ($decoded as $index => $name) {
                if (is_string($name) && $name !== '') {
                    $snapshots[$trackers[$index] ?? 'detached:' . $index] = $name;
                }
            }
            return $snapshots;
        }
        return array_filter(
            $decoded,
            static fn (mixed $name, mixed $id): bool => is_string($id) && is_string($name) && $name !== '',
            ARRAY_FILTER_USE_BOTH,
        );
    }

    private function journalContextName(string $table, string $id, string $owner): string
    {
        if ($id === '') {
            return '';
        }
        $record = $this->ownedRecord($table, $id, $owner);
        return (string) $record['name'];
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

    private function accessibleFlashcardReviewSet(string $id, string $account): array
    {
        $statement = $this->database->pdo->prepare(
            "SELECT flashcard_review_sets.*,
                    flashcard_review_set_shares.id AS share_id,
                    CASE WHEN flashcard_review_sets.owner = :account
                         THEN 'owner' ELSE flashcard_review_set_shares.role END AS access_role,
                    users.name AS owner_name,
                    users.avatar AS owner_avatar
             FROM flashcard_review_sets
             JOIN users ON users.id = flashcard_review_sets.owner
             LEFT JOIN flashcard_review_set_shares
               ON flashcard_review_set_shares.review_set = flashcard_review_sets.id
              AND flashcard_review_set_shares.recipient = :account
             WHERE flashcard_review_sets.id = :id
               AND (flashcard_review_sets.owner = :account
                    OR flashcard_review_set_shares.recipient = :account)
             LIMIT 1",
        );
        $statement->execute(['id' => $id, 'account' => $account]);
        $record = $statement->fetch();
        if (!is_array($record)) {
            throw new ApiException(404, 'Review set not found.');
        }
        return $record;
    }

    private function flashcardReviewSetIsAccessible(string $id, string $account): bool
    {
        if ($id === '') {
            return false;
        }
        $statement = $this->database->pdo->prepare(
            'SELECT 1 FROM flashcard_review_sets
             LEFT JOIN flashcard_review_set_shares
               ON flashcard_review_set_shares.review_set = flashcard_review_sets.id
              AND flashcard_review_set_shares.recipient = :account
             WHERE flashcard_review_sets.id = :id
               AND (flashcard_review_sets.owner = :account
                    OR flashcard_review_set_shares.recipient = :account)
             LIMIT 1',
        );
        $statement->execute(['id' => $id, 'account' => $account]);
        return $statement->fetchColumn() !== false;
    }

    private function accessibleReviewSetResponse(array $reviewSet, string $account): array
    {
        $settings = $this->effectiveFlashcardReviewSettings($reviewSet, $account);
        $record = array_merge(
            $this->normalizeRecord($this->requireCollection('flashcard_review_sets'), $reviewSet),
            $settings,
        );
        $record['access_role'] = (string) ($reviewSet['access_role'] ?? 'owner');
        $record['share_id'] = (string) ($reviewSet['share_id'] ?? '');
        $record['owner_name'] = (string) ($reviewSet['owner_name'] ?? '');
        $ownerAvatar = $this->validAvatarFilename($reviewSet['owner_avatar'] ?? null);
        $record['owner_avatar'] = $ownerAvatar === null ? '' : '/avatars/' . $ownerAvatar;
        $record['tag_details'] = $this->flashcardTagDetails(
            (string) $reviewSet['owner'],
            $this->reviewSetTagIds($reviewSet),
        );
        $record['matching_card_count'] = count($this->matchingSourceFlashcards($reviewSet));
        return $record;
    }

    private function validatedFlashcardReviewSettings(array $body): array
    {
        $this->allowOnlyFields($body, self::FLASHCARD_REVIEW_SETTING_FIELDS);
        $fields = $this->requireCollection('flashcard_review_sets')['config']['fields'];
        $settings = [];
        foreach (self::FLASHCARD_REVIEW_SETTING_FIELDS as $field) {
            if (!array_key_exists($field, $body)) {
                throw new ApiException(422, 'Every Review set preference is required.', [
                    $field => 'required',
                ]);
            }
            $settings[$field] = $this->validateField($field, $body[$field], $fields[$field]);
        }
        if ($settings['mode'] !== 'passive') {
            $settings['indefinite'] = false;
        }
        $this->validateFlashcardSpeechSettings($settings);
        return $settings;
    }

    private function effectiveFlashcardReviewSettings(array $reviewSet, string $account): array
    {
        $statement = $this->database->pdo->prepare(
            'SELECT * FROM flashcard_review_set_preferences
             WHERE review_set = :review_set AND account = :account LIMIT 1',
        );
        $statement->execute(['review_set' => $reviewSet['id'], 'account' => $account]);
        $preferences = $statement->fetch();
        $source = is_array($preferences) ? $preferences : $reviewSet;
        $settings = [];
        foreach (self::FLASHCARD_REVIEW_SETTING_FIELDS as $field) {
            $settings[$field] = match ($field) {
                'indefinite', 'note_before_back', 'speech_enabled'
                    => (bool) ($source[$field] ?? false),
                'max_cards', 'front_seconds', 'back_seconds', 'back_speech_repeat_count'
                    => (int) ($source[$field] ?? 0),
                default => (string) ($source[$field] ?? ''),
            };
        }
        return $settings;
    }

    private function saveFlashcardReviewSetPreferences(
        string $reviewSetId,
        string $account,
        array $settings,
    ): void {
        $statement = $this->database->pdo->prepare(
            'INSERT INTO flashcard_review_set_preferences (
                review_set, account, mode, card_sides, indefinite, max_cards,
                front_seconds, back_seconds, back_speech_repeat_count,
                note_before_back,
                speech_enabled, front_language, back_language, sort_mode, updated_at
             ) VALUES (
                :review_set, :account, :mode, :card_sides, :indefinite, :max_cards,
                :front_seconds, :back_seconds, :back_speech_repeat_count,
                :note_before_back,
                :speech_enabled, :front_language, :back_language, :sort_mode, :updated_at
             )
             ON CONFLICT(review_set, account) DO UPDATE SET
                mode = excluded.mode,
                card_sides = excluded.card_sides,
                indefinite = excluded.indefinite,
                max_cards = excluded.max_cards,
                front_seconds = excluded.front_seconds,
                back_seconds = excluded.back_seconds,
                back_speech_repeat_count = excluded.back_speech_repeat_count,
                note_before_back = excluded.note_before_back,
                speech_enabled = excluded.speech_enabled,
                front_language = excluded.front_language,
                back_language = excluded.back_language,
                sort_mode = excluded.sort_mode,
                updated_at = excluded.updated_at',
        );
        $statement->execute([
            'review_set' => $reviewSetId,
            'account' => $account,
            ...$this->booleanDatabaseSettings($settings),
            'updated_at' => $this->now(),
        ]);
    }

    private function booleanDatabaseSettings(array $settings): array
    {
        $values = array_intersect_key(
            $settings,
            array_flip(self::FLASHCARD_REVIEW_SETTING_FIELDS),
        );
        $values['indefinite'] = !empty($values['indefinite']) ? 1 : 0;
        $values['note_before_back'] = !empty($values['note_before_back']) ? 1 : 0;
        $values['speech_enabled'] = !empty($values['speech_enabled']) ? 1 : 0;
        return $values;
    }

    private function validateFlashcardShareRole(mixed $role): string
    {
        if (!is_string($role) || !in_array($role, ['readonly', 'editor'], true)) {
            throw new ApiException(422, 'Select read-only or editor access.', ['role' => 'choice']);
        }
        return $role;
    }

    private function flashcardReviewSetShareResponse(array $share): array
    {
        return [
            'id' => (string) $share['id'],
            'review_set' => (string) $share['review_set'],
            'role' => (string) $share['role'],
            'email' => (string) ($share['recipient_email'] ?? ''),
            'created_at' => (string) $share['created_at'],
            'updated_at' => (string) $share['updated_at'],
        ];
    }

    private function reviewSetTagIds(array $reviewSet): array
    {
        $tags = $reviewSet['tags'] ?? [];
        if (is_string($tags)) {
            $tags = $this->decodeJsonColumn($tags);
        }
        return is_array($tags)
            ? array_values(array_filter($tags, static fn (mixed $tag): bool => is_string($tag)))
            : [];
    }

    private function flashcardTagDetails(string $owner, array $tagIds): array
    {
        if ($tagIds === []) {
            return [];
        }
        $map = $this->flashcardTagNameMap($owner);
        return array_values(array_map(
            static fn (string $id): array => ['id' => $id, 'name' => $map[$id] ?? 'Removed tag'],
            $tagIds,
        ));
    }

    private function flashcardTagNameMap(string $owner): array
    {
        $statement = $this->database->pdo->prepare(
            'SELECT id, name FROM flashcard_tags WHERE owner = :owner',
        );
        $statement->execute(['owner' => $owner]);
        $map = [];
        foreach ($statement->fetchAll() as $tag) {
            $map[(string) $tag['id']] = (string) $tag['name'];
        }
        return $map;
    }

    private function flashcardTagIdMap(string $owner): array
    {
        $statement = $this->database->pdo->prepare(
            'SELECT id, name FROM flashcard_tags WHERE owner = :owner',
        );
        $statement->execute(['owner' => $owner]);
        $map = [];
        foreach ($statement->fetchAll() as $tag) {
            $map[mb_strtolower((string) $tag['name'])] = (string) $tag['id'];
        }
        return $map;
    }

    private function matchingSourceFlashcards(array $reviewSet): array
    {
        $selectedTags = $this->reviewSetTagIds($reviewSet);
        $statement = $this->database->pdo->prepare(
            'SELECT * FROM flashcards WHERE owner = :owner ORDER BY created_at DESC, id',
        );
        $statement->execute(['owner' => $reviewSet['owner']]);
        return array_values(array_filter(
            $statement->fetchAll(),
            function (array $card) use ($selectedTags): bool {
                if ($selectedTags === []) {
                    return true;
                }
                $cardTags = $this->decodeJsonColumn($card['tags'] ?? '[]');
                return is_array($cardTags) && array_intersect($selectedTags, $cardTags) !== [];
            },
        ));
    }

    private function matchingSourceFlashcard(array $reviewSet, string $cardId): array
    {
        $card = $this->ownedRecord('flashcards', $cardId, (string) $reviewSet['owner']);
        $selectedTags = $this->reviewSetTagIds($reviewSet);
        if ($selectedTags === []) {
            return $card;
        }
        $cardTags = $this->decodeJsonColumn($card['tags'] ?? '[]');
        if (!is_array($cardTags) || array_intersect($selectedTags, $cardTags) === []) {
            throw new ApiException(404, 'Flashcard not found in this Review set.');
        }
        return $card;
    }

    private function requireFlashcardReviewSetEditor(array $reviewSet, string $account): void
    {
        $role = (string) ($reviewSet['access_role'] ?? '');
        if ((string) $reviewSet['owner'] !== $account && $role !== 'editor') {
            throw new ApiException(403, 'Editor access is required to change these cards.');
        }
    }

    private function flashcardStatsMap(string $reviewer, array $cardIds): array
    {
        if ($cardIds === []) {
            return [];
        }
        $statement = $this->database->pdo->prepare(
            'SELECT * FROM flashcard_review_card_stats WHERE reviewer = :reviewer',
        );
        $statement->execute(['reviewer' => $reviewer]);
        $wanted = array_fill_keys(array_map('strval', $cardIds), true);
        $map = [];
        foreach ($statement->fetchAll() as $stats) {
            $cardId = (string) $stats['card'];
            if (isset($wanted[$cardId])) {
                $map[$cardId] = $stats;
            }
        }
        return $map;
    }

    private function flashcardResponseForReviewer(array $card, string $reviewer): array
    {
        $stats = $this->flashcardStatsMap($reviewer, [(string) $card['id']]);
        $cardStats = $stats[(string) $card['id']] ?? null;
        $card = array_merge($card, [
            'last_reviewed_at' => $cardStats['last_reviewed_at'] ?? '',
            'passive_views' => (int) ($cardStats['passive_views'] ?? 0),
            'success_count' => (int) ($cardStats['success_count'] ?? 0),
            'error_count' => (int) ($cardStats['error_count'] ?? 0),
        ]);
        $response = $this->normalizeRecord($this->requireCollection('flashcards'), $card);
        $response['tag_details'] = $this->flashcardTagDetails(
            (string) $card['owner'],
            is_array($response['tags'] ?? null) ? $response['tags'] : [],
        );
        return $response;
    }

    private function detachFlashcardReviewSetFromAccount(string $reviewSetId, string $account): void
    {
        foreach (['tasks', 'program_steps', 'interval_templates'] as $table) {
            $statement = $this->database->pdo->prepare(
                "UPDATE {$table} SET flashcard_review_set = ''
                 WHERE flashcard_review_set = :review_set AND owner = :owner",
            );
            $statement->execute(['review_set' => $reviewSetId, 'owner' => $account]);
        }
    }

    private function nextFlashcardReviewSetOrder(string $owner): int
    {
        $statement = $this->database->pdo->prepare(
            'SELECT COALESCE(MAX(sort_order), -1) + 1 FROM flashcard_review_sets WHERE owner = :owner',
        );
        $statement->execute(['owner' => $owner]);
        return (int) $statement->fetchColumn();
    }

    private function uniqueReviewSetCopyName(string $name, string $owner): string
    {
        $base = mb_substr(trim($name) . ' copy', 0, 160);
        $candidate = $base;
        $suffix = 2;
        $statement = $this->database->pdo->prepare(
            'SELECT 1 FROM flashcard_review_sets
             WHERE owner = :owner AND name = :name COLLATE NOCASE LIMIT 1',
        );
        while (true) {
            $statement->execute(['owner' => $owner, 'name' => $candidate]);
            if ($statement->fetchColumn() === false) {
                return $candidate;
            }
            $ending = ' ' . $suffix++;
            $candidate = mb_substr($base, 0, 160 - mb_strlen($ending)) . $ending;
        }
    }

    private function uniqueFlashcardTagName(string $name, string $owner): string
    {
        $base = mb_substr(trim($name), 0, 50);
        $candidate = $base === '' ? 'Review set copy' : $base;
        $suffix = 2;
        $statement = $this->database->pdo->prepare(
            'SELECT 1 FROM flashcard_tags
             WHERE owner = :owner AND name = :name COLLATE NOCASE LIMIT 1',
        );
        while (true) {
            $statement->execute(['owner' => $owner, 'name' => $candidate]);
            if ($statement->fetchColumn() === false) {
                return $candidate;
            }
            $ending = ' ' . $suffix++;
            $candidate = mb_substr($base, 0, 50 - mb_strlen($ending)) . $ending;
        }
    }

    private function duplicateFlashcardImageFile(string $filename): string
    {
        $validated = $this->validAvatarFilename($filename);
        if ($validated === null) {
            return '';
        }
        $source = $this->flashcardImageDirectory() . DIRECTORY_SEPARATOR . $validated;
        $bytes = is_file($source) && is_readable($source) ? file_get_contents($source) : false;
        if ($bytes === false) {
            return '';
        }
        return $this->storeSquareJpeg($bytes, $this->flashcardImageDirectory(), 'card image');
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
        if ($collection['name'] === 'journal_entries') {
            $trackers = $this->journalTrackerIds($record['tracker'] ?? '');
            $record['tracker'] = json_encode($trackers, JSON_THROW_ON_ERROR);
            $record['tracker_snapshot'] = $this->journalStoredTrackerSnapshots(
                $record['tracker_snapshot'] ?? '',
                $trackers,
            );
        }
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

    private function caseInsensitiveKey(string $value): string
    {
        return function_exists('mb_strtolower')
            ? mb_strtolower($value, 'UTF-8')
            : strtolower($value);
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
