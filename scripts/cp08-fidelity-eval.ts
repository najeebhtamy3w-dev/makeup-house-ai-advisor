/**
 * CP08 — measures the fidelity guard on REAL model output (hand-labelled Qwen3-4B sentences from CP07) and on all
 * five CP07 model runs. Run: node --no-warnings --import tsx scripts/cp08-fidelity-eval.ts
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { openDb } from '../server/src/db.ts';
import { seedKnowledge } from '../server/src/cp07/store.ts';
import { answerCp07, groundingCheck } from '../server/src/cp07/answer.ts';
import { fidelityCheck } from '../server/src/cp08/fidelity.ts';
import { FIDELITY_LABELS } from '../tests/fixtures/cp08-fidelity-labels.ts';
const db = openDb(':memory:'); seedKnowledge(db);
const claimsFor = (q: string) => answerCp07(db, q, undefined, { logGaps: false }).sections.flatMap((s) => s.items).filter((i) => i.claim_id).map((i) => ({ id: i.claim_id!, text: i.text, src: i.source_ids }));
const res = FIDELITY_LABELS.map((r) => {
  const cl = claimsFor(r.q);
  const fid = fidelityCheck(r.sentence, cl, { question: r.q });
  const old = groundingCheck(r.sentence, { claim_ids: cl.map((c) => c.id), claim_texts: cl.map((c) => c.text), source_ids: [...new Set(cl.flatMap((c) => c.src))], product_names: [] });
  const foreign = /[ㄱ-힝一-鿿]|[A-Za-z]{3,}(?![^[]*\])/.test(r.sentence.replace(/«[^»]*»|SPF|fragrance-free/g, ''));
  return { n: r.n, label: r.label, cp07_rejects: !old.ok, cp08_rejects: !fid.ok || foreign, problems: [...fid.problems.map((p) => p.problem), ...(foreign ? ['foreign script'] : [])] };
});
const d = res.filter((r) => r.label === 'drift'), f = res.filter((r) => r.label === 'faithful');
const summary = {
  labelled: res.length, drift: d.length, faithful: f.length,
  cp07_guard: { drift_caught: `${d.filter((r) => r.cp07_rejects).length}/${d.length}`, faithful_wrongly_rejected: `${f.filter((r) => r.cp07_rejects).length}/${f.length}` },
  cp08_guard: { drift_caught: `${d.filter((r) => r.cp08_rejects).length}/${d.length}`, faithful_wrongly_rejected: `${f.filter((r) => r.cp08_rejects).length}/${f.length}` },
};
// all five model runs: answers that passed CP07's guard — how many does CP08 reject?
const perModel: Record<string, string> = {};
for (const file of readdirSync('docs/cp07/models').filter((x) => x.endsWith('.json'))) {
  const j = JSON.parse(readFileSync(`docs/cp07/models/${file}`, 'utf8')); let passed = 0, rej = 0;
  for (const r of j.rephrase as { q: string; mode_used: string; model_text: string | null }[]) { if (r.mode_used !== 'LOCAL_MODEL' || !r.model_text) continue; passed++; if (!fidelityCheck(r.model_text, claimsFor(r.q), { question: r.q }).ok) rej++; }
  perModel[file.replace('.json', '')] = `${rej}/${passed} CP07-passing answers now rejected`;
}
writeFileSync('docs/cp08/fidelity-eval.json', JSON.stringify({ summary, perModel, rows: res }, null, 1));
console.log(JSON.stringify({ summary, perModel }, null, 1));
for (const r of res) if ((r.label === 'drift') !== r.cp08_rejects) console.log(r.label === 'drift' ? 'MISSED drift' : 'FALSE reject', r.n, r.problems.join(' | '));
