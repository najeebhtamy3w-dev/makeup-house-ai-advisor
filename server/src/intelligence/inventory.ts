import { z } from 'zod';
import { audit, now, type DB } from '../db.ts';
import { HttpError, route } from '../http.ts';

const idSchema = z.number().int().min(1).max(2147483647);
const quantitySchema = z.number().int().min(0).max(1_000_000_000);
/** Expiry is a Gregorian date, inclusive through the end of that date in the shop's Yemen time zone. */
export function isInventoryDate(value: string): boolean {
  if (!/^(19|20|21)\d{2}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}
export const inventoryBusinessDate = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
const dateSchema = z.string().refine(isInventoryDate, 'تاريخ انتهاء غير صالح؛ استخدم YYYY-MM-DD');
const batchCode = z.string().trim().min(1).max(120).refine(s => !/[\u0000-\u001f\u007f]/.test(s), 'رمز دفعة غير صالح');
const batchInput = z.object({ product_id: idSchema, batch_code: batchCode, quantity: quantitySchema, expires_on: dateSchema }).strict();
const patchInput = z.object({ version: idSchema, batch_code: batchCode.optional(), quantity: quantitySchema.optional(), expires_on: dateSchema.optional() }).strict()
  .refine(b => b.batch_code !== undefined || b.quantity !== undefined || b.expires_on !== undefined, 'لا توجد تعديلات');

export interface InventoryBatch {
  id: number; product_id: number; batch_code: string; quantity: number; expires_on: string; version: number;
  created_by: number | null; updated_by: number | null; created_at: string; updated_at: string;
}
export interface ValidBatchAvailability {
  product_id: number; as_of: string; availability: 'yes' | 'no' | 'unknown'; eligible_product: boolean;
  valid_quantity: number; valid_batches: Pick<InventoryBatch, 'id' | 'batch_code' | 'quantity' | 'expires_on' | 'version'>[];
  reason: 'product_not_found' | 'product_not_reviewed_active' | 'no_batch_records' | 'no_valid_positive_batches' | 'verified_positive_unexpired_batches' | 'batch_scan_limit';
}
/** Read-only authority for local stock. Scientific suitability must still be checked separately. */
export function checkValidBatches(db: DB, productId: number, nowDate = inventoryBusinessDate()): ValidBatchAvailability {
  idSchema.parse(productId); dateSchema.parse(nowDate);
  const product = db.prepare('SELECT id, record_status, verification FROM products WHERE id=?').get(productId) as { id: number; record_status: string; verification: string } | undefined;
  const result: ValidBatchAvailability = { product_id: productId, as_of: nowDate, availability: 'unknown', eligible_product: false, valid_quantity: 0, valid_batches: [], reason: 'product_not_found' };
  if (!product) return result;
  result.eligible_product = product.record_status === 'active' && product.verification === 'verified';
  const count = db.prepare('SELECT COUNT(*) n FROM inventory_batches WHERE product_id=?').get(productId) as { n: number };
  if (!result.eligible_product) return { ...result, reason: 'product_not_reviewed_active' };
  if (!count.n) return { ...result, reason: 'no_batch_records' };
  // Revalidate stored dates too: an invalid row from a damaged or externally edited backup is not usable stock.
  const rows = db.prepare('SELECT id,batch_code,quantity,expires_on,version FROM inventory_batches WHERE product_id=? AND quantity>0 AND expires_on>=? ORDER BY expires_on,id LIMIT 201').all(productId, nowDate) as ValidBatchAvailability['valid_batches'];
  if (rows.length > 200) return { ...result, reason: 'batch_scan_limit' };
  result.valid_batches = rows.filter(b => isInventoryDate(b.expires_on) && Number.isSafeInteger(b.quantity) && b.quantity > 0);
  result.valid_quantity = result.valid_batches.reduce((sum, b) => sum + b.quantity, 0);
  if (!Number.isSafeInteger(result.valid_quantity)) return { ...result, valid_quantity: 0, valid_batches: [], reason: 'no_valid_positive_batches' };
  return { ...result, availability: result.valid_batches.length ? 'yes' : 'no', reason: result.valid_batches.length ? 'verified_positive_unexpired_batches' : 'no_valid_positive_batches' };
}

const parseId = (raw: string | undefined) => idSchema.parse(Number(raw));
function loadBatch(db: DB, id: number) { return db.prepare('SELECT * FROM inventory_batches WHERE id=?').get(id) as InventoryBatch | undefined; }
function requireProduct(db: DB, id: number) { if (!db.prepare('SELECT id FROM products WHERE id=?').get(id)) throw new HttpError(404, 'المنتج غير موجود'); }
function duplicate(db: DB, productId: number, code: string, except = 0) { return db.prepare('SELECT id FROM inventory_batches WHERE product_id=? AND batch_code=? AND id<>?').get(productId, code, except); }

route('GET', '/api/inventory/batches', 'any', c => {
  const productId = c.query.has('product_id') ? parseId(c.query.get('product_id') ?? undefined) : null;
  const limit = c.query.has('limit') ? z.number().int().min(1).max(100).parse(Number(c.query.get('limit'))) : 50;
  const offset = c.query.has('offset') ? z.number().int().min(0).max(10_000_000).parse(Number(c.query.get('offset'))) : 0;
  const where = productId ? ' WHERE b.product_id=?' : '';
  const params = productId ? [productId] : [];
  const batches = c.db.prepare(`SELECT b.*,p.name AS product_name FROM inventory_batches b JOIN products p ON p.id=b.product_id${where} ORDER BY b.expires_on,b.id LIMIT ? OFFSET ?`).all(...params, limit, offset);
  const total = (c.db.prepare(`SELECT COUNT(*) n FROM inventory_batches b${where}`).get(...params) as { n: number }).n;
  return { batches, total, limit, offset, as_of: inventoryBusinessDate(), ...(productId ? { availability: checkValidBatches(c.db, productId) } : {}) };
});
route('GET', '/api/inventory/availability/:id', 'any', c => checkValidBatches(c.db, parseId(c.params.id)));
route('POST', '/api/inventory/batches', 'manager', async c => {
  const b = batchInput.parse(await c.body()); requireProduct(c.db, b.product_id);
  if (duplicate(c.db, b.product_id, b.batch_code)) throw new HttpError(409, 'رمز الدفعة مسجل لهذا المنتج؛ افتح الدفعة وعدّلها');
  const at = now();
  c.db.exec('BEGIN');
  try {
    const inserted = c.db.prepare('INSERT INTO inventory_batches(product_id,batch_code,quantity,expires_on,created_by,updated_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(b.product_id, b.batch_code, b.quantity, b.expires_on, c.user!.id, c.user!.id, at, at);
    const id = Number(inserted.lastInsertRowid);
    audit(c.db, c.user!.id, 'inventory_batch_create', 'inventory_batch', id, JSON.stringify(b));
    c.db.exec('COMMIT'); return { batch: loadBatch(c.db, id) };
  } catch (error) { c.db.exec('ROLLBACK'); throw error; }
});
route('PATCH', '/api/inventory/batches/:id', 'manager', async c => {
  const id = parseId(c.params.id), b = patchInput.parse(await c.body());
  const current = loadBatch(c.db, id); if (!current) throw new HttpError(404, 'الدفعة غير موجودة');
  if (current.version !== b.version) throw Object.assign(new HttpError(409, 'عُدّلت الدفعة؛ أعد تحميلها قبل الحفظ'), { stale: true, currentVersion: current.version });
  const next = { batch_code: b.batch_code ?? current.batch_code, quantity: b.quantity ?? current.quantity, expires_on: b.expires_on ?? current.expires_on };
  if (duplicate(c.db, current.product_id, next.batch_code, id)) throw new HttpError(409, 'رمز الدفعة مسجل لهذا المنتج');
  c.db.exec('BEGIN');
  try {
    const changed = c.db.prepare('UPDATE inventory_batches SET batch_code=?,quantity=?,expires_on=?,version=version+1,updated_by=?,updated_at=? WHERE id=? AND version=?')
      .run(next.batch_code, next.quantity, next.expires_on, c.user!.id, now(), id, b.version);
    if (Number(changed.changes) !== 1) throw new HttpError(409, 'عُدّلت الدفعة؛ أعد تحميلها');
    audit(c.db, c.user!.id, 'inventory_batch_update', 'inventory_batch', id, JSON.stringify({ previous_version: b.version, ...next }));
    c.db.exec('COMMIT'); return { batch: loadBatch(c.db, id) };
  } catch (error) { c.db.exec('ROLLBACK'); throw error; }
});
