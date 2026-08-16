#!/usr/bin/env bash

set -euo pipefail

test_root="${TMPDIR:-/tmp}"
test_dir="$(mktemp -d "$test_root/backontrack-database-cleanup-test.XXXXXX")"
test_db="$test_dir/data.db"
backup_db="$test_dir/data.backup.db"
rotation_dir="$test_dir/backups"

cleanup() {
  case "$test_dir" in
    "$test_root"/backontrack-database-cleanup-test.*) rm -rf -- "$test_dir" ;;
  esac
}
trap cleanup EXIT

command -v sqlite3 >/dev/null 2>&1 || {
  echo "sqlite3 is required for the database cleanup test." >&2
  exit 1
}

sqlite3 "$test_db" <<'SQL'
CREATE TABLE sync_operation_receipts (
    account_id TEXT NOT NULL,
    client_id TEXT NOT NULL,
    operation_id TEXT NOT NULL,
    response JSON NOT NULL,
    applied_at TEXT NOT NULL,
    PRIMARY KEY (account_id, client_id, operation_id)
);
CREATE TABLE sync_change_log (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT NOT NULL,
    resource TEXT NOT NULL,
    record_id TEXT NOT NULL,
    action TEXT NOT NULL,
    changed_at TEXT NOT NULL
);
CREATE TABLE sync_clients (
    account_id TEXT NOT NULL,
    client_id TEXT NOT NULL,
    acknowledged_cursor INTEGER NOT NULL DEFAULT 0,
    protocol_version INTEGER NOT NULL DEFAULT 1,
    last_seen_at TEXT NOT NULL,
    PRIMARY KEY (account_id, client_id)
);
CREATE TABLE application_data (
    id TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

INSERT INTO sync_operation_receipts VALUES
    ('account-1', 'client-1', 'operation-1', '{"status":"applied"}', '2026-08-09T00:00:00.000Z'),
    ('account-1', 'client-1', 'operation-2', '{"status":"applied"}', '2026-08-10T00:00:00.000Z'),
    ('account-2', 'client-2', 'operation-3', '{"status":"rejected"}', '2026-08-11T00:00:00.000Z');
INSERT INTO sync_change_log (account_id, resource, record_id, action, changed_at) VALUES
    ('account-1', 'tasks', 'task-1', 'upsert', '2026-08-09T00:00:00.000Z'),
    ('account-1', 'tasks', 'task-1', 'upsert', '2026-08-10T00:00:00.000Z'),
    ('account-1', 'tasks', 'task-2', 'delete', '2026-08-11T00:00:00.000Z'),
    ('account-2', 'tasks', 'task-1', 'upsert', '2026-08-12T00:00:00.000Z');
INSERT INTO sync_clients VALUES ('account-1', 'client-1', 4, 1, '2026-08-12T00:00:00.000Z');
INSERT INTO application_data VALUES ('preserved', 'Keep me');
SQL

dry_run_output="$(bash scripts/cleanup-database.sh --database "$test_db")"
[[ "$dry_run_output" == *"Dry run only."* ]] || {
  echo "Cleanup dry run did not report its mode." >&2
  exit 1
}
[[ "$(sqlite3 "$test_db" 'SELECT COUNT(*) FROM sync_operation_receipts;')" == "3" ]] || {
  echo "Cleanup dry run changed operation receipts." >&2
  exit 1
}

bash scripts/cleanup-database.sh \
  --database "$test_db" \
  --backup "$backup_db" \
  --apply \
  --yes

[[ "$(sqlite3 "$test_db" 'SELECT COUNT(*) FROM sync_operation_receipts;')" == "0" ]] || {
  echo "Cleanup did not remove operation receipts." >&2
  exit 1
}
[[ "$(sqlite3 "$test_db" 'SELECT group_concat(sequence, ",") FROM (SELECT sequence FROM sync_change_log ORDER BY sequence);')" == "2,3,4" ]] || {
  echo "Cleanup did not retain exactly the latest change for each account and record." >&2
  exit 1
}
[[ "$(sqlite3 "$test_db" "SELECT value FROM application_data WHERE id = 'preserved';")" == "Keep me" ]] || {
  echo "Cleanup changed application data." >&2
  exit 1
}
[[ "$(sqlite3 "$backup_db" 'SELECT COUNT(*) FROM sync_operation_receipts;')" == "3" ]] || {
  echo "Cleanup backup does not contain the original receipts." >&2
  exit 1
}
[[ "$(sqlite3 "$backup_db" 'SELECT COUNT(*) FROM sync_change_log;')" == "4" ]] || {
  echo "Cleanup backup does not contain the original change log." >&2
  exit 1
}
[[ "$(sqlite3 -readonly "$test_db" 'PRAGMA quick_check;')" == "ok" ]] || {
  echo "Cleaned database failed its integrity check." >&2
  exit 1
}
[[ "$(sqlite3 -readonly "$backup_db" 'PRAGMA quick_check;')" == "ok" ]] || {
  echo "Cleanup backup failed its integrity check." >&2
  exit 1
}

mkdir -p -- "$rotation_dir"
for timestamp in 20260101T000001Z 20260101T000002Z 20260101T000003Z; do
  sqlite3 "$test_db" ".backup '$rotation_dir/data.db.backup-$timestamp'"
done
legacy_backup="$test_dir/data.db.backup-20250101T000000Z"
sqlite3 "$test_db" ".backup '$legacy_backup'"
bash scripts/cleanup-database.sh \
  --database "$test_db" \
  --backup-directory "$rotation_dir" \
  --keep-backups 2 \
  --apply \
  --yes >/dev/null

[[ "$(find "$rotation_dir" -maxdepth 1 -type f -name 'data.db.backup-*' | wc -l | tr -d '[:space:]')" == "2" ]] || {
  echo "Cleanup did not enforce generated backup retention." >&2
  exit 1
}
[[ ! -e "$rotation_dir/data.db.backup-20260101T000001Z" ]] || {
  echo "Cleanup retained the oldest generated backup." >&2
  exit 1
}
[[ ! -e "$legacy_backup" ]] || {
  echo "Cleanup did not move a legacy backup out of the database directory." >&2
  exit 1
}

echo "Database cleanup test passed."
