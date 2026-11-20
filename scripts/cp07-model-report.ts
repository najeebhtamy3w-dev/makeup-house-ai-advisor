/**
 * Aggregates docs/cp07/models/*.json into one markdown table (docs/cp07/model-table.md).
 * "copy ratio" = share of the model's Arabic words that already appear verbatim in the grounded claims it received:
 * a high value means the model mostly COPIED (safe but adds nothing); a low value with a passed grounding check means
 * it actually rephrased. Run: node --no-warnings --import tsx scripts/cp07-model-report.ts
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { openDb } from '../server/src/db.ts';
import { seedKnowledge } from '../server/src/cp07/store.ts';
import { answerCp07 } from '../server/src/cp07/answer.ts';

const db = openDb(':memory:'); seedKnowledge(db);
const words = (s: string) => (s.match(/[؀-ۿ]{3,}/g) ?? []);
const rows: string[] = [];
const pct = (x: { pct: number } | null) => (x ? `${x.pct}%` : '—');
for (const f of readdirSync('docs/cp07/models').filter((x) => x.endsWith('.json')).sort()) {
  const d = JSON.parse(readFileSync(`docs/cp07/models/${f}`, 'utf8')); const s = d.summary;
  const copy: number[] = [];
  for (const r of d.rephrase as { q: string; model_text: string | null; mode_used: string }[]) {
    if (!r.model_text || r.mode_used !== 'LOCAL_MODEL') continue;
    const src = new Set(answerCp07(db, r.q, undefined, { logGaps: false }).sections.flatMap((x) => x.items).filter((i) => i.claim_id).flatMap((i) => words(i.text)));
    const w = words(r.model_text); if (w.length) copy.push(w.filter((x) => src.has(x)).length / w.length);
  }
  const copyRatio = copy.length ? `${Math.round(100 * copy.reduce((a, b) => a + b, 0) / copy.length)}%` : '—';
  rows.push(`| ${s.model} | ${(s.file_bytes / 1e9).toFixed(2)} GB | ${s.load_ms} | ${s.rss_after_load_mb} / ${s.peak_rss_mb} | ${s.nlu_tokens_per_s ?? '—'} | ${s.nlu.p50_ms} / ${s.nlu.p95_ms} | ${s.nlu.json_failures}/${s.nlu.n} | ${pct(s.nlu.model.intent)} | ${pct(s.nlu.model.product)} | ${pct(s.nlu.model.skin)} | ${pct(s.nlu.model.hair)} | ${pct(s.nlu.model.ingredients)} | ${pct(s.nlu.model.red)} | ${s.rephrase.grounded_pass}/${s.rephrase.n} | ${copyRatio} | ${s.rephrase.p50_ms ?? '—'} |`);
  if (!rows.some((r) => r.startsWith('| RULES'))) rows.unshift(`| RULES (CP07 LOCAL_RULES) | 0 | 0 | — | — | <2 | 0/${s.nlu.n} | ${pct(s.nlu.rules.intent)} | ${pct(s.nlu.rules.product)} | ${pct(s.nlu.rules.skin)} | ${pct(s.nlu.rules.hair)} | ${pct(s.nlu.rules.ingredients)} | ${pct(s.nlu.rules.red)} | n/a | n/a | <2 |`);
}
const head = '| Engine | Weights | Load ms | RSS after load / peak MB | ≈tok/s | NLU p50 / p95 ms | JSON fail | Intent | Product | Skin | Hair | Ingredients | Red-flag | Rephrase grounded | Copy ratio | Rephrase p50 ms |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|';
writeFileSync('docs/cp07/model-table.md', `${head}\n${rows.join('\n')}\n`);
console.log(`${head}\n${rows.join('\n')}`);
