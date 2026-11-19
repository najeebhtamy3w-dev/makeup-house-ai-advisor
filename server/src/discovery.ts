// CP05 unified product discovery: INPUT → IDENTIFY → SEARCH (store first, then source) → MATCH (reasons) → drafts for REVIEW.
// One service for the three flows (new product, completing an imported product, updating an existing one).
// Nothing here ever writes product data: barcode lookups store DRAFT candidates (existing engine), name hits are only suggestions.
import { z } from 'zod';
import type { DB } from './db.ts';
import { audit } from './db.ts';
import { HttpError, route } from './http.ts';
import { gtinValid, normalizeBarcode } from './gtin.ts';
import { norm } from './advisor.ts';
import { compareBrand, compareName, compareSize, type FieldCmp } from './enrichment/identity.ts';
import { enrichBarcode, getConnectors } from './enrichment/engine.ts';
import { Unreachable, type SearchHit } from './enrichment/types.ts';

export const POSSIBLE = 'تطابق محتمل — يحتاج مراجعة';
export const COVERAGE_NOTE = 'المصدر الحالي (Open Beauty Facts) قاعدة مفتوحة يسهم فيها المستخدمون: تغطيتها جزئية، وقد تكون بعض البيانات ناقصة أو مترجمة. البحث بالاسم يعطي مرشحين محتملين فقط، ولا يوجد تعرف بصري على الصورة في هذه النسخة.';

interface Q { barcode: string; name: string; brand: string; size: string }
type Reason = { field: 'barcode' | 'name' | 'brand' | 'size'; match: FieldCmp['match'] | 'missing'; note: string };

/** Explains why a record might (not) be the same product. Name/brand alone are never proof; size differences are flagged. */
export function matchReasons(q: Q, r: { barcode?: string | null; name: string; brand: string; size: string }): { reasons: Reason[]; score: number; same_barcode: boolean } {
  const reasons: Reason[] = []; let score = 0;
  const same_barcode = !!(q.barcode && r.barcode && q.barcode === r.barcode);
  if (same_barcode) { reasons.push({ field: 'barcode', match: 'exact', note: 'نفس الباركود (لا يثبت وحده تطابق التركيبة)' }); score += 100; }
  if (q.name && r.name) { const c = compareName(q.name, r.name); reasons.push({ field: 'name', match: c.match, note: c.note || 'الاسم مطابق' }); score += c.match === 'exact' ? 30 : c.match === 'partial' ? 15 : 0; }
  if (q.brand && r.brand) { const c = compareBrand(q.brand, r.brand); reasons.push({ field: 'brand', match: c.match, note: c.note || 'العلامة مطابقة' }); score += c.match === 'exact' ? 20 : -20; }
  else if (q.brand || r.brand) reasons.push({ field: 'brand', match: 'missing', note: 'العلامة غير معروفة لأحد الطرفين' });
  if (q.size && r.size) { const c = compareSize(q.size, r.size); reasons.push({ field: 'size', match: c.match, note: c.note || 'الحجم مطابق' }); score += c.match === 'exact' ? 10 : c.match === 'conflict' ? -15 : 0; }
  else reasons.push({ field: 'size', match: 'missing', note: 'الحجم غير معروف لأحد الطرفين — تحقق من العبوة' });
  return { reasons, score, same_barcode };
}

/** Store first: same barcode, or a similar name (possible duplicate). Different sizes stay different products. */
export function findLocal(db: DB, q: Q, excludeId?: number) {
  const rows: { id: number; barcode: string | null; name: string; brand: string; size: string; verification: string; primary_image_id: number | null }[] = [];
  const sel = "SELECT p.id, p.barcode, p.name, p.brand, p.size, p.verification, (SELECT i.id FROM product_images i WHERE i.product_id = p.id ORDER BY i.is_primary DESC, i.id LIMIT 1) AS primary_image_id FROM products p";
  if (q.barcode) rows.push(...(db.prepare(`${sel} WHERE p.barcode = ?`).all(q.barcode) as typeof rows));
  const toks = norm(q.name).split(/\s+/).filter((t) => t.length >= 3).sort((a, b) => b.length - a.length).slice(0, 2);
  for (const t of toks) rows.push(...(db.prepare(`${sel} WHERE p.name LIKE ? LIMIT 200`).all(`%${t.replace(/[%_]/g, '')}%`) as typeof rows));
  const seen = new Set<number>();
  return rows.filter((r) => r.id !== excludeId && !seen.has(r.id) && seen.add(r.id))
    .map((r) => ({ ...r, ...matchReasons(q, r) }))
    .filter((r) => r.same_barcode || r.reasons.some((x) => x.field === 'name' && x.match !== 'conflict'))
    .sort((a, b) => b.score - a.score).slice(0, 5)
    .map((r) => ({ ...r, status: r.same_barcode ? 'same_barcode' : 'possible_duplicate', label: r.same_barcode ? 'مسجل في المحل بنفس الباركود' : 'منتج مشابه في المحل — تحقق: قد يكون حجمًا أو إصدارًا مختلفًا' }));
}

