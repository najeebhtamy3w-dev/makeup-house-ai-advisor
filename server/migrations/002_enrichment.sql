-- Enrichment engine. POLICY: no price/cost/quantity columns. Candidates are DRAFTS until a manager approves.
CREATE TABLE enrichment_runs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  barcode      TEXT NOT NULL,
  connector    TEXT NOT NULL,
  outcome      TEXT NOT NULL CHECK (outcome IN ('found','not_found','unreachable','rate_limited','error')),
  detail       TEXT NOT NULL DEFAULT '',          -- non-sensitive error class only
  requested_by INTEGER REFERENCES users(id),
  fetched_at   TEXT NOT NULL
);
CREATE INDEX idx_runs_barcode ON enrichment_runs(barcode, connector, fetched_at);
CREATE TABLE enrichment_candidates (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id        INTEGER NOT NULL REFERENCES enrichment_runs(id) ON DELETE CASCADE,
  barcode       TEXT NOT NULL,
  field         TEXT NOT NULL CHECK (field IN ('name','brand','size','ingredients','image_url')),
  value         TEXT NOT NULL,
  source_name   TEXT NOT NULL,
  source_url    TEXT NOT NULL DEFAULT '',
  license       TEXT NOT NULL DEFAULT '',
  is_mock       INTEGER NOT NULL DEFAULT 0,
  extracted_at  TEXT NOT NULL,
  conflict_note TEXT NOT NULL DEFAULT '',          -- non-empty => differs from local value or another source
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending','approved','rejected')),
  reviewed_by   INTEGER REFERENCES users(id),
  reviewed_at   TEXT
);
CREATE INDEX idx_cand_status ON enrichment_candidates(review_status, barcode);
CREATE TABLE enrichment_jobs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  barcode    TEXT NOT NULL UNIQUE,
  status     TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','done','failed')),
  attempts   INTEGER NOT NULL DEFAULT 0,
  next_at    TEXT NOT NULL,
  last_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_jobs_due ON enrichment_jobs(status, next_at);
