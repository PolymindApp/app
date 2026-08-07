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

CREATE TABLE flashcard_tags (
    id TEXT PRIMARY KEY NOT NULL DEFAULT ('r' || lower(hex(randomblob(7)))),
    owner TEXT NOT NULL,
    name VARCHAR(50) NOT NULL DEFAULT '' COLLATE NOCASE
);

CREATE UNIQUE INDEX idx_flashcard_tags_owner_name
    ON flashcard_tags (owner, name COLLATE NOCASE);

CREATE TABLE flashcards (
    id TEXT PRIMARY KEY NOT NULL DEFAULT ('r' || lower(hex(randomblob(7)))),
    owner TEXT NOT NULL,
    front TEXT NOT NULL DEFAULT '',
    back TEXT NOT NULL DEFAULT '',
    note VARCHAR(2000) NOT NULL DEFAULT '',
    tags JSON NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT '',
    last_reviewed_at TEXT NOT NULL DEFAULT '',
    passive_views INTEGER NOT NULL DEFAULT 0,
    success_count INTEGER NOT NULL DEFAULT 0,
    error_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_flashcards_owner_created
    ON flashcards (owner, created_at DESC);
CREATE INDEX idx_flashcards_owner_reviewed
    ON flashcards (owner, last_reviewed_at);

CREATE TABLE flashcard_review_sets (
    id TEXT PRIMARY KEY NOT NULL DEFAULT ('r' || lower(hex(randomblob(7)))),
    owner TEXT NOT NULL,
    name VARCHAR(160) NOT NULL DEFAULT '',
    tags JSON NOT NULL DEFAULT '[]',
    mode TEXT NOT NULL DEFAULT 'manual',
    indefinite BOOLEAN NOT NULL DEFAULT FALSE,
    max_cards INTEGER NOT NULL DEFAULT 20,
    front_seconds INTEGER NOT NULL DEFAULT 5,
    back_seconds INTEGER NOT NULL DEFAULT 5,
    back_speech_repeat_count INTEGER NOT NULL DEFAULT 1,
    speech_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    front_language VARCHAR(35) NOT NULL DEFAULT '',
    back_language VARCHAR(35) NOT NULL DEFAULT '',
    sort_mode TEXT NOT NULL DEFAULT 'difficult',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT ''
);

CREATE INDEX idx_flashcard_review_sets_owner_order
    ON flashcard_review_sets (owner, sort_order, name);

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
    entry_notes_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    entry_note_suggestions_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order NUMERIC NOT NULL DEFAULT 0,
    color TEXT NOT NULL DEFAULT '',
    interval_template TEXT NOT NULL DEFAULT '',
    flashcard_review_set TEXT NOT NULL DEFAULT '',
    tracking_trackers JSON NOT NULL DEFAULT '[]'
);

CREATE INDEX idx_tasks_owner_active ON tasks (owner, active);
CREATE INDEX idx_tasks_owner_interval_template
    ON tasks (owner, interval_template);
CREATE INDEX idx_tasks_owner_flashcard_review_set
    ON tasks (owner, flashcard_review_set);

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
    active BOOLEAN NOT NULL DEFAULT FALSE,
    interval_template TEXT NOT NULL DEFAULT '',
    flashcard_review_set TEXT NOT NULL DEFAULT ''
);

CREATE INDEX idx_program_steps_task_order ON program_steps (task, sort_order);
CREATE INDEX idx_program_steps_owner_interval_template
    ON program_steps (owner, interval_template);
CREATE INDEX idx_program_steps_owner_flashcard_review_set
    ON program_steps (owner, flashcard_review_set);

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
    created_at TEXT NOT NULL DEFAULT '',
    value NUMERIC NOT NULL DEFAULT 0,
    kind TEXT NOT NULL DEFAULT '',
    unit TEXT NOT NULL DEFAULT '',
    note VARCHAR(255) NOT NULL DEFAULT ''
        CHECK (length(note) <= 255 AND instr(note, char(10)) = 0 AND instr(note, char(13)) = 0)
);

CREATE INDEX idx_entries_owner_date ON entries (owner, entry_date);
CREATE INDEX idx_entries_task_created ON entries (task, created_at DESC);

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
    sort_order NUMERIC NOT NULL DEFAULT 0,
    flashcard_review_set TEXT NOT NULL DEFAULT ''
);

CREATE INDEX idx_interval_templates_owner_order
    ON interval_templates (owner, sort_order);
CREATE INDEX idx_interval_templates_owner_flashcard_review_set
    ON interval_templates (owner, flashcard_review_set);

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
    runtime_state JSON DEFAULT NULL,
    task TEXT NOT NULL DEFAULT '',
    program_step TEXT NOT NULL DEFAULT '',
    task_date TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    flashcard_snapshot JSON NOT NULL DEFAULT '{}'
);

CREATE INDEX idx_interval_sessions_owner_started
    ON interval_sessions (owner, started_at);
CREATE INDEX idx_interval_sessions_owner_status
    ON interval_sessions (owner, status);
CREATE INDEX idx_interval_sessions_owner_task_date
    ON interval_sessions (owner, task, task_date);
CREATE INDEX idx_interval_sessions_owner_program_step_date
    ON interval_sessions (owner, program_step, task_date);

