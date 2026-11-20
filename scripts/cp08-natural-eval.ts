/**
 * CP08 — scores the advisor on the NATURAL datasets (tests/fixtures/cp08-natural-eval.ts).
 *   node --no-warnings --import tsx scripts/cp08-natural-eval.ts <label> [--show-dev]
 * BLIND: aggregates only (no per-item output — keeps the blind set blind). DEV and CRITICAL: per-item failures printed.
 * Output: docs/cp08/eval-<label>.json (BLIND item results are stored but only read for the final report).
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { openDb } from '../server/src/db.ts';
import { seedKnowledge } from '../server/src/cp07/store.ts';
import { answerCp07 } from '../server/src/cp07/answer.ts';
import { AdvisorContext, type TAdvisorContext } from '../server/src/contracts.ts';
import { syntheticCatalogue } from './cp07-benchmark.ts';
import { BLIND, BLIND_CONVS, CRITICAL, DEV, DEV_CONVS, type NGold, type NItem, type NConv } from '../tests/fixtures/cp08-natural-eval.ts';

const label = process.argv[2] ?? 'run'; const showDev = process.argv.includes('--show-dev');
const db = openDb(':memory:'); seedKnowledge(db); const products = syntheticCatalogue(db);
const eq = (a: string[] = [], b: string[] = []) => a.length === b.length && a.every((x) => b.includes(x));
const INSUF = /لا تتوفر لدي معلومات موثوقة كافية/;

function score(text: string, ctx: TAdvisorContext, g: NGold, inConv: boolean) {
  const t0 = performance.now();
  const a = answerCp07(db, text, ctx, { products, logGaps: false });
  const ms = performance.now() - t0; const u = a.understanding;
  const pt = inConv ? (u.requested_product_type ?? u.conversation_context.product_type ?? null) : u.requested_product_type;
  const red = u.medical_red_flags.length > 0 && !a.products && a.used_claim_ids.length === 0;
  const r: Record<string, boolean | null> = {
    intent: g.intent ? g.intent.includes(u.intent) : null,
    product: g.product_type !== undefined ? pt === g.product_type : null,
    skin: g.skin ? eq(u.skin_type, g.skin) : null,
    hair: g.hair ? eq(u.hair_type, g.hair) : null,
    ingredients: g.ingredients ? g.ingredients.every((x) => u.ingredients.includes(x)) : null,
    constraints: g.constraints && g.constraints.length ? g.constraints.every((x) => u.constraints.includes(x)) : null,
    red_flag: g.red_flag ? red : null,
    referral: g.referral ? (u.referrals.length > 0 || u.medical_red_flags.length > 0) : null,
    insufficient: g.insufficient ? INSUF.test(a.text) : null,
  };
  // a red flag must never be raised on an ordinary question (false alarm), and never skipped on a critical one
  if (!g.red_flag && u.medical_red_flags.length) r.false_alarm = false;
  return { r, ms, got: { intent: u.intent, product: pt, skin: u.skin_type, hair: u.hair_type, ingredients: u.ingredients, constraints: u.constraints, red: u.medical_red_flags, referrals: u.referrals.length }, ctx: a.understanding.intent === 'reset' ? AdvisorContext.parse({}) : a.understanding.conversation_context };
}
const runItems = (items: NItem[]) => items.map((it) => ({ id: it.id, text: it.text, ...score(it.text, AdvisorContext.parse({}), it.gold, false) }));
const runConvs = (convs: NConv[]) => convs.flatMap((c) => { let ctx = AdvisorContext.parse({}); return c.turns.map((t) => { const s = score(t.text, ctx, t.gold, true); ctx = s.ctx; return { id: t.id, text: t.text, ...s }; }); });

type Row = { id: string; text: string; r: Record<string, boolean | null>; ms: number; got: unknown };
function agg(rows: Row[]) {
  const fields = ['intent', 'product', 'skin', 'hair', 'ingredients', 'constraints', 'red_flag', 'referral', 'insufficient', 'false_alarm'];
  const out: Record<string, string> = {};
  for (const f of fields) { const v = rows.map((x) => x.r[f]).filter((x) => x !== null && x !== undefined) as boolean[]; if (v.length) out[f] = `${Math.round(1000 * v.filter(Boolean).length / v.length) / 10}% (${v.filter(Boolean).length}/${v.length})`; }
  const all = rows.map((x) => Object.values(x.r).filter((v) => v !== null).every(Boolean));
  out.all_fields_correct = `${Math.round(1000 * all.filter(Boolean).length / all.length) / 10}% (${all.filter(Boolean).length}/${all.length})`;
  const ms = rows.map((x) => x.ms).sort((a, b) => a - b); out.latency_p50_ms = ms[Math.floor(ms.length / 2)]!.toFixed(2); out.latency_p95_ms = ms[Math.floor(ms.length * 0.95)]!.toFixed(2);
  return out;
}
const fails = (rows: Row[]) => rows.filter((x) => Object.values(x.r).some((v) => v === false)).map((x) => `${x.id} «${x.text}» ${Object.entries(x.r).filter(([, v]) => v === false).map(([k]) => k).join(',')} → ${JSON.stringify(x.got)}`);

const dev = [...runItems(DEV), ...runConvs(DEV_CONVS)];
const blind = [...runItems(BLIND), ...runConvs(BLIND_CONVS)];
const critical = runItems(CRITICAL);
const summary = { label, at: new Date().toISOString(), sizes: { dev: dev.length, blind: blind.length, critical: critical.length }, dev: agg(dev), blind: agg(blind), blind_single: agg(blind.filter((x) => !x.id.startsWith('bc'))), blind_multi_turn: agg(blind.filter((x) => x.id.startsWith('bc'))), critical: agg(critical) };
mkdirSync('docs/cp08', { recursive: true });
writeFileSync(`docs/cp08/eval-${label}.json`, JSON.stringify({ summary, dev, critical, blind }, null, 1));
console.log(JSON.stringify(summary, null, 1));
console.log('\nCRITICAL failures (release blockers):'); for (const f of fails(critical)) console.log('  ' + f);
if (showDev) { console.log('\nDEV failures:'); for (const f of fails(dev)) console.log('  ' + f); }
