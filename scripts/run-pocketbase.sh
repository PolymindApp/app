#!/usr/bin/env bash
set -euo pipefail

if [[ ! -x .pocketbase/pocketbase ]]; then
  pnpm pb:download
fi

exec .pocketbase/pocketbase serve \
  --http=127.0.0.1:8090 \
  --dir=.pocketbase/pb_data \
  --migrationsDir=pb_migrations
