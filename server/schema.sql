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
    image_url VARCHAR(2048) NOT NULL DEFAULT '',
    image_file VARCHAR(52) NOT NULL DEFAULT '',
    library_image_id INTEGER NOT NULL DEFAULT 0,
    image_metadata JSON NOT NULL DEFAULT '{}',
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

CREATE TABLE image_sources (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    language VARCHAR(35) NOT NULL DEFAULT '',
    source_url VARCHAR(2048) NOT NULL DEFAULT '',
    license_name TEXT NOT NULL DEFAULT '',
    license_url VARCHAR(2048) NOT NULL DEFAULT '',
    attribution TEXT NOT NULL DEFAULT ''
);

CREATE TABLE image_concepts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_key TEXT NOT NULL UNIQUE,
    canonical_name TEXT NOT NULL COLLATE NOCASE,
    part_of_speech TEXT NOT NULL,
    semantic_category TEXT NOT NULL DEFAULT '',
    definition TEXT NOT NULL DEFAULT '',
    search_query TEXT NOT NULL,
    search_text TEXT NOT NULL DEFAULT '',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    pexels_searched BOOLEAN NOT NULL DEFAULT FALSE,
    pexels_searched_at TEXT NOT NULL DEFAULT '',
    pexels_result_count INTEGER NOT NULL DEFAULT 0,
    last_search_error TEXT NOT NULL DEFAULT '',
    CHECK (part_of_speech IN ('noun', 'verb', 'adjective', 'adverb', 'preposition'))
);

CREATE INDEX idx_image_concepts_pending
    ON image_concepts (active, pexels_searched, id);
CREATE INDEX idx_image_concepts_name
    ON image_concepts (canonical_name COLLATE NOCASE);

CREATE TABLE image_concept_terms (
    concept_id INTEGER NOT NULL,
    language VARCHAR(35) NOT NULL,
    term TEXT NOT NULL,
    source_id TEXT NOT NULL,
    PRIMARY KEY (concept_id, language, term, source_id),
    FOREIGN KEY (concept_id) REFERENCES image_concepts (id) ON DELETE CASCADE,
    FOREIGN KEY (source_id) REFERENCES image_sources (id) ON DELETE RESTRICT
);

CREATE INDEX idx_image_concept_terms_language_term
    ON image_concept_terms (language, term COLLATE NOCASE);

CREATE TABLE image_assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    filename VARCHAR(52) NOT NULL,
    content_sha256 VARCHAR(64) NOT NULL,
    source_url VARCHAR(2048) NOT NULL,
    download_url VARCHAR(2048) NOT NULL,
    photographer TEXT NOT NULL DEFAULT '',
    photographer_url VARCHAR(2048) NOT NULL DEFAULT '',
    photographer_id TEXT NOT NULL DEFAULT '',
    alt TEXT NOT NULL DEFAULT '',
    source_width INTEGER NOT NULL DEFAULT 0,
    source_height INTEGER NOT NULL DEFAULT 0,
    average_color VARCHAR(20) NOT NULL DEFAULT '',
    license_name TEXT NOT NULL,
    license_url VARCHAR(2048) NOT NULL,
    fetched_at TEXT NOT NULL,
    UNIQUE (provider, provider_id)
);

CREATE INDEX idx_image_assets_filename ON image_assets (filename);
CREATE INDEX idx_image_assets_content_hash ON image_assets (content_sha256);

CREATE TABLE image_concept_assets (
    concept_id INTEGER NOT NULL,
    image_id INTEGER NOT NULL,
    result_rank INTEGER NOT NULL,
    linked_at TEXT NOT NULL,
    PRIMARY KEY (concept_id, image_id),
    FOREIGN KEY (concept_id) REFERENCES image_concepts (id) ON DELETE CASCADE,
    FOREIGN KEY (image_id) REFERENCES image_assets (id) ON DELETE CASCADE
);

CREATE INDEX idx_image_concept_assets_rank
    ON image_concept_assets (concept_id, result_rank, image_id);

