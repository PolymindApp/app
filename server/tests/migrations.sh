#!/usr/bin/env bash
set -euo pipefail

test_root="${TMPDIR:-/tmp}"
test_dir="$(mktemp -d "$test_root/backontrack-migrations-test.XXXXXX")"
empty_db="$test_dir/empty.db"
existing_db="$test_dir/existing.db"
email_invite_db="$test_dir/email-invite.db"
email_auth_db="$test_dir/email-auth.db"
cli_db="$test_dir/cli.db"
http_db="$test_dir/http.db"
http_response="$test_dir/http-response.json"
http_server_log="$test_dir/http-server.log"
http_server_pid=""

cleanup() {
  if [[ -n "$http_server_pid" ]]; then
    kill "$http_server_pid" >/dev/null 2>&1 || true
    wait "$http_server_pid" >/dev/null 2>&1 || true
  fi
  case "$test_dir" in
    "$test_root"/backontrack-migrations-test.*) rm -rf -- "$test_dir" ;;
  esac
}
trap cleanup EXIT

for command in curl php sqlite3; do
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
    $database = new BackOnTrack\Api\Database($argv[1]);
    echo implode(",", $database->migrationsApplied);
  ' "$database_path"
}

sqlite3 "$empty_db" 'VACUUM'
first_run="$(run_migrations "$empty_db")"
[[ "$first_run" == "202607290001,202607290002,202607290003,202607300001,202607310001,202607310002,202607310003,202608010001,202608020001,202608020002,202608020003,202608020004,202608050001,202608050002,202608050003,202608060001,202608060002,202608060003,202608060004,202608070001,202608070002,202608070003,202608070004,202608070005,202608070006,202608080001,202608080003,202608090001,202608090002,202608100001,202608100002,202608110001,202608120001,202608120002,202608120003,202608130001,202608140001,202608140002,202608140003" ]] || {
  echo "An empty database did not apply the complete migration sequence." >&2
  exit 1
}

expected_tables=(
  users
  tags
  flashcard_tags
  flashcards
  flashcard_review_sets
  flashcard_review_set_shares
  flashcard_review_set_preferences
  flashcard_review_card_stats
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
  backontrack_rate_limits
  backontrack_auth_tokens
  backontrack_passkey_challenges
  backontrack_passkeys
  sync_record_versions
  sync_change_log
  sync_operation_receipts
  sync_clients
  backontrack_schema_migrations
)
for table in "${expected_tables[@]}"; do
  exists="$(sqlite3 "$empty_db" \
    "SELECT COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = '$table';")"
  [[ "$exists" == 1 ]] || {
    echo "Migration-created database is missing table: $table" >&2
    exit 1
  }
done

migration_count="$(sqlite3 "$empty_db" 'SELECT COUNT(*) FROM backontrack_schema_migrations;')"
[[ "$migration_count" == 39 ]] || {
  echo "Migration history does not contain all migrations." >&2
  exit 1
}

task_reminder_columns="$(sqlite3 "$empty_db" \
  "SELECT COUNT(*) FROM pragma_table_info('tasks')
   WHERE name IN ('reminder_enabled', 'reminder_times');")"
tracker_reminder_columns="$(sqlite3 "$empty_db" \
  "SELECT COUNT(*) FROM pragma_table_info('tracking_trackers')
   WHERE name IN ('reminder_enabled', 'reminder_time', 'reminder_show_name');")"
[[ "$task_reminder_columns" == 2 && "$tracker_reminder_columns" == 0 ]] || {
  echo "Task reminder fields were not moved away from trackers." >&2
  exit 1
}

journal_image_columns="$(sqlite3 "$empty_db" \
  "SELECT COUNT(*) FROM pragma_table_info('journal_entries')
   WHERE name IN ('image_url', 'image_file');")"
[[ "$journal_image_columns" == 2 ]] || {
  echo "The journal image migration did not install both image fields." >&2
  exit 1
}
journal_color_default="$(sqlite3 "$empty_db" \
  "SELECT dflt_value FROM pragma_table_info('journal_entries') WHERE name = 'color';")"
[[ "$journal_color_default" == "'#C7F464'" ]] || {
  echo "The journal color migration did not install the color field." >&2
  exit 1
}

flashcard_audio_columns="$(sqlite3 "$empty_db" \
  "SELECT COUNT(*) FROM pragma_table_info('flashcards')
   WHERE name IN ('front_audio_url', 'front_audio_file', 'back_audio_url', 'back_audio_file');")"
