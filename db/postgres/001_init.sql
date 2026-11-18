-- PostgreSQL twin of server/migrations/001_init.sql
-- POLICY: no price / cost / quantity columns anywhere. Do not add them.
CREATE TABLE users (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('manager','staff')),
  password_hash TEXT NOT NULL,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE products (
  id                      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  barcode                 TEXT UNIQUE,
  name                    TEXT NOT NULL,
  brand                   TEXT NOT NULL DEFAULT '',
  category                TEXT NOT NULL DEFAULT 'أخرى',
  size                    TEXT NOT NULL DEFAULT '',
  availability            TEXT NOT NULL DEFAULT 'unknown' CHECK (availability IN ('yes','no','unknown')),
  availability_updated_at TIMESTAMPTZ,
  availability_updated_by BIGINT REFERENCES users(id),
  verification            TEXT NOT NULL DEFAULT 'review' CHECK (verification IN ('review','partial','verified')),
  ingredients             TEXT NOT NULL DEFAULT '',
  benefits                TEXT NOT NULL DEFAULT '',
  warnings                TEXT NOT NULL DEFAULT '',
  source_url              TEXT NOT NULL DEFAULT '',
  created_by              BIGINT REFERENCES users(id),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_products_name ON products(name);
CREATE INDEX idx_products_category ON products(category);
CREATE TABLE product_facts (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id    BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  field         TEXT NOT NULL,
  value         TEXT NOT NULL,
  origin        TEXT NOT NULL CHECK (origin IN ('source','manual','ai_inference')),
  source_name   TEXT NOT NULL DEFAULT '',
  source_url    TEXT NOT NULL DEFAULT '',
  extracted_at  TIMESTAMPTZ,
  verified_at   TIMESTAMPTZ,
  verified_by   BIGINT REFERENCES users(id),
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending','approved','rejected')),
  product_version TEXT NOT NULL DEFAULT ''
);
CREATE TABLE unmet_requests (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  key        TEXT NOT NULL,
  text       TEXT NOT NULL,
  category   TEXT NOT NULL DEFAULT '',
  brand      TEXT NOT NULL DEFAULT '',
  note       TEXT NOT NULL DEFAULT '',
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_unmet_key ON unmet_requests(key);
CREATE TABLE import_jobs (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  filename   TEXT NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('previewed','committed','failed')),
  total      INTEGER NOT NULL DEFAULT 0,
  added      INTEGER NOT NULL DEFAULT 0,
  duplicates INTEGER NOT NULL DEFAULT 0,
  invalid    INTEGER NOT NULL DEFAULT 0,
  ignored_columns TEXT NOT NULL DEFAULT '',
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE audit_log (
  id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id   BIGINT REFERENCES users(id),
  action    TEXT NOT NULL,
  entity    TEXT NOT NULL,
  entity_id TEXT NOT NULL DEFAULT '',
  detail    TEXT NOT NULL DEFAULT '',
  at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
