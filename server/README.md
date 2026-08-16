# BackOnTrack PHP API

This is a PHP 8.1 JSON API for the BackOnTrack SQLite database. `public/index.php` is the front controller; PHP code, data, and local configuration remain outside the web root.

## PHP extensions

Install the locked WebAuthn dependency, then verify the host:

```bash
composer install --no-dev --optimize-autoloader
php -r 'var_export([
    "php" => PHP_VERSION,
    "curl" => extension_loaded("curl"),
    "gd" => extension_loaded("gd"),
    "pdo_sqlite" => extension_loaded("pdo_sqlite"),
    "openssl" => extension_loaded("openssl"),
]); echo PHP_EOL;'
```

cURL, GD, PDO_SQLITE, OpenSSL, and SQLite FTS5 must be enabled. If the host has no Composer executable, run Composer locally and upload the generated root `vendor` directory with `server`. The seed-builder command additionally requires PHP's Zip extension.

## Configuration

Configuration may be supplied through the root `.env`, process environment variables, or an ignored `server/config.local.php` copied from `config.example.php`. Precedence is process environment, local PHP configuration, root `.env`, then defaults.

| Setting | Purpose | Default |
| --- | --- | --- |
| `BACKONTRACK_DB_PATH` | Absolute path to `data.db` | Local `private/data.db` |
| `BACKONTRACK_BACKUP_DIR` | Cleanup backup directory, preferably outside live database storage | `backups/` beside `private/` |
| `BACKONTRACK_BACKUP_KEEP` | Number of generated cleanup backups to retain | `3` |
| `BACKONTRACK_API_SECRET` | HMAC signing secret, at least 32 characters | Required in production |
| `BACKONTRACK_MIGRATION_KEY` | Dedicated key for authenticated HTTP migrations, at least 32 characters | HTTP migration disabled |
| `BACKONTRACK_ALLOWED_ORIGINS` | Comma-separated exact browser/Capacitor origins | Same-origin only |
| `BACKONTRACK_TOKEN_TTL` | Token lifetime in seconds, 5 minutes–30 days | 604800 |
| `BACKONTRACK_MAX_BODY_BYTES` | Maximum JSON request size | 2500000 |
| `BACKONTRACK_APP_URL` | Public browser URL used in account email links | Required for account email |
| `BACKONTRACK_MAIL_HOST` | SMTP host used by PHPMailer | Required for account email |
| `BACKONTRACK_MAIL_PORT` | SMTP port | 587 |
| `BACKONTRACK_MAIL_USERNAME` | SMTP username; configure with the password | No authentication |
| `BACKONTRACK_MAIL_PASSWORD` | SMTP password; configure with the username | No authentication |
| `BACKONTRACK_MAIL_ENCRYPTION` | `tls`, `ssl`, or `none` for trusted local development | `tls` |
| `BACKONTRACK_MAIL_FROM_ADDRESS` | Sender email address | Required for account email |
| `BACKONTRACK_MAIL_FROM_NAME` | Sender display name | BackOnTrack |
| `BACKONTRACK_PASSKEY_RP_ID` | Android passkey relying-party domain | Disabled |
| `BACKONTRACK_PASSKEY_ANDROID_PACKAGE` | Trusted Android application ID | Disabled |
| `BACKONTRACK_PASSKEY_ANDROID_KEY_HASHES` | Comma-separated base64url SHA-256 signing-certificate hashes | Disabled |

Generate a production secret:

```bash
php -r 'echo bin2hex(random_bytes(32)), PHP_EOL;'
```

Generate separate values for `BACKONTRACK_API_SECRET` and `BACKONTRACK_MIGRATION_KEY`. Never commit either secret.

Only `VITE_API_URL` is exposed to the browser build. Variables beginning with `BACKONTRACK_` remain PHP-only.

For a native Android client, the allowed origins normally include `http://localhost`. For iOS Capacitor, include `capacitor://localhost`. Include the exact HTTPS origin of every browser client.

Registration and password recovery require SMTP delivery. `BACKONTRACK_APP_URL` must point to the deployed browser application rather than the API, so confirmation links open `/verify-email` and reset links open `/reset-password`. Use authenticated TLS in production. `none` is intended only for a trusted loopback development SMTP server.

## Database placement

1. Keep `data.db` in a directory outside the public web root. The repository default is `private/data.db`.
2. Give the PHP/web-server user read and write access to both the database file and its directory. SQLite needs directory access for WAL and shared-memory files.
3. Set `BACKONTRACK_DB_PATH` when the production path differs from the default.
4. Make a verified backup before schema or application upgrades.

On a single-user hosting account, restrictive local permissions can be applied with:

```bash
chmod 700 private
chmod 600 private/data.db
```

For a new installation, create the database with:

```bash
sqlite3 private/data.db 'VACUUM;'
php server/migrate.php
```

## Database migrations

The API applies pending migrations automatically before handling a request. For deployments, run them explicitly after uploading the new server code and before directing traffic to it:

