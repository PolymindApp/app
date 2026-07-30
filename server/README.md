# Mom PHP API

This is a PHP 8.1 JSON API for the Mom SQLite database. `public/index.php` is the front controller; PHP code, data, and local configuration remain outside the web root.

## PHP extensions

Install the locked WebAuthn dependency, then verify the host:

```bash
composer install --no-dev --optimize-autoloader
php -r 'var_export([
    "php" => PHP_VERSION,
    "pdo_sqlite" => extension_loaded("pdo_sqlite"),
    "openssl" => extension_loaded("openssl"),
]); echo PHP_EOL;'
```

PDO_SQLITE and OpenSSL must be enabled. If the host has no Composer executable, run Composer locally and upload the generated root `vendor` directory with `server`.

## Configuration

Configuration may be supplied through the root `.env`, process environment variables, or an ignored `server/config.local.php` copied from `config.example.php`. Precedence is process environment, local PHP configuration, root `.env`, then defaults.

| Setting | Purpose | Default |
| --- | --- | --- |
| `MOM_DB_PATH` | Absolute path to `data.db` | Local `private/data.db` |
| `MOM_API_SECRET` | HMAC signing secret, at least 32 characters | Required in production |
| `MOM_ALLOWED_ORIGINS` | Comma-separated exact browser/Capacitor origins | Same-origin only |
| `MOM_TOKEN_TTL` | Token lifetime in seconds, 5 minutes–30 days | 604800 |
| `MOM_MAX_BODY_BYTES` | Maximum JSON request size | 2500000 |
| `MOM_PASSKEY_RP_ID` | Android passkey relying-party domain | Disabled |
| `MOM_PASSKEY_ANDROID_PACKAGE` | Trusted Android application ID | Disabled |
| `MOM_PASSKEY_ANDROID_KEY_HASHES` | Comma-separated base64url SHA-256 signing-certificate hashes | Disabled |

Generate a production secret:

```bash
php -r 'echo bin2hex(random_bytes(32)), PHP_EOL;'
```

Never commit the generated secret.

Only `VITE_API_URL` is exposed to the browser build. Variables beginning with `MOM_` remain PHP-only.

For a native Android client, the allowed origins normally include `http://localhost`. For iOS Capacitor, include `capacitor://localhost`. Include the exact HTTPS origin of every browser client.

## Database placement

1. Keep `data.db` in a directory outside the public web root. The repository default is `private/data.db`.
2. Give the PHP/web-server user read and write access to both the database file and its directory. SQLite needs directory access for WAL and shared-memory files.
3. Set `MOM_DB_PATH` when the production path differs from the default.
4. Make a verified backup before schema or application upgrades.

On a single-user hosting account, restrictive local permissions can be applied with:

```bash
chmod 700 private
chmod 600 private/data.db
```

For a new installation, create the database with:

```bash
sqlite3 private/data.db < server/schema.sql
```

On startup, the API checks for the expected Mom tables and creates its rate-limit, passkey-credential, and one-time-challenge support tables when necessary.

## Apache/shared hosting

For the prepared shared-hosting layout, upload the `server` directory at `/server` and the Composer-generated `vendor` directory beside it. Its included `.htaccess` routes requests through the root `index.php`, preserves the bearer authorization header, disables directory listing, and prevents direct access to implementation files. The public API remains `https://mom.coulombe.dev/server`; `/public` is not part of the URL.

When the provider supports aliases or custom document roots, pointing `/server` directly at `server/public` remains the preferred alternative.

If the host cannot change the document root, copy `server/public` into the public `/api` directory and place `server/src` plus `config.local.php` in a private sibling directory. Adjust the `require` paths in `public/index.php` only if that layout changes.

Check:

```bash
curl https://example.com/api/health
```

Expected response:

```json
{"status":"ok"}
```

## Nginx/PHP-FPM

A minimal location when the API is mounted at `/api`:

```nginx
location /api/ {
    try_files $uri $uri/ /api/index.php?$query_string;
}

location = /api/index.php {
    include fastcgi_params;
    fastcgi_param SCRIPT_FILENAME /private/app/server/public/index.php;
    fastcgi_param HTTP_AUTHORIZATION $http_authorization;
    fastcgi_pass unix:/run/php/php-fpm.sock;
}
```

Use the PHP-FPM socket configured by the host.

## Security behavior

- HS256 bearer tokens are signed with `MOM_API_SECRET`, expire automatically, and are bound to each user’s `token_key`.
- Passwords use PHP’s password hashing API and are rehashed after a successful login when PHP recommends it.
- Authentication attempts are throttled by IP and normalized email.
- CORS uses an exact allowlist and never returns a wildcard origin.
- SQL table names, columns, filters, and sorts come from server-side allowlists.
- All values are bound parameters.
- Unknown fields and invalid JSON, enums, dates, relations, and oversized bodies are rejected.
- Cross-user records return `404`, preventing both access and record-ID disclosure.
- Cascade behavior needed by task, occurrence, program-step, tag, and interval-template deletion is implemented transactionally.
- Android passkey challenges are random, expire after five minutes, and are consumed once.
- Passkey registration and login require the configured Android package and signing-certificate origin, RP-ID hash, user-presence/user-verification flags, and a valid authenticator signature.

## Android passkey deployment

The three `MOM_PASSKEY_*` settings must either all be configured or all be empty. `MOM_PASSKEY_RP_ID` is the domain that serves the app’s Digital Asset Link, without a scheme or path. The signing hashes use unpadded base64url SHA-256; they are intentionally a different representation from the colon-separated hexadecimal fingerprints in `assetlinks.json`.

The client publishes `public/.well-known/assetlinks.json` into the web build. After deployment, verify:

```bash
curl -i https://mom.coulombe.dev/.well-known/assetlinks.json
```

The response must be HTTPS status `200`, must not redirect, and should use `Content-Type: application/json`. The production configuration currently trusts the project’s release certificate and this workstation’s debug certificate so both APK variants can enroll and use passkeys. Remove the debug fingerprint from both configuration locations if production should accept release builds only.

Serve the API only over HTTPS. The client stores its bearer token in local storage, so a restrictive Content Security Policy for the web application is also recommended.

## Backups

Back up the database with SQLite’s online backup operation instead of copying only `data.db` while the API is active:

```bash
sqlite3 /private/path/data.db ".backup /private/backups/mom-$(date +%F).db"
```

Store backups outside the hosting account and periodically test a restore.
