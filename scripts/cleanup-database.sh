#!/usr/bin/env bash

set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
database_path="${BACKONTRACK_DB_PATH:-private/data.db}"
backup_path=""
apply_cleanup=false
assume_yes=false

usage() {
  cat <<'EOF'
Inspect or clean BackOnTrack's SQLite sync bookkeeping.

Usage:
  pnpm db:cleanup
  pnpm db:cleanup -- --apply
  pnpm db:cleanup -- --apply --yes

Options:
  --database PATH  SQLite database to inspect (default: BACKONTRACK_DB_PATH or private/data.db).
  --backup PATH    Backup destination used with --apply (default: DATABASE.backup-UTC_TIMESTAMP).
  --apply          Delete operation receipts, compact the change log, and vacuum the database.
  --yes            Skip the interactive confirmation. Intended for controlled automation.
  --help           Show this help.

Before using --apply, let every active client finish syncing, close the clients, and stop the API.
The backup is always created and verified before cleanup starts.
EOF
}

fail() {
  echo "Database cleanup stopped: $1" >&2
  exit 1
}

while (( $# )); do
  case "$1" in
    --database)
      [[ $# -ge 2 ]] || fail "--database requires a path."
      database_path="$2"
      shift 2
      ;;
    --backup)
      [[ $# -ge 2 ]] || fail "--backup requires a path."
      backup_path="$2"
      shift 2
      ;;
    --apply)
      apply_cleanup=true
      shift
      ;;
    --yes)
      assume_yes=true
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      fail "unknown option: $1"
      ;;
  esac
done

command -v sqlite3 >/dev/null 2>&1 || fail "sqlite3 is required."

cd "$repository_root"
if [[ "$database_path" != /* ]]; then
  database_path="$repository_root/${database_path#./}"
fi
[[ -f "$database_path" ]] || fail "database not found: $database_path"
[[ -r "$database_path" ]] || fail "database is not readable: $database_path"
if [[ "$apply_cleanup" == true ]]; then
  [[ -w "$database_path" ]] || fail "database is not writable: $database_path"
  [[ -w "$(dirname "$database_path")" ]] \
    || fail "database directory is not writable: $(dirname "$database_path")"
fi

schema_tables="$(sqlite3 -readonly "$database_path" \
  "SELECT COUNT(*) FROM sqlite_schema
   WHERE type = 'table'
     AND name IN ('sync_operation_receipts', 'sync_change_log', 'sync_clients');")"
[[ "$schema_tables" == "3" ]] || fail "database does not contain the expected BackOnTrack sync schema."

integrity="$(sqlite3 -readonly "$database_path" 'PRAGMA quick_check;')"
[[ "$integrity" == "ok" ]] || fail "database integrity check failed before cleanup: $integrity"

database_bytes="$(wc -c < "$database_path" | tr -d '[:space:]')"
receipt_rows="$(sqlite3 -readonly "$database_path" 'SELECT COUNT(*) FROM sync_operation_receipts;')"
receipt_bytes="$(sqlite3 -readonly "$database_path" \
  "SELECT COALESCE(SUM(length(response)), 0) FROM sync_operation_receipts;")"
change_rows="$(sqlite3 -readonly "$database_path" 'SELECT COUNT(*) FROM sync_change_log;')"
retained_change_rows="$(sqlite3 -readonly "$database_path" \
  "SELECT COUNT(*) FROM (
     SELECT 1
     FROM sync_change_log
     GROUP BY account_id, resource, record_id
   );")"
removable_change_rows=$((change_rows - retained_change_rows))

printf 'Database: %s\n' "$database_path"
printf 'Current file size: %s bytes\n' "$database_bytes"
printf 'Operation receipts to remove: %s rows (%s JSON bytes)\n' "$receipt_rows" "$receipt_bytes"
printf 'Redundant change-log rows to remove: %s of %s\n' "$removable_change_rows" "$change_rows"
printf 'Latest change-log rows retained: %s\n' "$retained_change_rows"

if [[ "$apply_cleanup" == false ]]; then
  echo "Dry run only. Run again with --apply after all clients and the API are stopped."
  exit 0
fi

if [[ "$assume_yes" == false ]]; then
  [[ -t 0 ]] || fail "interactive confirmation is unavailable; rerun with --yes after verifying clients and the API are stopped."
  echo
  echo "This permanently removes the receipt cache and redundant change-log history."
  echo "Type CLEAN to continue:"
  read -r confirmation
  [[ "$confirmation" == "CLEAN" ]] || fail "confirmation was not provided."
fi

if [[ -z "$backup_path" ]]; then
  backup_path="$database_path.backup-$(date -u +%Y%m%dT%H%M%SZ)"
elif [[ "$backup_path" != /* ]]; then
  backup_path="$repository_root/${backup_path#./}"
fi
[[ "$backup_path" != "$database_path" ]] || fail "backup path must differ from the database path."
[[ ! -e "$backup_path" ]] || fail "backup already exists: $backup_path"
[[ -w "$(dirname "$backup_path")" ]] || fail "backup directory is not writable: $(dirname "$backup_path")"
[[ "$backup_path" != *$'\n'* && "$backup_path" != *'"'* ]] \
  || fail "backup path cannot contain a newline or double quote."

echo "Creating backup: $backup_path"
printf '.backup "%s"\n' "$backup_path" | sqlite3 "$database_path"
[[ -s "$backup_path" ]] || fail "backup was not created."
backup_integrity="$(sqlite3 -readonly "$backup_path" 'PRAGMA quick_check;')"
[[ "$backup_integrity" == "ok" ]] || fail "backup integrity check failed: $backup_integrity"

echo "Cleaning sync bookkeeping and reclaiming file space..."
sqlite3 -cmd '.timeout 5000' "$database_path" <<'SQL'
.bail on
PRAGMA foreign_keys = ON;
BEGIN IMMEDIATE;

DELETE FROM sync_operation_receipts;

DELETE FROM sync_change_log
WHERE sequence NOT IN (
    SELECT MAX(sequence)
    FROM sync_change_log
    GROUP BY account_id, resource, record_id
);

COMMIT;
VACUUM;
PRAGMA optimize;
SQL

integrity="$(sqlite3 -readonly "$database_path" 'PRAGMA quick_check;')"
[[ "$integrity" == "ok" ]] || fail "database integrity check failed after cleanup: $integrity"

remaining_receipts="$(sqlite3 -readonly "$database_path" 'SELECT COUNT(*) FROM sync_operation_receipts;')"
remaining_changes="$(sqlite3 -readonly "$database_path" 'SELECT COUNT(*) FROM sync_change_log;')"
final_bytes="$(wc -c < "$database_path" | tr -d '[:space:]')"
reclaimed_bytes=$((database_bytes - final_bytes))

echo "Database cleanup completed."
printf 'Backup: %s\n' "$backup_path"
if (( reclaimed_bytes >= 0 )); then
  printf 'Final file size: %s bytes (%s bytes reclaimed)\n' "$final_bytes" "$reclaimed_bytes"
else
  printf 'Final file size: %s bytes (%s bytes larger after page normalization)\n' \
    "$final_bytes" "$((-reclaimed_bytes))"
fi
printf 'Remaining operation receipts: %s\n' "$remaining_receipts"
printf 'Remaining change-log rows: %s\n' "$remaining_changes"
echo "Integrity check: ok"
