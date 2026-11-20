-- CP06.2 Phase 5. ADDITIVE ONLY.
-- Which import batch created a product: lets a manager undo the DRAFTS of one batch safely (nothing else is ever removed).
ALTER TABLE products ADD COLUMN import_batch_id INTEGER REFERENCES import_batches(id);
CREATE INDEX idx_products_import_batch ON products(import_batch_id);
-- Pause/resume switches for the enrichment queue: scope = 'all' | 'provider:<id>' | 'batch:<id>'. Not a product state.
CREATE TABLE queue_control (
  scope       TEXT PRIMARY KEY,
  paused      INTEGER NOT NULL DEFAULT 0 CHECK (paused IN (0,1)),
  updated_by  INTEGER REFERENCES users(id),
  updated_at  TEXT NOT NULL
);
