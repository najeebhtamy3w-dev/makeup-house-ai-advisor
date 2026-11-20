/** Scores BLIND-2 once (CP07 vs ORIGINAL). Run: node --no-warnings --import tsx scripts/cp07-blind2.ts */
import { writeFileSync } from 'node:fs';
import { openDb } from '../server/src/db.ts';
import { understand } from '../server/src/advisor2/understand.ts';
import { consult } from '../server/src/advisor2/compose.ts';
import { seedKnowledge, getClaim } from '../server/src/cp07/store.ts';
import { answerCp07 } from '../server/src/cp07/answer.ts';
import { syntheticCatalogue } from './cp07-benchmark.ts';
import { BLIND2, type Gold } from '../tests/fixtures/cp07-benchmark.ts';
const db = openDb(':memory:'); seedKnowledge(db); const products = syntheticCatalogue(db);
const eq = (a: string[] = [], b: string[] = []) => a.length === b.length && a.every((x) => b.includes(x));
const sc = (p: { intent: string; product: string | null; skin: string[]; hair: string[]; ing?: string[] }, g: Gold) => ({ intent: g.intent ? g.intent.includes(p.intent) : null, product: g.product_type !== undefined ? p.product === g.product_type : null, skin: g.skin ? eq(p.skin, g.skin) : null, hair: g.hair ? eq(p.hair, g.hair) : null, ingredients: g.ingredients ? g.ingredients.every((x) => (p.ing ?? []).includes(x)) : null });
const rows = [];
for (const q of BLIND2) {
  const a = answerCp07(db, q.text, undefined, { products }); const u = a.understanding;
  const o = understand(q.text); const oc = await consult(db, 1, undefined, q.text, { products, ai: { provider: null, monthly_budget_usd: 5, daily_request_cap: 200, timeout_ms: 1000 }, online: false });
  const oText = oc.response.sections.flatMap((s) => [s.title, ...s.items.map((i) => i.text)]).join('\n');
  const topics = a.used_claim_ids.map((id) => getClaim(db, id)!.topic_id);
  rows.push({ id: q.id, cat: q.cat, text: q.text,
    cp07: { ...sc({ intent: u.intent, product: u.requested_product_type, skin: u.skin_type, hair: u.hair_type, ing: u.ingredients }, q.gold), got: [u.intent, u.requested_product_type, u.skin_type, u.hair_type, u.ingredients],
      topic_hit: q.gold.topics_any ? topics.some((t) => q.gold.topics_any!.includes(t)) : null,
      red: q.gold.red_flag ? (u.medical_red_flags.length > 0 && !a.products && !a.used_claim_ids.length) : null,
      refer: q.gold.referral ? (u.referrals.length > 0 || u.medical_red_flags.length > 0 || /طبيب|مختص|صيدلي/.test(a.text)) : null,
      insuf: q.gold.insufficient ? /لا تتوفر لدي معلومات موثوقة كافية/.test(a.text) : null },
    original: { ...sc({ intent: o.intent === 'ingredient' ? 'ingredient_question' : o.intent, product: o.asked_product_type, skin: o.ctx.skin, hair: o.ctx.hair }, q.gold),
      red: q.gold.red_flag ? oc.response.sections.some((s) => s.kind === 'safety_warnings') && !oc.response.sections.find((s) => s.kind === 'local_recommendations')?.items.length : null,
      refer: q.gold.referral ? /طبيب|مختص|صيدلي/.test(oText) : null, insuf: q.gold.insufficient ? /(لا تتوفر|لا أملك|غير كاف)/.test(oText) : null } });
}
const rate = (xs: (boolean | null)[]) => { const v = xs.filter((x) => x !== null) as boolean[]; return v.length ? `${Math.round(1000 * v.filter(Boolean).length / v.length) / 10}% (n=${v.length})` : '—'; };
const s: Record<string, Record<string, string>> = {};
for (const f of ['intent', 'product', 'skin', 'hair', 'ingredients', 'topic_hit', 'red', 'refer', 'insuf']) s[f] = { cp07: rate(rows.map((r) => (r.cp07 as unknown as Record<string, boolean | null>)[f] ?? null)), original: rate(rows.map((r) => (r.original as unknown as Record<string, boolean | null>)[f] ?? null)) };
writeFileSync('docs/cp07/blind2-raw.json', JSON.stringify({ summary: s, rows }, null, 1));
console.log(JSON.stringify(s, null, 1));
for (const r of rows) { const c = r.cp07 as Record<string, unknown>; const bad = Object.entries(c).filter(([k, v]) => v === false && k !== 'got').map(([k]) => k); if (bad.length) console.log('FAIL', r.id, r.text, bad, JSON.stringify(c.got)); }
