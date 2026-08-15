<?php

declare(strict_types=1);

namespace BackOnTrack\Api;

use RuntimeException;
use Throwable;

final class ApiException extends RuntimeException
{
    public function __construct(
        public readonly int $status,
        string $message,
        public readonly array $details = [],
        ?Throwable $previous = null,
    ) {
        parent::__construct($message, 0, $previous);
    }

    public static function debugPayload(Throwable $exception): array
    {
        $payload = [
            'type' => $exception::class,
            'message' => $exception->getMessage(),
            'file' => $exception->getFile(),
            'line' => $exception->getLine(),
            'trace' => $exception->getTraceAsString(),
        ];

        $previous = $exception->getPrevious();
        if ($previous !== null) {
            $payload['previous'] = self::debugPayload($previous);
        }

        return $payload;
    }
}