CREATE VIRTUAL TABLE image_concepts_fts USING fts5(
    canonical_name,
    search_text,
    content = 'image_concepts',
    content_rowid = 'id',
    tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER image_concepts_fts_insert
AFTER INSERT ON image_concepts BEGIN
    INSERT INTO image_concepts_fts(rowid, canonical_name, search_text)
    VALUES (new.id, new.canonical_name, new.search_text);
END;

CREATE TRIGGER image_concepts_fts_delete
AFTER DELETE ON image_concepts BEGIN
    INSERT INTO image_concepts_fts(
        image_concepts_fts, rowid, canonical_name, search_text
    ) VALUES ('delete', old.id, old.canonical_name, old.search_text);
END;

CREATE TRIGGER image_concepts_fts_update
AFTER UPDATE OF canonical_name, search_text ON image_concepts BEGIN
    INSERT INTO image_concepts_fts(
        image_concepts_fts, rowid, canonical_name, search_text
    ) VALUES ('delete', old.id, old.canonical_name, old.search_text);
    INSERT INTO image_concepts_fts(rowid, canonical_name, search_text)
    VALUES (new.id, new.canonical_name, new.search_text);
END;

CREATE TABLE flashcard_review_sets (
    id TEXT PRIMARY KEY NOT NULL DEFAULT ('r' || lower(hex(randomblob(7)))),
    owner TEXT NOT NULL,
    name VARCHAR(160) NOT NULL DEFAULT '',
    tags JSON NOT NULL DEFAULT '[]',
    mode TEXT NOT NULL DEFAULT 'manual',
    card_sides TEXT NOT NULL DEFAULT 'both',
    indefinite BOOLEAN NOT NULL DEFAULT FALSE,
    max_cards INTEGER NOT NULL DEFAULT 20,
    front_seconds INTEGER NOT NULL DEFAULT 5,
    back_seconds INTEGER NOT NULL DEFAULT 5,
    back_speech_repeat_count INTEGER NOT NULL DEFAULT 1,
    note_before_back BOOLEAN NOT NULL DEFAULT FALSE,
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

CREATE TABLE flashcard_review_set_shares (
    id TEXT PRIMARY KEY NOT NULL,
    review_set TEXT NOT NULL,
    recipient TEXT NOT NULL,
    recipient_email TEXT NOT NULL DEFAULT '' COLLATE NOCASE,
    role TEXT NOT NULL DEFAULT 'readonly',
    created_at TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT '',
    CHECK (role IN ('readonly', 'editor')),
    UNIQUE (review_set, recipient)
);

CREATE INDEX idx_flashcard_review_set_shares_recipient
    ON flashcard_review_set_shares (recipient, review_set);
CREATE INDEX idx_flashcard_review_set_shares_set
    ON flashcard_review_set_shares (review_set, recipient);
CREATE UNIQUE INDEX idx_flashcard_review_set_shares_email
    ON flashcard_review_set_shares (review_set, recipient_email COLLATE NOCASE)
    WHERE recipient_email <> '';

CREATE TABLE flashcard_review_set_preferences (
    review_set TEXT NOT NULL,
    account TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'manual',
    card_sides TEXT NOT NULL DEFAULT 'both',
    indefinite BOOLEAN NOT NULL DEFAULT FALSE,
    max_cards INTEGER NOT NULL DEFAULT 20,
    front_seconds INTEGER NOT NULL DEFAULT 5,
    back_seconds INTEGER NOT NULL DEFAULT 5,
    back_speech_repeat_count INTEGER NOT NULL DEFAULT 1,
    note_before_back BOOLEAN NOT NULL DEFAULT FALSE,
    speech_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    front_language VARCHAR(35) NOT NULL DEFAULT '',
    back_language VARCHAR(35) NOT NULL DEFAULT '',
    sort_mode TEXT NOT NULL DEFAULT 'difficult',
    updated_at TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (review_set, account)
);

CREATE INDEX idx_flashcard_review_set_preferences_account
    ON flashcard_review_set_preferences (account, review_set);

CREATE TABLE flashcard_review_card_stats (
    reviewer TEXT NOT NULL,
    card TEXT NOT NULL,
    last_reviewed_at TEXT NOT NULL DEFAULT '',
    passive_views INTEGER NOT NULL DEFAULT 0,
    success_count INTEGER NOT NULL DEFAULT 0,
    error_count INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (reviewer, card)
);

CREATE INDEX idx_flashcard_review_card_stats_card
    ON flashcard_review_card_stats (card, reviewer);

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
    session_count_mode TEXT NOT NULL DEFAULT 'task',
    session_goal_type TEXT NOT NULL DEFAULT 'complete',
    session_target_seconds NUMERIC NOT NULL DEFAULT 0,
    tracking_trackers JSON NOT NULL DEFAULT '[]',
    reminder_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    reminder_times JSON NOT NULL DEFAULT '[]'
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
        CHECK (length(note) <= 255 AND instr(note, char(10)) = 0 AND instr(note, char(13)) = 0),
    source_type TEXT NOT NULL DEFAULT '',
    source_session TEXT NOT NULL DEFAULT ''
);

CREATE INDEX idx_entries_owner_date ON entries (owner, entry_date);
CREATE INDEX idx_entries_task_created ON entries (task, created_at DESC);
CREATE UNIQUE INDEX idx_entries_task_source_session
    ON entries (owner, task, program_step, source_type, source_session)
    WHERE source_session != '';

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
    flashcard_snapshot JSON NOT NULL DEFAULT '{}',
    client_id TEXT NOT NULL DEFAULT ''
);

CREATE INDEX idx_interval_sessions_owner_started
    ON interval_sessions (owner, started_at);
CREATE INDEX idx_interval_sessions_owner_status
    ON interval_sessions (owner, status);
CREATE INDEX idx_interval_sessions_owner_task_date
    ON interval_sessions (owner, task, task_date);
CREATE INDEX idx_interval_sessions_owner_program_step_date
    ON interval_sessions (owner, program_step, task_date);
