#!/usr/bin/env bash
set -euo pipefail

test_root="${TMPDIR:-/tmp}"
test_dir="$(mktemp -d "$test_root/mom-migrations-test.XXXXXX")"
empty_db="$test_dir/empty.db"
existing_db="$test_dir/existing.db"
cli_db="$test_dir/cli.db"

cleanup() {
  case "$test_dir" in
    "$test_root"/mom-migrations-test.*) rm -rf -- "$test_dir" ;;
  esac
}
trap cleanup EXIT

for command in php sqlite3; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "$command is required for the migration test." >&2
    exit 1
  }
done

run_migrations() {
  local database_path="$1"
  php -r '
    require "server/src/ApiException.php";
    require "server/src/MigrationRunner.php";
    require "server/src/Database.php";
    $database = new Mom\Api\Database($argv[1]);
    echo implode(",", $database->migrationsApplied);
  ' "$database_path"
}

sqlite3 "$empty_db" 'VACUUM'
first_run="$(run_migrations "$empty_db")"
[[ "$first_run" == "202607290001,202607290002,202607290003,202607300001,202607310001,202607310002,202607310003,202608010001" ]] || {
  echo "An empty database did not apply the complete migration sequence." >&2
  exit 1
}

expected_tables=(
  users
  tags
  tasks
  program_steps
  occurrences
  entries
  interval_templates
  interval_sessions
  tracking_trackers
  tracking_entries
  mom_rate_limits
  mom_passkey_challenges
  mom_passkeys
  mom_schema_migrations
)
for table in "${expected_tables[@]}"; do
  exists="$(sqlite3 "$empty_db" \
    "SELECT COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = '$table';")"
  [[ "$exists" == 1 ]] || {
    echo "Migration-created database is missing table: $table" >&2
    exit 1
  }
done

migration_count="$(sqlite3 "$empty_db" 'SELECT COUNT(*) FROM mom_schema_migrations;')"
[[ "$migration_count" == 8 ]] || {
  echo "Migration history does not contain all migrations." >&2
  exit 1
}

sqlite3 "$empty_db" \
  "INSERT INTO tags (id, owner, name) VALUES ('preserved-tag', 'user-1', 'Preserved');"
second_run="$(run_migrations "$empty_db")"
[[ -z "$second_run" ]] || {
  echo "A repeated migration run reapplied completed migrations." >&2
  exit 1
}
preserved="$(sqlite3 "$empty_db" \
  "SELECT COUNT(*) FROM tags WHERE id = 'preserved-tag' AND name = 'Preserved';")"
[[ "$preserved" == 1 ]] || {
  echo "A repeated migration run changed existing application data." >&2
  exit 1
}
sqlite3 "$cli_db" 'VACUUM'
cli_output="$(
  MOM_DB_PATH="$cli_db" \
  MOM_API_SECRET="mom-migration-test-secret-at-least-32-characters" \
    php server/migrate.php
)"
[[ "$cli_output" == *"Applied 8 migrations"* && "$cli_output" == *"202608010001"* ]] || {
  echo "The migration CLI did not initialize and report a new database." >&2
  exit 1
}

source_db="${MOM_TEST_SOURCE_DB:-private/data.db}"
[[ -f "$source_db" ]] || {
  echo "Source database not found: $source_db" >&2
  exit 1
}
sqlite3 "$source_db" ".backup $existing_db"
sqlite3 "$existing_db" 'DROP TABLE IF EXISTS mom_schema_migrations;'
before_counts="$(sqlite3 "$existing_db" \
  "SELECT (SELECT COUNT(*) FROM tasks) || ':' || (SELECT COUNT(*) FROM entries);")"
existing_run="$(run_migrations "$existing_db")"
after_counts="$(sqlite3 "$existing_db" \
  "SELECT (SELECT COUNT(*) FROM tasks) || ':' || (SELECT COUNT(*) FROM entries);")"
[[ "$existing_run" == "202607290001,202607290002,202607290003,202607300001,202607310001,202607310002,202607310003,202608010001" ]] || {
  echo "An existing PHP database was not baselined correctly." >&2
  exit 1
}
[[ "$before_counts" == "$after_counts" ]] || {
  echo "Baselining an existing database changed application rows." >&2
  exit 1
}

echo "SQLite migration bootstrap, baseline, and idempotency checks passed."
