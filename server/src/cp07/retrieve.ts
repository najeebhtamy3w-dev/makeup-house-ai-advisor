/**
 * CP07 Phase 7 — local knowledge retrieval. Offline, free, traceable:
 *   1. structured routing: understood concepts → knowledge topics (and ingredient topics, combination relationships);
 *   2. lexical ranking: BM25 over Arabic-normalised, light-stemmed claim text + topic titles + ingredient names;
 *      SQLite FTS5 is used when the SQLite build has it (Node), otherwise the same BM25 in JS (Android SQLite-WASM is not
 *      guaranteed to ship FTS5) — both read ONLY usable claims;
 *   3. filter: only claims allowed by store.USABLE_SQL, every hit carries its claim id and source ids.
 * No embeddings and no vector DB: Phase 7 measurement (docs/CP07_REGRESSION_RESULTS.md) showed routing + BM25 is enough
 * for a corpus of ~80 claims; a vector index would add a model dependency without a measured gain.
 */
import type { DB } from '../db.ts';
import { normAr } from '../advisor2/understand.ts';
import { tokens } from './validate.ts';
import { USABLE_SQL, type ClaimRow } from './store.ts';
import type { Cp07Understanding } from './nlu.ts';

export interface Hit { claim: ClaimRow; score: number; why: string[]; source_ids: string[] }
const SYN: Record<string, string> = { ناشف: 'جاف', نشفان: 'جاف', يلمع: 'دهني', لامع: 'دهني', زيتي: 'دهني', يحك: 'حكه', حكحكه: 'حكه', يطيح: 'تساقط', يتساقط: 'تساقط', مقشر: 'تقشير', سكراب: 'تقشير', حبوب: 'حبوب', بثور: 'حبوب', واقي: 'شمس', بلوك: 'شمس', منظف: 'غسول' };
const expand = (t: Set<string>) => { const o = new Set(t); for (const w of t) if (SYN[w]) o.add(SYN[w]!); return o; };

const CONCERN_TOPIC: Record<string, string[]> = { acne: ['acne'], dryness: ['dry_skin'], sensitivity: ['sensitive_skin'], pigmentation: ['pigmentation'], dandruff: ['dandruff'], itch: ['dandruff'], hair_loss: ['hair_loss'], sun: ['sun'] };
const SKIN_TOPIC: Record<string, string> = { dry: 'dry_skin', sensitive: 'sensitive_skin', oily: 'oily_skin', combination: 'combination_skin' };
const PRODUCT_TOPIC: Record<string, string[]> = { moisturizer: ['moisturizer_basics'], sunscreen: ['sun'], exfoliant: ['exfoliation'], shampoo: [], conditioner: ['dry_damaged_hair'] };

export function routeTopics(db: DB, u: Cp07Understanding): { topics: string[]; subjects: string[] } {
  const t: string[] = []; const add = (x?: string) => { if (x && !t.includes(x)) t.push(x); };
  const hairCtx = u.conversation_context.domain === 'hair' || u.conversation_context.domain === 'scalp';
  for (const i of u.ingredients) { const r = db.prepare('SELECT topic_id FROM ingredient_knowledge WHERE inci = ?').get(i) as { topic_id: string } | undefined; add(r?.topic_id ?? (i === 'exfoliation' ? 'exfoliation' : undefined)); }
  for (const c of u.concerns) { if (c === 'oil') add(hairCtx ? 'oily_hair' : 'oily_skin'); else if (c === 'dryness' && hairCtx) add('dry_damaged_hair'); else for (const x of CONCERN_TOPIC[c] ?? []) add(x); }
  if (!hairCtx) for (const s of u.skin_type) add(SKIN_TOPIC[s]);
  for (const h of u.hair_type) add(h === 'oily' ? 'oily_hair' : 'dry_damaged_hair');
  for (const x of PRODUCT_TOPIC[u.requested_product_type ?? ''] ?? []) add(x);
  if (u.intent === 'routine') add('routine');
  const subjects: string[] = [];
  if (u.intent === 'combination' && u.ingredients.length >= 2) {
    const ids = u.ingredients.map((i) => i === 'retinol' ? 'retinoids' : i);
    for (let a = 0; a < ids.length; a++) for (let b = 0; b < ids.length; b++) if (a !== b) subjects.push(`${ids[a]}+${ids[b]}`);
  }
  return { topics: t, subjects };
}

