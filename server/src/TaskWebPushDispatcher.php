<?php

declare(strict_types=1);

namespace BackOnTrack\Api;

use DateTimeImmutable;
use DateTimeZone;
use Minishlink\WebPush\Subscription;
use Minishlink\WebPush\WebPush;
use Throwable;

final class TaskWebPushDispatcher
{
    private const DUE_LOOKBACK_SECONDS = 300;

    public function __construct(
        private readonly Config $config,
        private readonly Database $database,
    ) {
    }

    /** @return array{candidates: int, sent: int, failed: int, expired: int} */
    public function dispatch(?DateTimeImmutable $now = null): array
    {
        if (!$this->config->webPushConfigured()) {
            throw new ApiException(503, 'Desktop notifications are not configured on the server.');
        }
        $now ??= new DateTimeImmutable('now');
        $webPush = new WebPush([
            'VAPID' => [
                'subject' => $this->config->webPushVapidSubject,
                'publicKey' => $this->config->webPushVapidPublicKey,
                'privateKey' => $this->config->webPushVapidPrivateKey,
            ],
        ], [
            'TTL' => self::DUE_LOOKBACK_SECONDS,
            'urgency' => 'normal',
            'contentType' => 'application/json',
        ]);
        $webPush->setReuseVAPIDHeaders(true);

        $removeExpired = $this->database->pdo->prepare(
            'DELETE FROM web_push_subscriptions
             WHERE expiration_time IS NOT NULL AND expiration_time <= :now',
        );
        $removeExpired->execute(['now' => $now->getTimestamp() * 1000]);

        $statement = $this->database->pdo->query(
            'SELECT subscriptions.id AS subscription_id,
                    subscriptions.endpoint, subscriptions.public_key,
                    subscriptions.auth_token, subscriptions.content_encoding,
                    users.timezone, tasks.*
             FROM web_push_subscriptions AS subscriptions
             JOIN users ON users.id = subscriptions.account_id
             JOIN tasks ON tasks.owner = subscriptions.account_id
             WHERE tasks.active = TRUE AND tasks.reminder_enabled = TRUE
             ORDER BY subscriptions.id, tasks.sort_order, tasks.id',
        );
        $rows = $statement->fetchAll();
        $result = ['candidates' => 0, 'sent' => 0, 'failed' => 0, 'expired' => 0];
        foreach ($rows as $row) {
            if (!is_array($row)) continue;
            try {
                $timezone = new DateTimeZone((string) $row['timezone']);
            } catch (Throwable) {
                $timezone = new DateTimeZone('UTC');
            }
            $localNow = $now->setTimezone($timezone);
            $dateKey = $localNow->format('Y-m-d');
            if (!$this->taskIsIncompleteOnDate($row, $dateKey)) continue;

            $reminderTimes = array_values(array_filter(
                $this->decodeList($row['reminder_times'] ?? '[]'),
                'is_string',
            ));
            foreach (array_values(array_unique($reminderTimes)) as $reminderTime) {
                if (preg_match('/^(?:[01]\d|2[0-3]):[0-5]\d$/', $reminderTime) !== 1) continue;
                $scheduled = DateTimeImmutable::createFromFormat(
                    '!Y-m-d H:i',
                    $dateKey . ' ' . $reminderTime,
                    $timezone,
                );
                if (!$scheduled) continue;
                $secondsLate = $localNow->getTimestamp() - $scheduled->getTimestamp();
                if ($secondsLate < 0 || $secondsLate > self::DUE_LOOKBACK_SECONDS) continue;

                $result['candidates']++;
                if (!$this->reserveDelivery($row, $dateKey, $reminderTime, $now)) continue;
                try {
                    $payload = json_encode([
                        'title' => 'Task reminder',
                        'body' => (string) $row['name'],
                        'url' => '/tasks',
                        'tag' => sprintf(
                            'backontrack-task-%s-%s-%s',
                            (string) $row['id'],
                            $dateKey,
                            str_replace(':', '', $reminderTime),
                        ),
                        'taskId' => (string) $row['id'],
                        'scheduledDate' => $dateKey,
                    ], JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
                    $report = $webPush->sendOneNotification(
                        Subscription::create([
                            'endpoint' => (string) $row['endpoint'],
                            'publicKey' => (string) $row['public_key'],
                            'authToken' => (string) $row['auth_token'],
                            'contentEncoding' => (string) $row['content_encoding'],
                        ]),
                        $payload,
                        ['topic' => substr(hash('sha256', (string) $row['id']), 0, 32)],
                    );
                    if ($report->isSuccess()) {
                        $this->markDeliverySent($row, $dateKey, $reminderTime, $now);
                        $result['sent']++;
                    } elseif ($report->isSubscriptionExpired()) {
                        $this->deleteSubscription((string) $row['subscription_id']);
                        $result['expired']++;
                    } else {
                        $this->releaseDelivery($row, $dateKey, $reminderTime);
                        $result['failed']++;
                        error_log('[backontrack-web-push] Delivery failed: ' . $report->getReason());
                    }
                } catch (Throwable $exception) {
                    $this->releaseDelivery($row, $dateKey, $reminderTime);
                    $result['failed']++;
                    error_log('[backontrack-web-push] Delivery failed: ' . $exception->getMessage());
                }
            }
        }

        $cleanupBefore = $now->modify('-45 days')->format('Y-m-d');
        $cleanup = $this->database->pdo->prepare(
            'DELETE FROM task_web_push_deliveries WHERE scheduled_date < :before',
        );
        $cleanup->execute(['before' => $cleanupBefore]);
        return $result;
    }

    private function taskIsIncompleteOnDate(array $task, string $dateKey): bool
    {
        if ((string) $task['type'] !== 'program') {
            if (!$this->taskScheduledOnDate($task, $dateKey)) return false;
            $statement = $this->database->pdo->prepare(
                "SELECT status FROM occurrences
                 WHERE owner = :owner AND task = :task AND program_step = ''
                   AND scheduled_date = :scheduled_date
                 LIMIT 1",
            );
            $statement->execute([
                'owner' => $task['owner'],
                'task' => $task['id'],
                'scheduled_date' => $dateKey,
            ]);
            return $statement->fetchColumn() !== 'completed';
        }

        $steps = $this->database->pdo->prepare(
            "SELECT * FROM program_steps
             WHERE owner = :owner AND task = :task AND active = TRUE
               AND completion_type != 'day_off'",
        );
        $steps->execute(['owner' => $task['owner'], 'task' => $task['id']]);
        $scheduledSteps = array_values(array_filter(
            $steps->fetchAll(),
            fn (mixed $step): bool => is_array($step)
                && $this->programStepScheduledOnDate($task, $step, $dateKey),
        ));
        if ($scheduledSteps === []) return false;

        $status = $this->database->pdo->prepare(
            'SELECT status FROM occurrences
             WHERE owner = :owner AND task = :task AND program_step = :program_step
               AND scheduled_date = :scheduled_date
             LIMIT 1',
        );
        foreach ($scheduledSteps as $step) {
            $status->execute([
                'owner' => $task['owner'],
                'task' => $task['id'],
                'program_step' => $step['id'],
                'scheduled_date' => $dateKey,
            ]);
            if ($status->fetchColumn() !== 'completed') return true;
        }
        return false;
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
        if ($elapsed < 0 || (!(bool) $task['program_repeat'] && $elapsed >= $cycleLength)) {
            return false;
        }
        $cycleDay = ($elapsed % $cycleLength) + 1;
        return in_array($cycleDay, array_map('intval', $this->decodeList($step['cycle_days'] ?? '[]')), true);
    }

    private function taskScheduledOnDate(array $task, string $dateKey): bool
    {
        $startDate = (string) ($task['start_date'] ?? '');
        $endDate = (string) ($task['end_date'] ?? '');
        if ($startDate === '' || $dateKey < $startDate || ($endDate !== '' && $dateKey > $endDate)) {
            return false;
        }
        $recurrence = (string) ($task['recurrence_type'] ?? '');
        if ($recurrence === 'daily') return true;

        $date = new DateTimeImmutable($dateKey . 'T12:00:00');
        $weekdays = array_map('intval', $this->decodeList($task['weekdays'] ?? '[]'));
        if (!in_array((int) $date->format('w'), $weekdays, true)) return false;
        if ($recurrence === 'weekdays') return true;
        if ($recurrence !== 'interval_weeks') return false;

        $start = new DateTimeImmutable($startDate . 'T12:00:00');
        $days = (int) $start->modify('monday this week')
            ->diff($date->modify('monday this week'))
            ->format('%r%a');
        $weeks = intdiv($days, 7);
        return $weeks >= 0 && $weeks % max(1, (int) $task['interval_weeks']) === 0;
    }

    /** @return list<mixed> */
    private function decodeList(mixed $value): array
    {
        if (is_string($value)) {
            $value = json_decode($value, true);
        }
        if (!is_array($value) || !array_is_list($value)) return [];
        return array_values($value);
    }

    private function reserveDelivery(
        array $row,
        string $dateKey,
        string $reminderTime,
        DateTimeImmutable $now,
    ): bool {
        $statement = $this->database->pdo->prepare(
            'INSERT OR IGNORE INTO task_web_push_deliveries (
                subscription_id, task_id, scheduled_date, reminder_time, reserved_at, sent_at
             ) VALUES (
                :subscription_id, :task_id, :scheduled_date, :reminder_time, :reserved_at, \'\'
             )',
        );
        $statement->execute([
            'subscription_id' => $row['subscription_id'],
            'task_id' => $row['id'],
            'scheduled_date' => $dateKey,
            'reminder_time' => $reminderTime,
            'reserved_at' => $this->utcTimestamp($now),
        ]);
        return $statement->rowCount() === 1;
    }

