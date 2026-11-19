-- CP04 product images. ADDITIVE ONLY (no change to existing tables). POLICY: no price/cost/quantity columns.
-- Images live in the same SQLite file as the products they describe, so they persist exactly as long as the
-- product data does (persistent Docker volume on a shop device; wiped together with everything else on free staging).
CREATE TABLE product_images (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL DEFAULT 'front' CHECK (kind IN ('front','package','ingredients','other')),
  is_primary  INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0,1)),
  mime        TEXT NOT NULL CHECK (mime IN ('image/jpeg','image/png','image/webp')),
  bytes       BLOB NOT NULL,
  size        INTEGER NOT NULL,
  width       INTEGER,
  height      INTEGER,
  origin      TEXT NOT NULL CHECK (origin IN ('camera','upload','source')),
  source_name TEXT NOT NULL DEFAULT '',            -- e.g. Open Beauty Facts (origin=source only)
  source_url  TEXT NOT NULL DEFAULT '',            -- product page the image came from
  license     TEXT NOT NULL DEFAULT '',            -- e.g. CC BY-SA 3.0
  attribution TEXT NOT NULL DEFAULT '',
  identity_note TEXT NOT NULL DEFAULT '',          -- what was (not) verified about the image matching the package
  created_by  INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_images_product ON product_images(product_id, is_primary DESC, id);
