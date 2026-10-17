-- Relational model for multi-question assignments and Socratic sessions.
-- The legacy documents JSON store remains available for backward compatibility.
CREATE TABLE IF NOT EXISTS assignments (
    id TEXT PRIMARY KEY,
    owner_id TEXT REFERENCES users(id),
    title TEXT NOT NULL,
    prompt TEXT NOT NULL,
    task_type TEXT NOT NULL DEFAULT 'mixed',
    source_text TEXT NOT NULL DEFAULT '',
    document_id TEXT REFERENCES uploaded_documents(id),
    status TEXT NOT NULL DEFAULT 'pending',
    progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assignment_items (
    id TEXT PRIMARY KEY,
    assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
    item_order INTEGER NOT NULL,
    item_type TEXT NOT NULL,
    label TEXT NOT NULL,
    prompt TEXT NOT NULL,
    context TEXT NOT NULL DEFAULT '',
    source_pages TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'pending',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    UNIQUE (assignment_id, item_order)
);

CREATE TABLE IF NOT EXISTS learning_sessions (
    id TEXT PRIMARY KEY,
    assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
    owner_id TEXT REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'active',
    active_item_order INTEGER NOT NULL DEFAULT 1,
    version INTEGER NOT NULL DEFAULT 0,
    tutor_mode TEXT NOT NULL DEFAULT 'openai',
    model TEXT,
    assessment_model TEXT,
    plan_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (assignment_id, owner_id)
);

CREATE TABLE IF NOT EXISTS session_items (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES learning_sessions(id) ON DELETE CASCADE,
    assignment_item_id TEXT NOT NULL REFERENCES assignment_items(id),
    item_order INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    current_objective TEXT,
    bloom_level INTEGER CHECK (bloom_level BETWEEN 1 AND 6),
    hint_count INTEGER NOT NULL DEFAULT 0,
    plan_json TEXT NOT NULL DEFAULT '{}',
    assessment_json TEXT,
    started_at TEXT,
    completed_at TEXT,
    UNIQUE (session_id, assignment_item_id),
    UNIQUE (session_id, item_order)
);

CREATE TABLE IF NOT EXISTS session_turns (
    id TEXT PRIMARY KEY,
    session_item_id TEXT NOT NULL REFERENCES session_items(id) ON DELETE CASCADE,
    turn_order INTEGER NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('student', 'tutor', 'hint', 'system')),
    kind TEXT NOT NULL,
    text TEXT NOT NULL,
    bloom_level INTEGER CHECK (bloom_level BETWEEN 1 AND 6),
    strategy TEXT,
    objective TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    UNIQUE (session_item_id, turn_order)
);

CREATE INDEX IF NOT EXISTS assignments_owner_updated ON assignments (owner_id, updated_at);
CREATE INDEX IF NOT EXISTS assignment_items_assignment_order ON assignment_items (assignment_id, item_order);
CREATE INDEX IF NOT EXISTS learning_sessions_owner_status ON learning_sessions (owner_id, status, updated_at);
CREATE INDEX IF NOT EXISTS session_items_session_order ON session_items (session_id, item_order);
CREATE INDEX IF NOT EXISTS session_turns_item_order ON session_turns (session_item_id, turn_order);