/* ---------------- BM25 (JS) ---------------- */
interface Doc { id: string; tf: Map<string, number>; len: number }
type Ix = { key: string; docs: Doc[]; df: Map<string, number>; avg: number; byId: Map<string, ClaimRow> };
const caches = new WeakMap<DB, Ix>();
function docText(db: DB, c: ClaimRow) {
  const topic = db.prepare('SELECT title_ar, title_en FROM knowledge_topics WHERE id = ?').get(c.topic_id) as { title_ar: string; title_en: string } | undefined;
  const ing = db.prepare('SELECT inci, names_ar, synonyms FROM ingredient_knowledge WHERE topic_id = ?').all(c.topic_id) as { inci: string; names_ar: string; synonyms: string }[];
  return [c.text_ar, c.structured_en, topic?.title_ar ?? '', topic?.title_en ?? '', ...ing.flatMap((i) => [i.inci, ...JSON.parse(i.names_ar), ...JSON.parse(i.synonyms)])].join(' ');
}
function index(db: DB) {
  const key = String((db.prepare(`SELECT COUNT(*) || ':' || COALESCE(MAX(updated_at),'') k FROM knowledge_claims WHERE ${USABLE_SQL}`).get() as { k: string }).k);
  const hit = caches.get(db); if (hit?.key === key) return hit;
  const claims = db.prepare(`SELECT * FROM knowledge_claims WHERE ${USABLE_SQL}`).all() as unknown as ClaimRow[];
  const docs: Doc[] = []; const df = new Map<string, number>();
  for (const c of claims) { const toks = [...tokens(docText(db, c))]; const tf = new Map<string, number>(); for (const w of toks) tf.set(w, (tf.get(w) ?? 0) + 1); for (const w of tf.keys()) df.set(w, (df.get(w) ?? 0) + 1); docs.push({ id: c.id, tf, len: toks.length }); }
  const ix: Ix = { key, docs, df, avg: docs.reduce((s, d) => s + d.len, 0) / Math.max(1, docs.length), byId: new Map(claims.map((c) => [c.id, c])) };
  caches.set(db, ix); return ix;
}
export function bm25(db: DB, query: string, k1 = 1.2, b = 0.75): Map<string, number> {
  const ix = index(db); const q = expand(tokens(query)); const N = ix.docs.length; const out = new Map<string, number>();
  for (const d of ix.docs) { let s = 0; for (const w of q) { const f = d.tf.get(w); if (!f) continue; const n = ix.df.get(w)!; const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5)); s += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d.len / ix.avg)); } if (s > 0) out.set(d.id, s); }
  return out;
}

/* ---------------- FTS5 (when the SQLite build has it) ---------------- */
let ftsOk: boolean | null = null;
export function ftsAvailable(db: DB): boolean {
  if (ftsOk !== null) return ftsOk;
  try { db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS temp.cp07_fts_probe USING fts5(x)"); db.exec('DROP TABLE temp.cp07_fts_probe'); ftsOk = true; } catch { ftsOk = false; }
  return ftsOk;
}
/** Rebuilds the FTS index from usable claims (temp table: never persisted, never part of a backup). */
export function ftsSearch(db: DB, query: string): Map<string, number> {
  const out = new Map<string, number>(); if (!ftsAvailable(db)) return out;
  db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS temp.cp07_fts USING fts5(claim_id UNINDEXED, body, tokenize='unicode61 remove_diacritics 2')");
  const ix = index(db);
  const have = (db.prepare('SELECT COUNT(*) n FROM temp.cp07_fts').get() as { n: number }).n;
  if (have !== ix.docs.length) { db.exec('DELETE FROM temp.cp07_fts'); const ins = db.prepare('INSERT INTO temp.cp07_fts(claim_id, body) VALUES (?, ?)'); for (const d of ix.docs) ins.run(d.id, [...d.tf.keys()].join(' ')); }
  const terms = [...expand(tokens(query))].map((w) => `"${w.replace(/"/g, '')}"`); if (!terms.length) return out;
  for (const r of db.prepare(`SELECT claim_id, bm25(cp07_fts) s FROM temp.cp07_fts WHERE cp07_fts MATCH ? ORDER BY s LIMIT 40`).all(terms.join(' OR ')) as { claim_id: string; s: number }[]) out.set(r.claim_id, -r.s);
  return out;
}

const LEVEL_W: Record<string, number> = { guideline: 0.3, systematic_review: 0.28, clinical_study: 0.22, narrative_review: 0.18, expert_patient_education: 0.2, regulatory: 0.12, manufacturer_claim: 0, unknown: 0.05 };
/** Ranked, usable, traceable hits. `useFts` only switches the lexical scorer; routing and filtering are identical. */
export function retrieve(db: DB, text: string, u: Cp07Understanding, opts: { limit?: number; useFts?: boolean } = {}): Hit[] {
  const ix = index(db); const { topics, subjects } = routeTopics(db, u);
  // a named ingredient is the most specific thing in a question: its own topic outranks the skin-type topic
  const ingTopics = new Set(u.ingredients.map((i) => (db.prepare('SELECT topic_id FROM ingredient_knowledge WHERE inci = ?').get(i) as { topic_id: string } | undefined)?.topic_id).filter(Boolean) as string[]);
  const lex = opts.useFts && ftsAvailable(db) ? ftsSearch(db, normAr(text)) : bm25(db, normAr(text));
  const maxLex = Math.max(1e-9, ...lex.values());
  const hits: Hit[] = [];
  for (const c of ix.byId.values()) {
    const why: string[] = []; let s = 0;
    const ti = topics.indexOf(c.topic_id);
    if (ti >= 0) { s += 2 - Math.min(ti, 4) * 0.15 + (ingTopics.has(c.topic_id) ? 0.6 : 0); why.push(`topic:${c.topic_id}`); }
    if (c.subject && subjects.includes(c.subject)) { s += 2.5; why.push(`combination:${c.subject}`); }
    const l = lex.get(c.id); if (l) { s += l / maxLex; why.push('lexical'); }
    if (!why.length) continue;
    if (topics.length && ti < 0 && !why.includes(`combination:${c.subject}`) && (l ?? 0) / maxLex < 0.75) continue;   // weak off-topic lexical noise
    s += LEVEL_W[c.evidence_level] ?? 0;
    hits.push({ claim: c, score: Math.round(s * 1000) / 1000, why, source_ids: [] });
  }
  hits.sort((a, b) => b.score - a.score);
  const top = hits.slice(0, opts.limit ?? 12);
  const src = db.prepare('SELECT source_id FROM knowledge_claim_sources WHERE claim_id = ? ORDER BY source_id');
  for (const h of top) h.source_ids = (src.all(h.claim.id) as { source_id: string }[]).map((r) => r.source_id);
  return top;
}
export const resetRetrievalCache = (db: DB) => { caches.delete(db); };
