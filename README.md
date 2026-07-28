# REP — Daily Tasks

A mobile-first routine, daily-task, and programmable interval tracker built with Vue 3, Vuetify, TypeScript, and PocketBase. Interval templates support nested repeat groups, one-time Quick sessions, recovery, and an installable PWA runner.

## Requirements

- Node.js 22+
- pnpm 11+
- `curl` and `unzip` for the one-time PocketBase download

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

Set `VITE_POCKETBASE_URL` to use a PocketBase server other than `http://127.0.0.1:8090`.
