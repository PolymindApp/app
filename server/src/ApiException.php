<?php

declare(strict_types=1);

namespace Mom\Api;

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
}
