-- CP06.2 Phase 2. ADDITIVE ONLY: no column, table or row is dropped or rewritten except the explicit, lossless backfills below.
-- POLICY (unchanged): no price / cost / quantity / sales columns anywhere.
-- Old tables (enrichment_candidates, enrichment_jobs) stay as they are and keep working; the v2 tables live beside them.

-- 1) product identity: names per language, maker, variant, record lifecycle, optimistic-concurrency version
ALTER TABLE products ADD COLUMN name_ar TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN name_en TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN manufacturer TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN variant TEXT NOT NULL DEFAULT '';            -- shade / scent / edition: a different variant is a different product
ALTER TABLE products ADD COLUMN record_status TEXT NOT NULL DEFAULT 'active'
  CHECK (record_status IN ('import_draft','active','archived'));              -- drafts and archived records are never recommended
ALTER TABLE products ADD COLUMN version INTEGER NOT NULL DEFAULT 1;           -- incremented on every write; a stale write is refused (409)
CREATE INDEX idx_products_record_status ON products(record_status);

-- 2) several codes per product. products.barcode stays the primary code (compatibility); every code is ALSO listed here.
CREATE TABLE product_codes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  code        TEXT NOT NULL,                                                  -- kept as TEXT: leading zeros matter
  kind        TEXT NOT NULL CHECK (kind IN ('gtin','internal','unverified')),
  is_primary  INTEGER NOT NULL DEFAULT 0,
  verified    INTEGER NOT NULL DEFAULT 0,                                     -- 1 = a person confirmed the code belongs to this product
  created_at  TEXT NOT NULL,
  UNIQUE (code, kind)
);
CREATE INDEX idx_product_codes_product ON product_codes(product_id);
-- lossless backfill: the existing primary barcodes (already validated as GTIN by the API/importer when they were saved)
INSERT INTO product_codes(product_id, code, kind, is_primary, verified, created_at)
  SELECT id, barcode, CASE WHEN length(barcode) IN (8,12,13,14) AND barcode NOT GLOB '*[^0-9]*' THEN 'gtin' ELSE 'unverified' END, 1, 0, created_at
  FROM products WHERE barcode IS NOT NULL AND barcode <> '';

-- 3) evidence: one row per proposed field value, tied to the PRODUCT (not only a barcode). Never written into products directly.
CREATE TABLE evidence (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id      INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  field           TEXT NOT NULL,                                              -- name, brand, size, ingredients, image_url, manufacturer, ...
  value           TEXT NOT NULL,
  provider        TEXT NOT NULL,
  source_url      TEXT NOT NULL DEFAULT '',
  retrieved_at    TEXT NOT NULL,
  match_basis     TEXT NOT NULL CHECK (match_basis IN ('exact_gtin','strong','ambiguous','manual','ocr_text')),
  confidence      INTEGER NOT NULL CHECK (confidence BETWEEN 0 AND 100),
  review_state    TEXT NOT NULL DEFAULT 'pending' CHECK (review_state IN ('pending','accepted','partially_accepted','rejected')),
  license_status  TEXT NOT NULL DEFAULT 'unknown' CHECK (license_status IN ('known','unknown','restricted')),   -- never invented
  license         TEXT NOT NULL DEFAULT '',
  fingerprint     TEXT NOT NULL UNIQUE,                                       -- product+field+provider+value hash: re-runs never duplicate
  reviewed_by     INTEGER REFERENCES users(id),
  reviewed_at     TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_evidence_review ON evidence(review_state, product_id);

-- 4) enrichment queue v2: keyed by product + provider + query (a product without a barcode can be enriched by name)
CREATE TABLE enrichment_jobs_v2 (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id    INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  provider      TEXT NOT NULL,
  query_key     TEXT NOT NULL,
  job_state     TEXT NOT NULL DEFAULT 'queued' CHECK (job_state IN ('queued','leased','waiting_retry','waiting_network','done','dead','cancelled')),
  match_outcome TEXT NOT NULL DEFAULT 'not_attempted' CHECK (match_outcome IN ('not_attempted','exact_gtin','strong','ambiguous','none','source_unavailable')),
  review_state  TEXT NOT NULL DEFAULT 'none' CHECK (review_state IN ('none','pending','accepted','partially_accepted','rejected')),
  priority      INTEGER NOT NULL DEFAULT 0,
  attempts      INTEGER NOT NULL DEFAULT 0,
  lease_until   TEXT,
  next_at       TEXT NOT NULL,
  last_error    TEXT NOT NULL DEFAULT '',
  batch_id      INTEGER REFERENCES import_batches(id),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (product_id, provider, query_key)
);
CREATE INDEX idx_jobs_v2_due ON enrichment_jobs_v2(job_state, priority DESC, next_at);

