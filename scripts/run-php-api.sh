#!/usr/bin/env bash
set -euo pipefail

if ! command -v php >/dev/null 2>&1; then
  echo "PHP 8.1 or newer is required." >&2
  exit 1
fi

if ! php -r 'exit(PHP_VERSION_ID >= 80100 && extension_loaded("pdo_sqlite") ? 0 : 1);'; then
  echo "PHP 8.1+ with PDO_SQLITE is required." >&2
  exit 1
fi

if [[ -z "${POLYMIND_API_SECRET:-}" && ! -f .env && ! -f server/config.local.php ]]; then
  export POLYMIND_API_SECRET="local-development-secret-not-for-production"
fi

exec php -S 127.0.0.1:8090 -t server/public server/router.php
