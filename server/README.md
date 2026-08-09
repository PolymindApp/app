# Polymind PHP API

This is a PHP 8.1 JSON API for the Polymind SQLite database. `public/index.php` is the front controller; PHP code, data, and local configuration remain outside the web root.

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
| `MOM_DB_PATH` | Absolute path to `data.db` | Local `private/data.db` |
| `MOM_API_SECRET` | HMAC signing secret, at least 32 characters | Required in production |
| `MOM_MIGRATION_KEY` | Dedicated key for authenticated HTTP migrations, at least 32 characters | HTTP migration disabled |
| `MOM_ALLOWED_ORIGINS` | Comma-separated exact browser/Capacitor origins | Same-origin only |
| `MOM_TOKEN_TTL` | Token lifetime in seconds, 5 minutes–30 days | 604800 |
| `MOM_MAX_BODY_BYTES` | Maximum JSON request size | 2500000 |
| `MOM_PEXELS_API_KEY` | Server-side Pexels API key used by batch and on-demand cache fills | Disabled |
| `MOM_CODEX_BRIDGE_URL` | HTTPS URL of the separately hosted Codex bridge | Disabled |
| `MOM_CODEX_BRIDGE_TOKEN` | Shared bridge bearer token, at least 32 characters | Disabled |
| `MOM_PASSKEY_RP_ID` | Android passkey relying-party domain | Disabled |
| `MOM_PASSKEY_ANDROID_PACKAGE` | Trusted Android application ID | Disabled |
| `MOM_PASSKEY_ANDROID_KEY_HASHES` | Comma-separated base64url SHA-256 signing-certificate hashes | Disabled |

Generate a production secret:

```bash
php -r 'echo bin2hex(random_bytes(32)), PHP_EOL;'
```

Generate separate values for `MOM_API_SECRET` and `MOM_MIGRATION_KEY`. Never commit either secret.

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
sqlite3 private/data.db 'VACUUM;'
php server/migrate.php
```

## Database migrations

The API applies pending migrations automatically before handling a request. For deployments, run them explicitly after uploading the new server code and before directing traffic to it:

```bash
php server/migrate.php
```

On a host without CLI access, configure a dedicated `MOM_MIGRATION_KEY` and invoke the same runner over HTTPS:

```bash
curl --fail-with-body \
  --header "X-Mom-Migration-Key: $MOM_MIGRATION_KEY" \
  https://example.com/server/migrate.php
