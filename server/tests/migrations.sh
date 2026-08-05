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
[[ "$first_run" == "202607290001,202607290002,202607290003,202607300001,202607310001,202607310002,202607310003,202608010001,202608020001,202608020002,202608020003,202608020004,202608050001,202608050002,202608050003" ]] || {
  echo "An empty database did not apply the complete migration sequence." >&2
  exit 1
}

expected_tables=(
  users
  tags
  flashcard_tags
  flashcards
  flashcard_review_sets
  flashcard_review_sessions
  flashcard_review_events
  tasks
  program_steps
  occurrences
  entries
  interval_templates
  interval_sessions
  tracking_trackers
  tracking_entries
  journal_entries
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
[[ "$migration_count" == 15 ]] || {
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
[[ "$cli_output" == *"Applied 15 migrations"* && "$cli_output" == *"202608050003"* ]] || {
  echo "The migration CLI did not initialize and report a new database." >&2
  exit 1
}

source_db="${MOM_TEST_SOURCE_DB:-private/data.db}"
[[ -f "$source_db" ]] || {
  echo "Source database not found: $source_db" >&2
  exit 1
}
sqlite3 "$source_db" ".backup $existing_db"
sqlite3 "$existing_db" \
  "DELETE FROM mom_schema_migrations WHERE version IN ('202608050001', '202608050002', '202608050003');
   DROP INDEX IF EXISTS idx_interval_templates_owner_flashcard_review_set;
   DROP INDEX IF EXISTS idx_tasks_owner_flashcard_review_set;
   DROP INDEX IF EXISTS idx_program_steps_owner_flashcard_review_set;
   DROP TABLE IF EXISTS flashcard_review_events;
   DROP TABLE IF EXISTS flashcard_review_sessions;
   DROP TABLE IF EXISTS flashcard_review_sets;
   DROP TABLE IF EXISTS flashcards;
   DROP TABLE IF EXISTS flashcard_tags;"
existing_task_flashcard_column="$(sqlite3 "$existing_db" \
  "SELECT COUNT(*) FROM pragma_table_info('tasks') WHERE name = 'flashcard_review_set';")"
if [[ "$existing_task_flashcard_column" == 1 ]]; then
  sqlite3 "$existing_db" 'ALTER TABLE tasks DROP COLUMN flashcard_review_set;'
fi
existing_step_flashcard_column="$(sqlite3 "$existing_db" \
  "SELECT COUNT(*) FROM pragma_table_info('program_steps') WHERE name = 'flashcard_review_set';")"
if [[ "$existing_step_flashcard_column" == 1 ]]; then
  sqlite3 "$existing_db" 'ALTER TABLE program_steps DROP COLUMN flashcard_review_set;'
fi
existing_interval_review_set_column="$(sqlite3 "$existing_db" \
  "SELECT COUNT(*) FROM pragma_table_info('interval_templates') WHERE name = 'flashcard_review_set';")"
if [[ "$existing_interval_review_set_column" == 1 ]]; then
  sqlite3 "$existing_db" 'ALTER TABLE interval_templates DROP COLUMN flashcard_review_set;'
fi
existing_interval_snapshot_column="$(sqlite3 "$existing_db" \
  "SELECT COUNT(*) FROM pragma_table_info('interval_sessions') WHERE name = 'flashcard_snapshot';")"
if [[ "$existing_interval_snapshot_column" == 1 ]]; then
  sqlite3 "$existing_db" 'ALTER TABLE interval_sessions DROP COLUMN flashcard_snapshot;'
fi
before_counts="$(sqlite3 "$existing_db" \
  "SELECT (SELECT COUNT(*) FROM tasks) || ':' || (SELECT COUNT(*) FROM entries);")"
existing_run="$(run_migrations "$existing_db")"
after_counts="$(sqlite3 "$existing_db" \
  "SELECT (SELECT COUNT(*) FROM tasks) || ':' || (SELECT COUNT(*) FROM entries);")"
[[ "$existing_run" == "202608050001,202608050002,202608050003" ]] || {
  echo "An existing PHP database did not apply only the pending flashcard migration." >&2
  exit 1
}
[[ "$before_counts" == "$after_counts" ]] || {
  echo "Baselining an existing database changed application rows." >&2
  exit 1
}

entry_note_type="$(sqlite3 "$existing_db" \
  "SELECT type FROM pragma_table_info('entries') WHERE name = 'note';")"
entry_created_column="$(sqlite3 "$existing_db" \
  "SELECT COUNT(*) FROM pragma_table_info('entries') WHERE name = 'created_at';")"
[[ "$entry_note_type" == "VARCHAR(255)" && "$entry_created_column" == 1 ]] || {
  echo "The entry note reference migration did not install the expected schema." >&2
  exit 1
}

task_note_settings="$(sqlite3 "$existing_db" \
  "SELECT COUNT(*) FROM pragma_table_info('tasks') WHERE name IN ('entry_notes_enabled', 'entry_note_suggestions_enabled');")"
[[ "$task_note_settings" == 2 ]] || {
  echo "The task entry note settings migration did not install both columns." >&2
  exit 1
}
enabled_task_note_settings="$(sqlite3 "$existing_db" \
  'SELECT COUNT(*) FROM tasks WHERE entry_notes_enabled != 0 OR entry_note_suggestions_enabled != 0;')"
[[ "$enabled_task_note_settings" == 0 ]] || {
  echo "Existing task entry note settings were not disabled by default." >&2
  exit 1
}

journal_columns="$(sqlite3 "$existing_db" \
  "SELECT COUNT(*) FROM pragma_table_info('journal_entries') WHERE name IN ('body', 'task', 'tracker', 'task_snapshot', 'tracker_snapshot', 'created_at', 'updated_at');")"
[[ "$journal_columns" == 7 ]] || {
  echo "The journaling migration did not install the expected columns." >&2
  exit 1
}

flashcard_task_columns="$(sqlite3 "$existing_db" \
  "SELECT (SELECT COUNT(*) FROM pragma_table_info('tasks') WHERE name = 'flashcard_review_set') || ':' ||
          (SELECT COUNT(*) FROM pragma_table_info('program_steps') WHERE name = 'flashcard_review_set');")"
[[ "$flashcard_task_columns" == "1:1" ]] || {
  echo "The flashcard migration did not install task Review set attachments." >&2
  exit 1
}

flashcard_tables="$(sqlite3 "$existing_db" \
  "SELECT COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name IN (
    'flashcard_tags', 'flashcards', 'flashcard_review_sets',
    'flashcard_review_sessions', 'flashcard_review_events'
  );")"
[[ "$flashcard_tables" == 5 ]] || {
  echo "The flashcard migration did not install every flashcard table." >&2
  exit 1
}

flashcard_speech_columns="$(sqlite3 "$existing_db" \
  "SELECT (SELECT COUNT(*) FROM pragma_table_info('flashcard_review_sets')
             WHERE name IN ('speech_enabled', 'front_language', 'back_language')) || ':' ||
          (SELECT COUNT(*) FROM pragma_table_info('flashcard_review_sessions')
             WHERE name IN ('speech_enabled_snapshot', 'front_language_snapshot', 'back_language_snapshot'));")"
[[ "$flashcard_speech_columns" == "3:3" ]] || {
  echo "The flashcard speech migration did not install every speech setting." >&2
  exit 1
}

interval_flashcard_columns="$(sqlite3 "$existing_db" \
  "SELECT (SELECT COUNT(*) FROM pragma_table_info('interval_templates')
             WHERE name = 'flashcard_review_set') || ':' ||
          (SELECT COUNT(*) FROM pragma_table_info('interval_sessions')
             WHERE name = 'flashcard_snapshot');")"
[[ "$interval_flashcard_columns" == "1:1" ]] || {
  echo "The interval Review set migration did not install its attachment and snapshot columns." >&2
  exit 1
}

echo "SQLite migration bootstrap, baseline, and idempotency checks passed."
