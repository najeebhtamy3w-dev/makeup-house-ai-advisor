/**
 * Final completion — ADDITIONAL product codes on the existing CP06.2 table `product_codes` (migration 006; no new table).
 * A product keeps its primary barcode in products.barcode (kept in sync by the 006 triggers); extra GTINs, internal store
 * codes and unverified codes are added here. Rules:
 *   - a code can belong to ONE product only (UNIQUE(code, kind) + a cross-kind check) → never silently two products;
 *   - GTIN kind requires a valid check digit; leading zeros are kept (TEXT);
 *   - the primary code is managed through the product form, not here;
 *   - marking a code «verified» or removing one is a manager action; adding is open to staff (stored unverified);
 *   - every change is audited. Lookup by any code: GET /api/products/by-code/:code.
 */
import { z } from 'zod';
import { route, HttpError } from './http.ts';
import { audit, now } from './db.ts';
import { gtinValid, normalizeBarcode } from './gtin.ts';
import { PRODUCT_SELECT, presentProduct, type ProductRow } from './routes.ts';
import { TYPE_IDS, CATEGORIES } from './taxonomy.ts';

const pid = (s: string) => { const n = Number(s); if (!Number.isInteger(n) || n < 1) throw new HttpError(400, 'معرّف غير صالح'); return n; };
const exists = (db: { prepare(sql: string): { get(...a: unknown[]): unknown } }, id: number) => { if (!db.prepare('SELECT 1 FROM products WHERE id = ?').get(id)) throw new HttpError(404, 'المنتج غير موجود'); };

route('GET', '/api/products/:id/codes', 'any', (c) => {
  const id = pid(c.params.id!); exists(c.db, id);
  return { codes: c.db.prepare('SELECT id, code, kind, is_primary, verified, created_at FROM product_codes WHERE product_id = ? ORDER BY is_primary DESC, id').all(id) };
});

route('POST', '/api/products/:id/codes', 'any', async (c) => {
  const id = pid(c.params.id!); exists(c.db, id);
  const b = z.object({ code: z.string().max(40), kind: z.enum(['gtin', 'internal', 'unverified']) }).strict().parse(await c.body());
  const code = normalizeBarcode(b.code);
  if (!/^[0-9A-Za-z-]{3,40}$/.test(code)) throw new HttpError(400, 'رمز غير صالح');
  if (/e\+?\d/i.test(b.code)) throw new HttpError(400, 'الرمز مكتوب بصيغة علمية (مثل 6.29E+12) — أدخله كاملًا كنص');
  if (b.kind === 'gtin' && !gtinValid(code)) throw new HttpError(400, 'باركود GTIN غير صالح (خانة التحقق لا تطابق)');
  const owner = c.db.prepare('SELECT product_id FROM product_codes WHERE code = ? UNION SELECT id FROM products WHERE barcode = ?').get(code, code) as { product_id: number } | undefined;
  if (owner) throw new HttpError(409, owner.product_id === id ? 'الرمز مسجل لهذا المنتج مسبقًا' : `الرمز مسجل لمنتج آخر (رقم ${owner.product_id}) — لا يُربط رمز واحد بمنتجين`);
  const r = c.db.prepare('INSERT INTO product_codes(product_id, code, kind, is_primary, verified, created_at) VALUES (?, ?, ?, 0, 0, ?)').run(id, code, b.kind, now());
  audit(c.db, c.user!.id, 'code_add', 'product', id, `${b.kind}:${code}`);
  return { id: Number(r.lastInsertRowid), code, kind: b.kind, verified: false };
});

route('PATCH', '/api/products/:id/codes/:codeId', 'manager', async (c) => {
  const id = pid(c.params.id!); const cid = pid(c.params.codeId!);
  const b = z.object({ verified: z.boolean() }).strict().parse(await c.body());
  const n = c.db.prepare('UPDATE product_codes SET verified = ? WHERE id = ? AND product_id = ?').run(b.verified ? 1 : 0, cid, id).changes;
  if (!n) throw new HttpError(404, 'الرمز غير موجود');
  audit(c.db, c.user!.id, b.verified ? 'code_verify' : 'code_unverify', 'product', id, String(cid));
  return { ok: true };
});

route('DELETE', '/api/products/:id/codes/:codeId', 'manager', (c) => {
  const id = pid(c.params.id!); const cid = pid(c.params.codeId!);
  const row = c.db.prepare('SELECT code, is_primary FROM product_codes WHERE id = ? AND product_id = ?').get(cid, id) as { code: string; is_primary: number } | undefined;
  if (!row) throw new HttpError(404, 'الرمز غير موجود');
  if (row.is_primary) throw new HttpError(409, 'الباركود الأساسي يُعدّل من بطاقة المنتج');
  c.db.prepare('DELETE FROM product_codes WHERE id = ?').run(cid);
  audit(c.db, c.user!.id, 'code_remove', 'product', id, row.code);
  return { ok: true };
});

/** Find a product by ANY of its codes (primary barcode or an additional one). */
route('GET', '/api/products/by-code/:code', 'any', (c) => {
  const code = normalizeBarcode(c.params.code);
  const hit = c.db.prepare('SELECT product_id, kind, is_primary, verified FROM product_codes WHERE code = ?').get(code) as { product_id: number; kind: string; is_primary: number; verified: number } | undefined;
  const p = hit ? (c.db.prepare(`${PRODUCT_SELECT} WHERE products.id = ?`).get(hit.product_id) as ProductRow | undefined)
    : (c.db.prepare(`${PRODUCT_SELECT} WHERE barcode = ?`).get(code) as ProductRow | undefined);
  return { code, found: !!p, matched_by: hit ? (hit.is_primary ? 'primary' : `additional_${hit.kind}`) : p ? 'primary' : null, code_verified: hit ? !!hit.verified : null, product: p ? presentProduct(p, c.cfg.availabilityStaleHours) : null };
});