```

The HTTP endpoint accepts only `GET`, is disabled when the key is missing or shorter than 32 characters, uses a constant-time comparison, and never returns internal exception details. Send the key in the header rather than the URL so it is not stored in normal URL or query-string logs.

Applied versions are stored in `mom_schema_migrations` with the migration filename checksum and application time. All pending migrations run inside one SQLite `BEGIN IMMEDIATE` transaction, so concurrent PHP requests cannot apply the same migration and a failed batch is rolled back.

The reconstructed PHP-era history is:

| Version | Change |
| --- | --- |
| `202607290001` | Baseline schema used when the standalone PHP server replaced the previous backend |
| `202607290002` | API rate-limit storage |
| `202607290003` | Android passkey credentials and one-time challenges |
| `202608070005` | Multilingual image concepts, full-text search, Pexels cache metadata, and flashcard library image attribution |
| `202608070006` | Live Review set sharing, recipient preferences, reviewer-specific card statistics, and source-owner session attribution |
| `202608080001` | Privacy-preserving Review set invitations for registered and future email addresses |
| `202608080002` | Legacy encrypted per-user OpenAI API connections |
| `202608080003` | Review set note-before-answer display preference |
| `202608080004` | Remove legacy API keys in favor of hosted ChatGPT authentication |
| `202608090001` | Offline synchronization versions, change log, idempotency receipts, client cursors, and per-device active sessions |

Existing PHP databases are advanced without recreating application data. Migration `202608080004` is the explicit exception for deletion: it removes credentials from the superseded API-key connection. The schema is validated after migration, including required columns.

Migration files in `server/migrations` are immutable after deployment. Any later schema or data change must be a new file named with the next 12-digit version and a descriptive suffix. Editing or removing an applied migration causes startup to fail instead of silently accepting schema drift.

## Offline synchronization

Authenticated clients initialize their local database with `POST /sync/bootstrap`, then use `POST /sync/exchange` for both queued operations and cursor-based pulls. An exchange accepts at most 100 ordered operations and returns at most 500 coalesced changes. Operation receipts make retries safe across browser service workers, native background execution, request timeouts, and foreground recovery.

Owned collection records carry server revisions and per-field hybrid logical clocks. The exchange applies last-writer-wins only to fields changed by both clients; deletes are terminal for the same record ID. Flashcard review events remain additive and update reviewer statistics exactly once. Unique tag names and task occurrences return replacement IDs so clients can rewrite queued relationships rather than dropping work. Review-set access, shared-card projections, preferences, shares, account settings, avatars, and compressed card images use the same exchange contract.

The initial bootstrap is the only network-dependent preparation step. After it completes, token expiry does not remove the cached account. The client must reauthenticate before it can exchange again, and sign-out should flush before erasing local account data.

Recommended deployment order:

1. Create and verify an online SQLite backup.
2. Upload the new `server`, `vendor`, and migration files.
3. Confirm `.env` points to the intended database.
4. Run `php server/migrate.php`, or call its authenticated HTTPS endpoint.
5. Verify `/health`, then deploy or enable the client.

The release workflow calls the authenticated endpoint after its upload job succeeds. Configure the same `MOM_MIGRATION_KEY` value in the host's root `.env` and the GitHub `Web` environment secret. `MIGRATION_URL` may be set as a `Web` environment variable when the default deployment URL is not appropriate. The first ordinary API request also applies pending migrations as a fallback. Keep the backup: migrations are forward-only and do not perform automatic rollbacks after a successful deployment.

## Flashcard image library

The committed seed contains more than 5,000 common WordNet concepts and localized Open Multilingual WordNet terms. Each source and its data license are recorded in `image_sources`. Load or refresh it after migrations:

```bash
php scripts/seed-image-concepts.php
```

The seed is idempotent. Existing Pexels results remain flagged as searched unless a concept's English search query changes. To rebuild the committed artifact from the upstream WordNet and OMW archives, run `php scripts/build-image-concept-seed.php`; this development-only command downloads its sources and requires cURL and Zip.

Create a Pexels API key and set `MOM_PEXELS_API_KEY` in the server environment. Local API runs also use that one value from the root `.env.prod` when it is absent from the environment, local server configuration, and `.env`; other production settings are not imported. Fill the cache in bounded batches:

```bash
php scripts/fetch-pexels-images.php --limit=100
```

The limit is the maximum number of unsearched concepts processed in that run; `--limit=0` processes every pending concept. Each Pexels search requests and stores up to 30 results. Successful searches, including zero-result searches, are flagged so later runs skip them. A failed search remains pending and records its error for a retry.

Authenticated image-library searches also fill misses on demand. The API first fetches a matching pending concept. If the term is not in the concept catalog, it creates an on-demand concept and immediately stores up to 30 Pexels results. A matching concept already searched with zero results is not searched again. External fetches are rate-limited per account; ordinary cached searches do not consume that allowance.

Downloaded photos are center-cropped to 256 × 256 JPEGs and stored in `flashcard-images` beside the configured database. `image_assets` retains the Pexels photo page, photographer, alt text, license, dimensions, content hash, and source URL. Flashcards keep an attribution snapshot when an image is selected, while the cached file remains shared. The picker links photographers and photos back to Pexels and displays “Photos provided by Pexels”; deployments remain responsible for following the current Pexels API and license terms.

The flashcard card list also offers **Bulk → Assign images**. It opens a safe-area fullscreen review where each selected card can receive a proposed cached image, use a refined multilingual search, or be skipped before moving to the next card.

## Review set sharing

`GET /flashcard-review-sets` returns the authenticated account’s owned sets and sets shared with it. Each record includes its `access_role`, owner display metadata, resolved tag names, current matching-card count, and that account’s effective review settings.

Owners manage access through `/flashcard-review-sets/{id}/shares` and `/flashcard-review-set-shares/{shareId}`. Shares accept any valid email address and a `readonly` or `editor` role. Create, list, and update responses expose only the invited email and role—not account profile data or registration state. An invitation for an unregistered address is claimed automatically on that account’s first authenticated request after registration. Read-only recipients may review and list cards. Editors may also use the set-scoped card and image endpoints to mutate the owner’s matching source cards, but cannot change card tags, set identity, tag filters, or sharing. New editor-created cards receive the set’s current tags automatically.

Review preferences and card statistics are keyed by account, so one recipient’s timing, speech, sorting, success, and error history do not alter another account’s experience. Sessions retain both the reviewer and source owner. Recipients may attach accessible sets to their tasks, program steps, and interval templates. Removing a share detaches those references transactionally while keeping immutable review events and session snapshots.

`POST /flashcard-review-sets/{id}/copies` creates a recipient-owned set and copies every card currently matching the shared filter. Copied cards, tags, settings, and non-library image files are independent; the original live share remains in place.

## ChatGPT connection through Codex

Authenticated users manage their connection through `GET`, `POST`, and `DELETE /auth/chatgpt`. `POST` starts OpenAI’s ChatGPT device-code flow through the separately hosted Codex bridge. `GET` returns availability, pending verification details, or the connected account email and plan. `DELETE` cancels a pending login or logs the account out.

The PHP API authenticates to the bridge with `MOM_CODEX_BRIDGE_TOKEN` and sends an HMAC subject derived from the Mom user ID and `MOM_API_SECRET`; raw user IDs and ChatGPT credentials do not cross that boundary. Both bridge settings must be present together. Remote bridge URLs require HTTPS, while loopback HTTP is accepted for local development.

Deploy the Node service documented in [`codex-bridge/README.md`](../codex-bridge/README.md) on a host that can run the Codex CLI and persist its credential volume. It uses App Server’s stdio JSON-RPC transport internally rather than exposing the experimental WebSocket transport. This connection is for Codex-powered commands and does not expose the user’s ordinary ChatGPT conversation history.

Migration `202608080004` drops the legacy `mom_openai_connections` table. Any API keys stored by the superseded implementation are permanently deleted and users must connect with ChatGPT again.

## Apache/shared hosting

For the prepared shared-hosting layout, upload the `server` directory at `/server` and the Composer-generated `vendor` directory beside it. Its included `.htaccess` routes requests through the root `index.php`, preserves the bearer authorization header, disables directory listing, and prevents direct access to implementation files except for the authenticated migration endpoint. The public API remains `https://mom.coulombe.dev/server`; `/public` is not part of the URL.

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
- Avatars are cropped and compressed in the client, validated again by PHP, stored under the private data directory with random filenames, and served through immutable unguessable URLs.
- Cascade behavior needed by task, occurrence, program-step, tag, and interval-template deletion is implemented transactionally.
- Android passkey challenges are random, expire after five minutes, and are consumed once.
- Passkey registration and login require the configured Android package and signing-certificate origin, RP-ID hash, user-presence/user-verification flags, and a valid authenticator signature.
- Disconnecting biometric sign-in deletes every registered credential for the authenticated account and invalidates its pending registration challenges.
- The PHP API never receives ChatGPT passwords or OAuth tokens; only the isolated Codex bridge stores refreshable credentials.
- Bridge requests use a dedicated bearer token and privacy-preserving HMAC account subjects. Remote connections require HTTPS.

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
