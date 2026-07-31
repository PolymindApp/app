#!/usr/bin/env bash

set -euo pipefail

default_api_url="http://localhost:8090"
vite_api_url="${VITE_API_URL:-$(
  node --input-type=module -e \
    "import { loadEnv } from 'vite'; process.stdout.write(loadEnv('development', process.cwd(), 'VITE_').VITE_API_URL || '')"
)}"

export VITE_API_URL="${vite_api_url:-$default_api_url}"
exec vite "$@"
