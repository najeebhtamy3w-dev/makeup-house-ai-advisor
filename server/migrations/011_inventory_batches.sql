-- V3.2 directive explicitly authorizes quantities/batches/expiry, superseding the old no-quantity policy.
-- Additive only: old availability flags are retained and NEVER converted into invented stock.
CREATE TABLE inventory_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  batch_code TEXT NOT NULL CHECK (length(batch_code) BETWEEN 1 AND 120),
  quantity INTEGER NOT NULL CHECK (typeof(quantity) = 'integer' AND quantity BETWEEN 0 AND 1000000000),
  expires_on TEXT NOT NULL CHECK (length(expires_on) = 10),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by INTEGER REFERENCES users(id),
  updated_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(product_id, batch_code)
);
CREATE INDEX idx_inventory_batches_product_expiry ON inventory_batches(product_id, expires_on, quantity);