CREATE INDEX idx_interval_sessions_owner_client_status
    ON interval_sessions (owner, client_id, status);

CREATE TABLE flashcard_review_sessions (
    id TEXT PRIMARY KEY NOT NULL DEFAULT ('r' || lower(hex(randomblob(7)))),
    owner TEXT NOT NULL,
    source_owner TEXT NOT NULL DEFAULT '',
    review_set TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'running',
    snapshot_name VARCHAR(160) NOT NULL DEFAULT '',
    mode_snapshot TEXT NOT NULL DEFAULT 'manual',
    card_sides_snapshot TEXT NOT NULL DEFAULT 'both',
    indefinite_snapshot BOOLEAN NOT NULL DEFAULT FALSE,
    max_cards_snapshot INTEGER NOT NULL DEFAULT 20,
    sort_snapshot TEXT NOT NULL DEFAULT 'difficult',
    tags_snapshot JSON NOT NULL DEFAULT '[]',
    front_seconds_snapshot INTEGER NOT NULL DEFAULT 5,
    back_seconds_snapshot INTEGER NOT NULL DEFAULT 5,
    back_speech_repeat_count_snapshot INTEGER NOT NULL DEFAULT 1,
    note_before_back_snapshot BOOLEAN NOT NULL DEFAULT FALSE,
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
    task_date TEXT NOT NULL DEFAULT '',
    client_id TEXT NOT NULL DEFAULT ''
);

CREATE INDEX idx_flashcard_review_sessions_owner_started
    ON flashcard_review_sessions (owner, started_at DESC);
CREATE INDEX idx_flashcard_review_sessions_owner_status
    ON flashcard_review_sessions (owner, status);
CREATE INDEX idx_flashcard_review_sessions_owner_task_date
    ON flashcard_review_sessions (owner, task, task_date);
CREATE UNIQUE INDEX idx_flashcard_review_sessions_one_active_device
    ON flashcard_review_sessions (owner, client_id)
    WHERE client_id <> '' AND status IN ('running', 'paused');
CREATE INDEX idx_flashcard_review_sessions_owner_client_status
    ON flashcard_review_sessions (owner, client_id, status);

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
    icon TEXT NOT NULL DEFAULT 'mdi-checkbox-marked-circle-outline'
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
    image_url TEXT NOT NULL DEFAULT '',
    image_file VARCHAR(52) NOT NULL DEFAULT '',
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

CREATE TABLE polymind_rate_limits (
    rate_key TEXT PRIMARY KEY NOT NULL,
    window_start INTEGER NOT NULL,
    hits INTEGER NOT NULL
);

CREATE TABLE polymind_auth_tokens (
    token_hash TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    purpose TEXT NOT NULL CHECK (purpose IN ('email_verification', 'password_reset')),
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE (user_id, purpose)
);

CREATE INDEX idx_polymind_auth_tokens_expiry
    ON polymind_auth_tokens (expires_at);

CREATE TABLE polymind_passkey_challenges (
    id TEXT PRIMARY KEY NOT NULL,
    purpose TEXT NOT NULL CHECK (purpose IN ('register', 'login')),
    user_id TEXT,
    user_handle TEXT,
    challenge BLOB NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE INDEX idx_polymind_passkey_challenges_expiry
    ON polymind_passkey_challenges (expires_at);

CREATE TABLE polymind_passkeys (
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

CREATE INDEX idx_polymind_passkeys_user ON polymind_passkeys (user_id);

CREATE TABLE sync_record_versions (
    account_id TEXT NOT NULL,
    resource TEXT NOT NULL,
    record_id TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    field_clocks JSON NOT NULL DEFAULT '{}',
    deleted BOOLEAN NOT NULL DEFAULT FALSE,
    modified_at TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (account_id, resource, record_id)
);
CREATE INDEX idx_sync_record_versions_resource
    ON sync_record_versions (account_id, resource, deleted, record_id);

CREATE TABLE sync_change_log (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT NOT NULL,
    resource TEXT NOT NULL,
    record_id TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('upsert', 'delete')),
    changed_at TEXT NOT NULL
);
CREATE INDEX idx_sync_change_log_account_sequence
    ON sync_change_log (account_id, sequence);

CREATE TABLE sync_operation_receipts (
    account_id TEXT NOT NULL,
    client_id TEXT NOT NULL,
    operation_id TEXT NOT NULL,
    response JSON NOT NULL,
    applied_at TEXT NOT NULL,
    PRIMARY KEY (account_id, client_id, operation_id)
);

CREATE TABLE sync_clients (
    account_id TEXT NOT NULL,
    client_id TEXT NOT NULL,
    acknowledged_cursor INTEGER NOT NULL DEFAULT 0,
    protocol_version INTEGER NOT NULL DEFAULT 1,
    last_seen_at TEXT NOT NULL,
    PRIMARY KEY (account_id, client_id)
);

CREATE TABLE polymind_schema_migrations (
    version TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL
);

COMMIT;