-- 5) provider cache: the same question is never asked twice within its freshness window ("not found" is cached too)
CREATE TABLE provider_cache (
  provider    TEXT NOT NULL,
  query_key   TEXT NOT NULL,
  outcome     TEXT NOT NULL,
  payload     TEXT NOT NULL DEFAULT '',
  fetched_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  PRIMARY KEY (provider, query_key)
);

-- 6) resumable import batches
CREATE TABLE import_batches (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  filename        TEXT NOT NULL,
  fingerprint     TEXT NOT NULL,
  total_rows      INTEGER NOT NULL DEFAULT 0,
  processed_rows  INTEGER NOT NULL DEFAULT 0,
  state           TEXT NOT NULL DEFAULT 'running' CHECK (state IN ('running','paused','done','failed','rolled_back')),
  report          TEXT NOT NULL DEFAULT '',
  created_by      INTEGER REFERENCES users(id),
  created_at      TEXT NOT NULL,
  finished_at     TEXT
);

-- 7) advisor conversations: minimal, per staff member, expiring (no customer identity is stored)
CREATE TABLE advisor_sessions (
  id              TEXT PRIMARY KEY,                                           -- random, unguessable
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  context         TEXT NOT NULL DEFAULT '{}',                                 -- extracted concerns / skin & hair context / product refs / flags
  created_at      TEXT NOT NULL,
  last_active_at  TEXT NOT NULL,
  expires_at      TEXT NOT NULL
);
CREATE INDEX idx_advisor_sessions_user ON advisor_sessions(user_id, expires_at);
CREATE TABLE advisor_turns (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL REFERENCES advisor_sessions(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('staff','advisor')),
  text        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_advisor_turns_session ON advisor_turns(session_id, id);

-- 8) AI provider usage accounting (no provider is enabled; counters exist so a budget can be enforced before one is)
CREATE TABLE ai_usage (
  day            TEXT NOT NULL,                                               -- YYYY-MM-DD (UTC)
  provider       TEXT NOT NULL,
  requests       INTEGER NOT NULL DEFAULT 0,
  input_tokens   INTEGER NOT NULL DEFAULT 0,
  output_tokens  INTEGER NOT NULL DEFAULT 0,
  est_cost_usd   REAL NOT NULL DEFAULT 0,
  errors         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, provider)
);

-- 9) knowledge retrieved from outside, kept as UNREVIEWED candidates (never becomes approved knowledge automatically)
CREATE TABLE knowledge_retrievals (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source        TEXT NOT NULL,
  query_key     TEXT NOT NULL,
  title         TEXT NOT NULL,
  url           TEXT NOT NULL,
  snippet       TEXT NOT NULL DEFAULT '',
  language      TEXT NOT NULL DEFAULT 'en',
  retrieved_at  TEXT NOT NULL,
  review_state  TEXT NOT NULL DEFAULT 'unreviewed' CHECK (review_state IN ('unreviewed','approved','rejected','outdated')),
  UNIQUE (source, url)
);

-- 10) keep the primary code in product_codes in step with products.barcode, whoever writes it (form, import, Android worker)
CREATE TRIGGER trg_products_code_ins AFTER INSERT ON products WHEN NEW.barcode IS NOT NULL AND NEW.barcode <> '' BEGIN
  INSERT OR IGNORE INTO product_codes(product_id, code, kind, is_primary, verified, created_at)
  VALUES (NEW.id, NEW.barcode, CASE WHEN length(NEW.barcode) IN (8,12,13,14) AND NEW.barcode NOT GLOB '*[^0-9]*' THEN 'gtin' ELSE 'unverified' END, 1, 0, NEW.created_at);
END;
CREATE TRIGGER trg_products_code_upd AFTER UPDATE OF barcode ON products WHEN COALESCE(OLD.barcode, '') <> COALESCE(NEW.barcode, '') BEGIN
  DELETE FROM product_codes WHERE product_id = NEW.id AND is_primary = 1;
  INSERT OR IGNORE INTO product_codes(product_id, code, kind, is_primary, verified, created_at)
  SELECT NEW.id, NEW.barcode, CASE WHEN length(NEW.barcode) IN (8,12,13,14) AND NEW.barcode NOT GLOB '*[^0-9]*' THEN 'gtin' ELSE 'unverified' END, 1, 0, NEW.updated_at
  WHERE NEW.barcode IS NOT NULL AND NEW.barcode <> '';
END;