/* ---------------- bulk classification (manager) ---------------- */
/**
 * Sets the product FORM (and optionally the category) for up to 500 selected products and marks the classification as
 * confirmed by a person. It touches ONLY product_type / category / classification_status / version — never ingredients,
 * warnings, verification or anything scientific. Manager-only (the stricter existing rule; staff classify one product in
 * its card). Optimistic concurrency: rows changed since the list was loaded (version mismatch) are skipped and reported.
 */
route('POST', '/api/products/bulk-classify', 'manager', async (c) => {
  const b = z.object({ items: z.array(z.object({ id: z.number().int().positive(), version: z.number().int().positive() })).min(1).max(500), product_type: z.string().max(40), category: z.string().max(60).optional() }).strict().parse(await c.body());
  if (!TYPE_IDS.has(b.product_type)) throw new HttpError(400, 'نوع منتج غير معروف');
  if (b.category && !(CATEGORIES as readonly string[]).includes(b.category)) throw new HttpError(400, 'تصنيف غير معروف');
  const t = now(); const done: number[] = []; const stale: number[] = [];
  const upd = c.db.prepare(`UPDATE products SET product_type = ?, ${b.category ? 'category = ?, ' : ''}classification_status = 'confirmed', classification_raw = '', version = version + 1, updated_at = ? WHERE id = ? AND version = ?`);
  c.db.exec('BEGIN');
  try {
    for (const it of b.items) { const args = b.category ? [b.product_type, b.category, t, it.id, it.version] : [b.product_type, t, it.id, it.version]; if (Number(upd.run(...args).changes)) done.push(it.id); else stale.push(it.id); }
    audit(c.db, c.user!.id, 'bulk_classify', 'product', done.length, `${b.product_type}${b.category ? '/' + b.category : ''}: ${done.join(',').slice(0, 900)}`);
    c.db.exec('COMMIT');
  } catch (e) { c.db.exec('ROLLBACK'); throw e; }
  return { updated: done.length, skipped_changed_meanwhile: stale };
});

/* ---------------- manager dashboard (real counts only) ---------------- */
route('GET', '/api/dashboard', 'manager', (c) => {
  const n = (sql: string, ...a: (string | number)[]) => Number((c.db.prepare(sql).get(...a) as { n: number } | undefined)?.n ?? 0);
  const has = (t: string) => !!c.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
  return {
    catalog: { products: n("SELECT COUNT(*) n FROM products WHERE record_status = 'active'"), drafts: n("SELECT COUNT(*) n FROM products WHERE record_status = 'import_draft'"), archived: n("SELECT COUNT(*) n FROM products WHERE record_status = 'archived'") },
    completeness: {
      verified: n("SELECT COUNT(*) n FROM products WHERE record_status = 'active' AND verification = 'verified'"),
      unverified: n("SELECT COUNT(*) n FROM products WHERE record_status = 'active' AND verification <> 'verified'"),
      unclassified: n("SELECT COUNT(*) n FROM products WHERE record_status = 'active' AND (product_type = '' OR classification_status IN ('unknown','needs_review'))"),
      suggested_classification: n("SELECT COUNT(*) n FROM products WHERE record_status = 'active' AND classification_status = 'suggested'"),
      without_ingredients: n("SELECT COUNT(*) n FROM products WHERE record_status = 'active' AND ingredients = ''"),
      without_image: n("SELECT COUNT(*) n FROM products p WHERE record_status = 'active' AND NOT EXISTS (SELECT 1 FROM product_images i WHERE i.product_id = p.id)"),
      without_barcode: n("SELECT COUNT(*) n FROM products WHERE record_status = 'active' AND (barcode IS NULL OR barcode = '')"),
      additional_codes: n('SELECT COUNT(*) n FROM product_codes WHERE is_primary = 0'),
    },
    enrichment: Object.fromEntries((c.db.prepare('SELECT job_state k, COUNT(*) n FROM enrichment_jobs_v2 GROUP BY job_state').all() as { k: string; n: number }[]).map((r) => [r.k, r.n])),
    review: { evidence_pending: n("SELECT COUNT(*) n FROM evidence WHERE review_state = 'pending'"), legacy_candidates_pending: n("SELECT COUNT(DISTINCT barcode) n FROM enrichment_candidates WHERE review_status = 'pending'") },
    imports: { batches: n('SELECT COUNT(*) n FROM import_batches'), last: c.db.prepare('SELECT id, filename, state, total_rows, processed_rows, created_at FROM import_batches ORDER BY id DESC LIMIT 1').get() ?? null },
    knowledge: has('knowledge_claims') ? { pending_review: n("SELECT COUNT(*) n FROM knowledge_claims WHERE state = 'pending_review'"), approved: n("SELECT COUNT(*) n FROM knowledge_claims WHERE state IN ('approved','published')"), scientifically_reviewed: n("SELECT COUNT(*) n FROM knowledge_claims WHERE review_level = 'qualified_scientific'"), gaps_open: n("SELECT COUNT(*) n FROM knowledge_gaps WHERE status <> 'covered' AND status <> 'dismissed'") } : null,
    unmet_requests: n('SELECT COUNT(*) n FROM unmet_requests'),
    backup: { last: (c.db.prepare("SELECT at FROM audit_log WHERE action = 'backup' ORDER BY id DESC LIMIT 1").get() as { at: string } | undefined)?.at ?? null },
    users: Object.fromEntries((c.db.prepare('SELECT role k, COUNT(*) n FROM users WHERE active = 1 GROUP BY role').all() as { k: string; n: number }[]).map((r) => [r.k, r.n])),
  };
});
