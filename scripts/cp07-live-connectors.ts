/**
 * CP07 — one live check of the free official connectors (MedlinePlus, PubMed) with GENERIC concept queries from gap keys.
 * No staff text, no customer data, no shop product data. In-memory DB; results printed for the report.
 * Run: node --no-warnings --import tsx scripts/cp07-live-connectors.ts
 */
import { openDb } from '../server/src/db.ts';
import { seedKnowledge } from '../server/src/cp07/store.ts';
import { setExternalSearch } from '../server/src/cp07/connectors.ts';
import { logGap, enqueueGap, runIngestionOnce } from '../server/src/cp07/growth.ts';
const db = openDb(':memory:'); seedKnowledge(db); setExternalSearch(db, true);
for (const k of ['ingredient:azelaic acid', 'subject:collagen']) logGap(db, k);
const gaps = db.prepare('SELECT id, gap_key FROM knowledge_gaps').all() as { id: number; gap_key: string }[];
for (const g of gaps) { try { console.log(g.gap_key, enqueueGap(db, g.id)); } catch (e) { console.log(g.gap_key, 'not queued:', (e as Error).message); } }
const f = (u: string, i?: { signal?: AbortSignal }) => fetch(u, { signal: i?.signal, headers: { 'user-agent': 'mh-advisor-cp07/1.0 (knowledge review tool)' } });
for (let i = 0; i < 6; i++) { const r = await runIngestionOnce(db, { fetch: f as never, online: true }); if (!r) break; console.log('job', r); }
for (const e of db.prepare('SELECT source, title, url, published_at, evidence_level, evidence_state, license_status FROM knowledge_retrievals').all() as Record<string, string>[]) console.log(`${e.source} | ${e.evidence_state} | ${e.evidence_level} | ${e.license_status} | ${e.published_at ?? '-'} | ${e.title.slice(0, 90)} | ${e.url}`);
console.log('connector state', db.prepare('SELECT connector, failures, calls_today FROM knowledge_connector_state').all());
