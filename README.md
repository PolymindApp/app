# Polymind — Many systems. One mind.

A mobile-first personal management app for tasks, plans, habits, workouts, and programmable intervals. The client uses Vue 3, Vuetify, and TypeScript. A PHP API provides password/passkey authentication and secure SQLite access.

## Requirements

- Node.js 22+
- pnpm 11+
- PHP 8.1+ with PDO_SQLITE
- Composer 2
- A writable Polymind SQLite database
- Android Studio 2025.2.1+ and an Android SDK for Android builds

## Start locally

The PHP server uses the private `private/data.db` database by default:

```bash
pnpm install
composer install
pnpm dev:all
```

Open `http://localhost:5173`. Vite proxies `/api` to the PHP server at `http://127.0.0.1:8090`.

The database is intentionally ignored by Git. For a new empty installation only:

```bash
sqlite3 private/data.db 'VACUUM;'
pnpm api:migrate
```

Every API startup also applies pending migrations automatically. The explicit command is useful for checking an upgrade before serving requests. `server/schema.sql` is a readable snapshot of the current schema, not the upgrade mechanism.

`pnpm api:serve` uses a local-development signing secret when no secret or local configuration is supplied. That fallback is bound to `127.0.0.1` and must never be used for deployment.

## Environment and hosting build

The ignored `.env` contains the active local values. The ignored `.env.prod` contains the production build and deployment values, while `.env.example` is the safe template that can be committed or copied to another machine.

For a web app and API on the same domain, the prepared value needs no change:

```dotenv
VITE_API_URL=/api
```

For a separate API subdomain or a native app build, set an absolute HTTPS URL:

```dotenv
VITE_API_URL=https://api.your-domain.example
MOM_ALLOWED_ORIGINS=https://your-domain.example,http://localhost,capacitor://localhost
```

Generate a different `MOM_API_SECRET` for each production installation:

```bash
php -r 'echo bin2hex(random_bytes(32)), PHP_EOL;'
```

Generate a second, independent value for `MOM_MIGRATION_KEY`. Store it in the host's root `.env` and as the `MOM_MIGRATION_KEY` secret in the GitHub `Web` environment so the release workflow can run migrations after uploading the server.

The PHP server reads the root `.env` itself. Vite exposes only variables beginning with `VITE_`, so `MOM_API_SECRET`, `MOM_DB_PATH`, and other server settings are not embedded in browser JavaScript.

Prepare the web build with:

```bash
pnpm install --frozen-lockfile
composer install --no-dev --optimize-autoloader
pnpm build:prod
```

For the prepared `mom.coulombe.dev` deployment, this loads `.env.prod` and embeds `https://mom.coulombe.dev/server` as the browser API URL. Upload the contents of `dist` as the web application, then upload the `server` and Composer-generated `vendor` directories. Back up the database before releasing. The GitHub release workflow calls the authenticated migration endpoint after its upload job succeeds. The generated `dist/.htaccess` routes `/server/*` to the protected PHP front controller without exposing `/public` in the URL.

On the host, place a copy of `.env.prod` named `.env` at the project root because the PHP runtime reads `.env`. Prefer keeping both environment files and `private` outside the public document root. When shared hosting requires them at the deployment root, the included Apache rules deny browser access to `.env`, `private`, and the server implementation. The PHP process must be able to read the root `.env` and read/write `private/data.db`.

## Commands

- `pnpm dev` — run the Vue client
- `pnpm api:serve` — run the PHP API
- `pnpm api:migrate` — apply pending SQLite migrations and report the current version
- `pnpm dev:all` — run the Vue client and PHP API
- `pnpm typecheck` — validate TypeScript and Vue templates
- `pnpm test` — run unit tests
- `pnpm test:api` — exercise the PHP API against a temporary database copy
- `pnpm build` — type-check and create a production build
- `pnpm build:prod` — build using the private `.env.prod` hosting configuration
- `pnpm android:sync` — build with `.env.prod` and sync the web app into Android
- `pnpm android:assets` — regenerate launcher and splash assets
- `pnpm android:dev` — launch a connected device with live reload and the PHP API
- `pnpm android:open` — open the native project in Android Studio
- `pnpm android:run` — sync and run on an emulator or device
- `pnpm android:build` — create a debug APK using `.env.prod`
- `pnpm android:build:release` — create a signed release APK using `.env.prod`
- `pnpm android:bundle` — create a signed release AAB using `.env.prod`
- `pnpm ios:sync` — build with `.env.prod` and sync the web app into Xcode
- `pnpm ios:assets` — regenerate iOS app-icon and splash assets
- `pnpm ios:open` — open the native project in Xcode
- `pnpm ios:run` — sync and run on an iOS simulator or device
- `pnpm ios:build:release` — create a signed release IPA using the configured Apple signing identity
- `pnpm release:android [X.X.X]` — update Android and iOS versions, then create and push a release commit and annotated tag using an authenticated Codex CLI to summarize every committed change since the previous release

## iOS release builds

The Capacitor iOS project targets iOS 15 or newer and requires Xcode 26 or newer. Tag releases and `ios` manual workflow runs build a signed IPA on the `macos-26` GitHub runner and retain it as a workflow artifact for 30 days.

Create a GitHub environment named `iOS` with these secrets:

- `IOS_CERTIFICATE_BASE64` — the base64-encoded Apple distribution `.p12` certificate
- `IOS_CERTIFICATE_PASSWORD` — the `.p12` password
- `IOS_PROVISIONING_PROFILE_BASE64` — a base64-encoded distribution provisioning profile for `dev.coulombe.mom`

