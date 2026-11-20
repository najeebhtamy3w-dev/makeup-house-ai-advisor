-- CP06.3 — small display thumbnails next to the original images. ADDITIVE ONLY: two nullable columns; the original `bytes`
-- are never modified or deleted. Thumbnails are produced in the browser / app (canvas) and stored once; until then the
-- original is served, so existing images keep working unchanged. No price / cost / quantity fields.
ALTER TABLE product_images ADD COLUMN thumb BLOB;
ALTER TABLE product_images ADD COLUMN thumb_mime TEXT;
