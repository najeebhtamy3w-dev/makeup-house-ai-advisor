/**
 * CP07 Phase 11 — product ↔ knowledge bridge. Reads ACTIVE shop products only (record_status = 'active', supplied by
 * the caller), runs the UNCHANGED CP06.2 suitability engine (advisor.ts → science/*), then explains each product with
 * ingredient_knowledge. Writes nothing: no inference is ever stored in a product record. Suitability, information
 * completeness and availability stay three separate fields. No prices, stock quantities or sales — not in scope.
 */
import type { DB } from '../db.ts';
import { advise, type P } from '../advisor.ts';
import type { Cp07Understanding } from './nlu.ts';
import { USABLE_SQL } from './store.ts';

const TYPE_TO_TAXONOMY: Record<string, string[]> = { cleanser: ['cleanser'], moisturizer: ['cream', 'lotion', 'moisturizer'], sunscreen: ['sunscreen'], serum: ['serum'], toner: ['toner'], shampoo: ['shampoo'], conditioner: ['conditioner'], hair_oil: ['oil', 'hair_oil'], mask: ['mask'], exfoliant: ['exfoliant', 'scrub', 'peeling'] };
const TYPE_AR: Record<string, string> = { cleanser: 'غسول', moisturizer: 'مرطب', sunscreen: 'واقي شمس', serum: 'سيروم', toner: 'تونر', shampoo: 'شامبو', conditioner: 'بلسم', hair_oil: 'زيت شعر', mask: 'ماسك', exfoliant: 'مقشر' };
const SKIN_AR: Record<string, string> = { dry: 'جافة', oily: 'دهنية', combination: 'مختلطة', sensitive: 'حساسة', normal: 'عادية' };

export interface BridgeItem {
  id: number; name: string; brand: string; product_type: string;
  suitability: { verdict: string; label: string; reasons: string[]; precautions: string[]; missing: string[] };
  information: 'documented' | 'partial' | 'unknown'; availability: string; availability_note: string;
  ingredients_explained: { inci: string; functions: string[]; claim_ids: string[] }[];
}
export interface BridgeResult { items: BridgeItem[]; needs_information: { id: number; name: string; missing: string }[]; excluded: { id: number; name: string; reasons: string[] }[]; note: string }

export function productBridge(db: DB, products: P[], u: Cp07Understanding, conflictIds?: Set<number>): BridgeResult {
  const type = u.requested_product_type;
  if (!type) return { items: [], needs_information: [], excluded: [], note: 'لم يُطلب نوع منتج محدد؛ لا ترشيح منتجات.' };
  // a query the CP06.2 engine already understands, built from the UNDERSTOOD facts (not free text)
  // sensitive skin → fragrance-free is requested from the unchanged rules, because the knowledge base says so
  // (sensitive-skin claim «اختاري منتجات لطيفة خالية من العطور», AAD). This only builds the query; science/* decides.
  const avoidFragrance = u.constraints.includes('fragrance_free') || u.skin_type.includes('sensitive');
  const query = [TYPE_AR[type] ?? '', ...u.skin_type.map((s) => `بشرة ${SKIN_AR[s] ?? ''}`), avoidFragrance ? 'بدون عطر' : '', u.constraints.includes('sulfate_free') ? 'بدون سلفات' : ''].join(' ').trim();
  const wanted = TYPE_TO_TAXONOMY[type] ?? [type];
  const pool = products.filter((p) => wanted.includes(p.product_type ?? '') || wanted.some((w) => p.category === w));
  const r = advise(query, pool, { conflictIds });
  const ingRows = db.prepare('SELECT inci, synonyms, functions, topic_id FROM ingredient_knowledge').all() as { inci: string; synonyms: string; functions: string; topic_id: string }[];
  const claimIds = db.prepare(`SELECT id FROM knowledge_claims WHERE topic_id = ? AND ${USABLE_SQL} ORDER BY id`);
  const items: BridgeItem[] = [];
  for (const m of r.store_matches as Record<string, any>[]) {
    const p = pool.find((x) => x.id === m.id)!;
    if (!['suitable', 'conditional'].includes(m.suitability.verdict)) continue;   // never a confident recommendation from incomplete data
    const inci = p.ingredients.toLowerCase().split(/[,،;]/).map((s) => s.trim()).filter(Boolean);
    const explained = ingRows.filter((i) => [i.inci, ...JSON.parse(i.synonyms) as string[]].some((n) => inci.includes(n.toLowerCase())))
      .map((i) => ({ inci: i.inci, functions: JSON.parse(i.functions) as string[], claim_ids: (claimIds.all(i.topic_id) as { id: string }[]).map((x) => x.id) }));
    items.push({
      id: p.id, name: p.name, brand: p.brand, product_type: p.product_type ?? '',
      suitability: { verdict: m.suitability.verdict, label: m.suitability.verdict_label, reasons: m.suitability.reasons, precautions: m.suitability.precautions ?? [], missing: m.suitability.missing ?? [] },
      information: m.suitability.level, availability: m.availability, availability_note: m.availability_note, ingredients_explained: explained,
    });
  }
  const needs_information = [...(r.cannot_assess as Record<string, any>[]), ...(r.store_matches as Record<string, any>[]).filter((m) => m.suitability.verdict === 'insufficient')]
    .map((m) => ({ id: m.id, name: m.name, missing: m.reason ?? (m.suitability?.missing?.[0] ?? 'معلومات المكونات غير كافية') }));
  const excluded = (r.excluded as { id: number; name: string; reasons: string[] }[]).map((e) => ({ id: e.id, name: e.name, reasons: e.reasons }));
  const note = !pool.length ? `لا يوجد في الكتالوج المعتمد منتج من نوع «${TYPE_AR[type] ?? type}».`
    : !items.length ? 'توجد منتجات من هذا النوع لكن معلوماتها لا تكفي لترشيح مطمئن؛ تحتاج مراجعة المكونات.' : 'الملاءمة من قواعد المحل المعتمدة؛ التوفر منفصل ويُتأكد منه على الرف.';
  return { items: items.slice(0, 5), needs_information: needs_information.slice(0, 5), excluded: excluded.slice(0, 5), note };
}