    private function markDeliverySent(
        array $row,
        string $dateKey,
        string $reminderTime,
        DateTimeImmutable $now,
    ): void {
        $statement = $this->database->pdo->prepare(
            'UPDATE task_web_push_deliveries SET sent_at = :sent_at
             WHERE subscription_id = :subscription_id AND task_id = :task_id
               AND scheduled_date = :scheduled_date AND reminder_time = :reminder_time',
        );
        $statement->execute([
            'sent_at' => $this->utcTimestamp($now),
            'subscription_id' => $row['subscription_id'],
            'task_id' => $row['id'],
            'scheduled_date' => $dateKey,
            'reminder_time' => $reminderTime,
        ]);
    }

    private function releaseDelivery(array $row, string $dateKey, string $reminderTime): void
    {
        $statement = $this->database->pdo->prepare(
            'DELETE FROM task_web_push_deliveries
             WHERE subscription_id = :subscription_id AND task_id = :task_id
               AND scheduled_date = :scheduled_date AND reminder_time = :reminder_time',
        );
        $statement->execute([
            'subscription_id' => $row['subscription_id'],
            'task_id' => $row['id'],
            'scheduled_date' => $dateKey,
            'reminder_time' => $reminderTime,
        ]);
    }

    private function deleteSubscription(string $subscriptionId): void
    {
        $statement = $this->database->pdo->prepare(
            'DELETE FROM web_push_subscriptions WHERE id = :id',
        );
        $statement->execute(['id' => $subscriptionId]);
    }

    private function utcTimestamp(DateTimeImmutable $date): string
    {
        return $date->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s.v\Z');
    }
}
