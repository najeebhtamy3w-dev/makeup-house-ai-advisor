-- CP05 taxonomy + rapid entry. ADDITIVE ONLY: existing rows keep every value (category untouched, type '' = unclassified).
-- No automatic reclassification here: suggestions are produced on request, reported, and confirmed by a person.
ALTER TABLE products ADD COLUMN product_type TEXT NOT NULL DEFAULT '';          -- stable id from server/src/taxonomy.ts, '' = unclassified
ALTER TABLE products ADD COLUMN application_area TEXT NOT NULL DEFAULT '';      -- stable id, optional
ALTER TABLE products ADD COLUMN functions TEXT NOT NULL DEFAULT '';             -- comma-separated stable ids, optional
ALTER TABLE products ADD COLUMN classification_status TEXT NOT NULL DEFAULT 'unknown'
  CHECK (classification_status IN ('unknown','suggested','confirmed','needs_review'));
ALTER TABLE products ADD COLUMN classification_raw TEXT NOT NULL DEFAULT '';    -- original unmapped value from an import file, kept for review
ALTER TABLE products ADD COLUMN client_ref TEXT;                                -- idempotency key of the form submission (double-submit guard)
CREATE INDEX idx_products_type ON products(product_type, category);
CREATE UNIQUE INDEX idx_products_client_ref ON products(client_ref) WHERE client_ref IS NOT NULL;
