<?php

declare(strict_types=1);

return [
    'POLYMIND_DB_PATH' => '/absolute/private/path/to/data.db',
    'POLYMIND_API_SECRET' => 'CHANGE_ME',
    'POLYMIND_MIGRATION_KEY' => 'CHANGE_ME',
    'POLYMIND_ALLOWED_ORIGINS' => 'https://polymind.example.com,capacitor://localhost,http://localhost',
    'POLYMIND_TOKEN_TTL' => 604800,
    'POLYMIND_MAX_BODY_BYTES' => 2500000,
    'POLYMIND_APP_URL' => 'https://polymind.example.com',
    'POLYMIND_MAIL_HOST' => 'smtp.example.com',
    'POLYMIND_MAIL_PORT' => 587,
    'POLYMIND_MAIL_USERNAME' => 'smtp-user',
    'POLYMIND_MAIL_PASSWORD' => 'CHANGE_ME',
    'POLYMIND_MAIL_ENCRYPTION' => 'tls',
    'POLYMIND_MAIL_FROM_ADDRESS' => 'polymind@example.com',
    'POLYMIND_MAIL_FROM_NAME' => 'Polymind',
    'POLYMIND_PEXELS_API_KEY' => 'CHANGE_ME',
    'POLYMIND_PASSKEY_RP_ID' => 'polymind.example.com',
    'POLYMIND_PASSKEY_ANDROID_PACKAGE' => 'app.polymind.android',
    'POLYMIND_PASSKEY_ANDROID_KEY_HASHES' => 'BASE64URL_SHA256_OF_ANDROID_SIGNING_CERTIFICATE',
];
