-- CP07 — unified knowledge engine. ADDITIVE ONLY: new tables + new columns on the unused CP06.2 table
-- knowledge_retrievals (reused as the store of DISCOVERED evidence, instead of creating a duplicate table).
-- Nothing here touches products, product images, users, science/* rules or any existing row.
-- The FTS5 index is NOT created here (the Android SQLite-WASM build is not guaranteed to have FTS5);
-- server/src/cp07/retrieve.ts creates it at run time when available and otherwise uses a JS BM25.

-- 1) sources: one row per original source (page, guideline, review article). Never a search-engine summary.
CREATE TABLE knowledge_sources (
  id                  TEXT PRIMARY KEY,
  title               TEXT NOT NULL,
  url                 TEXT NOT NULL UNIQUE,
  publisher           TEXT NOT NULL,
  source_type         TEXT NOT NULL CHECK (source_type IN ('health_agency','professional_body','peer_reviewed_review','peer_reviewed_study','guideline','drug_label','regulation','product_database','manufacturer','other')),
  evidence_level      TEXT NOT NULL CHECK (evidence_level IN ('guideline','systematic_review','narrative_review','clinical_study','expert_patient_education','regulatory','manufacturer_claim','unknown')),
  license_status      TEXT NOT NULL CHECK (license_status IN ('public_domain','open_license','link_and_summary_only','metadata_only','unknown')),
  industry_affiliation TEXT NOT NULL DEFAULT '',   -- e.g. "authors employed by an ingredient manufacturer"
  language            TEXT NOT NULL DEFAULT 'en',
  published_at        TEXT,
  accessed_at         TEXT NOT NULL,
  origin              TEXT NOT NULL CHECK (origin IN ('curated_seed','connector','manual')),
  created_at          TEXT NOT NULL
);

CREATE TABLE knowledge_topics (
  id        TEXT PRIMARY KEY,
  domain    TEXT NOT NULL CHECK (domain IN ('skin','hair','scalp','ingredients','routine','safety','general')),
  title_ar  TEXT NOT NULL,
  title_en  TEXT NOT NULL DEFAULT ''
);

-- 2) claims. State machine: discovered → extracted → pending_review → approved → published (+ rejected / superseded / needs_update).
--    review_level is SEPARATE from state: an administrator approving is NOT a qualified scientific review.
CREATE TABLE knowledge_claims (
  id                 TEXT PRIMARY KEY,
  topic_id           TEXT NOT NULL REFERENCES knowledge_topics(id),
  kind               TEXT NOT NULL CHECK (kind IN ('education','advice','ingredient','caution','referral','comparison','interaction')),
  subject            TEXT NOT NULL DEFAULT '',          -- ingredient INCI or condition id the claim is about
  stance             TEXT NOT NULL DEFAULT 'neutral' CHECK (stance IN ('supports','cautions','avoid','neutral')),
  text_ar            TEXT NOT NULL,                     -- simplified Arabic wording (original, not a copy)
  structured_en      TEXT NOT NULL DEFAULT '',          -- short structured statement for checking against the source
  limitations        TEXT NOT NULL DEFAULT '',
  warnings           TEXT NOT NULL DEFAULT '',
  evidence_level     TEXT NOT NULL DEFAULT 'unknown',
  state              TEXT NOT NULL CHECK (state IN ('discovered','extracted','pending_review','approved','published','rejected','superseded','needs_update')),
  review_level       TEXT NOT NULL DEFAULT 'none' CHECK (review_level IN ('none','administrative','qualified_scientific')),
  origin             TEXT NOT NULL CHECK (origin IN ('curated_seed','connector','manual')),
  version            INTEGER NOT NULL DEFAULT 1,
  supersedes         TEXT,
  admin_approved_by  INTEGER,
  admin_approved_at  TEXT,
  sci_reviewer       TEXT,
  sci_reviewer_qualification TEXT,
  sci_reviewed_at    TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE INDEX idx_kclaims_topic ON knowledge_claims(topic_id, state);
CREATE INDEX idx_kclaims_subject ON knowledge_claims(subject);

CREATE TABLE knowledge_claim_sources (
  claim_id   TEXT NOT NULL REFERENCES knowledge_claims(id),
  source_id  TEXT NOT NULL REFERENCES knowledge_sources(id),
  locator    TEXT NOT NULL DEFAULT '',     -- section / sentence the claim relies on
  PRIMARY KEY (claim_id, source_id)
);

-- 3) ingredient knowledge (cosmetic function level). Complements science/ingredients (CP03, unchanged).
CREATE TABLE ingredient_knowledge (
  inci                TEXT PRIMARY KEY,
  names_ar            TEXT NOT NULL,           -- JSON array
  synonyms            TEXT NOT NULL DEFAULT '[]',
  functions           TEXT NOT NULL,           -- JSON array
  concentration_note  TEXT NOT NULL DEFAULT '',-- only when a cited source states it
  irritation_potential TEXT NOT NULL DEFAULT 'unknown' CHECK (irritation_potential IN ('low','moderate','high','unknown')),
  topic_id            TEXT NOT NULL REFERENCES knowledge_topics(id)
);

CREATE TABLE knowledge_relationships (
  from_id  TEXT NOT NULL,
  rel      TEXT NOT NULL CHECK (rel IN ('helps_with','caution_with','avoid_combining','related_topic','product_type_for','conflicts_with')),
  to_id    TEXT NOT NULL,
  claim_id TEXT REFERENCES knowledge_claims(id),
  PRIMARY KEY (from_id, rel, to_id)
);

-- 4) audit trail: every state change, never deleted; snapshot keeps the previous text.
CREATE TABLE knowledge_review_history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  claim_id   TEXT NOT NULL,
  action     TEXT NOT NULL,
  from_state TEXT,
  to_state   TEXT,
  actor_id   INTEGER,
  actor_role TEXT NOT NULL DEFAULT '',
  reason     TEXT NOT NULL DEFAULT '',
  snapshot   TEXT NOT NULL DEFAULT '',
  at         TEXT NOT NULL
);
CREATE INDEX idx_khist_claim ON knowledge_review_history(claim_id, id);

-- 5) knowledge gaps: what the advisor could not answer. Topic key only — no staff text, no customer data.
CREATE TABLE knowledge_gaps (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  gap_key    TEXT NOT NULL UNIQUE,            -- normalised concept key, e.g. "ingredient:azelaic acid"
  label_ar   TEXT NOT NULL,
  hits       INTEGER NOT NULL DEFAULT 1,
  status     TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','searching','evidence_pending','covered','dismissed')),
  first_at   TEXT NOT NULL,
  last_at    TEXT NOT NULL
);

CREATE TABLE knowledge_ingestion_jobs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  gap_id      INTEGER REFERENCES knowledge_gaps(id),
  connector   TEXT NOT NULL,
  query       TEXT NOT NULL,                  -- generic English concept terms only
  state       TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','running','done','failed','blocked_offline','blocked_disabled')),
  attempts    INTEGER NOT NULL DEFAULT 0,
  next_at     TEXT NOT NULL,
  found       INTEGER NOT NULL DEFAULT 0,
  error       TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE (connector, query)
);

-- 6) discovered evidence = the CP06.2 table knowledge_retrievals, extended (never used as fact until reviewed).
ALTER TABLE knowledge_retrievals ADD COLUMN publisher TEXT NOT NULL DEFAULT '';
ALTER TABLE knowledge_retrievals ADD COLUMN pub_types TEXT NOT NULL DEFAULT '';
ALTER TABLE knowledge_retrievals ADD COLUMN published_at TEXT;
ALTER TABLE knowledge_retrievals ADD COLUMN license_status TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE knowledge_retrievals ADD COLUMN evidence_level TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE knowledge_retrievals ADD COLUMN validation TEXT NOT NULL DEFAULT '';
ALTER TABLE knowledge_retrievals ADD COLUMN evidence_state TEXT NOT NULL DEFAULT 'discovered';
ALTER TABLE knowledge_retrievals ADD COLUMN job_id INTEGER;
ALTER TABLE knowledge_retrievals ADD COLUMN gap_id INTEGER;

-- 7) retrieval log: which claims were used for which intent. Query HASH only, no text.
CREATE TABLE knowledge_retrieval_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  query_hash  TEXT NOT NULL,
  intent      TEXT NOT NULL,
  claim_ids   TEXT NOT NULL,
  engine      TEXT NOT NULL,
  at          TEXT NOT NULL
);

-- 8) connector state: circuit breaker + daily counters; response cache; global switches.
CREATE TABLE knowledge_connector_state (
  connector   TEXT PRIMARY KEY,
  failures    INTEGER NOT NULL DEFAULT 0,
  open_until  TEXT,
  last_call_at TEXT,
  day         TEXT NOT NULL DEFAULT '',
  calls_today INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE knowledge_cache (
  key        TEXT PRIMARY KEY,
  body       TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);
CREATE TABLE knowledge_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO knowledge_settings(key, value) VALUES ('external_search_enabled', '0');
