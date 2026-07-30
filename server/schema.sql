PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

BEGIN;

CREATE TABLE users (
    id TEXT PRIMARY KEY NOT NULL DEFAULT ('r' || lower(hex(randomblob(7)))),
    email TEXT NOT NULL COLLATE NOCASE,
    email_visibility BOOLEAN NOT NULL DEFAULT FALSE,
    verified BOOLEAN NOT NULL DEFAULT FALSE,
    name TEXT NOT NULL DEFAULT '',
    avatar TEXT NOT NULL DEFAULT '',
    password TEXT NOT NULL,
    token_key TEXT NOT NULL,
    timezone TEXT NOT NULL DEFAULT 'UTC',
    settings JSON NOT NULL DEFAULT '{}',
    created TEXT NOT NULL,
    updated TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_users_email ON users (email COLLATE NOCASE);
CREATE UNIQUE INDEX idx_users_token_key ON users (token_key);

CREATE TABLE tags (
    id TEXT PRIMARY KEY NOT NULL DEFAULT ('r' || lower(hex(randomblob(7)))),
    owner TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT ''
);

CREATE UNIQUE INDEX idx_tags_owner_name ON tags (owner, name);

CREATE TABLE tasks (
    id TEXT PRIMARY KEY NOT NULL DEFAULT ('r' || lower(hex(randomblob(7)))),
    owner TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL DEFAULT '',
    tags JSON NOT NULL DEFAULT '[]',
    mandatory BOOLEAN NOT NULL DEFAULT FALSE,
    review_when_missed BOOLEAN NOT NULL DEFAULT FALSE,
    active BOOLEAN NOT NULL DEFAULT FALSE,
    start_date TEXT NOT NULL DEFAULT '',
    end_date TEXT NOT NULL DEFAULT '',
    recurrence_type TEXT NOT NULL DEFAULT '',
    weekdays JSON DEFAULT NULL,
    interval_weeks NUMERIC NOT NULL DEFAULT 0,
    target_value NUMERIC NOT NULL DEFAULT 0,
    target_operator TEXT NOT NULL DEFAULT '',
    unit TEXT NOT NULL DEFAULT '',
    custom_unit TEXT NOT NULL DEFAULT '',
    goal_period TEXT NOT NULL DEFAULT '',
    quick_amounts JSON DEFAULT NULL,
    cycle_length NUMERIC NOT NULL DEFAULT 0,
    program_repeat BOOLEAN NOT NULL DEFAULT FALSE,
    program_strict BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order NUMERIC NOT NULL DEFAULT 0,
    color TEXT NOT NULL DEFAULT ''
);

CREATE INDEX idx_tasks_owner_active ON tasks (owner, active);

CREATE TABLE program_steps (
    id TEXT PRIMARY KEY NOT NULL DEFAULT ('r' || lower(hex(randomblob(7)))),
    owner TEXT NOT NULL,
    task TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    sort_order NUMERIC NOT NULL DEFAULT 0,
    cycle_days JSON DEFAULT NULL,
    completion_type TEXT NOT NULL DEFAULT '',
    target_value NUMERIC NOT NULL DEFAULT 0,
    target_operator TEXT NOT NULL DEFAULT '',
    unit TEXT NOT NULL DEFAULT '',
    custom_unit TEXT NOT NULL DEFAULT '',
    quick_amounts JSON DEFAULT NULL,
    active BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX idx_program_steps_task_order ON program_steps (task, sort_order);

CREATE TABLE occurrences (
    id TEXT PRIMARY KEY NOT NULL DEFAULT ('r' || lower(hex(randomblob(7)))),
    owner TEXT NOT NULL,
    task TEXT NOT NULL DEFAULT '',
    program_step TEXT NOT NULL DEFAULT '',
    scheduled_date TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT '',
    sealed BOOLEAN NOT NULL DEFAULT FALSE,
    completed_at TEXT NOT NULL DEFAULT '',
    snapshot_name TEXT NOT NULL DEFAULT '',
    snapshot_target NUMERIC NOT NULL DEFAULT 0,
    snapshot_unit TEXT NOT NULL DEFAULT ''
);

CREATE UNIQUE INDEX idx_occurrences_unique
    ON occurrences (task, program_step, scheduled_date);
CREATE INDEX idx_occurrences_owner_date
    ON occurrences (owner, scheduled_date);

CREATE TABLE entries (
    id TEXT PRIMARY KEY NOT NULL DEFAULT ('r' || lower(hex(randomblob(7)))),
    owner TEXT NOT NULL,
    task TEXT NOT NULL DEFAULT '',
    occurrence TEXT NOT NULL DEFAULT '',
    program_step TEXT NOT NULL DEFAULT '',
    entry_date TEXT NOT NULL DEFAULT '',
    value NUMERIC NOT NULL DEFAULT 0,
    kind TEXT NOT NULL DEFAULT '',
    unit TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT ''
);

CREATE INDEX idx_entries_owner_date ON entries (owner, entry_date);

CREATE TABLE interval_templates (
    id TEXT PRIMARY KEY NOT NULL DEFAULT ('r' || lower(hex(randomblob(7)))),
    owner TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT '',
    definition JSON DEFAULT NULL,
    sound_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    vibration_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    sound TEXT NOT NULL DEFAULT '',
    sort_order NUMERIC NOT NULL DEFAULT 0
);

CREATE INDEX idx_interval_templates_owner_order
    ON interval_templates (owner, sort_order);

CREATE TABLE interval_sessions (
    id TEXT PRIMARY KEY NOT NULL DEFAULT ('r' || lower(hex(randomblob(7)))),
    owner TEXT NOT NULL,
    template TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT '',
    snapshot_name TEXT NOT NULL DEFAULT '',
    definition_snapshot JSON DEFAULT NULL,
    cue_snapshot JSON DEFAULT NULL,
    started_at TEXT NOT NULL DEFAULT '',
    ended_at TEXT NOT NULL DEFAULT '',
    planned_seconds NUMERIC NOT NULL DEFAULT 0,
    elapsed_seconds NUMERIC NOT NULL DEFAULT 0,
    runtime_state JSON DEFAULT NULL
);

CREATE INDEX idx_interval_sessions_owner_started
    ON interval_sessions (owner, started_at);
CREATE INDEX idx_interval_sessions_owner_status
    ON interval_sessions (owner, status);

CREATE TABLE mom_rate_limits (
    rate_key TEXT PRIMARY KEY NOT NULL,
    window_start INTEGER NOT NULL,
    hits INTEGER NOT NULL
);

CREATE TABLE mom_passkey_challenges (
    id TEXT PRIMARY KEY NOT NULL,
    purpose TEXT NOT NULL CHECK (purpose IN ('register', 'login')),
    user_id TEXT,
    user_handle TEXT,
    challenge BLOB NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE INDEX idx_mom_passkey_challenges_expiry
    ON mom_passkey_challenges (expires_at);

CREATE TABLE mom_passkeys (
    credential_id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    user_handle TEXT NOT NULL,
    public_key TEXT NOT NULL,
    signature_counter INTEGER,
    transports TEXT NOT NULL DEFAULT '[]',
    backup_eligible BOOLEAN NOT NULL DEFAULT FALSE,
    backed_up BOOLEAN NOT NULL DEFAULT FALSE,
    created TEXT NOT NULL,
    last_used TEXT NOT NULL DEFAULT '',
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_mom_passkeys_user ON mom_passkeys (user_id);

CREATE TABLE mom_schema_migrations (
    version TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL
);

COMMIT;
