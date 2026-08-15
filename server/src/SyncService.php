<?php

declare(strict_types=1);

namespace BackOnTrack\Api;

use JsonException;
use PDO;
use PDOException;
use Throwable;

final class SyncService
{
    private const PROTOCOL_VERSION = 1;
    private const MAX_OPERATIONS = 100;
    private const MAX_CHANGES = 500;
    private const FLASHCARD_REVIEW_PREFERENCE_FIELDS = [
        'mode', 'card_sides', 'indefinite', 'max_cards', 'front_seconds',
        'back_seconds', 'back_speech_repeat_count', 'note_before_back',
        'speech_enabled', 'front_language', 'back_language', 'sort_mode',
        'excluded_cards',
    ];

    public function __construct(
        private readonly Database $database,
        private readonly Config $config,
    )
    {
    }

    public function bootstrap(array $user, array $body): array
    {
        $account = (string) $user['id'];
        $clientId = $this->clientId($body['clientId'] ?? null);
        $watermark = isset($body['watermark'])
            ? max(0, (int) $body['watermark'])
            : (int) $this->database->pdo->query(
                'SELECT COALESCE(MAX(sequence), 0) FROM sync_change_log',
            )->fetchColumn();

        $resources = [];
        foreach (Schema::collections() as $name => $config) {
            $statement = $this->database->pdo->prepare(
                "SELECT * FROM {$name} WHERE owner = :owner ORDER BY id",
            );
            $statement->execute(['owner' => $account]);
            foreach ($statement->fetchAll() as $record) {
                $resources[] = $this->ownedEnvelope($name, $config, $record, $account);
            }
        }

        $resources[] = $this->userEnvelope($account);
        foreach ($this->accessibleReviewSets($account) as $reviewSet) {
            $resources[] = $this->projectionEnvelope(
                'accessible_flashcard_review_sets',
                (string) $reviewSet['id'],
                $reviewSet,
            );
            foreach ($this->reviewSetCards($reviewSet, $account) as $card) {
                $resources[] = $this->projectionEnvelope(
                    'review_set_cards',
                    (string) $reviewSet['id'] . ':' . (string) $card['id'],
                    ['review_set_id' => (string) $reviewSet['id'], ...$card],
                );
            }
        }
        foreach ($this->reviewSetShares($account) as $share) {
            $resources[] = $this->projectionEnvelope(
                'flashcard_review_set_shares',
                (string) $share['id'],
                $share,
            );
        }

        $this->touchClient($account, $clientId, $watermark);
        return [
            'watermark' => $watermark,
            'nextPageToken' => null,
            'resources' => $resources,
            'protocolVersion' => self::PROTOCOL_VERSION,
        ];
    }

    public function exchange(array $user, array $body): array
    {
        $account = (string) $user['id'];
        $clientId = $this->clientId($body['clientId'] ?? null);
        $cursor = max(0, (int) ($body['cursor'] ?? 0));
        $operations = $body['operations'] ?? [];
        if (!is_array($operations) || !array_is_list($operations)) {
            throw new ApiException(422, 'Sync operations must be an array.');
        }
        if (count($operations) > self::MAX_OPERATIONS) {
            throw new ApiException(422, 'Too many sync operations were included.');
        }

        $acknowledgements = [];
        foreach ($operations as $operation) {
            if (!is_array($operation) || array_is_list($operation)) {
                throw new ApiException(422, 'A sync operation is invalid.');
            }
            $acknowledgements[] = $this->applyOperation($operation, $account, $clientId);
        }

        $changeResult = $this->changesAfter($account, $cursor);
        $this->touchClient($account, $clientId, $changeResult['cursor']);

        return [
            'cursor' => $changeResult['cursor'],
            'hasMore' => $changeResult['hasMore'],
            'serverTime' => $this->now(),
            'acknowledgements' => $acknowledgements,
            'changes' => $changeResult['changes'],
            'resetRequired' => false,
            'protocolVersion' => self::PROTOCOL_VERSION,
        ];
    }

