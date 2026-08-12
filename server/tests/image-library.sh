#!/usr/bin/env bash
set -euo pipefail

test_root="${TMPDIR:-/tmp}"
test_dir="$(mktemp -d "$test_root/polymind-image-library-test.XXXXXX")"
test_db="$test_dir/data.db"
mock_log="$test_dir/pexels.log"
mock_pid=""

cleanup() {
  if [[ -n "$mock_pid" ]]; then
    kill "$mock_pid" >/dev/null 2>&1 || true
    wait "$mock_pid" >/dev/null 2>&1 || true
  fi
  case "$test_dir" in
    "$test_root"/polymind-image-library-test.*) rm -rf -- "$test_dir" ;;
  esac
}
trap cleanup EXIT

for command in curl php sqlite3; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "$command is required for the image library test." >&2
    exit 1
  }
done

if ! php -r 'exit(function_exists("curl_init") && function_exists("imagecreatetruecolor") ? 0 : 1);'; then
  echo "The cURL and GD PHP extensions are required for the image library test." >&2
  exit 1
fi

sqlite3 "$test_db" 'VACUUM'
seed_output="$(
  POLYMIND_DB_PATH="$test_db" \
  POLYMIND_API_SECRET="polymind-image-library-test-secret-at-least-32-characters" \
    php scripts/seed-image-concepts.php
)"
[[ "$seed_output" =~ Seeded\ ([5-9][0-9]{3}|[1-9][0-9]{4,})\ image\ concepts ]] || {
  echo "The multilingual image concept seed did not install at least 5,000 concepts." >&2
  exit 1
}

seed_summary="$(sqlite3 "$test_db" \
  "SELECT (SELECT COUNT(*) FROM image_concepts WHERE active = TRUE) || ':' ||
          (SELECT COUNT(*) FROM image_concept_terms) || ':' ||
          (SELECT COUNT(DISTINCT language) FROM image_concept_terms) || ':' ||
          (SELECT COUNT(*) FROM image_concepts WHERE pexels_searched = FALSE);")"
IFS=: read -r concept_count term_count language_count pending_count <<<"$seed_summary"
[[ "$concept_count" -ge 5000 && "$term_count" -ge 100000 && "$language_count" -ge 20 \
  && "$pending_count" == "$concept_count" ]] || {
  echo "The image concept seed is missing expected multilingual or pending-search data." >&2
  exit 1
}

first_concept_id="$(sqlite3 "$test_db" \
  'SELECT id FROM image_concepts WHERE active = TRUE AND pexels_searched = FALSE ORDER BY id LIMIT 1;')"
mock_port="${POLYMIND_PEXELS_TEST_PORT:-$((19700 + RANDOM % 800))}"
php -S "127.0.0.1:$mock_port" server/tests/fixtures/pexels-router.php >"$mock_log" 2>&1 &
mock_pid=$!

for _attempt in {1..50}; do
  curl --silent --output /dev/null "http://127.0.0.1:$mock_port/missing" && break
  kill -0 "$mock_pid" >/dev/null 2>&1 || {
    cat "$mock_log" >&2
    exit 1
  }
  sleep .1
done

fetch_output="$(
  POLYMIND_DB_PATH="$test_db" \
  POLYMIND_API_SECRET="polymind-image-library-test-secret-at-least-32-characters" \
  POLYMIND_PEXELS_API_KEY="test-pexels-key" \
  POLYMIND_PEXELS_API_BASE_URL="http://127.0.0.1:$mock_port/v1/search" \
    php scripts/fetch-pexels-images.php --limit=1
)"
[[ "$fetch_output" == *"Searched 1/1 concepts; 1 new and 0 reused assets"* ]] || {
  echo "The Pexels fetch command did not cache the mock search result." >&2
  cat "$mock_log" >&2
  exit 1
}

fetch_summary="$(sqlite3 "$test_db" \
  "SELECT (SELECT pexels_searched FROM image_concepts WHERE id = $first_concept_id) || ':' ||
          (SELECT pexels_result_count FROM image_concepts WHERE id = $first_concept_id) || ':' ||
          (SELECT COUNT(*) FROM image_assets) || ':' ||
          (SELECT COUNT(*) FROM image_concept_assets WHERE concept_id = $first_concept_id);")"
[[ "$fetch_summary" == "1:1:1:1" ]] || {
  echo "The Pexels fetch command did not flag and link the searched concept." >&2
  exit 1
}

cached_filename="$(sqlite3 "$test_db" 'SELECT filename FROM image_assets LIMIT 1;')"
cached_path="$test_dir/flashcard-images/$cached_filename"
php -r '
  $details = getimagesize($argv[1]);
  if (!is_array($details) || $details[0] !== 256 || $details[1] !== 256) exit(1);
' "$cached_path" || {
  echo "The Pexels fetch command did not store a 256 x 256 cached JPEG." >&2
  exit 1
}

echo "Multilingual seed and pending-only Pexels cache checks passed."
