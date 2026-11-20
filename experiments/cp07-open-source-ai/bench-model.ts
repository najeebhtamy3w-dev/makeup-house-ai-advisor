/**
 * Benchmarks ONE local model (run each model in its own process for clean memory numbers):
 *   node --no-warnings --import tsx experiments/cp07-open-source-ai/bench-model.ts <path.gguf> [--no-think]
 * Task A — understanding as JSON (grammar-constrained) on 48 held-out benchmark questions, scored like the rules engine.
 * Task B — grounded Arabic rephrasing on 12 questions; every output passes the CP07 grounding check or falls back.
 * Measures: load time, RSS after load, peak RSS, tokens/s, latency per call. Dev machine CPU only — NOT a phone.
 */
import { writeFileSync, mkdirSync, statSync } from 'node:fs';
import { cpus } from 'node:os';
import { openDb } from '../../server/src/db.ts';
import { seedKnowledge } from '../../server/src/cp07/store.ts';
import { understandCp07 } from '../../server/src/cp07/nlu.ts';
import { ALL_QUESTIONS, type Q } from '../../tests/fixtures/cp07-benchmark.ts';
import { syntheticCatalogue } from '../../scripts/cp07-benchmark.ts';
import { LlamaCppEngine, hybridAnswer } from './engine.ts';

const modelPath = process.argv[2]!; const noThink = process.argv.includes('--no-think');
const name = modelPath.split('/').pop()!.replace(/\.gguf$/, '');
const rss = () => Math.round(process.memoryUsage().rss / 1e6);
let peak = rss(); const sampler = setInterval(() => { peak = Math.max(peak, rss()); }, 200);

const SCHEMA = { type: 'object', properties: {
  intent: { enum: ['product_guidance', 'explain', 'routine', 'ingredient_question', 'combination', 'compare', 'greeting', 'unclear', 'out_of_scope'] },
  product_type: { enum: ['cleanser', 'moisturizer', 'sunscreen', 'serum', 'toner', 'shampoo', 'conditioner', 'hair_oil', 'mask', 'exfoliant', 'none'] },
  skin_type: { type: 'array', items: { enum: ['dry', 'oily', 'combination', 'sensitive', 'normal'] } },
  hair_type: { type: 'array', items: { enum: ['dry', 'oily', 'colored', 'curly', 'damaged'] } },
  ingredients: { type: 'array', items: { enum: ['glycerin', 'urea', 'petrolatum', 'ceramide np', 'sodium hyaluronate', 'niacinamide', 'salicylic acid', 'retinol', 'adapalene', 'benzoyl peroxide', 'dimethicone', 'panthenol', 'exfoliation', 'other'] } },
  medical_red_flag: { type: 'boolean' },
}, required: ['intent', 'product_type', 'skin_type', 'hair_type', 'ingredients', 'medical_red_flag'] };
const NLU_SYS = 'Classify a beauty-shop staff question written in Arabic (often Yemeni dialect). Return JSON only. ' +
  'intent: product_guidance = asks for a product type; explain = asks why/how about a skin or hair condition; routine; ingredient_question = asks about one ingredient; combination = using two ingredients together; compare; greeting; unclear; out_of_scope = prices/sales. ' +
  'product_type: the product FORM requested, or none. skin_type / hair_type: only what is stated. medical_red_flag: true for swelling, breathing difficulty, pus, bleeding, burns/blisters, fever with rash, a changing mole.';

// stratified held-out sample: 10 skin, 10 hair, 10 ingredient, 10 yemeni, 8 medical (red flags)
const pickCat = (c: Q['cat'], n: number, step: number) => ALL_QUESTIONS.filter((q) => q.cat === c).filter((_, i) => i % step === 0).slice(0, n);
const SAMPLE = [...pickCat('skin', 10, 10), ...pickCat('hair', 10, 10), ...pickCat('ingredient', 10, 10), ...pickCat('yemeni', 10, 5), ...pickCat('medical', 8, 2).filter((q) => q.gold.red_flag || q.gold.referral)];
const REPHRASE = ['بشرتي جافه وحساسه وأشتي غسول', 'معي بشرة دهنية وأشتي واقي شمس', 'أقدر أستخدم الريتينول مع المقشر؟', 'ايش فايدة اليوريا', 'شعري دهني وأريد شامبو', 'عندي قشرة في الرأس', 'هل النياسيناميد يناسب البشرة الدهنية؟', 'بشرتي مختلطة وأبحث عن مرطب', 'ما فائدة الجليسرين للبشرة؟', 'شعري جاف ومصبوغ', 'عندي حبوب في الوجه ليش تطلع؟', 'كيف أحمي بشرتي من الشمس'];