[[ "$flashcard_audio_columns" == 4 ]] || {
  echo "The flashcard audio migration did not install all face recording fields." >&2
  exit 1
}

task_session_columns="$(sqlite3 "$empty_db" \
  "SELECT COUNT(*) FROM pragma_table_info('tasks')
   WHERE name IN ('session_count_mode', 'session_goal_type', 'session_target_seconds');")"
entry_session_columns="$(sqlite3 "$empty_db" \
  "SELECT COUNT(*) FROM pragma_table_info('entries')
   WHERE name IN ('source_type', 'source_session');")"
[[ "$task_session_columns" == 3 && "$entry_session_columns" == 2 ]] || {
  echo "Task session objective fields were not created." >&2
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

sqlite3 "$empty_db" ".backup $email_auth_db"
sqlite3 "$email_auth_db" \
  "DELETE FROM backontrack_schema_migrations WHERE version = '202608100001';
   DROP TABLE backontrack_auth_tokens;
   INSERT INTO users (id, email, password, token_key, created, updated, verified)
     VALUES ('legacy-unverified', 'legacy-unverified@example.test', 'hash', 'legacy-token-key', '', '', FALSE);"
email_auth_run="$(run_migrations "$email_auth_db")"
email_auth_backfill="$(sqlite3 "$email_auth_db" \
  "SELECT (SELECT verified FROM users WHERE id = 'legacy-unverified') || ':' ||
          (SELECT COUNT(*) FROM sqlite_schema
             WHERE type = 'table' AND name = 'backontrack_auth_tokens');")"
[[ "$email_auth_run" == "202608100001" && "$email_auth_backfill" == "1:1" ]] || {
  echo "The email authentication migration did not preserve and verify a legacy account." >&2
  exit 1
}

sqlite3 "$empty_db" ".backup $email_invite_db"
sqlite3 "$email_invite_db" \
  "DELETE FROM backontrack_schema_migrations WHERE version = '202608080001';
   INSERT INTO users (id, email, password, token_key, created, updated)
     VALUES ('invite-user', 'invite@example.test', 'hash', 'token-key', '', '');
   INSERT INTO flashcard_review_sets (id, owner, name)
     VALUES ('invite-set', 'invite-owner', 'Invite migration');
   INSERT INTO flashcard_review_set_shares (id, review_set, recipient)
     VALUES ('invite-share', 'invite-set', 'invite-user');"
email_invite_run="$(run_migrations "$email_invite_db")"
email_invite_backfill="$(sqlite3 "$email_invite_db" \
  "SELECT (SELECT recipient_email FROM flashcard_review_set_shares
             WHERE id = 'invite-share') || ':' ||
          (SELECT COUNT(*) FROM sqlite_schema
             WHERE type = 'index' AND name = 'idx_flashcard_review_set_shares_email');")"
[[ "$email_invite_run" == "202608080001" && "$email_invite_backfill" == "invite@example.test:1" ]] || {
  echo "The email invitation migration did not backfill an existing share." >&2
  exit 1
}

sqlite3 "$cli_db" 'VACUUM'
cli_output="$(
  BACKONTRACK_DB_PATH="$cli_db" \
  BACKONTRACK_API_SECRET="backontrack-migration-test-secret-at-least-32-characters" \
    php server/migrate.php
)"
[[ "$cli_output" == *"Applied 39 migrations"* && "$cli_output" == *"202608140003"* ]] || {
  echo "The migration CLI did not initialize and report a new database." >&2
  exit 1
}

sqlite3 "$http_db" 'VACUUM'
http_port="${BACKONTRACK_MIGRATION_TEST_PORT:-$((18900 + RANDOM % 800))}"
http_key="backontrack-http-migration-key-at-least-32-characters"
BACKONTRACK_DB_PATH="$http_db" \
BACKONTRACK_API_SECRET="backontrack-migration-test-secret-at-least-32-characters" \
BACKONTRACK_MIGRATION_KEY="$http_key" \
  php -S "127.0.0.1:$http_port" -t . >"$http_server_log" 2>&1 &
http_server_pid="$!"

http_status=""
for _ in {1..50}; do
  http_status="$(
    curl --silent --output "$http_response" --write-out '%{http_code}' \
      "http://127.0.0.1:$http_port/server/migrate.php" \
      2>/dev/null \
      || true
  )"
  [[ "$http_status" != "000" && -n "$http_status" ]] && break
  sleep 0.1
