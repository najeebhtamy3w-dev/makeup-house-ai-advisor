/**
 * CP06.2 Phase 5 — HTTP routes for import batches, the v2 enrichment queue and EVIDENCE review.
 * Principle: EXTERNAL SOURCES PROPOSE — AUTHORISED PEOPLE APPROVE. Approving evidence stays manager-only (unchanged
 * permission policy); staff can read queue progress. Every approval is audited with old and new value.
 */
import { z } from 'zod';
import { route, HttpError, RawResponse } from './http.ts';
import { audit, now, type DB } from './db.ts';
import { rollbackDrafts, batchReportCsv } from './import-batch.ts';
import { queueStatus, setPaused, cancel, processOne } from './queue.ts';
import { fromConnector, PROVIDER_FACTS, type ProductProvider } from './providers.ts';
import { getConnectors } from './enrichment/engine.ts';

const id = (v: string) => { const n = Number(v); if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'معرّف غير صالح'); return n; };

/** providers enabled by configuration (MH_ENRICH), wrapped in the CP06.2 contract. Nothing else is ever called. */
export function activeProviders(): ProductProvider[] {
  return getConnectors().map((c) => fromConnector(c, PROVIDER_FACTS.find((f) => f.id === c.id) ?? { id: c.id, name: c.name, license: c.license, license_status: 'unknown', limits: { perMinute: null, perDay: null, source: 'test', verified: false }, cost_per_request_usd: 0, requires_owner_approval: false }));
}

