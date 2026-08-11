<?php

declare(strict_types=1);

return [
    'MOM_DB_PATH' => '/absolute/private/path/to/data.db',
    'MOM_API_SECRET' => 'CHANGE_ME',
    'MOM_MIGRATION_KEY' => 'CHANGE_ME',
    'MOM_ALLOWED_ORIGINS' => 'https://mom.example.com,capacitor://localhost,http://localhost',
    'MOM_TOKEN_TTL' => 604800,
    'MOM_MAX_BODY_BYTES' => 2500000,
    'MOM_APP_URL' => 'https://mom.example.com',
    'MOM_MAIL_HOST' => 'smtp.example.com',
    'MOM_MAIL_PORT' => 587,
    'MOM_MAIL_USERNAME' => 'smtp-user',
    'MOM_MAIL_PASSWORD' => 'CHANGE_ME',
    'MOM_MAIL_ENCRYPTION' => 'tls',
    'MOM_MAIL_FROM_ADDRESS' => 'polymind@example.com',
    'MOM_MAIL_FROM_NAME' => 'Polymind',
    'MOM_PEXELS_API_KEY' => 'CHANGE_ME',
    'MOM_PASSKEY_RP_ID' => 'mom.example.com',
    'MOM_PASSKEY_ANDROID_PACKAGE' => 'dev.example.mom',
    'MOM_PASSKEY_ANDROID_KEY_HASHES' => 'BASE64URL_SHA256_OF_ANDROID_SIGNING_CERTIFICATE',
];
