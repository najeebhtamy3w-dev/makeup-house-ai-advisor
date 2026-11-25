-- V3.2 additive consultation memory/diagnostics. Never stores hidden reasoning or changes existing product records.
CREATE TABLE intelligence_memory (
 session_id TEXT PRIMARY KEY REFERENCES advisor_sessions(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL DEFAULT 0,
 state_json TEXT NOT NULL DEFAULT '{}',
 updated_at TEXT NOT NULL
);
CREATE TABLE intelligence_diagnostics (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 session_id TEXT NOT NULL REFERENCES advisor_sessions(id) ON DELETE CASCADE,
 user_id INTEGER NOT NULL REFERENCES users(id),
 provenance TEXT NOT NULL,
 diagnostics_json TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX intelligence_diagnostics_session ON intelligence_diagnostics(session_id,id);
-- Global knowledge never implies stock. Imported records default to draft pending human review.
CREATE TABLE global_products (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 brand TEXT NOT NULL DEFAULT '',
 product_type TEXT NOT NULL DEFAULT '',
 ingredients TEXT NOT NULL DEFAULT '',
 source_url TEXT NOT NULL,
 evidence_kind TEXT NOT NULL DEFAULT 'manufacturer_information',
 review_status TEXT NOT NULL DEFAULT 'draft' CHECK(review_status IN ('draft','reviewed','rejected')),
 reviewed_by INTEGER REFERENCES users(id),
 verified_at TEXT,
 version INTEGER NOT NULL DEFAULT 1
);
