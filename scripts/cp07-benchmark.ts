/**
 * CP07 Phase 12 — runs the held-out benchmark against:
 *   ORIGINAL  = CP06.2 conversational advisor (advisor2: understand() + consult()), unchanged
 *   CP07      = CP07 knowledge engine, LOCAL_RULES (no model)
 * The LOCAL_MODEL hybrid runs separately (experiments/cp07-open-source-ai) because it needs model weights.
 * Synthetic catalogue only; no network; no real shop data. Writes raw results to docs/cp07/benchmark-raw.json.
 * Run: node --no-warnings --import tsx scripts/cp07-benchmark.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { openDb, type DB } from '../server/src/db.ts';
import { understand } from '../server/src/advisor2/understand.ts';
import { consult } from '../server/src/advisor2/compose.ts';
import { seedKnowledge, getClaim, USABLE_SQL } from '../server/src/cp07/store.ts';
import { answerCp07 } from '../server/src/cp07/answer.ts';
import { understandCp07 } from '../server/src/cp07/nlu.ts';
import { findConflicts } from '../server/src/cp07/validate.ts';
import { PRODUCT_SELECT, presentProduct, type ProductRow } from '../server/src/routes.ts';
import { ALL_QUESTIONS, BENCH, type Gold, type Q } from '../tests/fixtures/cp07-benchmark.ts';
import { AdvisorContext } from '../server/src/contracts.ts';

export function syntheticCatalogue(db: DB) {
  const t = new Date().toISOString();
  db.prepare("INSERT OR IGNORE INTO users(id, username, display_name, role, password_hash, created_at) VALUES (1,'bench','Bench','manager','x',?)").run(t);
  const P: [string, string, string, string, string, string, string][] = [
    // name, brand, product_type, category, verification, ingredients, record_status
    ['Gentle Hydrating Cleanser TEST', 'Synth', 'cleanser', 'عناية بالبشرة', 'verified', 'aqua, glycerin, cocamidopropyl betaine, ceramide np, panthenol, phenoxyethanol', 'active'],
    ['Foaming Gel Cleanser TEST', 'Synth', 'cleanser', 'عناية بالبشرة', 'verified', 'aqua, sodium laureth sulfate, cocamidopropyl betaine, parfum, phenoxyethanol', 'active'],
    ['Cleanser No INCI TEST', 'Synth', 'cleanser', 'عناية بالبشرة', 'review', '', 'active'],
    ['Draft Cleanser TEST', 'Synth', 'cleanser', 'عناية بالبشرة', 'verified', 'aqua, glycerin', 'import_draft'],
    ['Barrier Cream TEST', 'Synth', 'cream', 'عناية بالبشرة', 'verified', 'aqua, glycerin, petrolatum, ceramide np, cholesterol, dimethicone, phenoxyethanol', 'active'],
    ['Light Gel Moisturizer TEST', 'Synth', 'gel', 'عناية بالبشرة', 'partial', 'aqua, glycerin, sodium hyaluronate, niacinamide, parfum', 'active'],
    ['Mineral Sunscreen SPF50 TEST', 'Synth', 'sunscreen', 'عناية بالبشرة', 'verified', 'aqua, zinc oxide, titanium dioxide, glycerin, dimethicone', 'active'],
    ['Daily Shampoo TEST', 'Synth', 'shampoo', 'عناية بالشعر', 'verified', 'aqua, sodium laureth sulfate, cocamidopropyl betaine, panthenol, parfum', 'active'],
    ['Repair Conditioner TEST', 'Synth', 'conditioner', 'عناية بالشعر', 'verified', 'aqua, cetearyl alcohol, behentrimonium chloride, amodimethicone, panthenol', 'active'],
    ['Archived Shampoo TEST', 'Synth', 'shampoo', 'عناية بالشعر', 'verified', 'aqua, decyl glucoside', 'archived'],
  ];
  const ins = db.prepare("INSERT INTO products(name, brand, product_type, category, verification, ingredients, record_status, availability, created_at, updated_at) VALUES (?,?,?,?,?,?,?,'unknown',?,?)");
  for (const p of P) ins.run(...p, t, t);
  return () => (db.prepare(`${PRODUCT_SELECT} WHERE products.record_status = 'active'`).all() as unknown as ProductRow[]).map((p) => presentProduct(p, 72));
}

const eqSet = (a: string[] = [], b: string[] = []) => a.length === b.length && a.every((x) => b.includes(x));
const SYSTEM_KINDS = new Set(['understanding', 'insufficient', 'follow_up', 'scope', 'referral', 'products', 'warnings']);
const INSUF_RE = /لا تتوفر لدي معلومات موثوقة كافية/;
const ORIG_INSUF_RE = /(لا تتوفر|لا أملك|لا يوجد لدي|غير كافي|غير كافية|لم أتعرف|لم يتضح|وضّح|وضحي|ما نوع)/;
const mapOrigIntent = (i: string) => i === 'ingredient' ? 'ingredient_question' : i;

function scoreNlu(pred: { intent: string; product_type: string | null; skin: string[]; hair: string[]; ingredients?: string[] }, g: Gold) {
  const r: Record<string, boolean | null> = {
    intent: g.intent ? g.intent.includes(pred.intent) : null,
    product: g.product_type !== undefined ? pred.product_type === g.product_type : null,
    skin: g.skin !== undefined ? eqSet(pred.skin, g.skin) : null,
    hair: g.hair !== undefined ? eqSet(pred.hair, g.hair) : null,
    ingredients: g.ingredients ? g.ingredients.every((x) => (pred.ingredients ?? []).includes(x)) : null,
  };
  return r;
}

async function main() {
  const db = openDb(':memory:'); seedKnowledge(db); const products = syntheticCatalogue(db);
  const usable = new Set((db.prepare(`SELECT id FROM knowledge_claims WHERE ${USABLE_SQL}`).all() as { id: string }[]).map((r) => r.id));
  const srcOf = (id: string) => (db.prepare('SELECT source_id FROM knowledge_claim_sources WHERE claim_id = ? ORDER BY source_id').all(id) as { source_id: string }[]).map((r) => r.source_id);
  const raw: Record<string, unknown>[] = [];
  const lat: { orig: number[]; cp07: number[] } = { orig: [], cp07: [] };
  for (const q of ALL_QUESTIONS) {
    // ---------- ORIGINAL ----------
    let t0 = performance.now();
    const ou = understand(q.text);
    const oc = await consult(db, 1, undefined, q.text, { products, ai: { provider: null, monthly_budget_usd: 5, daily_request_cap: 200, timeout_ms: 1000 }, online: false });
    lat.orig.push(performance.now() - t0);
    const oText = oc.response.sections.flatMap((s) => [s.title, ...s.items.map((i) => i.text)]).join('\n');
    const oLocal = oc.response.sections.find((s) => s.kind === 'local_recommendations');
    const oUnsourced = oc.response.sections.filter((s) => ['condition_education', 'practical_advice', 'ingredient_guidance', 'suggested_routine'].includes(s.kind)).flatMap((s) => s.items).filter((i) => !i.sources.length).length;
    const oNlu = scoreNlu({ intent: mapOrigIntent(ou.intent), product_type: ou.asked_product_type, skin: ou.ctx.skin, hair: ou.ctx.hair }, q.gold);
    // ---------- CP07 ----------
    t0 = performance.now();
    const a = answerCp07(db, q.text, undefined, { products, logGaps: true });
    lat.cp07.push(performance.now() - t0);
    const u = a.understanding;
    const cNlu = scoreNlu({ intent: u.intent, product_type: u.requested_product_type, skin: u.skin_type, hair: u.hair_type, ingredients: u.ingredients }, q.gold);
    const items = a.sections.flatMap((s) => s.items.map((i) => ({ s, i })));
    const unsupported = items.filter(({ s, i }) => !i.claim_id && !SYSTEM_KINDS.has(s.kind)).length
      + items.filter(({ i }) => i.claim_id && (!usable.has(i.claim_id) || getClaim(db, i.claim_id)!.text_ar !== i.text)).length;
    const badCitations = items.filter(({ i }) => i.claim_id && JSON.stringify(srcOf(i.claim_id)) !== JSON.stringify(i.source_ids)).length
      + a.sources.filter((s) => !s?.url).length;
    const topicsUsed = a.used_claim_ids.map((id) => getClaim(db, id)!.topic_id);
    const precision = q.gold.topics_any && topicsUsed.length ? topicsUsed.filter((t) => q.gold.topics_any!.includes(t)).length / topicsUsed.length : null;
    const hitAny = q.gold.topics_any ? topicsUsed.some((t) => q.gold.topics_any!.includes(t)) : null;
    const productLeak = (a.products?.items ?? []).filter((p) => /Draft|Archived/.test(p.name)).length
      + (a.products?.items ?? []).filter((p) => u.requested_product_type && !({ cleanser: ['cleanser'], moisturizer: ['cream', 'lotion', 'gel', 'moisturizer'], sunscreen: ['sunscreen'], shampoo: ['shampoo'], conditioner: ['conditioner'] } as Record<string, string[]>)[u.requested_product_type]?.includes(p.product_type) && !(u.requested_product_type === 'moisturizer' && p.product_type === 'gel')).length;
    const redOk = q.gold.red_flag ? (a.sections.every((s) => s.kind === 'referral' || s.kind === 'understanding') && !a.used_claim_ids.length && !a.products) : null;
    const origRedOk = q.gold.red_flag ? (oc.response.sections.some((s) => s.kind === 'safety_warnings') && !(oLocal?.items.length)) : null;
    const referOk = q.gold.referral ? (u.referrals.length > 0 || /طبيب|مختص|صيدلي/.test(a.text)) : null;
    const origReferOk = q.gold.referral ? /طبيب|مختص|صيدلي/.test(oText) : null;
    const insufOk = q.gold.insufficient ? INSUF_RE.test(a.text) : null;
    const origInsufOk = q.gold.insufficient ? ORIG_INSUF_RE.test(oText) : null;
    raw.push({ id: q.id, cat: q.cat, text: q.text, cp07: { nlu: cNlu, intent: u.intent, product: u.requested_product_type, skin: u.skin_type, hair: u.hair_type, ingredients: u.ingredients, used: a.used_claim_ids, unsupported, badCitations, precision, hitAny, productLeak, redOk, referOk, insufOk, evidence_status: a.evidence_status, products: a.products?.items.map((p) => p.name) ?? [] },
      original: { nlu: oNlu, intent: ou.intent, product: ou.asked_product_type, skin: ou.ctx.skin, hair: ou.ctx.hair, unsourced: oUnsourced, redOk: origRedOk, referOk: origReferOk, insufOk: origInsufOk } });
  }
  // ---------- multi-turn ----------
  const conv: Record<string, unknown>[] = [];
  for (const c of BENCH.conversations) {
    let ctx = AdvisorContext.parse({}); let octx = AdvisorContext.parse({}); const res: { cp07: Record<string, boolean | null>; original: Record<string, boolean | null> }[] = [];
    for (const t of c.turns) {
      const u = understandCp07(t.text, ctx); ctx = u.intent === 'reset' ? AdvisorContext.parse({}) : u.conversation_context;
      const o = understand(t.text, octx); octx = o.intent === 'reset' ? AdvisorContext.parse({}) : o.ctx;
      res.push({ cp07: scoreNlu({ intent: u.intent, product_type: u.requested_product_type, skin: u.skin_type, hair: u.hair_type }, t.gold), original: scoreNlu({ intent: mapOrigIntent(o.intent), product_type: o.asked_product_type, skin: o.ctx.skin, hair: o.ctx.hair }, t.gold) });
    }
    conv.push({ id: c.id, turns: c.turns.map((t) => t.text), res });
  }
  // ---------- conflicts ----------
  const conflicts = BENCH.conflicts.map((k) => { const f = findConflicts(k.a, [k.b]); const got = f[0]?.type ?? 'none'; return { id: k.id, expect: k.expect, got, ok: got === k.expect }; });

  // ---------- summary ----------
  const rate = (xs: (boolean | null | undefined)[]) => { const v = xs.filter((x) => x !== null && x !== undefined) as boolean[]; return v.length ? { pct: Math.round(1000 * v.filter(Boolean).length / v.length) / 10, n: v.length } : null; };
  const pick = (eng: 'cp07' | 'original', field: string, cats?: string[]) => raw.filter((r) => !cats || cats.includes(r.cat as string)).map((r) => ((r[eng] as Record<string, unknown>).nlu as Record<string, boolean | null>)[field]);
  const pctl = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]! * 10) / 10; };
  const cp = raw.map((r) => r.cp07 as Record<string, any>); const og = raw.map((r) => r.original as Record<string, any>);
  const convTurns = conv.flatMap((c) => (c.res as { cp07: Record<string, boolean | null>; original: Record<string, boolean | null> }[]));
  const summary = {
    generated_at: new Date().toISOString(), questions: raw.length, conversations: conv.length, conflict_cases: conflicts.length,
    intent_accuracy: { cp07: rate(pick('cp07', 'intent')), original: rate(pick('original', 'intent')) },
    product_type_accuracy: { cp07: rate(pick('cp07', 'product')), original: rate(pick('original', 'product')) },
    skin_type_accuracy: { cp07: rate(pick('cp07', 'skin')), original: rate(pick('original', 'skin')) },
    hair_type_accuracy: { cp07: rate(pick('cp07', 'hair')), original: rate(pick('original', 'hair')) },
    ingredient_detection: { cp07: rate(pick('cp07', 'ingredients')), original: null },
    yemeni_intent: { cp07: rate(pick('cp07', 'intent', ['yemeni'])), original: rate(pick('original', 'intent', ['yemeni'])) },
    yemeni_all_fields: { cp07: rate(raw.filter((r) => r.cat === 'yemeni').map((r) => Object.values((r.cp07 as any).nlu).filter((x) => x !== null).every(Boolean))), original: rate(raw.filter((r) => r.cat === 'yemeni').map((r) => Object.values((r.original as any).nlu).filter((x) => x !== null).every(Boolean))) },
    by_category_intent: Object.fromEntries(['skin', 'hair', 'ingredient', 'yemeni'].map((c) => [c, { cp07: rate(pick('cp07', 'intent', [c])), original: rate(pick('original', 'intent', [c])) }])),
    multi_turn_turn_accuracy: { cp07: rate(convTurns.map((t) => Object.values(t.cp07).filter((x) => x !== null).every(Boolean))), original: rate(convTurns.map((t) => Object.values(t.original).filter((x) => x !== null).every(Boolean))) },
    retrieval_topic_hit: rate(cp.map((x) => x.hitAny)),
    retrieval_precision_mean: (() => { const v = cp.map((x) => x.precision).filter((x) => x !== null) as number[]; return { mean: Math.round(1000 * v.reduce((s, x) => s + x, 0) / v.length) / 10, n: v.length }; })(),
    unsupported_items_total: { cp07: cp.reduce((s, x) => s + x.unsupported, 0), original_unsourced_content_items: og.reduce((s, x) => s + x.unsourced, 0) },
    citation_errors_total: cp.reduce((s, x) => s + x.badCitations, 0),
    product_leaks_total: cp.reduce((s, x) => s + x.productLeak, 0),
    medical_red_flag_handling: { cp07: rate(cp.map((x) => x.redOk)), original: rate(og.map((x) => x.redOk)) },
    referral_handling: { cp07: rate(cp.map((x) => x.referOk)), original: rate(og.map((x) => x.referOk)) },
    insufficient_evidence_admitted: { cp07: rate(cp.map((x) => x.insufOk)), original_any_hedge: rate(og.map((x) => x.insufOk)) },
    conflict_detection: rate(conflicts.map((c) => c.ok)),
    latency_ms: { cp07: { p50: pctl(lat.cp07, 0.5), p95: pctl(lat.cp07, 0.95) }, original: { p50: pctl(lat.orig, 0.5), p95: pctl(lat.orig, 0.95) } },
    rss_mb_after: Math.round(process.memoryUsage().rss / 1e6),
    network_calls: 0,
    gaps_logged: db.prepare('SELECT gap_key, hits FROM knowledge_gaps ORDER BY hits DESC').all(),
  };
  mkdirSync('docs/cp07', { recursive: true });
  writeFileSync('docs/cp07/benchmark-raw.json', JSON.stringify({ summary, questions: raw, conversations: conv, conflicts }, null, 1));
  console.log(JSON.stringify(summary, null, 1));
}
const isMain = process.argv[1]?.endsWith('cp07-benchmark.ts'); if (isMain) await main();
export type { Q };