const searches: number[] = [];
const SEARCH_PER_MIN = 8; // OBF documents 10 search requests/min/IP; stay below it
export const resetSearchLimiter = () => { searches.length = 0; };
function takeSearch(t = Date.now()) { while (searches.length && t - searches[0]! > 60_000) searches.shift(); if (searches.length >= SEARCH_PER_MIN) return false; searches.push(t); return true; }

export async function identify(db: DB, cfg: Parameters<typeof enrichBarcode>[1], input: Partial<Q> & { product_id?: number }, userId: number) {
  const q: Q = { barcode: normalizeBarcode(input.barcode ?? ''), name: (input.name ?? '').trim(), brand: (input.brand ?? '').trim(), size: (input.size ?? '').trim() };
  if (q.barcode && !gtinValid(q.barcode)) throw new HttpError(400, 'الباركود غير صالح (الطول أو رقم التحقق). أعد مسحه.');
  if (!q.barcode && q.name.length < 2) throw new HttpError(400, 'أدخل الباركود أو اسم المنتج (حرفان على الأقل) للبحث.');
  const local = findLocal(db, q, input.product_id);
  const connectors = getConnectors();
  if (!connectors.length) return { query: q, local, global: { mode: 'disabled' as const, outcome: 'disabled', note: 'البحث في المصادر غير مفعّل على هذا الخادم. أدخل البيانات يدويًا.' }, coverage_note: COVERAGE_NOTE };

  if (q.barcode) {
    try {
      const r = await enrichBarcode(db, cfg, q.barcode, userId);
      return { query: q, local, global: { mode: 'barcode' as const, ...r, status: r.outcome === 'found' ? POSSIBLE : null }, coverage_note: COVERAGE_NOTE };
    } catch (e) { if ((e as Error).message === 'invalid_barcode') throw new HttpError(400, 'الباركود غير صالح'); throw e; }
  }
  const searchable = connectors.filter((c) => c.searchByName);
  if (!searchable.length) return { query: q, local, global: { mode: 'name' as const, outcome: 'unsupported', hits: [], note: 'المصدر المفعّل لا يدعم البحث بالاسم. امسح الباركود.' }, coverage_note: COVERAGE_NOTE };
  if (!takeSearch()) return { query: q, local, global: { mode: 'name' as const, outcome: 'rate_limited', hits: [] }, coverage_note: COVERAGE_NOTE };
  const hits: (SearchHit & { source_name: string; in_store_id: number | null; reasons: Reason[]; score: number; status: string })[] = [];
  let outcome: 'found' | 'not_found' | 'unreachable' = 'not_found';
  for (const c of searchable) {
    try {
      for (const h of await c.searchByName!({ name: q.name, brand: q.brand })) {
        const m = matchReasons(q, h);
        const inStore = db.prepare('SELECT id FROM products WHERE barcode = ?').get(h.code) as { id: number } | undefined;
        hits.push({ ...h, source_name: c.name, in_store_id: inStore?.id ?? null, reasons: m.reasons, score: m.score, status: POSSIBLE });
      }
      if (hits.length) outcome = 'found';
    } catch (e) { if (e instanceof Unreachable) { if (outcome !== 'found') outcome = 'unreachable'; } else throw e; }
  }
  hits.sort((a, b) => b.score - a.score);
  audit(db, userId, 'discovery_search', 'name', norm(q.name).slice(0, 40), `${outcome}:${hits.length}`);
  return { query: q, local, global: { mode: 'name' as const, outcome, hits: hits.slice(0, 10), status: hits.length ? POSSIBLE : null }, coverage_note: COVERAGE_NOTE };
}

route('POST', '/api/discovery/identify', 'any', async (c) => {
  const d = z.object({ barcode: z.string().max(40).optional(), name: z.string().max(200).optional(), brand: z.string().max(120).optional(), size: z.string().max(60).optional(), product_id: z.number().int().positive().optional() }).strict().parse(await c.body());
  return identify(c.db, c.cfg, d, c.user!.id);
});

/** Pending source suggestions for ONE product (its barcode). Staff may see them; only a manager approves (existing review route). */
route('GET', '/api/products/:id/suggestions', 'any', (c) => {
  const id = Number(c.params.id); if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'معرّف غير صالح');
  const p = c.db.prepare('SELECT id, barcode, name, brand, size, ingredients FROM products WHERE id = ?').get(id) as { barcode: string | null } & Record<string, string> | undefined;
  if (!p) throw new HttpError(404, 'المنتج غير موجود');
  if (!p.barcode) return { barcode: null, candidates: [], last_lookup: null };
  const candidates = c.db.prepare("SELECT id, field, value, source_name, source_url, license, is_mock, conflict_note, quality_note, extracted_at FROM enrichment_candidates WHERE barcode = ? AND review_status = 'pending' ORDER BY field, id").all(p.barcode);
  const last = c.db.prepare('SELECT outcome, fetched_at FROM enrichment_runs WHERE barcode = ? ORDER BY id DESC LIMIT 1').get(p.barcode) ?? null;
  return { barcode: p.barcode, local: { name: p.name, brand: p.brand, size: p.size, ingredients: p.ingredients }, candidates, last_lookup: last };
});