```bash
php server/migrate.php
```

On a host without CLI access, configure a dedicated `BACKONTRACK_MIGRATION_KEY` and invoke the same runner over HTTPS:

```bash
curl --fail-with-body \
  --header "X-BackOnTrack-Migration-Key: $BACKONTRACK_MIGRATION_KEY" \
  https://example.com/server/migrate.php
```

The HTTP endpoint accepts only `GET`, is disabled when the key is missing or shorter than 32 characters, uses a constant-time comparison, and never returns internal exception details. Send the key in the header rather than the URL so it is not stored in normal URL or query-string logs.

Applied versions are stored in `backontrack_schema_migrations` with the migration filename checksum and application time. All pending migrations run inside one SQLite `BEGIN IMMEDIATE` transaction, so concurrent PHP requests cannot apply the same migration and a failed batch is rolled back.

The reconstructed PHP-era history is:

| Version | Change |
| --- | --- |
| `202607290001` | Baseline schema used when the standalone PHP server replaced the previous backend |
| `202607290002` | API rate-limit storage |
| `202607290003` | Android passkey credentials and one-time challenges |
| `202608070006` | Live Review set sharing, recipient preferences, reviewer-specific card statistics, and source-owner session attribution |
| `202608080001` | Privacy-preserving Review set invitations for registered and future email addresses |
| `202608080003` | Review set note-before-answer display preference |
| `202608090001` | Offline synchronization versions, change log, idempotency receipts, client cursors, and per-device active sessions |
| `202608100001` | Hashed email-confirmation and password-reset tokens; existing accounts are grandfathered as verified |
| `202608140001` | Optional front- and back-face flashcard audio recordings |
| `202608140002` | Removal of the retired stock-image library and attribution fields |
| `202608160003` | Bounded sync receipts, client-confirmed receipt watermarks, and change-log retention cursors |

Existing PHP databases are advanced without recreating application data. The schema is validated after migration, including required columns.

Migration files in `server/migrations` are immutable after deployment. Any later schema or data change must be a new file named with the next 12-digit version and a descriptive suffix. Editing or removing an applied migration causes startup to fail instead of silently accepting schema drift. A fully reversed historical migration pair may be retired only by recording its exact version, name hash, and file checksum in `MigrationRunner`; new databases then skip the pair while existing histories remain verifiable.

## Offline synchronization

Authenticated clients initialize their local database with `POST /sync/bootstrap`, then use `POST /sync/exchange` for both queued operations and cursor-based pulls. An exchange accepts at most 100 ordered operations and returns at most 500 coalesced changes. Operation receipts make retries safe across browser service workers, native background execution, request timeouts, and foreground recovery.

Sync protocol v2 bounds that bookkeeping. The client persists `receiptWatermark` in the same IndexedDB transaction that reconciles acknowledgements, then sends it back as `confirmedReceiptSequence`; the server removes those confirmed receipts. Stored duplicate responses contain only the operation outcome rather than full resource snapshots. Pending, undispatched patches to the same record are coalesced locally. Change-log rows acknowledged by every client active in the last 30 days are removed, and a client behind the retained cursor receives `resetRequired` so it can bootstrap without losing its local outbox. Unconfirmed receipts also expire after 30 days as an abandoned-client fallback.

Owned collection records carry server revisions and per-field hybrid logical clocks. The exchange applies last-writer-wins only to fields changed by both clients; deletes are terminal for the same record ID. Flashcard review events remain additive and update reviewer statistics exactly once. Unique tag names and task occurrences return replacement IDs so clients can rewrite queued relationships rather than dropping work. Review-set access, shared-card projections, preferences, shares, account settings, avatars, and compressed card images use the same exchange contract.

The initial bootstrap is the only network-dependent preparation step. After it completes, token expiry does not remove the cached account. The client must reauthenticate before it can exchange again, and sign-out should flush before erasing local account data.

Recommended deployment order:

1. Create and verify an online SQLite backup.
2. Upload the new `server`, `vendor`, and migration files.
3. Confirm `.env` points to the intended database.
4. Run `php server/migrate.php`, or call its authenticated HTTPS endpoint.
5. Verify `/health`, then deploy or enable the client.

The release workflow calls the authenticated endpoint after its upload job succeeds. Configure the same `BACKONTRACK_MIGRATION_KEY` value in the host's root `.env` and the GitHub `Web` environment secret. `MIGRATION_URL` may be set as a `Web` environment variable when the default deployment URL is not appropriate. The first ordinary API request also applies pending migrations as a fallback. Keep the backup: migrations are forward-only and do not perform automatic rollbacks after a successful deployment.

## Flashcard face recordings

Each flashcard face can store one optional WebM or MP4 recording of up to 60 seconds and 1.5 MB. Recordings are kept in `flashcard-audio` beside the configured database and are included in Review set and interval snapshots. When read-aloud is enabled, a face recording plays in place of synthesized speech, including native Android background playback; text-to-speech remains the fallback when a recording cannot be played.

