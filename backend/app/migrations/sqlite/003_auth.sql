CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at REAL NOT NULL
);
CREATE UNIQUE INDEX users_email_normalized ON users (lower(email));

CREATE TABLE auth_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    refresh_hash TEXT NOT NULL,
    created_at REAL NOT NULL,
    expires_at REAL NOT NULL,
    revoked_at REAL
);
CREATE INDEX auth_sessions_user ON auth_sessions (user_id, expires_at);

CREATE TABLE auth_rate_limits (
    id TEXT PRIMARY KEY,
    window_start REAL NOT NULL,
    attempts INTEGER NOT NULL
);

ALTER TABLE documents ADD COLUMN owner_id TEXT REFERENCES users(id);
CREATE INDEX documents_owner ON documents (collection, owner_id);
ALTER TABLE uploaded_documents ADD COLUMN owner_id TEXT REFERENCES users(id);
CREATE INDEX uploaded_documents_owner ON uploaded_documents (owner_id);