CREATE TABLE flashcard_review_sessions (
    id TEXT PRIMARY KEY NOT NULL DEFAULT ('r' || lower(hex(randomblob(7)))),
    owner TEXT NOT NULL,
    review_set TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'running',
    snapshot_name VARCHAR(160) NOT NULL DEFAULT '',
    mode_snapshot TEXT NOT NULL DEFAULT 'manual',
    indefinite_snapshot BOOLEAN NOT NULL DEFAULT FALSE,
    sort_snapshot TEXT NOT NULL DEFAULT 'difficult',
    tags_snapshot JSON NOT NULL DEFAULT '[]',
    front_seconds_snapshot INTEGER NOT NULL DEFAULT 5,
    back_seconds_snapshot INTEGER NOT NULL DEFAULT 5,
    back_speech_repeat_count_snapshot INTEGER NOT NULL DEFAULT 1,
    speech_enabled_snapshot BOOLEAN NOT NULL DEFAULT FALSE,
    front_language_snapshot VARCHAR(35) NOT NULL DEFAULT '',
    back_language_snapshot VARCHAR(35) NOT NULL DEFAULT '',
    queue_state JSON NOT NULL DEFAULT '[]',
    started_at TEXT NOT NULL DEFAULT '',
    ended_at TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT '',
    elapsed_seconds INTEGER NOT NULL DEFAULT 0,
    total_cards INTEGER NOT NULL DEFAULT 0,
    viewed_count INTEGER NOT NULL DEFAULT 0,
    success_count INTEGER NOT NULL DEFAULT 0,
    error_count INTEGER NOT NULL DEFAULT 0,
    ejected_count INTEGER NOT NULL DEFAULT 0,
    task TEXT NOT NULL DEFAULT '',
    program_step TEXT NOT NULL DEFAULT '',
    task_date TEXT NOT NULL DEFAULT ''
);

CREATE INDEX idx_flashcard_review_sessions_owner_started
    ON flashcard_review_sessions (owner, started_at DESC);
CREATE INDEX idx_flashcard_review_sessions_owner_status
    ON flashcard_review_sessions (owner, status);
CREATE INDEX idx_flashcard_review_sessions_owner_task_date
    ON flashcard_review_sessions (owner, task, task_date);
CREATE UNIQUE INDEX idx_flashcard_review_sessions_one_active
    ON flashcard_review_sessions (owner)
    WHERE status IN ('running', 'paused');

CREATE TABLE flashcard_review_events (
    id TEXT PRIMARY KEY NOT NULL DEFAULT ('r' || lower(hex(randomblob(7)))),
    owner TEXT NOT NULL,
    session TEXT NOT NULL DEFAULT '',
    card TEXT NOT NULL DEFAULT '',
    outcome TEXT NOT NULL DEFAULT '',
    reviewed_at TEXT NOT NULL DEFAULT '',
    front_snapshot TEXT NOT NULL DEFAULT '',
    back_snapshot TEXT NOT NULL DEFAULT '',
    tags_snapshot JSON NOT NULL DEFAULT '[]'
);

CREATE INDEX idx_flashcard_review_events_owner_session
    ON flashcard_review_events (owner, session, reviewed_at);
CREATE INDEX idx_flashcard_review_events_owner_card
    ON flashcard_review_events (owner, card, reviewed_at DESC);

CREATE TABLE tracking_trackers (
    id TEXT PRIMARY KEY NOT NULL DEFAULT ('r' || lower(hex(randomblob(7)))),
    owner TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'factor',
    kind TEXT NOT NULL DEFAULT 'yes_no',
    category TEXT NOT NULL DEFAULT 'other',
    unit TEXT NOT NULL DEFAULT '',
    scale_min NUMERIC NOT NULL DEFAULT 0,
    scale_max NUMERIC NOT NULL DEFAULT 0,
    favorable_direction TEXT NOT NULL DEFAULT 'neutral',
    daily_aggregation TEXT NOT NULL DEFAULT 'last',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order NUMERIC NOT NULL DEFAULT 0,
    color TEXT NOT NULL DEFAULT '#C7F464',
    icon TEXT NOT NULL DEFAULT 'mdi-checkbox-marked-circle-outline',
    reminder_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    reminder_time TEXT NOT NULL DEFAULT '20:00',
    reminder_show_name BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX idx_tracking_trackers_owner_active_order
    ON tracking_trackers (owner, active, sort_order);

CREATE TABLE tracking_entries (
    id TEXT PRIMARY KEY NOT NULL DEFAULT ('r' || lower(hex(randomblob(7)))),
    owner TEXT NOT NULL,
    tracker TEXT NOT NULL DEFAULT '',
    occurred_at TEXT NOT NULL DEFAULT '',
    local_date TEXT NOT NULL DEFAULT '',
    timezone_offset INTEGER NOT NULL DEFAULT 0,
    value NUMERIC NOT NULL DEFAULT 0,
    note TEXT NOT NULL DEFAULT ''
);

CREATE INDEX idx_tracking_entries_owner_date ON tracking_entries (owner, local_date);
CREATE INDEX idx_tracking_entries_tracker_occurred ON tracking_entries (tracker, occurred_at);

CREATE TABLE journal_entries (
    id TEXT PRIMARY KEY NOT NULL DEFAULT ('r' || lower(hex(randomblob(7)))),
    owner TEXT NOT NULL,
    title VARCHAR(160) NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    occurred_at TEXT NOT NULL DEFAULT '',
    local_date TEXT NOT NULL DEFAULT '',
    timezone_offset INTEGER NOT NULL DEFAULT 0,
    task TEXT NOT NULL DEFAULT '',
    tracker TEXT NOT NULL DEFAULT '',
    task_snapshot VARCHAR(160) NOT NULL DEFAULT '',
    tracker_snapshot VARCHAR(160) NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT ''
);

CREATE INDEX idx_journal_entries_owner_date
    ON journal_entries (owner, local_date, occurred_at DESC);
CREATE INDEX idx_journal_entries_task_date
    ON journal_entries (task, local_date, occurred_at DESC);
CREATE INDEX idx_journal_entries_tracker_date
    ON journal_entries (tracker, local_date, occurred_at DESC);

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