    private function applyOperation(array $operation, string $account, string $clientId): array
    {
        $operationId = $this->identifier($operation['operationId'] ?? null, 'operationId', 120);
        $receipt = $this->database->pdo->prepare(
            'SELECT response FROM sync_operation_receipts
             WHERE account_id = :account AND client_id = :client AND operation_id = :operation',
        );
        $receipt->execute([
            'account' => $account,
            'client' => $clientId,
            'operation' => $operationId,
        ]);
        $saved = $receipt->fetchColumn();
        if (is_string($saved)) {
            $response = json_decode($saved, true);
            if (is_array($response)) {
                $response['status'] = 'duplicate';
                return $response;
            }
        }

        $pdo = $this->database->pdo;
        $pdo->exec('SAVEPOINT sync_operation');
        try {
            $response = $this->mutate($operation, $account, $clientId);
            $response['operationId'] = $operationId;
            $pdo->exec('RELEASE SAVEPOINT sync_operation');
        } catch (ApiException $exception) {
            $pdo->exec('ROLLBACK TO SAVEPOINT sync_operation');
            $pdo->exec('RELEASE SAVEPOINT sync_operation');
            $response = [
                'operationId' => $operationId,
                'status' => 'rejected',
                'error' => [
                    'code' => (string) $exception->status,
                    'message' => $exception->getMessage(),
                    'details' => (object) $exception->details,
                ],
            ];
        } catch (Throwable $exception) {
            $pdo->exec('ROLLBACK TO SAVEPOINT sync_operation');
            $pdo->exec('RELEASE SAVEPOINT sync_operation');
            throw $exception;
        }

        $insert = $pdo->prepare(
            'INSERT INTO sync_operation_receipts (
                account_id, client_id, operation_id, response, applied_at
             ) VALUES (:account, :client, :operation, :response, :applied)',
        );
        $insert->execute([
            'account' => $account,
            'client' => $clientId,
            'operation' => $operationId,
            'response' => json_encode($response, JSON_THROW_ON_ERROR),
            'applied' => $this->now(),
        ]);
        return $response;
    }

    private function mutate(array $operation, string $account, string $clientId): array
    {
        $kind = (string) ($operation['kind'] ?? '');
        $resource = (string) ($operation['resource'] ?? '');
        $recordId = (string) ($operation['recordId'] ?? '');
        $payload = $operation['payload'] ?? [];
        $fieldClocks = $operation['fieldClocks'] ?? [];
        if (!is_array($payload) || ($payload !== [] && array_is_list($payload))) {
            throw new ApiException(422, 'The sync operation payload is invalid.');
        }
        if (!is_array($fieldClocks) || ($fieldClocks !== [] && array_is_list($fieldClocks))) {
            throw new ApiException(422, 'The sync field clocks are invalid.');
        }

        if ($kind === 'command') {
            return $this->applyCommand($resource, $payload, $fieldClocks, $account, $clientId);
        }
        if (!in_array($kind, ['create', 'patch', 'delete'], true)) {
            throw new ApiException(422, 'The sync operation kind is invalid.');
        }
        if ($resource === 'users') {
            $this->recordId($recordId);
            return $this->mutateUser($kind, $recordId, $payload, $fieldClocks, $account);
        }
        if ($resource === 'review_set_cards') {
            return $this->mutateSharedCard($kind, $recordId, $payload, $fieldClocks, $account);
        }
        $this->recordId($recordId);

        $config = Schema::collection($resource);
        if ($config === null) {
            throw new ApiException(404, 'Sync resource not found.');
        }
        if ($kind === 'create') {
            return $this->createOwnedRecord($resource, $config, $recordId, $payload, $fieldClocks, $account, $clientId);
        }
        if ($kind === 'patch') {
            return $this->patchOwnedRecord($resource, $config, $recordId, $payload, $fieldClocks, $account);
        }
        return $this->deleteOwnedRecord($resource, $config, $recordId, $account);
    }

    private function applyCommand(
        string $command,
        array $payload,
        array $fieldClocks,
        string $account,
        string $clientId,
    ): array {
        if ($command === 'settings.patch') {
            $statement = $this->database->pdo->prepare(
                'SELECT settings FROM users WHERE id = :account',
            );
            $statement->execute(['account' => $account]);
            $settings = json_decode((string) $statement->fetchColumn(), true);
            if (!is_array($settings)) {
                $settings = [];
            }
            foreach ($payload as $key => $value) {
                if (!is_string($key) || strlen($key) > 80) {
                    throw new ApiException(422, 'A settings field is invalid.');
                }
                $settings[$key] = $value;
            }
            $update = $this->database->pdo->prepare(
                'UPDATE users SET settings = :settings, updated = :updated WHERE id = :account',
            );
            $update->execute([
                'settings' => json_encode($settings, JSON_THROW_ON_ERROR),
                'updated' => $this->now(),
                'account' => $account,
            ]);
            return [
                'status' => 'applied',
                'resource' => $this->userEnvelope($account),
            ];
        }

        if ($command === 'avatar.set' || $command === 'avatar.remove') {
            $statement = $this->database->pdo->prepare('SELECT avatar FROM users WHERE id = :account');
            $statement->execute(['account' => $account]);
            $oldFilename = (string) $statement->fetchColumn();
            $filename = '';
            if ($command === 'avatar.set') {
                $encoded = $payload['image'] ?? null;
                if (!is_string($encoded)) {
                    throw new ApiException(422, 'Upload a valid compressed JPEG avatar.');
                }
                $filename = $this->storeSyncSquareJpeg(
                    $encoded,
                    dirname($this->config->databasePath) . DIRECTORY_SEPARATOR . 'avatars',
                    'avatar',
                );
            }
            $update = $this->database->pdo->prepare(
                'UPDATE users SET avatar = :avatar, updated = :updated WHERE id = :account',
            );
            $update->execute([
                'avatar' => $filename,
                'updated' => $this->now(),
                'account' => $account,
            ]);
            if ($oldFilename !== '' && preg_match('/^[a-f0-9]{48}\.jpg$/', $oldFilename) === 1) {
                $oldPath = dirname($this->config->databasePath) . DIRECTORY_SEPARATOR . 'avatars'
                    . DIRECTORY_SEPARATOR . $oldFilename;
                if (is_file($oldPath)) {
                    @unlink($oldPath);
                }
            }
            return ['status' => 'applied', 'resource' => $this->userEnvelope($account)];
        }

        if ($command === 'order.set') {
            $resource = (string) ($payload['resource'] ?? '');
            $ids = $payload['ids'] ?? [];
            if (!in_array($resource, ['tasks', 'interval_templates', 'flashcard_review_sets'], true)
                || !is_array($ids) || !array_is_list($ids)) {
                throw new ApiException(422, 'The ordered-list command is invalid.');
            }
            $update = $this->database->pdo->prepare(
                "UPDATE {$resource} SET sort_order = :sort WHERE id = :id AND owner = :owner",
            );
            foreach (array_values(array_unique($ids)) as $index => $id) {
                $this->recordId($id);
                $update->execute(['sort' => $index, 'id' => $id, 'owner' => $account]);
            }
            return ['status' => 'applied'];
        }

        if ($command === 'review_set_preferences.patch') {
            $reviewSetId = $this->recordId($payload['review_set_id'] ?? null);
            $reviewSet = $this->accessibleReviewSet($reviewSetId, $account);
            $fields = self::FLASHCARD_REVIEW_PREFERENCE_FIELDS;
            $requiredFields = array_values(array_filter(
                $fields,
                static fn (string $field): bool => $field !== 'excluded_cards',
            ));
            $settingsPayload = array_intersect_key($payload, array_flip($fields));
            if (count(array_intersect_key($settingsPayload, array_flip($requiredFields))) !== count($requiredFields)) {
                throw new ApiException(422, 'Every Review set preference is required.');
            }
            $settingsPayload['excluded_cards'] ??= [];
            $config = Schema::collection('flashcard_review_sets');
            if ($config === null) {
                throw new ApiException(500, 'Review set schema is unavailable.');
            }
            $settings = $this->validatedValues(
                'flashcard_review_sets',
                ['fields' => array_intersect_key($config['fields'], array_flip($fields)), 'required' => $fields],
                $settingsPayload,
                true,
            );
            if ($settings['mode'] !== 'passive') {
                $settings['indefinite'] = false;
            }
            $this->saveReviewSetPreferences($reviewSetId, $account, $config, $settings);
            if ((string) $reviewSet['owner'] === $account) {
                $assignments = array_map(
                    static fn (string $field): string => $field . ' = :' . $field,
                    $fields,
                );
                $statement = $this->database->pdo->prepare(
                    'UPDATE flashcard_review_sets SET ' . implode(', ', $assignments) . ', updated_at = :updated_at
                     WHERE id = :id AND owner = :owner',
                );
                $statement->execute([
                    ...$this->databaseValues($config, $settings),
                    'updated_at' => $this->now(),
                    'id' => $reviewSetId,
                    'owner' => $account,
                ]);
            }
            $record = $this->accessibleReviewSet($reviewSetId, $account);
            return [
                'status' => 'applied',
                'resource' => $this->projectionEnvelope(
                    'accessible_flashcard_review_sets',
                    $reviewSetId,
                    $this->reviewSetResponse($record, $account),
                ),
            ];
        }

        if ($command === 'review_set_share.create') {
            $id = $this->recordId($payload['id'] ?? null);
            $reviewSetId = $this->recordId($payload['review_set'] ?? null);
            $this->ownedRecord('flashcard_review_sets', $reviewSetId, $account);
            $email = strtolower(trim((string) ($payload['email'] ?? '')));
            if (strlen($email) > 254 || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
                throw new ApiException(422, 'Enter a valid email address.');
            }
            $role = (string) ($payload['role'] ?? '');
            if (!in_array($role, ['readonly', 'editor'], true)) {
                throw new ApiException(422, 'Select a valid access level.');
            }
            $recipientStatement = $this->database->pdo->prepare(
                'SELECT id FROM users WHERE email = :email COLLATE NOCASE LIMIT 1',
            );
            $recipientStatement->execute(['email' => $email]);
            $recipient = $recipientStatement->fetchColumn();
            if (is_string($recipient) && hash_equals($recipient, $account)) {
                throw new ApiException(422, 'That account could not be added.');
            }
            $now = $this->now();
            try {
                $statement = $this->database->pdo->prepare(
                    'INSERT INTO flashcard_review_set_shares (
                        id, review_set, recipient, recipient_email, role, created_at, updated_at
                     ) VALUES (
                        :id, :review_set, :recipient, :email, :role, :created, :updated
                     )',
                );
                $statement->execute([
                    'id' => $id,
                    'review_set' => $reviewSetId,
                    'recipient' => is_string($recipient) ? $recipient : 'pending:' . bin2hex(random_bytes(16)),
                    'email' => $email,
                    'role' => $role,
                    'created' => $now,
                    'updated' => $now,
                ]);
            } catch (PDOException $exception) {
                throw new ApiException(409, 'This Review set is already shared with that email address.', [], $exception);
            }
            return [
                'status' => 'applied',
                'resource' => $this->projectionEnvelope('flashcard_review_set_shares', $id, [
                    'id' => $id,
                    'review_set' => $reviewSetId,
                    'email' => $email,
                    'role' => $role,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]),
            ];
        }

        if ($command === 'review_set_share.patch' || $command === 'review_set_share.delete') {
            $id = $this->recordId($payload['id'] ?? null);
            $statement = $this->database->pdo->prepare(
                'SELECT shares.*, sets.owner FROM flashcard_review_set_shares AS shares
                 JOIN flashcard_review_sets AS sets ON sets.id = shares.review_set
                 WHERE shares.id = :id LIMIT 1',
            );
            $statement->execute(['id' => $id]);
            $share = $statement->fetch();
            if (!is_array($share)) {
                throw new ApiException(404, 'Share not found.');
            }
            $isOwner = hash_equals((string) $share['owner'], $account);
            $isRecipient = hash_equals((string) $share['recipient'], $account);
            if (!$isOwner && !$isRecipient) {
                throw new ApiException(404, 'Share not found.');
            }
            if ($command === 'review_set_share.patch') {
                if (!$isOwner) {
                    throw new ApiException(403, 'Only the Review set owner can change access.');
                }
                $role = (string) ($payload['role'] ?? '');
                if (!in_array($role, ['readonly', 'editor'], true)) {
                    throw new ApiException(422, 'Select a valid access level.');
                }
                $share['role'] = $role;
                $share['updated_at'] = $this->now();
                $update = $this->database->pdo->prepare(
                    'UPDATE flashcard_review_set_shares SET role = :role, updated_at = :updated WHERE id = :id',
                );
                $update->execute(['role' => $role, 'updated' => $share['updated_at'], 'id' => $id]);
                return [
                    'status' => 'applied',
                    'resource' => $this->projectionEnvelope('flashcard_review_set_shares', $id, [
                        'id' => $id,
                        'review_set' => (string) $share['review_set'],
                        'email' => (string) $share['recipient_email'],
                        'role' => $role,
                        'created_at' => (string) $share['created_at'],
                        'updated_at' => (string) $share['updated_at'],
                    ]),
                ];
            }
            foreach (['tasks', 'program_steps', 'interval_templates'] as $table) {
                $detach = $this->database->pdo->prepare(
                    "UPDATE {$table} SET flashcard_review_set = ''
                     WHERE flashcard_review_set = :review_set AND owner = :owner",
                );
                $detach->execute([
                    'review_set' => $share['review_set'],
                    'owner' => $share['recipient'],
                ]);
            }
            $preferences = $this->database->pdo->prepare(
                'DELETE FROM flashcard_review_set_preferences
                 WHERE review_set = :review_set AND account = :account',
            );
            $preferences->execute([
                'review_set' => $share['review_set'],
                'account' => $share['recipient'],
            ]);
            $delete = $this->database->pdo->prepare('DELETE FROM flashcard_review_set_shares WHERE id = :id');
            $delete->execute(['id' => $id]);
            return [
                'status' => 'applied',
                'resource' => $this->projectionEnvelope('flashcard_review_set_shares', $id, null, true),
            ];
        }

        throw new ApiException(422, 'The sync command is not supported.');
    }

    private function createOwnedRecord(
        string $resource,
        array $config,
        string $recordId,
        array $payload,
        array $fieldClocks,
        string $account,
        string $clientId,
    ): array {
        if ($resource === 'flashcards') {
            $payload = $this->prepareFlashcardImagePayload($payload);
            $payload = $this->prepareFlashcardAudioPayload($payload);
        }
        if ($resource === 'journal_entries') {
            $payload = $this->prepareJournalImagePayload($payload);
        }
        if ($resource === 'flashcard_review_events' && ($payload['outcome'] ?? null) === 'eject') {
            $payload['outcome'] = 'ejected';
        }
        $existingVersion = $this->versionRow($account, $resource, $recordId);
        if (is_array($existingVersion) && (int) $existingVersion['deleted'] === 1) {
            throw new ApiException(409, 'This record was already deleted.');
        }
        $values = $this->validatedValues($resource, $config, $payload, true);
        $values['id'] = $recordId;
        $values['owner'] = $account;
        if (in_array($resource, ['interval_sessions', 'flashcard_review_sessions'], true)) {
            $values['client_id'] = $clientId;
        }
        $this->addCreateMetadata($resource, $values);
        $this->validateRelations($resource, $values, $account);

        $columns = array_keys($values);
        $placeholders = array_map(static fn (string $column): string => ':' . $column, $columns);
        try {
            $statement = $this->database->pdo->prepare(sprintf(
                'INSERT INTO %s (%s) VALUES (%s)',
                $resource,
                implode(', ', $columns),
                implode(', ', $placeholders),
            ));
            $statement->execute($this->databaseValues($config, $values));
        } catch (PDOException $exception) {
            $replacement = $this->uniqueReplacement($resource, $values, $account);
            if ($replacement !== null) {
                return [
                    'status' => 'merged',
                    'replacementId' => $replacement,
                    'resource' => $this->readOwnedEnvelope($resource, $config, $replacement, $account),
                ];
            }
            throw new ApiException(409, 'A conflicting record already exists.', [], $exception);
        }
        $this->saveFieldClocks($account, $resource, $recordId, $fieldClocks);
        if ($resource === 'flashcard_review_events') {
            $this->recordFlashcardReviewStats($values, $account);
        } elseif ($resource === 'flashcard_review_sets') {
            $this->saveReviewSetPreferences(
                $recordId,
                $account,
                $config,
                $this->ownedRecord($resource, $recordId, $account),
            );
        }
        return [
            'status' => 'applied',
            'resource' => $this->readOwnedEnvelope($resource, $config, $recordId, $account),
        ];
    }

    private function patchOwnedRecord(
        string $resource,
        array $config,
        string $recordId,
        array $payload,
        array $fieldClocks,
        string $account,
    ): array {
        $current = $this->ownedRecord($resource, $recordId, $account);
        $normalizedCurrent = $this->normalizeRecord($config, $current);
        if ($resource === 'flashcards') {
            $payload = $this->prepareFlashcardImagePayload($payload);
            $payload = $this->prepareFlashcardAudioPayload($payload);
        }
        if ($resource === 'journal_entries') {
            $payload = $this->prepareJournalImagePayload($payload);
        }
        if ($resource === 'flashcard_review_events' && ($payload['outcome'] ?? null) === 'eject') {
            $payload['outcome'] = 'ejected';
        }
        $values = $this->validatedValues($resource, $config, $payload, false);
        if ($values === []) {
            throw new ApiException(422, 'At least one writable field is required.');
        }
        $version = $this->versionRow($account, $resource, $recordId);
        $currentClocks = $this->decodedClocks($version['field_clocks'] ?? '{}');
        $mergedClocks = $currentClocks;
        $accepted = [];
        foreach ($values as $field => $value) {
            $incomingClock = is_string($fieldClocks[$field] ?? null)
                ? (string) $fieldClocks[$field]
                : '';
            $currentClock = (string) ($currentClocks[$field] ?? $currentClocks['*'] ?? '');
            if ($incomingClock !== '' && strcmp($incomingClock, $currentClock) < 0) {
                continue;
            }
            $accepted[$field] = $value;
            if ($incomingClock !== '') {
                $mergedClocks[$field] = $incomingClock;
            }
        }
        if ($accepted === []) {
            return [
                'status' => 'merged',
                'resource' => $this->readOwnedEnvelope($resource, $config, $recordId, $account),
            ];
        }
        if ($resource === 'journal_entries') {
            $accepted['updated_at'] = $this->now();
        }
        if (in_array($resource, ['flashcards', 'flashcard_review_sets'], true)) {
            $accepted['updated_at'] = $this->now();
        }
        $this->validateRelations($resource, [...$normalizedCurrent, ...$accepted], $account);
        $assignments = array_map(
            static fn (string $column): string => $column . ' = :' . $column,
            array_keys($accepted),
        );
        $statement = $this->database->pdo->prepare(sprintf(
            'UPDATE %s SET %s WHERE id = :id AND owner = :owner',
            $resource,
            implode(', ', $assignments),
        ));
        $parameters = $this->databaseValues($config, $accepted);
        $parameters['id'] = $recordId;
        $parameters['owner'] = $account;
        $statement->execute($parameters);
        if ($resource === 'journal_entries' && array_key_exists('image_file', $accepted)) {
            $oldFilename = $this->validSquareImageFilename($current['image_file'] ?? null);
            $newFilename = $this->validSquareImageFilename($accepted['image_file'] ?? null);
            if ($oldFilename !== null && $oldFilename !== $newFilename) {
                $this->removeJournalImageFile($oldFilename);
            }
        }
        if ($resource === 'flashcards') {
            foreach (['front', 'back'] as $side) {
                $field = $side . '_audio_file';
                if (!array_key_exists($field, $accepted)) {
                    continue;
                }
                $oldFilename = $this->validFlashcardAudioFilename($current[$field] ?? null);
                $newFilename = $this->validFlashcardAudioFilename($accepted[$field] ?? null);
                if ($oldFilename !== null && $oldFilename !== $newFilename) {
                    $this->removeFlashcardAudioFileIfUnused($oldFilename);
                }
            }
        }
        if ($resource === 'flashcard_review_sets') {
            $this->saveReviewSetPreferences(
                $recordId,
                $account,
                $config,
                [...$normalizedCurrent, ...$accepted],
            );
        }
        $this->saveFieldClocks($account, $resource, $recordId, $mergedClocks);
        return [
            'status' => count($accepted) === count($values) ? 'applied' : 'merged',
            'resource' => $this->readOwnedEnvelope($resource, $config, $recordId, $account),
        ];
    }

    private function deleteOwnedRecord(string $resource, array $config, string $recordId, string $account): array
    {
        $current = $this->ownedRecord($resource, $recordId, $account);
        $this->cascadeDelete($resource, $recordId, $account);
        if ($resource === 'journal_entries') {
            $filename = $this->validSquareImageFilename($current['image_file'] ?? null);
            if ($filename !== null) {
                $this->removeJournalImageFile($filename);
            }
        }
        if ($resource === 'flashcards') {
            foreach (['front', 'back'] as $side) {
                $filename = $this->validFlashcardAudioFilename(
                    $current[$side . '_audio_file'] ?? null,
                );
                if ($filename !== null) {
                    $this->removeFlashcardAudioFileIfUnused($filename);
                }
            }
        }
        return [
            'status' => 'applied',
            'resource' => $this->deletedEnvelope($resource, $recordId, $account),
        ];
    }

    private function mutateUser(
        string $kind,
        string $recordId,
        array $payload,
        array $fieldClocks,
        string $account,
    ): array {
        if ($kind !== 'patch' || $recordId !== $account) {
            throw new ApiException(403, 'The account operation is not allowed.');
        }
        $allowed = array_intersect_key($payload, array_flip(['name', 'timezone', 'settings']));
        if ($allowed === []) {
            throw new ApiException(422, 'No writable account field was supplied.');
        }
        if (isset($allowed['name']) && (!is_string($allowed['name']) || trim($allowed['name']) === '')) {
            throw new ApiException(422, 'The account name is required.');
        }
        $version = $this->versionRow($account, 'users', $account);
        $currentClocks = $this->decodedClocks($version['field_clocks'] ?? '{}');
        $mergedClocks = $currentClocks;
        foreach (array_keys($allowed) as $field) {
            $incomingClock = is_string($fieldClocks[$field] ?? null)
                ? (string) $fieldClocks[$field]
                : '';
            $currentClock = (string) ($currentClocks[$field] ?? $currentClocks['*'] ?? '');
            if ($incomingClock !== '' && strcmp($incomingClock, $currentClock) < 0) {
                unset($allowed[$field]);
                continue;
            }
            if ($incomingClock !== '') {
                $mergedClocks[$field] = $incomingClock;
            }
        }
        if ($allowed === []) {
            return ['status' => 'merged', 'resource' => $this->userEnvelope($account)];
        }
        if (isset($allowed['settings'])) {
            $allowed['settings'] = json_encode($allowed['settings'], JSON_THROW_ON_ERROR);
        }
        $allowed['updated'] = $this->now();
        $assignments = array_map(static fn (string $field): string => $field . ' = :' . $field, array_keys($allowed));
        $statement = $this->database->pdo->prepare(
            'UPDATE users SET ' . implode(', ', $assignments) . ' WHERE id = :id',
        );
        $statement->execute([...$allowed, 'id' => $account]);
        $this->saveFieldClocks($account, 'users', $account, $mergedClocks);
        return ['status' => 'applied', 'resource' => $this->userEnvelope($account)];
    }

    private function mutateSharedCard(
        string $kind,
        string $recordId,
        array $payload,
        array $fieldClocks,
        string $account,
    ): array {
        [$reviewSetId, $cardId] = $this->sharedCardIds($recordId, $payload);
        $reviewSet = $this->accessibleReviewSet($reviewSetId, $account);
        if ((string) $reviewSet['owner'] !== $account && (string) $reviewSet['access_role'] !== 'editor') {
            throw new ApiException(403, 'This Review set is read-only.');
        }
        $sourceOwner = (string) $reviewSet['owner'];
        $config = Schema::collection('flashcards');
        if ($config === null) {
            throw new ApiException(500, 'Flashcard schema is unavailable.');
        }
        $payload = array_intersect_key($payload, array_flip([
            'front', 'back', 'note', 'image_url', 'front_audio_url', 'back_audio_url',
        ]));
        if ($kind === 'create') {
            $tags = $this->stringArray($reviewSet['tags'] ?? []);
            $response = $this->createOwnedRecord(
                'flashcards',
                $config,
                $cardId,
                [...$payload, 'tags' => $tags],
                $fieldClocks,
                $sourceOwner,
                '',
            );
        } elseif ($kind === 'patch') {
            $response = $this->patchOwnedRecord(
                'flashcards',
                $config,
                $cardId,
                $payload,
                $fieldClocks,
                $sourceOwner,
            );
        } else {
            $response = $this->deleteOwnedRecord('flashcards', $config, $cardId, $sourceOwner);
        }
        $projection = $kind === 'delete'
            ? $this->projectionEnvelope('review_set_cards', $reviewSetId . ':' . $cardId, null, true)
            : $this->readReviewSetCardEnvelope($reviewSetId, $cardId, $account);
        return ['status' => $response['status'], 'resource' => $projection];
    }

    private function validatedValues(string $resource, array $config, array $payload, bool $creating): array
    {
        $allowedFields = $config['fields'];
        $values = [];
        foreach ($payload as $field => $value) {
            if (!is_string($field) || !isset($allowedFields[$field])) {
                continue;
            }
            if ($field === 'client_id') {
                continue;
            }
            $values[$field] = $this->validatedValue($field, $value, $allowedFields[$field]);
        }
        if ($creating) {
            foreach ($config['required'] as $field) {
                if (!array_key_exists($field, $values)) {
                    throw new ApiException(422, "The {$field} field is required.");
                }
            }
        }
        return $values;
    }

    private function validatedValue(string $field, mixed $value, array $rules): mixed
    {
        $type = (string) ($rules['type'] ?? '');
        if (($rules['allowEmpty'] ?? false) && $value === '') {
            return '';
        }
        return match ($type) {
            'text' => $this->textValue($field, $value, (int) ($rules['max'] ?? 0), (bool) ($rules['required'] ?? false)),
            'choice' => $this->choiceValue($field, $value, $rules),
            'boolean' => is_bool($value) ? $value : throw new ApiException(422, "The {$field} field must be true or false."),
            'integer' => $this->integerValue($field, $value, $rules),
            'number' => $this->numberValue($field, $value, $rules),
            'json', 'json_array', 'number_array' => $this->jsonValue($field, $value, $rules),
            'relation' => $value === '' ? '' : $this->recordId($value),
            'date_key' => $this->dateValue($field, $value),
            'timestamp' => $this->timestampValue($field, $value),
            'time_key' => is_string($value) && preg_match('/^\d{2}:\d{2}$/', $value) === 1
                ? $value
                : throw new ApiException(422, "The {$field} field is invalid."),
            default => throw new ApiException(422, "The {$field} field is not writable."),
        };
    }

    private function addCreateMetadata(string $resource, array &$values): void
    {
        $now = $this->now();
        if ($resource === 'entries') {
            $values['created_at'] = $now;
        }
        if ($resource === 'flashcards') {
            $values += [
                'note' => '', 'image_url' => '', 'image_file' => '',
                'front_audio_url' => '', 'front_audio_file' => '',
                'back_audio_url' => '', 'back_audio_file' => '',
                'tags' => [], 'created_at' => $now, 'updated_at' => $now,
                'last_reviewed_at' => '', 'passive_views' => 0, 'success_count' => 0, 'error_count' => 0,
            ];
        }
        if ($resource === 'flashcard_review_sets') {
            $values += ['created_at' => $now, 'updated_at' => $now];
        }
        if ($resource === 'journal_entries') {
            $values += [
                'image_url' => '', 'image_file' => '',
                'task_snapshot' => '', 'tracker_snapshot' => [],
                'created_at' => $now, 'updated_at' => $now,
            ];
        }
    }

    private function cascadeDelete(string $resource, string $recordId, string $account): void
    {
        $pdo = $this->database->pdo;
        if ($resource === 'tasks') {
            $pdo->prepare("UPDATE journal_entries SET task = '' WHERE task = :id AND owner = :owner")
                ->execute(['id' => $recordId, 'owner' => $account]);
            foreach (['interval_sessions', 'flashcard_review_sessions'] as $table) {
                $pdo->prepare("UPDATE {$table} SET task = '', program_step = '' WHERE task = :id AND owner = :owner")
                    ->execute(['id' => $recordId, 'owner' => $account]);
            }
            foreach (['entries', 'occurrences', 'program_steps'] as $table) {
                $pdo->prepare("DELETE FROM {$table} WHERE task = :id AND owner = :owner")
                    ->execute(['id' => $recordId, 'owner' => $account]);
            }
        } elseif ($resource === 'program_steps') {
            foreach (['interval_sessions', 'flashcard_review_sessions'] as $table) {
                $pdo->prepare("UPDATE {$table} SET program_step = '' WHERE program_step = :id AND owner = :owner")
                    ->execute(['id' => $recordId, 'owner' => $account]);
            }
            foreach (['entries', 'occurrences'] as $table) {
                $pdo->prepare("DELETE FROM {$table} WHERE program_step = :id AND owner = :owner")
                    ->execute(['id' => $recordId, 'owner' => $account]);
            }
        } elseif ($resource === 'occurrences') {
            $pdo->prepare('DELETE FROM entries WHERE occurrence = :id AND owner = :owner')
                ->execute(['id' => $recordId, 'owner' => $account]);
        } elseif ($resource === 'tracking_trackers') {
            $pdo->prepare('DELETE FROM tracking_entries WHERE tracker = :id AND owner = :owner')
                ->execute(['id' => $recordId, 'owner' => $account]);
        } elseif ($resource === 'tags') {
            $this->removeTagFromJsonRecords('tasks', $recordId, $account);
        } elseif ($resource === 'flashcard_tags') {
            $this->removeTagFromJsonRecords('flashcards', $recordId, $account);
            $this->removeTagFromJsonRecords('flashcard_review_sets', $recordId, $account);
        } elseif ($resource === 'flashcards') {
            $pdo->prepare("UPDATE flashcard_review_events SET card = '' WHERE card = :id")
                ->execute(['id' => $recordId]);
            $pdo->prepare('DELETE FROM flashcard_review_card_stats WHERE card = :id')
                ->execute(['id' => $recordId]);
        }
        $pdo->prepare("DELETE FROM {$resource} WHERE id = :id AND owner = :owner")
            ->execute(['id' => $recordId, 'owner' => $account]);
    }

    private function removeTagFromJsonRecords(string $table, string $tagId, string $account): void
    {
        $statement = $this->database->pdo->prepare("SELECT id, tags FROM {$table} WHERE owner = :owner");
        $statement->execute(['owner' => $account]);
        $update = $this->database->pdo->prepare(
            "UPDATE {$table} SET tags = :tags WHERE id = :id AND owner = :owner",
        );
        foreach ($statement->fetchAll() as $record) {
            $tags = $this->stringArray($record['tags'] ?? []);
            if (!in_array($tagId, $tags, true)) {
                continue;
            }
            $update->execute([
                'tags' => json_encode(
                    array_values(array_filter($tags, static fn (string $tag): bool => $tag !== $tagId)),
                    JSON_THROW_ON_ERROR,
                ),
                'id' => $record['id'],
                'owner' => $account,
            ]);
        }
    }

    private function validateRelations(string $resource, array $values, string $account): void
    {
        if ($resource === 'entries'
            && array_key_exists('value', $values)
            && (float) $values['value'] === 0.0
        ) {
            throw new ApiException(422, 'Task log entries cannot have a value of zero.', [
                'value' => 'nonzero',
            ]);
        }
        if ($resource === 'tasks') {
            $reminderTimes = $values['reminder_times'] ?? [];
            foreach ($reminderTimes as $time) {
                if (!is_string($time) || preg_match('/^(?:[01]\d|2[0-3]):[0-5]\d$/', $time) !== 1) {
                    throw new ApiException(422, 'Reminder times must use HH:MM.');
                }
            }
            if (count($reminderTimes) !== count(array_unique($reminderTimes))) {
                throw new ApiException(422, 'Each task reminder must use a different time.');
            }
            if (($values['reminder_enabled'] ?? false) && $reminderTimes === []) {
                throw new ApiException(422, 'Add at least one time for an enabled task reminder.');
            }
            $isSessionTask = in_array(($values['type'] ?? ''), ['interval', 'flashcards'], true);
            $sessionCountMode = (string) ($values['session_count_mode'] ?? 'task');
            $sessionGoalType = (string) ($values['session_goal_type'] ?? 'complete');
            $sessionTargetSeconds = (int) ($values['session_target_seconds'] ?? 0);
            if ($isSessionTask && $sessionGoalType === 'duration' && $sessionTargetSeconds <= 0) {
                throw new ApiException(422, 'Choose a session duration greater than zero.');
            }
            if (
                !$isSessionTask
                && ($sessionCountMode !== 'task'
                    || $sessionGoalType !== 'complete'
                    || $sessionTargetSeconds !== 0)
            ) {
                throw new ApiException(422, 'Session objectives are only available for Interval and Review set tasks.');
            }
        }
        $relations = match ($resource) {
            'program_steps' => ['task' => 'tasks'],
            'occurrences', 'entries' => ['task' => 'tasks', 'program_step' => 'program_steps'],
            'tracking_entries' => ['tracker' => 'tracking_trackers'],
            'interval_sessions' => ['template' => 'interval_templates', 'task' => 'tasks', 'program_step' => 'program_steps'],
            default => [],
        };
        foreach ($relations as $field => $table) {
            $id = (string) ($values[$field] ?? '');
            if ($id === '') {
                continue;
            }
            $statement = $this->database->pdo->prepare(
                "SELECT 1 FROM {$table} WHERE id = :id AND owner = :owner",
            );
            $statement->execute(['id' => $id, 'owner' => $account]);
            if ($statement->fetchColumn() === false) {
                throw new ApiException(422, "The {$field} relation is unavailable.");
            }
        }
    }

    private function recordFlashcardReviewStats(array $event, string $account): void
    {
        $outcome = (string) ($event['outcome'] ?? '');
        $counter = match ($outcome) {
            'success' => 'success_count',
            'error' => 'error_count',
            'passive' => 'passive_views',
            default => null,
        };
        $cardId = (string) ($event['card'] ?? '');
        if ($counter === null || $cardId === '') {
            return;
        }

        $cardStatement = $this->database->pdo->prepare(
            'SELECT owner FROM flashcards WHERE id = :id LIMIT 1',
        );
        $cardStatement->execute(['id' => $cardId]);
        $cardOwner = $cardStatement->fetchColumn();
        if (!is_string($cardOwner)) {
            return;
        }

        $reviewedAt = (string) ($event['reviewed_at'] ?? $this->now());
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
            'reviewer' => $account,
            'card' => $cardId,
            'reviewed_at' => $reviewedAt,
            'passive_views' => $counter === 'passive_views' ? 1 : 0,
            'success_count' => $counter === 'success_count' ? 1 : 0,
            'error_count' => $counter === 'error_count' ? 1 : 0,
        ]);
        if (hash_equals($cardOwner, $account)) {
            $statement = $this->database->pdo->prepare(
                "UPDATE flashcards SET {$counter} = {$counter} + 1,
                    last_reviewed_at = :reviewed_at, updated_at = :reviewed_at
                 WHERE id = :id AND owner = :owner",
            );
            $statement->execute([
                'reviewed_at' => $reviewedAt,
                'id' => $cardId,
                'owner' => $account,
            ]);
        }
    }

    private function prepareFlashcardImagePayload(array $payload): array
    {
        $encoded = $payload['image_url'] ?? null;
        if (!is_string($encoded) || !str_starts_with($encoded, 'data:image/jpeg;base64,')) {
            return $payload;
        }
        $filename = $this->storeSyncSquareJpeg(
            $encoded,
            dirname($this->config->databasePath) . DIRECTORY_SEPARATOR . 'flashcard-images',
            'card image',
        );

        return [
            ...$payload,
            'image_url' => '',
            'image_file' => $filename,
        ];
    }

    private function prepareFlashcardAudioPayload(array $payload): array
    {
        foreach (['front', 'back'] as $side) {
            $urlField = $side . '_audio_url';
            $fileField = $side . '_audio_file';
            $encoded = $payload[$urlField] ?? null;
            if (!is_string($encoded) || $encoded === '') {
                continue;
            }
            if (!str_starts_with($encoded, 'data:audio/')) {
                throw new ApiException(422, 'Card audio must be a device recording.');
            }
            $payload[$urlField] = '';
            $payload[$fileField] = $this->storeSyncFlashcardAudio($encoded);
        }
        return $payload;
    }

    private function storeSyncFlashcardAudio(string $encoded): string
    {
        if (!str_contains($encoded, ',')) {
            throw new ApiException(422, 'Record valid WebM or MP4 card audio.');
        }
        [$metadata, $payload] = explode(',', $encoded, 2);
        if (
            preg_match(
                '#^data:(audio/(?:webm|mp4))(?:;codecs=[^;,]+)?;base64$#i',
                $metadata,
                $matches,
            ) !== 1
        ) {
            throw new ApiException(422, 'Record valid WebM or MP4 card audio.');
        }
        $bytes = base64_decode($payload, true);
        if ($bytes === false || strlen($bytes) < 100 || strlen($bytes) > 1_500_000) {
            throw new ApiException(422, 'The card recording is invalid or larger than 1.5 MB.');
        }
        $mimeType = strtolower($matches[1]);
        if ($mimeType === 'audio/webm' && !str_starts_with($bytes, "\x1A\x45\xDF\xA3")) {
            throw new ApiException(422, 'The WebM card recording is invalid.');
        }
        if ($mimeType === 'audio/mp4' && substr($bytes, 4, 4) !== 'ftyp') {
            throw new ApiException(422, 'The MP4 card recording is invalid.');
        }

        $directory = dirname($this->config->databasePath) . DIRECTORY_SEPARATOR . 'flashcard-audio';
        if (!is_dir($directory) && !mkdir($directory, 0700, true) && !is_dir($directory)) {
            throw new ApiException(500, 'The private flashcard audio directory could not be created.');
        }
        if (!is_writable($directory)) {
            throw new ApiException(500, 'The private flashcard audio directory is not writable.');
        }
        $extension = $mimeType === 'audio/webm' ? 'webm' : 'm4a';
        $filename = bin2hex(random_bytes(24)) . '.' . $extension;
        $temporary = tempnam($directory, '.audio-');
        if ($temporary === false) {
            throw new ApiException(500, 'The card recording could not be stored.');
        }
        try {
            if (file_put_contents($temporary, $bytes, LOCK_EX) !== strlen($bytes)) {
                throw new ApiException(500, 'The card recording could not be stored.');
            }
            @chmod($temporary, 0600);
            if (!rename($temporary, $directory . DIRECTORY_SEPARATOR . $filename)) {
                throw new ApiException(500, 'The card recording could not be finalized.');
            }
            $temporary = '';
        } finally {
            if ($temporary !== '' && is_file($temporary)) {
                @unlink($temporary);
            }
        }
        return $filename;
    }

    private function prepareJournalImagePayload(array $payload): array
    {
        $encoded = $payload['image_url'] ?? null;
        if (!is_string($encoded) || !str_starts_with($encoded, 'data:image/jpeg;base64,')) {
            return $payload;
        }
        $filename = $this->storeSyncSquareJpeg(
            $encoded,
            dirname($this->config->databasePath) . DIRECTORY_SEPARATOR . 'journal-images',
            'reflection image',
            512,
        );

        return [
            ...$payload,
            'image_url' => '',
            'image_file' => $filename,
        ];
    }

    private function storeSyncSquareJpeg(
        string $encoded,
        string $directory,
        string $label,
        int $maxDimension = 256,
    ): string
    {
        if (!str_starts_with($encoded, 'data:image/jpeg;base64,')) {
            throw new ApiException(422, "Upload a valid compressed JPEG {$label}.");
        }
        $bytes = base64_decode(substr($encoded, 23), true);
        if ($bytes === false || strlen($bytes) < 100 || strlen($bytes) > 500000) {
            throw new ApiException(422, "The compressed {$label} is invalid or too large.");
        }
        $details = @getimagesizefromstring($bytes);
        if (!is_array($details)
            || ($details['mime'] ?? null) !== 'image/jpeg'
            || ($details[0] ?? 0) < 1
            || ($details[0] ?? 0) > $maxDimension
            || ($details[1] ?? 0) !== ($details[0] ?? 0)) {
            throw new ApiException(
                422,
                "The {$label} must be a square JPEG no larger than {$maxDimension}×{$maxDimension}.",
            );
        }

        if (!is_dir($directory) && !mkdir($directory, 0700, true) && !is_dir($directory)) {
            throw new ApiException(500, "The private {$label} directory could not be created.");
        }
        if (!is_writable($directory)) {
            throw new ApiException(500, "The private {$label} directory is not writable.");
        }
        $filename = bin2hex(random_bytes(24)) . '.jpg';
        $temporary = tempnam($directory, '.image-');
        if ($temporary === false) {
            throw new ApiException(500, "The {$label} could not be stored.");
        }
        try {
            if (file_put_contents($temporary, $bytes, LOCK_EX) !== strlen($bytes)) {
                throw new ApiException(500, "The {$label} could not be stored.");
            }
            @chmod($temporary, 0600);
            if (!rename($temporary, $directory . DIRECTORY_SEPARATOR . $filename)) {
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

    private function validSquareImageFilename(mixed $value): ?string
    {
        return is_string($value) && preg_match('/^[a-f0-9]{48}\.jpg$/', $value) === 1
            ? $value
            : null;
    }

    private function validFlashcardAudioFilename(mixed $value): ?string
    {
        return is_string($value)
            && preg_match('/^[a-f0-9]{48}\.(?:webm|m4a)$/', $value) === 1
                ? $value
                : null;
    }

    private function removeFlashcardAudioFileIfUnused(string $filename): void
    {
        $statement = $this->database->pdo->prepare(
            'SELECT
                (SELECT COUNT(*) FROM flashcards
                 WHERE front_audio_file = :filename OR back_audio_file = :filename)
                + (SELECT COUNT(*) FROM flashcard_review_sessions WHERE queue_state LIKE :needle)
                + (SELECT COUNT(*) FROM interval_sessions WHERE flashcard_snapshot LIKE :needle)',
        );
        $statement->execute([
            'filename' => $filename,
            'needle' => '%' . $filename . '%',
        ]);
        if ((int) $statement->fetchColumn() > 0) {
            return;
        }
        $path = dirname($this->config->databasePath) . DIRECTORY_SEPARATOR
            . 'flashcard-audio' . DIRECTORY_SEPARATOR . $filename;
        if (is_file($path)) {
            @unlink($path);
        }
    }

    private function removeJournalImageFile(string $filename): void
    {
        $path = dirname($this->config->databasePath) . DIRECTORY_SEPARATOR . 'journal-images'
            . DIRECTORY_SEPARATOR . $filename;
        if (is_file($path)) {
            @unlink($path);
        }
    }

    private function changesAfter(string $account, int $cursor): array
    {
        $statement = $this->database->pdo->prepare(
            'SELECT sequence, resource, record_id, action
             FROM sync_change_log
             WHERE account_id = :account AND sequence > :cursor
             ORDER BY sequence
             LIMIT :limit',
        );
        $statement->bindValue(':account', $account);
        $statement->bindValue(':cursor', $cursor, PDO::PARAM_INT);
        $statement->bindValue(':limit', self::MAX_CHANGES, PDO::PARAM_INT);
        $statement->execute();
        $rows = $statement->fetchAll();
        $latest = [];
        $nextCursor = $cursor;
        foreach ($rows as $row) {
            $nextCursor = max($nextCursor, (int) $row['sequence']);
            $latest[(string) $row['resource'] . ':' . (string) $row['record_id']] = $row;
        }
        $changes = [];
        foreach ($latest as $row) {
            $changes[] = $this->changeEnvelope($row, $account);
        }
        $more = false;
        if (count($rows) === self::MAX_CHANGES) {
            $check = $this->database->pdo->prepare(
                'SELECT 1 FROM sync_change_log WHERE account_id = :account AND sequence > :cursor LIMIT 1',
            );
            $check->execute(['account' => $account, 'cursor' => $nextCursor]);
            $more = $check->fetchColumn() !== false;
        }
        return ['cursor' => $nextCursor, 'hasMore' => $more, 'changes' => $changes];
    }

    private function changeEnvelope(array $change, string $account): array
    {
        $resource = (string) $change['resource'];
        $recordId = (string) $change['record_id'];
        if ((string) $change['action'] === 'delete') {
            return $this->projectionEnvelope($resource, $recordId, null, true);
        }
        if ($resource === 'users') {
            return $this->userEnvelope($account);
        }
        if ($resource === 'accessible_flashcard_review_sets') {
            $record = $this->accessibleReviewSet($recordId, $account, false);
            return $record === null
                ? $this->projectionEnvelope($resource, $recordId, null, true)
                : $this->projectionEnvelope($resource, $recordId, $this->reviewSetResponse($record, $account));
        }
        if ($resource === 'review_set_cards') {
            [$reviewSetId, $cardId] = array_pad(explode(':', $recordId, 2), 2, '');
            try {
                return $this->readReviewSetCardEnvelope($reviewSetId, $cardId, $account);
            } catch (ApiException) {
                return $this->projectionEnvelope($resource, $recordId, null, true);
            }
        }
        if ($resource === 'flashcard_review_set_shares') {
            $statement = $this->database->pdo->prepare(
                'SELECT shares.id, shares.review_set, shares.role,
                        shares.recipient_email AS email, shares.created_at, shares.updated_at
                 FROM flashcard_review_set_shares AS shares
                 JOIN flashcard_review_sets AS sets ON sets.id = shares.review_set
                 WHERE shares.id = :id AND sets.owner = :owner',
            );
            $statement->execute(['id' => $recordId, 'owner' => $account]);
            $share = $statement->fetch();
            return is_array($share)
                ? $this->projectionEnvelope($resource, $recordId, $share)
                : $this->projectionEnvelope($resource, $recordId, null, true);
        }
        $config = Schema::collection($resource);
        if ($config === null) {
            return $this->projectionEnvelope($resource, $recordId, null, true);
        }
        try {
            return $this->readOwnedEnvelope($resource, $config, $recordId, $account);
        } catch (ApiException) {
            return $this->deletedEnvelope($resource, $recordId, $account);
        }
    }

    private function ownedEnvelope(string $resource, array $config, array $record, string $account): array
    {
        $version = $this->versionRow($account, $resource, (string) $record['id']);
        return [
            'resource' => $resource,
            'id' => (string) $record['id'],
            'revision' => (int) ($version['revision'] ?? 1),
            'fieldClocks' => $this->decodedClocks($version['field_clocks'] ?? '{}'),
            'deleted' => false,
            'data' => $this->normalizeRecord($config, $record),
        ];
    }

    private function readOwnedEnvelope(string $resource, array $config, string $recordId, string $account): array
    {
        return $this->ownedEnvelope($resource, $config, $this->ownedRecord($resource, $recordId, $account), $account);
    }

    private function deletedEnvelope(string $resource, string $recordId, string $account): array
    {
        $version = $this->versionRow($account, $resource, $recordId);
        return [
            'resource' => $resource,
            'id' => $recordId,
            'revision' => (int) ($version['revision'] ?? 1),
            'fieldClocks' => $this->decodedClocks($version['field_clocks'] ?? '{}'),
            'deleted' => true,
        ];
    }

    private function projectionEnvelope(string $resource, string $recordId, ?array $data, bool $deleted = false): array
    {
        return [
            'resource' => $resource,
            'id' => $recordId,
            'revision' => 1,
            'fieldClocks' => [],
            'deleted' => $deleted,
            ...($data === null ? [] : ['data' => $data]),
        ];
    }

    private function userEnvelope(string $account): array
    {
        $statement = $this->database->pdo->prepare(
            'SELECT id, email, verified, name, avatar, timezone, settings, created, updated
             FROM users WHERE id = :account',
        );
        $statement->execute(['account' => $account]);
        $record = $statement->fetch();
        if (!is_array($record)) {
            throw new ApiException(404, 'Account not found.');
        }
        $record['verified'] = (bool) $record['verified'];
        $record['settings'] = json_decode((string) $record['settings'], true) ?: new \stdClass();
        if ((string) $record['avatar'] !== '') {
            $record['avatar'] = '/avatars/' . $record['avatar'];
        }
        $version = $this->versionRow($account, 'users', $account);
        return [
            'resource' => 'users',
            'id' => $account,
            'revision' => (int) ($version['revision'] ?? 1),
            'fieldClocks' => $this->decodedClocks($version['field_clocks'] ?? '{}'),
            'deleted' => false,
            'data' => $record,
        ];
    }

    private function accessibleReviewSets(string $account): array
    {
        $statement = $this->database->pdo->prepare(
            "SELECT sets.*, shares.id AS share_id,
                    CASE WHEN sets.owner = :account THEN 'owner' ELSE shares.role END AS access_role,
                    users.name AS owner_name, users.avatar AS owner_avatar
             FROM flashcard_review_sets AS sets
             JOIN users ON users.id = sets.owner
             LEFT JOIN flashcard_review_set_shares AS shares
               ON shares.review_set = sets.id AND shares.recipient = :account
             WHERE sets.owner = :account OR shares.recipient = :account
             ORDER BY sets.owner <> :account, sets.sort_order, sets.name",
        );
        $statement->execute(['account' => $account]);
        return array_map(fn (array $record): array => $this->reviewSetResponse($record, $account), $statement->fetchAll());
    }

    private function accessibleReviewSet(string $id, string $account, bool $throw = true): ?array
    {
        $statement = $this->database->pdo->prepare(
            "SELECT sets.*, shares.id AS share_id,
                    CASE WHEN sets.owner = :account THEN 'owner' ELSE shares.role END AS access_role,
                    users.name AS owner_name, users.avatar AS owner_avatar
             FROM flashcard_review_sets AS sets
             JOIN users ON users.id = sets.owner
             LEFT JOIN flashcard_review_set_shares AS shares
               ON shares.review_set = sets.id AND shares.recipient = :account
             WHERE sets.id = :id AND (sets.owner = :account OR shares.recipient = :account)",
        );
        $statement->execute(['id' => $id, 'account' => $account]);
        $record = $statement->fetch();
        if (!is_array($record)) {
            if ($throw) {
                throw new ApiException(404, 'Review set not found.');
            }
            return null;
        }
        return $record;
    }

    private function reviewSetResponse(array $record, string $account): array
    {
        $config = Schema::collection('flashcard_review_sets');
        if ($config === null) {
            throw new ApiException(500, 'Review set schema is unavailable.');
        }
        $result = $this->normalizeRecord($config, $record);
        $preference = $this->database->pdo->prepare(
            'SELECT * FROM flashcard_review_set_preferences
             WHERE review_set = :review_set AND account = :account',
        );
        $preference->execute(['review_set' => $record['id'], 'account' => $account]);
        $settings = $preference->fetch();
        if (is_array($settings)) {
            foreach ([
                'mode', 'card_sides', 'indefinite', 'max_cards', 'front_seconds',
                'back_seconds', 'back_speech_repeat_count', 'note_before_back',
                'speech_enabled', 'front_language', 'back_language', 'sort_mode',
                'excluded_cards',
            ] as $field) {
                $result[$field] = match ($field) {
                    'indefinite', 'note_before_back', 'speech_enabled' => (bool) $settings[$field],
                    'excluded_cards' => $this->stringArray($settings[$field] ?? []),
                    default => $settings[$field],
                };
            }
        }
        $result['access_role'] = (string) ($record['access_role'] ?? 'owner');
        $result['share_id'] = (string) ($record['share_id'] ?? '');
        $result['owner_name'] = (string) ($record['owner_name'] ?? '');
        $result['owner_avatar'] = (string) ($record['owner_avatar'] ?? '') === ''
            ? ''
            : '/avatars/' . (string) $record['owner_avatar'];
        $tags = $this->stringArray($record['tags'] ?? []);
        $result['tag_details'] = $this->tagDetails((string) $record['owner'], $tags);
        $result['matching_card_count'] = count($this->matchingCards($record));
        return $result;
    }

    private function saveReviewSetPreferences(
        string $reviewSetId,
        string $account,
        array $config,
        array $settings,
    ): void {
        $values = array_intersect_key(
            $settings,
            array_flip(self::FLASHCARD_REVIEW_PREFERENCE_FIELDS),
        );
        $values['excluded_cards'] = $this->stringArray($values['excluded_cards'] ?? []);
        $statement = $this->database->pdo->prepare(
            'INSERT INTO flashcard_review_set_preferences (
                review_set, account, mode, card_sides, indefinite, max_cards,
                front_seconds, back_seconds, back_speech_repeat_count, note_before_back,
                speech_enabled, front_language, back_language, sort_mode, excluded_cards, updated_at
             ) VALUES (
                :review_set, :account, :mode, :card_sides, :indefinite, :max_cards,
                :front_seconds, :back_seconds, :back_speech_repeat_count, :note_before_back,
                :speech_enabled, :front_language, :back_language, :sort_mode, :excluded_cards, :updated_at
             ) ON CONFLICT(review_set, account) DO UPDATE SET
                mode = excluded.mode, card_sides = excluded.card_sides,
                indefinite = excluded.indefinite, max_cards = excluded.max_cards,
                front_seconds = excluded.front_seconds, back_seconds = excluded.back_seconds,
                back_speech_repeat_count = excluded.back_speech_repeat_count,
                note_before_back = excluded.note_before_back,
                speech_enabled = excluded.speech_enabled,
                front_language = excluded.front_language,
                back_language = excluded.back_language,
                sort_mode = excluded.sort_mode,
                excluded_cards = excluded.excluded_cards,
                updated_at = excluded.updated_at',
        );
        $statement->execute([
            'review_set' => $reviewSetId,
            'account' => $account,
            ...$this->databaseValues($config, $values),
            'updated_at' => $this->now(),
        ]);
    }

    private function reviewSetCards(array $reviewSet, string $account): array
    {
        $cards = $this->matchingCards($reviewSet);
        $config = Schema::collection('flashcards');
        if ($config === null) {
            return [];
        }
        return array_map(function (array $card) use ($config, $account): array {
            $result = $this->normalizeRecord($config, $card);
            $result['tag_details'] = $this->tagDetails((string) $card['owner'], $this->stringArray($card['tags'] ?? []));
            $stats = $this->database->pdo->prepare(
                'SELECT * FROM flashcard_review_card_stats WHERE reviewer = :reviewer AND card = :card',
            );
            $stats->execute(['reviewer' => $account, 'card' => $card['id']]);
            $row = $stats->fetch();
            if (is_array($row)) {
                foreach (['last_reviewed_at', 'passive_views', 'success_count', 'error_count'] as $field) {
                    $result[$field] = $row[$field];
                }
            }
            return $result;
        }, $cards);
    }

    private function readReviewSetCardEnvelope(string $reviewSetId, string $cardId, string $account): array
    {
        $reviewSet = $this->accessibleReviewSet($reviewSetId, $account);
        foreach ($this->reviewSetCards($reviewSet, $account) as $card) {
            if ((string) $card['id'] === $cardId) {
                return $this->projectionEnvelope(
                    'review_set_cards',
                    $reviewSetId . ':' . $cardId,
                    ['review_set_id' => $reviewSetId, ...$card],
                );
            }
        }
        throw new ApiException(404, 'Review set card not found.');
    }

    private function matchingCards(array $reviewSet): array
    {
        $tags = $this->stringArray($reviewSet['tags'] ?? []);
        $statement = $this->database->pdo->prepare('SELECT * FROM flashcards WHERE owner = :owner ORDER BY created_at DESC');
        $statement->execute(['owner' => $reviewSet['owner']]);
        return array_values(array_filter($statement->fetchAll(), function (array $card) use ($tags): bool {
            if ($tags === []) {
                return true;
            }
            return array_intersect($tags, $this->stringArray($card['tags'] ?? [])) !== [];
        }));
    }

    private function reviewSetShares(string $account): array
    {
        $statement = $this->database->pdo->prepare(
            'SELECT shares.id, shares.review_set, shares.role,
                    shares.recipient_email AS email, shares.created_at, shares.updated_at
             FROM flashcard_review_set_shares AS shares
             JOIN flashcard_review_sets AS sets ON sets.id = shares.review_set
             WHERE sets.owner = :owner ORDER BY shares.created_at',
        );
        $statement->execute(['owner' => $account]);
        return $statement->fetchAll();
    }

    private function tagDetails(string $owner, array $ids): array
    {
        if ($ids === []) {
            return [];
        }
        $statement = $this->database->pdo->prepare('SELECT id, name FROM flashcard_tags WHERE owner = :owner');
        $statement->execute(['owner' => $owner]);
        $names = [];
        foreach ($statement->fetchAll() as $tag) {
            $names[(string) $tag['id']] = (string) $tag['name'];
        }
        return array_map(static fn (string $id): array => ['id' => $id, 'name' => $names[$id] ?? 'Removed tag'], $ids);
    }

    private function normalizeRecord(array $config, array $record): array
    {
        foreach ($config['fields'] as $field => $rules) {
            if (!array_key_exists($field, $record)) {
                continue;
            }
            $record[$field] = match ($rules['type']) {
                'boolean' => (bool) $record[$field],
                'integer' => (int) $record[$field],
                'number' => (float) $record[$field],
                'json', 'json_array', 'number_array' => $this->decodedJson($record[$field]),
                default => $record[$field],
            };
        }
        if (isset($record['client_id'])) {
            $record['client_id'] = (string) $record['client_id'];
        }
        return $record;
    }

    private function databaseValues(array $config, array $values): array
    {
        foreach ($values as $field => $value) {
            $type = $config['fields'][$field]['type'] ?? null;
            if (in_array($type, ['json', 'json_array', 'number_array'], true)) {
                $values[$field] = json_encode($value, JSON_THROW_ON_ERROR);
            } elseif ($type === 'boolean') {
                $values[$field] = $value ? 1 : 0;
            } elseif (is_array($value) || is_object($value)) {
                $values[$field] = json_encode($value, JSON_THROW_ON_ERROR);
            }
        }
        return $values;
    }

    private function ownedRecord(string $resource, string $recordId, string $account): array
    {
        $statement = $this->database->pdo->prepare(
            "SELECT * FROM {$resource} WHERE id = :id AND owner = :owner",
        );
        $statement->execute(['id' => $recordId, 'owner' => $account]);
        $record = $statement->fetch();
        if (!is_array($record)) {
            throw new ApiException(404, 'Record not found.');
        }
        return $record;
    }

    private function versionRow(string $account, string $resource, string $recordId): ?array
    {
        $statement = $this->database->pdo->prepare(
            'SELECT * FROM sync_record_versions
             WHERE account_id = :account AND resource = :resource AND record_id = :record',
        );
        $statement->execute(['account' => $account, 'resource' => $resource, 'record' => $recordId]);
        $row = $statement->fetch();
        return is_array($row) ? $row : null;
    }

    private function saveFieldClocks(string $account, string $resource, string $recordId, array $clocks): void
    {
        $clean = [];
        foreach ($clocks as $field => $clock) {
            if (is_string($field) && is_string($clock) && strlen($field) <= 80 && strlen($clock) <= 160) {
                $clean[$field] = $clock;
            }
        }
        $statement = $this->database->pdo->prepare(
            'UPDATE sync_record_versions SET field_clocks = :clocks
             WHERE account_id = :account AND resource = :resource AND record_id = :record',
        );
        $statement->execute([
            'clocks' => json_encode($clean, JSON_THROW_ON_ERROR),
            'account' => $account,
            'resource' => $resource,
            'record' => $recordId,
        ]);
    }

    private function uniqueReplacement(string $resource, array $values, string $account): ?string
    {
        if (in_array($resource, ['tags', 'flashcard_tags'], true) && isset($values['name'])) {
            $statement = $this->database->pdo->prepare(
                "SELECT id FROM {$resource} WHERE owner = :owner AND name = :name COLLATE NOCASE LIMIT 1",
            );
            $statement->execute(['owner' => $account, 'name' => $values['name']]);
            $id = $statement->fetchColumn();
            return is_string($id) ? $id : null;
        }
        if ($resource === 'occurrences') {
            $statement = $this->database->pdo->prepare(
                'SELECT id FROM occurrences
                 WHERE owner = :owner AND task = :task AND program_step = :step AND scheduled_date = :date',
            );
            $statement->execute([
                'owner' => $account,
                'task' => $values['task'] ?? '',
                'step' => $values['program_step'] ?? '',
                'date' => $values['scheduled_date'] ?? '',
            ]);
            $id = $statement->fetchColumn();
            return is_string($id) ? $id : null;
        }
        if ($resource === 'entries' && ($values['source_session'] ?? '') !== '') {
            $statement = $this->database->pdo->prepare(
                'SELECT id FROM entries
                 WHERE owner = :owner AND task = :task AND program_step = :step
                   AND source_type = :source_type AND source_session = :source_session
                 LIMIT 1',
            );
            $statement->execute([
                'owner' => $account,
                'task' => $values['task'] ?? '',
                'step' => $values['program_step'] ?? '',
                'source_type' => $values['source_type'] ?? '',
                'source_session' => $values['source_session'],
            ]);
            $id = $statement->fetchColumn();
            return is_string($id) ? $id : null;
        }
        return null;
    }

    private function sharedCardIds(string $recordId, array $payload): array
    {
        if (str_contains($recordId, ':')) {
            [$reviewSetId, $cardId] = explode(':', $recordId, 2);
        } else {
            $reviewSetId = (string) ($payload['review_set_id'] ?? '');
            $cardId = $recordId;
        }
        $this->recordId($reviewSetId);
        $this->recordId($cardId);
        return [$reviewSetId, $cardId];
    }

    private function decodedClocks(mixed $value): array
    {
        $decoded = $this->decodedJson($value);
        return is_array($decoded) ? $decoded : [];
    }

    private function decodedJson(mixed $value): mixed
    {
        if (!is_string($value)) {
            return $value;
        }
        try {
            return json_decode($value, true, flags: JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            return [];
        }
    }

    private function stringArray(mixed $value): array
    {
        $decoded = $this->decodedJson($value);
        return is_array($decoded)
            ? array_values(array_filter($decoded, static fn (mixed $item): bool => is_string($item)))
            : [];
    }

    private function clientId(mixed $value): string
    {
        return $this->identifier($value, 'clientId', 120);
    }

    private function identifier(mixed $value, string $field, int $max): string
    {
        if (!is_string($value) || $value === '' || strlen($value) > $max
            || preg_match('/^[a-zA-Z0-9._:-]+$/', $value) !== 1) {
            throw new ApiException(422, "The {$field} value is invalid.");
        }
        return $value;
    }

    private function recordId(mixed $value): string
    {
        if (!is_string($value) || preg_match('/^[a-zA-Z0-9_-]{1,64}$/', $value) !== 1) {
            throw new ApiException(422, 'A record ID is invalid.');
        }
        return $value;
    }

    private function textValue(string $field, mixed $value, int $max, bool $required): string
    {
        if (!is_string($value) || ($required && trim($value) === '') || strlen($value) > $max) {
            throw new ApiException(422, "The {$field} field is invalid.");
        }
        return $value;
    }

    private function choiceValue(string $field, mixed $value, array $rules): string
    {
        if (($rules['allowEmpty'] ?? false) && $value === '') {
            return '';
        }
        if (!is_string($value) || !in_array($value, $rules['values'] ?? [], true)) {
            throw new ApiException(422, "The {$field} field is invalid.");
        }
        return $value;
    }

    private function integerValue(string $field, mixed $value, array $rules): int
    {
        if (filter_var($value, FILTER_VALIDATE_INT) === false) {
            throw new ApiException(422, "The {$field} field must be an integer.");
        }
        $number = (int) $value;
        if (($rules['min'] ?? null) !== null && $number < $rules['min']) {
            throw new ApiException(422, "The {$field} field is too small.");
        }
        if (($rules['max'] ?? null) !== null && $number > $rules['max']) {
            throw new ApiException(422, "The {$field} field is too large.");
        }
        return $number;
    }

    private function numberValue(string $field, mixed $value, array $rules): int|float
    {
        if (!is_int($value) && !is_float($value)) {
            throw new ApiException(422, "The {$field} field must be a number.");
        }
        if (($rules['min'] ?? null) !== null && $value < $rules['min']) {
            throw new ApiException(422, "The {$field} field is too small.");
        }
        if (($rules['max'] ?? null) !== null && $value > $rules['max']) {
            throw new ApiException(422, "The {$field} field is too large.");
        }
        return $value;
    }

    private function jsonValue(string $field, mixed $value, array $rules): mixed
    {
        if (in_array($rules['type'], ['json_array', 'number_array'], true)
            && (!is_array($value) || !array_is_list($value))) {
            throw new ApiException(422, "The {$field} field must be an array.");
        }
        if ($rules['type'] === 'number_array') {
            foreach ($value as $item) {
                if (!is_int($item) && !is_float($item)) {
                    throw new ApiException(422, "The {$field} field must contain numbers.");
                }
            }
        }
        $encoded = json_encode($value, JSON_THROW_ON_ERROR);
        if (strlen($encoded) > (int) ($rules['max'] ?? PHP_INT_MAX)) {
            throw new ApiException(422, "The {$field} field is too large.");
        }
        return $value;
    }

    private function dateValue(string $field, mixed $value): string
    {
        if (!is_string($value) || preg_match('/^\d{4}-\d{2}-\d{2}$/', $value) !== 1) {
            throw new ApiException(422, "The {$field} field is not a date.");
        }
        return $value;
    }

    private function timestampValue(string $field, mixed $value): string
    {
        if (!is_string($value) || strtotime($value) === false) {
            throw new ApiException(422, "The {$field} field is not a timestamp.");
        }
        return $value;
    }

    private function touchClient(string $account, string $clientId, int $cursor): void
    {
        $statement = $this->database->pdo->prepare(
            'INSERT INTO sync_clients (
                account_id, client_id, acknowledged_cursor, protocol_version, last_seen_at
             ) VALUES (:account, :client, :cursor, :protocol, :seen)
             ON CONFLICT(account_id, client_id) DO UPDATE SET
                acknowledged_cursor = MAX(sync_clients.acknowledged_cursor, excluded.acknowledged_cursor),
                protocol_version = excluded.protocol_version,
                last_seen_at = excluded.last_seen_at',
        );
        $statement->execute([
            'account' => $account,
            'client' => $clientId,
            'cursor' => $cursor,
            'protocol' => self::PROTOCOL_VERSION,
            'seen' => $this->now(),
        ]);
    }

    private function now(): string
    {
        return gmdate('Y-m-d\TH:i:s.v\Z');
    }
}