done
[[ "$http_status" == "401" ]] || {
  echo "The HTTP migration endpoint did not reject a missing key." >&2
  cat "$http_server_log" >&2
  exit 1
}

http_status="$(
  curl --silent --request POST \
    --header "X-BackOnTrack-Migration-Key: $http_key" \
    --output "$http_response" \
    --write-out '%{http_code}' \
    "http://127.0.0.1:$http_port/server/migrate.php"
)"
[[ "$http_status" == "405" ]] || {
  echo "The HTTP migration endpoint accepted a method other than GET." >&2
  exit 1
}

http_status="$(
  curl --silent \
    --header "X-BackOnTrack-Migration-Key: $http_key" \
    --output "$http_response" \
    --write-out '%{http_code}' \
    "http://127.0.0.1:$http_port/server/migrate.php"
)"
[[ "$http_status" == "200" ]] || {
  echo "The authenticated HTTP migration request failed." >&2
  cat "$http_response" >&2
  exit 1
}
php -r '
  $response = json_decode(file_get_contents($argv[1]), true, 512, JSON_THROW_ON_ERROR);
  if (
      ($response["status"] ?? null) !== "ok"
      || count($response["appliedMigrations"] ?? []) !== 39
      || ($response["currentVersion"] ?? null) !== "202608140003"
      || ($response["migrationCount"] ?? null) !== 39
  ) {
      fwrite(STDERR, "The HTTP migration response was invalid.\n");
      exit(1);
  }
' "$http_response"

curl --silent \
  --header "X-BackOnTrack-Migration-Key: $http_key" \
  --output "$http_response" \
  "http://127.0.0.1:$http_port/server/migrate.php"
php -r '
  $response = json_decode(file_get_contents($argv[1]), true, 512, JSON_THROW_ON_ERROR);
  if (($response["status"] ?? null) !== "ok" || ($response["appliedMigrations"] ?? null) !== []) {
      fwrite(STDERR, "The repeated HTTP migration request was not idempotent.\n");
      exit(1);
  }
' "$http_response"

kill "$http_server_pid"
wait "$http_server_pid" || true
http_server_pid=""

source_db="${BACKONTRACK_TEST_SOURCE_DB:-private/data.db}"
[[ -f "$source_db" ]] || {
  echo "Source database not found: $source_db" >&2
  exit 1
}
sqlite3 "$source_db" ".backup $existing_db"
legacy_migration_table_exists="$(sqlite3 "$existing_db" \
  "SELECT COUNT(*) FROM sqlite_schema
   WHERE type = 'table' AND name = 'mom_schema_migrations';")"
if [[ "$legacy_migration_table_exists" == 1 ]]; then
  sqlite3 "$existing_db" \
    'ALTER TABLE mom_schema_migrations RENAME TO backontrack_schema_migrations;'
fi
php -r '
  $pdo = new PDO("sqlite:" . $argv[1]);
  $triggers = $pdo->query(
      "SELECT name FROM sqlite_schema WHERE type = \"trigger\" AND name LIKE \"sync_%\""
  )->fetchAll(PDO::FETCH_COLUMN);
  foreach ($triggers as $trigger) {
      $pdo->exec("DROP TRIGGER IF EXISTS \"" . str_replace("\"", "\"\"", $trigger) . "\"");
  }
  $pdo->exec("DROP TABLE IF EXISTS image_concepts_fts");