/* ---------------- import batches ---------------- */
route('GET', '/api/imports/batches', 'manager', (c) => ({ batches: c.db.prepare('SELECT id, filename, total_rows, processed_rows, state, created_at, finished_at FROM import_batches ORDER BY id DESC LIMIT 50').all() }));
route('GET', '/api/imports/batches/:id/report', 'manager', (c) => {
  const csv = batchReportCsv(c.db, id(c.params.id!)); if (csv == null) throw new HttpError(404, 'الدفعة غير موجودة');
  return new RawResponse(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="import-${c.params.id}-errors.csv"` }, new TextEncoder().encode(csv));
});
route('POST', '/api/imports/batches/:id/rollback', 'manager', (c) => { const r = rollbackDrafts(c.db, id(c.params.id!), c.user!.id); if (!r) throw new HttpError(404, 'الدفعة غير موجودة'); return r; });

/* ---------------- queue ---------------- */
route('GET', '/api/queue/status', 'any', (c) => queueStatus(c.db));
const scope = z.object({ scope: z.string().regex(/^(all|provider:[a-z0-9_-]{1,30}|batch:\d{1,9})$/), paused: z.boolean() }).strict();
route('POST', '/api/queue/pause', 'manager', async (c) => { const b = scope.parse(await c.body()); setPaused(c.db, b.scope, b.paused, c.user!.id); audit(c.db, c.user!.id, b.paused ? 'queue_pause' : 'queue_resume', 'queue', b.scope); return queueStatus(c.db); });
route('POST', '/api/queue/cancel', 'manager', async (c) => {
  const b = z.object({ batch_id: z.number().int().positive().optional(), product_id: z.number().int().positive().optional() }).strict().refine((x) => !!x.batch_id !== !!x.product_id).parse(await c.body());
  const n = cancel(c.db, { batchId: b.batch_id, productId: b.product_id }); audit(c.db, c.user!.id, 'queue_cancel', 'queue', b.batch_id ? `batch:${b.batch_id}` : `product:${b.product_id}`, `jobs=${n}`); return { cancelled: n };
});
/** manager "run one now" (useful on the free Render plan, where a background loop sleeps with the service) */
route('POST', '/api/queue/run-one', 'manager', async (c) => processOne(c.db, activeProviders()));
/** final completion: the product a staff member is asking about now goes to the front of the queue (no new jobs are created) */
route('POST', '/api/queue/prioritize/:productId', 'any', (c) => {
  const pid = id(c.params.productId!);
  const n = c.db.prepare("UPDATE enrichment_jobs_v2 SET priority = 100, next_at = CASE WHEN job_state IN ('waiting_retry') THEN next_at ELSE ? END, updated_at = ? WHERE product_id = ? AND job_state IN ('queued','waiting_retry','waiting_network')").run(new Date().toISOString(), new Date().toISOString(), pid).changes;
  return { prioritized: Number(n) };
});

/* ---------------- evidence review ---------------- */
const EDITABLE = { name: 'name_en', brand: 'brand', size: 'size', ingredients: 'ingredients', manufacturer: 'manufacturer', variant: 'variant' } as const;   // source "name" fills the ENGLISH name, never the display name
type Ev = { id: number; product_id: number; field: string; value: string; provider: string; source_url: string; retrieved_at: string; match_basis: string; confidence: number; review_state: string; license_status: string; license: string };

route('GET', '/api/evidence/next', 'manager', (c) => {
  const after = Number(c.query.get('after') ?? 0) || 0;
  const pid = (c.db.prepare("SELECT product_id FROM evidence WHERE review_state = 'pending' AND product_id > ? ORDER BY product_id LIMIT 1").get(after) as { product_id: number } | undefined)?.product_id
    ?? (c.db.prepare("SELECT product_id FROM evidence WHERE review_state = 'pending' ORDER BY product_id LIMIT 1").get() as { product_id: number } | undefined)?.product_id;
  if (!pid) return { product: null, evidence: [], remaining: 0 };
  const product = c.db.prepare('SELECT id, name, name_en, brand, size, variant, manufacturer, ingredients, barcode, verification, version, (SELECT i.id FROM product_images i WHERE i.product_id = products.id ORDER BY i.is_primary DESC, i.id LIMIT 1) AS primary_image_id FROM products WHERE id = ?').get(pid);
  const evidence = c.db.prepare("SELECT * FROM evidence WHERE product_id = ? AND review_state = 'pending' ORDER BY field, id").all(pid) as unknown as Ev[];
  const remaining = (c.db.prepare("SELECT COUNT(DISTINCT product_id) n FROM evidence WHERE review_state = 'pending'").get() as { n: number }).n;
  return { product, evidence, remaining, identity_conflict: evidence.some((e) => e.match_basis === 'ambiguous') };
});

function refreshJobReview(db: DB, productId: number) {
  const rows = db.prepare('SELECT review_state s, COUNT(*) n FROM evidence WHERE product_id = ? GROUP BY review_state').all(productId) as { s: string; n: number }[];
  const m = Object.fromEntries(rows.map((r) => [r.s, r.n])); if (m.pending) return;
  const state = m.accepted && m.rejected ? 'partially_accepted' : m.accepted ? 'accepted' : 'rejected';
  db.prepare("UPDATE enrichment_jobs_v2 SET review_state = ?, updated_at = ? WHERE product_id = ? AND review_state = 'pending'").run(state, now(), productId);
}

route('POST', '/api/evidence/review', 'manager', async (c) => {
  const b = z.object({ product_id: z.number().int().positive(), version: z.number().int().positive(),
    decisions: z.array(z.object({ evidence_id: z.number().int().positive(), action: z.enum(['accept', 'reject']), override: z.string().max(20000).optional() })).min(1).max(20),
    confirm_identity: z.boolean().default(false) }).strict().parse(await c.body());
  const p = c.db.prepare('SELECT * FROM products WHERE id = ?').get(b.product_id) as Record<string, unknown> | undefined;
  if (!p) throw new HttpError(404, 'المنتج غير موجود');
  if (p.version !== b.version) throw Object.assign(new HttpError(409, 'تغيّر المنتج بعد فتح المراجعة. أعد فتحها لترى آخر نسخة.'), { stale: true, currentVersion: p.version as number });
  const evs = b.decisions.map((d) => { const e = c.db.prepare('SELECT * FROM evidence WHERE id = ? AND product_id = ?').get(d.evidence_id, b.product_id) as unknown as Ev | undefined; if (!e) throw new HttpError(404, 'دليل غير موجود'); if (e.review_state !== 'pending') throw new HttpError(409, 'تمت مراجعة هذا الدليل مسبقًا'); return { d, e }; });
  // identity first: accepting anything from an AMBIGUOUS match needs an explicit "this IS the same product" from the reviewer
  if (evs.some((x) => x.d.action === 'accept' && x.e.match_basis === 'ambiguous') && !b.confirm_identity) throw new HttpError(409, 'المطابقة ملتبسة (اختلاف في الحجم/الإصدار/الاسم). أكّد أنه المنتج نفسه أولًا، أو ارفض.');
  const t = now(); const uid = c.user!.id; let changed = false;
  c.db.exec('BEGIN');
  try {
    for (const { d, e } of evs) {
      if (d.action === 'reject') { c.db.prepare("UPDATE evidence SET review_state='rejected', reviewed_by=?, reviewed_at=? WHERE id=?").run(uid, t, e.id); audit(c.db, uid, 'evidence_reject', 'evidence', e.id, `product=${b.product_id} field=${e.field}`); continue; }
      const value = (d.override ?? e.value).trim();
      const col = (EDITABLE as Record<string, string>)[e.field];
      if (col) {
        const old = String(p[col] ?? '');
        c.db.prepare(`UPDATE products SET ${col} = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(value, t, b.product_id);
        changed = changed || old !== value;
        audit(c.db, uid, 'evidence_accept', 'product', b.product_id, `field=${e.field} provider=${e.provider} old_len=${old.length} new_len=${value.length}${d.override ? ' edited' : ''}`);
      } else audit(c.db, uid, 'evidence_accept_reference', 'product', b.product_id, `field=${e.field} provider=${e.provider}`);   // e.g. image_url: kept as an external reference, not downloaded
      c.db.prepare("INSERT INTO product_facts(product_id, field, value, origin, source_name, source_url, extracted_at, verified_at, verified_by, review_status) VALUES (?,?,?,?,?,?,?,?,?, 'approved')")
        .run(b.product_id, e.field, value, d.override ? 'manual' : 'source', e.provider, e.source_url, e.retrieved_at, t, uid);
      c.db.prepare("UPDATE evidence SET review_state='accepted', reviewed_by=?, reviewed_at=? WHERE id=?").run(uid, t, e.id);
      // other pending proposals for the same field are superseded by this decision
      c.db.prepare("UPDATE evidence SET review_state='rejected', reviewed_by=?, reviewed_at=? WHERE product_id=? AND field=? AND review_state='pending'").run(uid, t, b.product_id, e.field);
    }
    // content changes invalidate a previous approval (same rule as a manual edit)
    if (changed && p.verification === 'verified') c.db.prepare("UPDATE products SET verification='review' WHERE id=?").run(b.product_id);
    refreshJobReview(c.db, b.product_id);
    c.db.exec('COMMIT');
  } catch (e) { c.db.exec('ROLLBACK'); throw e; }
  const v = (c.db.prepare('SELECT version FROM products WHERE id = ?').get(b.product_id) as { version: number }).version;
  return { ok: true, version: v };
});
