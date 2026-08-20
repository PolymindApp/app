<?php

declare(strict_types=1);

use Minishlink\WebPush\VAPID;

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require dirname(__DIR__) . '/vendor/autoload.php';

$keys = VAPID::createVapidKeys();
fwrite(STDOUT, 'BACKONTRACK_WEB_PUSH_VAPID_PUBLIC_KEY=' . $keys['publicKey'] . PHP_EOL);
fwrite(STDOUT, 'BACKONTRACK_WEB_PUSH_VAPID_PRIVATE_KEY=' . $keys['privateKey'] . PHP_EOL);
