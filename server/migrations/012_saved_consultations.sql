-- Explicitly saved, redacted consultation snapshots survive active-session expiry.
-- No dependency on model weights and no automatic indefinite raw customer transcript.
CREATE TABLE intelligence_saved_conversations (
 id TEXT PRIMARY KEY,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 source_session_id TEXT NOT NULL,
 title TEXT NOT NULL,
 snapshot_json TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 UNIQUE(user_id,source_session_id)
);
CREATE INDEX intelligence_saved_owner_time ON intelligence_saved_conversations(user_id,updated_at);
