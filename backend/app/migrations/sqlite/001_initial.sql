CREATE TABLE IF NOT EXISTS documents (
    collection TEXT,
    id TEXT,
    body TEXT NOT NULL,
    PRIMARY KEY (collection, id)
);

CREATE TABLE uploaded_documents (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    storage_key TEXT NOT NULL UNIQUE,
    sha256 TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('uploaded', 'processing', 'needs_review', 'failed')),
    title TEXT NOT NULL,
    extracted_text TEXT,
    error TEXT,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);

CREATE TABLE jobs (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL UNIQUE REFERENCES uploaded_documents(id),
    type TEXT NOT NULL CHECK (type = 'extract_document'),
    status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    available_at REAL NOT NULL,
    lease_until REAL,
    lease_token TEXT,
    last_error TEXT,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);

CREATE INDEX jobs_pending ON jobs (status, available_at, lease_until, created_at);