const eq = (a: string[] = [], b: string[] = []) => a.length === b.length && a.every((x) => b.includes(x));
const t0 = performance.now(); const engine = new LlamaCppEngine(modelPath, 4096, cpus().length, noThink); await engine.initialize();
const loadMs = Math.round(performance.now() - t0); const rssLoaded = rss();
const nlu: Record<string, unknown>[] = []; let tok = 0, genMs = 0;
for (const q of SAMPLE) {
  let out: any = null, err = '', ms = 0;
  try { const r = await engine.generate(NLU_SYS, q.text, { jsonSchema: SCHEMA, maxTokens: 120, temperature: 0, timeoutMs: 90_000 }); ms = r.ms; tok += r.tokens; genMs += r.ms; out = JSON.parse(r.text); } catch (e) { err = (e as Error).message; }
  const rules = understandCp07(q.text);
  const g = q.gold; const pt = out?.product_type === 'none' ? null : out?.product_type ?? null;
  const ings = (out?.ingredients ?? []).filter((x: string) => x !== 'other');
  nlu.push({ id: q.id, cat: q.cat, text: q.text, ms: Math.round(ms), err, out,
    model: { intent: g.intent ? g.intent.includes(out?.intent) : null, product: g.product_type !== undefined ? pt === g.product_type : null, skin: g.skin ? eq(out?.skin_type, g.skin) : null, hair: g.hair ? eq(out?.hair_type, g.hair) : null, ingredients: g.ingredients ? g.ingredients.every((x) => ings.includes(x)) : null, red: g.red_flag ? out?.medical_red_flag === true : (g.referral ? null : out ? out.medical_red_flag === false : null) },
    rules: { intent: g.intent ? g.intent.includes(rules.intent) : null, product: g.product_type !== undefined ? rules.requested_product_type === g.product_type : null, skin: g.skin ? eq(rules.skin_type, g.skin) : null, hair: g.hair ? eq(rules.hair_type, g.hair) : null, ingredients: g.ingredients ? g.ingredients.every((x) => rules.ingredients.includes(x)) : null, red: g.red_flag ? rules.medical_red_flags.length > 0 : (g.referral ? null : rules.medical_red_flags.length === 0) } });
}
const db = openDb(':memory:'); seedKnowledge(db); const products = syntheticCatalogue(db);
const reph: Record<string, unknown>[] = [];
for (const q of REPHRASE) { const r = await hybridAnswer(db, q, 'LOCAL_MODEL', engine, { products }, undefined, 120_000); tok += 0; reph.push({ q, mode_used: r.mode_used, ms: Math.round(r.model_ms ?? 0), fallback: r.fallback_reason ?? null, problems: r.grounding?.problems ?? [], model_text: r.model_text ?? null }); }
await engine.dispose(); clearInterval(sampler);
const rate = (k: string, who: 'model' | 'rules') => { const v = nlu.map((x) => (x[who] as Record<string, boolean | null>)[k]).filter((x) => x !== null && x !== undefined) as boolean[]; return v.length ? { pct: Math.round(1000 * v.filter(Boolean).length / v.length) / 10, n: v.length } : null; };
const msList = nlu.map((x) => x.ms as number).sort((a, b) => a - b); const rMs = reph.map((x) => x.ms as number).filter(Boolean).sort((a, b) => a - b);
const summary = {
  model: name, file_bytes: statSync(modelPath).size, threads: cpus().length, cpu: cpus()[0]?.model, load_ms: loadMs, rss_after_load_mb: rssLoaded, peak_rss_mb: peak,
  nlu: { n: nlu.length, json_failures: nlu.filter((x) => x.err).length, p50_ms: msList[Math.floor(msList.length / 2)], p95_ms: msList[Math.floor(msList.length * 0.95)],
    model: Object.fromEntries(['intent', 'product', 'skin', 'hair', 'ingredients', 'red'].map((k) => [k, rate(k, 'model')])), rules: Object.fromEntries(['intent', 'product', 'skin', 'hair', 'ingredients', 'red'].map((k) => [k, rate(k, 'rules')])) },
  rephrase: { n: reph.length, grounded_pass: reph.filter((x) => x.mode_used === 'LOCAL_MODEL').length, fallbacks: reph.filter((x) => x.mode_used !== 'LOCAL_MODEL').length, p50_ms: rMs[Math.floor(rMs.length / 2)] ?? null, p95_ms: rMs[Math.floor(rMs.length * 0.95)] ?? null,
    problems: Object.entries(reph.flatMap((x) => (x.problems as string[]).map((p) => p.replace(/ [^ ]+$/, ''))).reduce((o, p) => ({ ...o, [p]: (o[p] ?? 0) + 1 }), {} as Record<string, number>)) },
  nlu_tokens_per_s: genMs ? Math.round(10 * tok / (genMs / 1000)) / 10 : null,
};
mkdirSync('docs/cp07/models', { recursive: true });
writeFileSync(`docs/cp07/models/${name}.json`, JSON.stringify({ summary, nlu, rephrase: reph }, null, 1));
console.log(JSON.stringify(summary, null, 1));