Owners use `/flashcards/{id}/audio/{front|back}` to add or remove recordings. Review set editors use the equivalent set-scoped card route. Stored audio is served from `/flashcard-audio/{filename}` with immutable caching.

## Review set sharing

`GET /flashcard-review-sets` returns the authenticated account’s owned sets and sets shared with it. Each record includes its `access_role`, owner display metadata, resolved tag names, current matching-card count, and that account’s effective review settings.

Owners manage access through `/flashcard-review-sets/{id}/shares` and `/flashcard-review-set-shares/{shareId}`. Shares accept any valid email address and a `readonly` or `editor` role. Create, list, and update responses expose only the invited email and role—not account profile data or registration state. An invitation for an unregistered address is claimed automatically on that account’s first authenticated request after registration. Read-only recipients may review and list cards. Editors may also use the set-scoped card and image-upload endpoints to mutate the owner’s matching source cards, but cannot change card tags, set identity, tag filters, or sharing. New editor-created cards receive the set’s current tags automatically.

Review preferences and card statistics are keyed by account, so one recipient’s timing, speech, sorting, success, and error history do not alter another account’s experience. Sessions retain both the reviewer and source owner. Recipients may attach accessible sets to their tasks, program steps, and interval templates. Removing a share detaches those references transactionally while keeping immutable review events and session snapshots.

`POST /flashcard-review-sets/{id}/copies` creates a recipient-owned set and copies every card currently matching the shared filter. Copied cards, tags, settings, and non-library image files are independent; the original live share remains in place.

## Apache/shared hosting

For the prepared shared-hosting layout, upload the `server` directory at `/server` and the Composer-generated `vendor` directory beside it. Its included `.htaccess` routes requests through the root `index.php`, preserves the bearer authorization header, disables directory listing, and prevents direct access to implementation files except for the authenticated migration endpoint. The public API remains `https://backontrack.app/server`; `/public` is not part of the URL.

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

- HS256 bearer tokens are signed with `BACKONTRACK_API_SECRET`, expire automatically, and are bound to each user’s `token_key`.
- Passwords use PHP’s password hashing API and are rehashed after a successful login when PHP recommends it.
- New password accounts cannot sign in until their emailed address is confirmed.
- Email confirmation and password reset tokens are stored only as HMAC hashes, expire after 24 hours and 1 hour respectively, and are consumed once.
- A password reset rotates the account token key to revoke existing bearer sessions.
- Authentication attempts are throttled by IP and normalized email.
- CORS uses an exact allowlist and never returns a wildcard origin.
- SQL table names, columns, filters, and sorts come from server-side allowlists.
- All values are bound parameters.
- Unknown fields and invalid JSON, enums, dates, relations, and oversized bodies are rejected.
- Cross-user records return `404`, preventing both access and record-ID disclosure.
- Avatars are cropped and compressed in the client, validated again by PHP, stored under the private data directory with random filenames, and served through immutable unguessable URLs.
- Cascade behavior needed by task, occurrence, program-step, tag, and interval-template deletion is implemented transactionally.
- Android passkey challenges are random, expire after five minutes, and are consumed once.
- Passkey registration and login require the configured Android package and signing-certificate origin, RP-ID hash, user-presence/user-verification flags, and a valid authenticator signature.
- Disconnecting biometric sign-in deletes every registered credential for the authenticated account and invalidates its pending registration challenges.

## Android passkey deployment

The three `BACKONTRACK_PASSKEY_*` settings must either all be configured or all be empty. `BACKONTRACK_PASSKEY_RP_ID` is the domain that serves the app’s Digital Asset Link, without a scheme or path. The signing hashes use unpadded base64url SHA-256; they are intentionally a different representation from the colon-separated hexadecimal fingerprints in `assetlinks.json`.

The client publishes `public/.well-known/assetlinks.json` into the web build. After deployment, verify:

```bash
curl -i https://backontrack.app/.well-known/assetlinks.json
```

The response must be HTTPS status `200`, must not redirect, and should use `Content-Type: application/json`. The production configuration currently trusts the project’s release certificate and this workstation’s debug certificate so both APK variants can enroll and use passkeys. Remove the debug fingerprint from both configuration locations if production should accept release builds only.

Serve the API only over HTTPS. The client stores its bearer token in local storage, so a restrictive Content Security Policy for the web application is also recommended.

## Backups

Back up the database with SQLite’s online backup operation instead of copying only `data.db` while the API is active:

```bash
sqlite3 /private/path/data.db ".backup /private/backups/backontrack-$(date +%F).db"
```

Store backups outside the hosting account and periodically test a restore.

`pnpm db:cleanup -- --apply` now writes generated backups outside `private/`, to `BACKONTRACK_BACKUP_DIR` (or `backups/` by default), moves legacy `data.db.backup-*` files out of the database directory, and retains the newest three. Configure `BACKONTRACK_BACKUP_KEEP` or pass `--keep-backups`. Passing an explicit `--backup` path disables automatic movement and rotation for that run.
