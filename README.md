# Mom — Management of Me

A mobile-first personal management app for tasks, plans, habits, workouts, and programmable intervals, built with Vue 3, Vuetify, TypeScript, and PocketBase. Interval templates support nested repeat groups, one-time Quick sessions, recovery, and an installable PWA runner.

## Requirements

- Node.js 22+
- pnpm 11+
- `curl` and `unzip` for the one-time PocketBase download
- Android Studio 2025.2.1+ and an Android SDK for Android builds

## Start locally

```bash
pnpm install
pnpm pb:download
pnpm dev:all
```

Open `http://localhost:5173`, create an account, and start building your plan. PocketBase runs at `http://127.0.0.1:8090`; its admin dashboard is available at `http://127.0.0.1:8090/_/`.

PocketBase data and the downloaded binary live under `.pocketbase/` and are intentionally ignored. The committed `pb_migrations/` directory contains the full application schema and per-user access rules.

## Commands

- `pnpm dev` — run the Vue client
- `pnpm pb:serve` — run PocketBase and apply migrations
- `pnpm dev:all` — run both development processes
- `pnpm typecheck` — validate TypeScript and Vue templates
- `pnpm test` — run unit tests
- `pnpm build` — type-check and create a production build
- `pnpm android:sync` — build the web app and sync it into Android
- `pnpm android:assets` — regenerate launcher and splash assets from `assets/`
- `pnpm android:dev` — launch a connected USB or wireless ADB device with live reload and PocketBase
- `pnpm android:open` — open the native project in Android Studio
- `pnpm android:run` — sync and run on a selected emulator or device
- `pnpm android:build` — create a debug APK
- `pnpm android:build:release` — create an unsigned release APK
- `pnpm android:bundle` — create an unsigned release AAB for signing and Play Store upload

Set `VITE_POCKETBASE_URL` to use a PocketBase server other than `http://127.0.0.1:8090`.

## Android

The Capacitor project uses the app name `Mom`, application ID `com.coulombe.mom`, and the Vite `dist/` directory.

Build an installable debug APK:

```bash
VITE_POCKETBASE_URL=https://your-pocketbase.example.com pnpm android:build
```

The APK is written to `android/app/build/outputs/apk/debug/app-debug.apk`.

For Google Play, configure release signing in Android Studio or Gradle, then run:

```bash
VITE_POCKETBASE_URL=https://your-pocketbase.example.com pnpm android:bundle
```

The unsigned AAB is written to `android/app/build/outputs/bundle/release/app-release.aab`. A phone or emulator cannot reach the computer through `127.0.0.1`; use a reachable PocketBase URL. Android production builds should use HTTPS.

### Develop on an Android phone

Connect one phone with USB debugging or wireless debugging enabled, then run:

```bash
pnpm android:dev
```

The command waits for an authorized USB device or automatically discovers a
previously paired wireless device over mDNS. It starts PocketBase and Vite when
needed, forwards ports `5173` and `8090` through ADB, installs Mom, and stays
attached for hot updates. Press `Ctrl+C` to stop it and clean up processes and
port forwarding.

If more than one device is connected, select one explicitly:

```bash
ANDROID_SERIAL=<device-id> pnpm android:dev
```

Once a phone is paired, enable Wireless debugging and simply run:

```bash
pnpm android:dev
```

For first-time pairing, open **Wireless debugging → Pair device with pairing
code** on the phone, then run the same command. The script discovers the phone
and asks only for the displayed six-digit code.

Use `--wireless` only to bypass discovery or select one of multiple phones:

```bash
pnpm android:dev -- --wireless 192.168.1.50:37841
```

For first-time wireless pairing, use the pairing address, connection address,
and code shown under Android's **Wireless debugging** screen:

```bash
pnpm android:dev -- \
  --pair 192.168.1.50:41237 \
  --pair-code 123456 \
  --wireless 192.168.1.50:37841
```

The same values can be supplied through `ANDROID_PAIR_ADDRESS`,
`ANDROID_PAIR_CODE`, and `ANDROID_WIRELESS_ADDRESS`.