' "$existing_db"
sqlite3 "$existing_db" \
  "DELETE FROM backontrack_schema_migrations WHERE version IN ('202608050001', '202608050002', '202608050003', '202608060001', '202608060002', '202608060003', '202608060004', '202608070001', '202608070002', '202608070003', '202608070004', '202608070005', '202608070006', '202608080001', '202608080003', '202608090001', '202608090002', '202608100001', '202608100002', '202608110001', '202608120001', '202608120002', '202608120003', '202608130001', '202608140001', '202608140002', '202608140003');
   DROP INDEX IF EXISTS idx_entries_task_source_session;
   DROP INDEX IF EXISTS idx_interval_templates_owner_flashcard_review_set;
   DROP INDEX IF EXISTS idx_tasks_owner_flashcard_review_set;
   DROP INDEX IF EXISTS idx_program_steps_owner_flashcard_review_set;
   DROP INDEX IF EXISTS idx_interval_sessions_owner_client_status;
   DROP INDEX IF EXISTS idx_flashcard_review_sessions_one_active_device;
   DROP INDEX IF EXISTS idx_flashcard_review_sessions_owner_client_status;
   DROP TABLE IF EXISTS image_concept_assets;
   DROP TABLE IF EXISTS image_assets;
   DROP TABLE IF EXISTS image_concept_terms;
   DROP TABLE IF EXISTS image_concepts;
   DROP TABLE IF EXISTS image_sources;
   DROP TABLE IF EXISTS mom_auth_tokens;
   DROP TABLE IF EXISTS backontrack_auth_tokens;
   DROP TABLE IF EXISTS sync_record_versions;
   DROP TABLE IF EXISTS sync_change_log;
   DROP TABLE IF EXISTS sync_operation_receipts;
   DROP TABLE IF EXISTS sync_clients;
   DROP TABLE IF EXISTS flashcard_review_events;
   DROP TABLE IF EXISTS flashcard_review_card_stats;
   DROP TABLE IF EXISTS flashcard_review_set_preferences;
   DROP TABLE IF EXISTS flashcard_review_set_shares;
   DROP TABLE IF EXISTS flashcard_review_sessions;
   DROP TABLE IF EXISTS flashcard_review_sets;
   DROP TABLE IF EXISTS flashcards;
   DROP TABLE IF EXISTS flashcard_tags;"
existing_task_flashcard_column="$(sqlite3 "$existing_db" \
  "SELECT COUNT(*) FROM pragma_table_info('tasks') WHERE name = 'flashcard_review_set';")"
if [[ "$existing_task_flashcard_column" == 1 ]]; then
  sqlite3 "$existing_db" 'ALTER TABLE tasks DROP COLUMN flashcard_review_set;'
fi
existing_task_tracking_column="$(sqlite3 "$existing_db" \
  "SELECT COUNT(*) FROM pragma_table_info('tasks') WHERE name = 'tracking_trackers';")"
if [[ "$existing_task_tracking_column" == 1 ]]; then
  sqlite3 "$existing_db" 'ALTER TABLE tasks DROP COLUMN tracking_trackers;'
fi
for reminder_column in reminder_enabled reminder_times; do
  existing_task_reminder_column="$(sqlite3 "$existing_db" \
    "SELECT COUNT(*) FROM pragma_table_info('tasks') WHERE name = '$reminder_column';")"
  if [[ "$existing_task_reminder_column" == 1 ]]; then
    sqlite3 "$existing_db" "ALTER TABLE tasks DROP COLUMN $reminder_column;"
  fi
done
for session_column in session_count_mode session_goal_type session_target_seconds; do
  existing_task_session_column="$(sqlite3 "$existing_db" \
    "SELECT COUNT(*) FROM pragma_table_info('tasks') WHERE name = '$session_column';")"
  if [[ "$existing_task_session_column" == 1 ]]; then
    sqlite3 "$existing_db" "ALTER TABLE tasks DROP COLUMN $session_column;"
  fi
done
for session_column in source_type source_session; do
  existing_entry_session_column="$(sqlite3 "$existing_db" \
    "SELECT COUNT(*) FROM pragma_table_info('entries') WHERE name = '$session_column';")"
  if [[ "$existing_entry_session_column" == 1 ]]; then
    sqlite3 "$existing_db" "ALTER TABLE entries DROP COLUMN $session_column;"
  fi
done
for table in interval_sessions flashcard_review_sessions; do
  existing_client_column="$(sqlite3 "$existing_db" \
    "SELECT COUNT(*) FROM pragma_table_info('$table') WHERE name = 'client_id';")"
  if [[ "$existing_client_column" == 1 ]]; then
    sqlite3 "$existing_db" "ALTER TABLE $table DROP COLUMN client_id;"
  fi
done
existing_tracker_reminder_column="$(sqlite3 "$existing_db" \
  "SELECT COUNT(*) FROM pragma_table_info('tracking_trackers') WHERE name = 'reminder_enabled';")"
if [[ "$existing_tracker_reminder_column" == 0 ]]; then
  sqlite3 "$existing_db" \
    "ALTER TABLE tracking_trackers ADD COLUMN reminder_enabled BOOLEAN NOT NULL DEFAULT FALSE;
     ALTER TABLE tracking_trackers ADD COLUMN reminder_time TEXT NOT NULL DEFAULT '20:00';
     ALTER TABLE tracking_trackers ADD COLUMN reminder_show_name BOOLEAN NOT NULL DEFAULT FALSE;"
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
existing_review_session_source_owner="$(sqlite3 "$existing_db" \
  "SELECT COUNT(*) FROM pragma_table_info('flashcard_review_sessions') WHERE name = 'source_owner';")"
