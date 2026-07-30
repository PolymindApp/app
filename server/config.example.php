<?php

declare(strict_types=1);

return [
    'MOM_DB_PATH' => '/absolute/private/path/to/data.db',
    'MOM_API_SECRET' => 'CHANGE_ME',
    'MOM_ALLOWED_ORIGINS' => 'https://mom.example.com,capacitor://localhost,http://localhost',
    'MOM_TOKEN_TTL' => 604800,
    'MOM_MAX_BODY_BYTES' => 2500000,
    'MOM_PASSKEY_RP_ID' => 'mom.example.com',
    'MOM_PASSKEY_ANDROID_PACKAGE' => 'dev.example.mom',
    'MOM_PASSKEY_ANDROID_KEY_HASHES' => 'BASE64URL_SHA256_OF_ANDROID_SIGNING_CERTIFICATE',
];