The environment may also define `VITE_API_URL` and `IOS_EXPORT_METHOD`. The API defaults to `https://mom.coulombe.dev/server`; the export method defaults to `app-store-connect` and may instead be `release-testing`, `enterprise`, or `debugging` when it matches the provisioning profile.

Encode each binary signing file without line breaks before saving it as a GitHub secret:

```bash
base64 < signing-file | tr -d '\n'
```

The workflow reads the Apple team from the profile, validates its application identifier, imports the certificate into an ephemeral keychain, builds through Capacitor, and removes the signing files afterward. For local release builds, export the parsed `IOS_TEAM_ID`, `IOS_SIGNING_CERTIFICATE`, and `IOS_PROVISIONING_PROFILE` values before running `pnpm ios:build:release`; routine device development is easier through `pnpm ios:open` and Xcode-managed signing.

## PHP API deployment

The detailed deployment guide is in [server/README.md](server/README.md).

## Sharing Review sets

Review set owners can share a live set with another existing Polymind account by exact email address. Read-only recipients can review and inspect matching cards. Editors can also add, change, and permanently delete matching cards in the owner’s source library; card tags remain controlled by the owner’s set filter.

Each recipient has private review settings and card progress. Shared sets can be attached to the recipient’s flashcard tasks, program steps, and intervals. A recipient can make an independent copy of every currently matching card without leaving the live share. Revoking or leaving a share automatically detaches those integrations while preserving completed review history and card snapshots.

The API serves these routes:

```text
GET    /health
POST   /auth/register
POST   /auth/login
POST   /auth/passkeys/register/options
POST   /auth/passkeys/register/verify
POST   /auth/passkeys/login/options
POST   /auth/passkeys/login/verify
GET    /flashcard-review-sets
PATCH  /flashcard-review-sets/{id}/preferences
GET    /flashcard-review-sets/{id}/shares
POST   /flashcard-review-sets/{id}/shares
PATCH  /flashcard-review-set-shares/{shareId}
DELETE /flashcard-review-set-shares/{shareId}
POST   /flashcard-review-sets/{id}/copies
GET    /flashcard-review-sets/{id}/cards
POST   /flashcard-review-sets/{id}/cards
PATCH  /flashcard-review-sets/{id}/cards/{cardId}
DELETE /flashcard-review-sets/{id}/cards/{cardId}
POST   /flashcard-review-sets/{id}/cards/{cardId}/image
DELETE /flashcard-review-sets/{id}/cards/{cardId}/image
GET    /collections/{collection}/records
POST   /collections/{collection}/records
GET    /collections/{collection}/records/{id}
PATCH  /collections/{collection}/records/{id}
DELETE /collections/{collection}/records/{id}
```

Only the application’s known collections, fields, sorts, and filters are accepted. Every data request requires a signed bearer token, and `owner` is always derived from that token. Related task, occurrence, program-step, tag, and interval records are checked for matching ownership before writes.

Passwords are stored as bcrypt hashes. Signed tokens are bound to a per-user `token_key`, and `mom_rate_limits` provides login and registration throttling.

Passkeys are exposed only by the native Android client. A signed-in user creates one from the account menu, then can use “Sign in with passkey” without entering an email. The PHP API stores only the credential public key, requires Android user verification, and issues the same bearer session used by password login.

The web build publishes `/.well-known/assetlinks.json`, which binds `mom.coulombe.dev` to the Android package and the configured release/debug signing certificates. It must remain reachable over HTTPS with status `200`, no redirect, and an `application/json` content type. If the signing key changes, update both that file’s SHA-256 fingerprint and `MOM_PASSKEY_ANDROID_KEY_HASHES` in `.env.prod` before installing the newly signed app.

## Client API URL

The client defaults to `/api`, which is appropriate when the PHP API is mounted on the same domain. Production web and Android builds load the absolute HTTPS API URL from `.env.prod`:

```bash
pnpm android:build
```

```bash
pnpm android:bundle
```

Both builds embed `https://mom.coulombe.dev/server`. The debug APK is written to `android/app/build/outputs/apk/debug/app-debug.apk`, the signed release APK to `android/app/build/outputs/apk/release/app-release.apk`, and the signed AAB to `android/app/build/outputs/bundle/release/app-release.aab`.

Release signing uses `private/mom-release.jks` and `private/android-signing.properties`. Both files are ignored by Git and required for every future update. Back them up together in a secure password manager or encrypted archive; losing the keystore prevents signing updates as the same Android application.

## Android live development

Connect one phone with USB or wireless debugging enabled, then run:

```bash
pnpm android:dev
```

The command starts the PHP API and Vite when needed, forwards ports `5173` and `8090`, installs Polymind, and stays attached for hot updates. Press `Ctrl+C` to stop it.

If more than one device is connected, select one explicitly:

```bash
ANDROID_SERIAL=<device-id> pnpm android:dev
```

For explicit wireless connection:

```bash
pnpm android:dev -- --wireless 192.168.1.50:37841
```

For first-time wireless pairing:

```bash
pnpm android:dev -- \
  --pair 192.168.1.50:41237 \
  --pair-code 123456 \
  --wireless 192.168.1.50:37841
```

The same values can be supplied through `ANDROID_PAIR_ADDRESS`, `ANDROID_PAIR_CODE`, and `ANDROID_WIRELESS_ADDRESS`.