if [[ "$existing_review_session_source_owner" == 1 ]]; then
  sqlite3 "$existing_db" 'ALTER TABLE flashcard_review_sessions DROP COLUMN source_owner;'
fi
before_counts="$(sqlite3 "$existing_db" \
  "SELECT (SELECT COUNT(*) FROM tasks) || ':' || (SELECT COUNT(*) FROM entries);")"
existing_run="$(run_migrations "$existing_db")"
after_counts="$(sqlite3 "$existing_db" \
  "SELECT (SELECT COUNT(*) FROM tasks) || ':' || (SELECT COUNT(*) FROM entries);")"
[[ "$existing_run" == "202608050001,202608050002,202608050003,202608060001,202608060002,202608060003,202608060004,202608070001,202608070002,202608070003,202608070004,202608070005,202608070006,202608080001,202608080003,202608090001,202608090002,202608100001,202608100002,202608110001,202608120001,202608120002,202608120003,202608130001,202608140001,202608140002,202608140003" ]] || {
  echo "An existing PHP database did not apply only the pending feature migrations." >&2
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
journal_columns="$(sqlite3 "$existing_db" \
  "SELECT COUNT(*) FROM pragma_table_info('journal_entries') WHERE name IN ('body', 'color', 'task', 'tracker', 'task_snapshot', 'tracker_snapshot', 'created_at', 'updated_at');")"
[[ "$journal_columns" == 8 ]] || {
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

flashcard_review_limit="$(sqlite3 "$existing_db" \
  "SELECT type || ':' || dflt_value FROM pragma_table_info('flashcard_review_sets') WHERE name = 'max_cards';")"
[[ "$flashcard_review_limit" == "INTEGER:20" ]] || {
  echo "The flashcard Review set limit migration did not install its default." >&2
  exit 1
}

flashcard_note_column="$(sqlite3 "$existing_db" \
  "SELECT type || ':' || dflt_value FROM pragma_table_info('flashcards') WHERE name = 'note';")"
[[ "$flashcard_note_column" == "VARCHAR(2000):''" ]] || {
  echo "The flashcard note migration did not install its optional note column." >&2
  exit 1
}

flashcard_indefinite_columns="$(sqlite3 "$existing_db" \
  "SELECT (SELECT COUNT(*) FROM pragma_table_info('flashcard_review_sets')
             WHERE name = 'indefinite') || ':' ||
          (SELECT COUNT(*) FROM pragma_table_info('flashcard_review_sessions')
             WHERE name = 'indefinite_snapshot');")"
[[ "$flashcard_indefinite_columns" == "1:1" ]] || {
  echo "The passive indefinite migration did not install both settings." >&2
  exit 1
}

flashcard_speech_repeat_columns="$(sqlite3 "$existing_db" \
  "SELECT (SELECT type || ':' || dflt_value FROM pragma_table_info('flashcard_review_sets')
             WHERE name = 'back_speech_repeat_count') || ':' ||
          (SELECT type || ':' || dflt_value FROM pragma_table_info('flashcard_review_sessions')
             WHERE name = 'back_speech_repeat_count_snapshot');")"
[[ "$flashcard_speech_repeat_columns" == "INTEGER:1:INTEGER:1" ]] || {
  echo "The flashcard speech repeat migration did not install both defaults." >&2
  exit 1
}

flashcard_card_side_columns="$(sqlite3 "$existing_db" \
  "SELECT (SELECT type || ':' || dflt_value FROM pragma_table_info('flashcard_review_sets')
             WHERE name = 'card_sides') || ':' ||
          (SELECT type || ':' || dflt_value FROM pragma_table_info('flashcard_review_sessions')
             WHERE name = 'card_sides_snapshot');")"
[[ "$flashcard_card_side_columns" == "TEXT:'both':TEXT:'both'" ]] || {
  echo "The flashcard card-side migration did not install both defaults." >&2
  exit 1
}

flashcard_session_limit="$(sqlite3 "$existing_db" \
  "SELECT type || ':' || dflt_value FROM pragma_table_info('flashcard_review_sessions')
   WHERE name = 'max_cards_snapshot';")"
[[ "$flashcard_session_limit" == "INTEGER:20" ]] || {
  echo "The flashcard session settings migration did not install its card-limit default." >&2
  exit 1
}

flashcard_note_order_columns="$(sqlite3 "$existing_db" \
  "SELECT (SELECT COUNT(*) FROM pragma_table_info('flashcard_review_sets')
             WHERE name = 'note_before_back') || ':' ||
          (SELECT COUNT(*) FROM pragma_table_info('flashcard_review_set_preferences')
             WHERE name = 'note_before_back') || ':' ||
          (SELECT COUNT(*) FROM pragma_table_info('flashcard_review_sessions')
             WHERE name = 'note_before_back_snapshot');")"
[[ "$flashcard_note_order_columns" == "1:1:1" ]] || {
  echo "The flashcard note response-order migration did not install every setting." >&2
  exit 1
}

flashcard_exclusion_columns="$(sqlite3 "$existing_db" \
  "SELECT (SELECT type || ':' || dflt_value FROM pragma_table_info('flashcard_review_sets')
             WHERE name = 'excluded_cards') || ':' ||
          (SELECT type || ':' || dflt_value FROM pragma_table_info('flashcard_review_set_preferences')
             WHERE name = 'excluded_cards') || ':' ||
          (SELECT type || ':' || dflt_value FROM pragma_table_info('flashcard_review_sessions')
             WHERE name = 'excluded_cards_snapshot');")"
[[ "$flashcard_exclusion_columns" == "JSON:'[]':JSON:'[]':JSON:'[]'" ]] || {
  echo "The Review set exclusion migration did not install every card list." >&2
  exit 1
}

flashcard_image_columns="$(sqlite3 "$existing_db" \
  "SELECT COUNT(*) FROM pragma_table_info('flashcards')
   WHERE name IN ('image_url', 'image_file', 'library_image_id', 'image_metadata');")"
[[ "$flashcard_image_columns" == 2 ]] || {
  echo "The flashcard image migrations did not retain only upload and URL fields." >&2
  exit 1
}


flashcard_audio_columns="$(sqlite3 "$existing_db" \
  "SELECT COUNT(*) FROM pragma_table_info('flashcards')
   WHERE name IN ('front_audio_url', 'front_audio_file', 'back_audio_url', 'back_audio_file');")"
[[ "$flashcard_audio_columns" == 4 ]] || {
  echo "The flashcard audio migration did not install all face recording fields." >&2
  exit 1
}

image_library_tables="$(sqlite3 "$existing_db" \
  "SELECT COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name IN (
    'image_sources', 'image_concepts', 'image_concept_terms',
    'image_assets', 'image_concept_assets', 'image_concepts_fts'
  );")"
[[ "$image_library_tables" == 0 ]] || {
  echo "The removed image library left cache tables behind." >&2
  exit 1
}

flashcard_sharing_schema="$(sqlite3 "$existing_db" \
  "SELECT (SELECT COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name IN (
      'flashcard_review_set_shares', 'flashcard_review_set_preferences',
      'flashcard_review_card_stats'
    )) || ':' ||
    (SELECT COUNT(*) FROM pragma_table_info('flashcard_review_sessions')
      WHERE name = 'source_owner') || ':' ||
    (SELECT COUNT(*) FROM pragma_table_info('flashcard_review_set_shares')
      WHERE name = 'recipient_email');")"
[[ "$flashcard_sharing_schema" == "3:1:1" ]] || {
  echo "The Review set sharing migrations did not install their tables, session source, and invitation email." >&2
  exit 1
}

owner_preference_count="$(sqlite3 "$existing_db" \
  'SELECT COUNT(*) FROM flashcard_review_set_preferences
   WHERE (review_set, account) IN (SELECT id, owner FROM flashcard_review_sets);')"
review_set_count="$(sqlite3 "$existing_db" 'SELECT COUNT(*) FROM flashcard_review_sets;')"
[[ "$owner_preference_count" == "$review_set_count" ]] || {
  echo "The Review set sharing migration did not backfill owner preferences." >&2
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

task_tracking_column="$(sqlite3 "$existing_db" \
  "SELECT type || ':' || dflt_value FROM pragma_table_info('tasks') WHERE name = 'tracking_trackers';")"
[[ "$task_tracking_column" == "JSON:'[]'" ]] || {
  echo "The task tracking migration did not install its tracker selection column." >&2
  exit 1
}

echo "SQLite migration bootstrap, baseline, and idempotency checks passed."
