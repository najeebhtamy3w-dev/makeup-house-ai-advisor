import type { Config } from '../config.ts';
import { audit, now, type DB } from '../db.ts';
import { gtinValid, normalizeBarcode } from '../gtin.ts';
import { Unreachable, type Connector, type EnrichField } from './types.ts';
import { compareField } from './identity.ts';
import { openBeautyFacts } from './openbeautyfacts.ts';
import { mockConnector } from './mock.ts';

let connectors: Connector[] = [];
export const setConnectors = (c: Connector[]) => { connectors = c; };
export const getConnectors = () => connectors;
export function configureConnectors(cfg: Config) {
  if (cfg.enrich === 'mock') connectors = [mockConnector()];
  else if (cfg.enrich === 'obf') connectors = [openBeautyFacts({ contact: cfg.enrichContact, baseUrl: cfg.enrichBaseUrl })];
  else connectors = [];
}

/** Sliding-window limiter shared by interactive lookups and the queue (stay under source limits: OBF = 15/min). */
const hits: number[] = [];
export const resetLimiter = () => { hits.length = 0; };
function take(perMin: number, t = Date.now()): boolean {
  while (hits.length && t - hits[0]! > 60_000) hits.shift();
  if (hits.length >= perMin) return false;
  hits.push(t); return true;
}
const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[\s,.;:()\-_/]+/g, ' ').trim();
const CACHE_HOURS = 24;

export type Outcome = 'found' | 'not_found' | 'unreachable' | 'rate_limited' | 'error' | 'disabled';
export interface LookupResult { outcome: Outcome; barcode: string; conflict: boolean; candidates: Candidate[]; connectors: { id: string; name: string; outcome: Outcome; cached: boolean }[] }
export interface Candidate { id: number; field: EnrichField; value: string; source_name: string; source_url: string; license: string; is_mock: number; conflict_note: string; review_status: string; extracted_at: string }

export async function enrichBarcode(db: DB, cfg: Config, rawBarcode: string, userId: number | null, opts: { force?: boolean } = {}): Promise<LookupResult> {
  const barcode = normalizeBarcode(rawBarcode);
  if (!gtinValid(barcode)) throw new Error('invalid_barcode');
  if (!connectors.length) return { outcome: 'disabled', barcode, conflict: false, candidates: [], connectors: [] };
  const per: LookupResult['connectors'] = [];
  for (const c of connectors) {
    const prev = db.prepare('SELECT id, outcome, fetched_at FROM enrichment_runs WHERE barcode=? AND connector=? AND outcome IN (\'found\',\'not_found\') ORDER BY id DESC LIMIT 1').get(barcode, c.id) as { id: number; outcome: Outcome; fetched_at: string } | undefined;
    if (prev && !opts.force && Date.now() - Date.parse(prev.fetched_at) < CACHE_HOURS * 3.6e6) { per.push({ id: c.id, name: c.name, outcome: prev.outcome, cached: true }); continue; }
    if (!take(cfg.enrichRatePerMin)) { per.push({ id: c.id, name: c.name, outcome: 'rate_limited', cached: false }); continue; }
    const t = now();
    try {
      const r = await c.lookupBarcode(barcode);
      const run = db.prepare('INSERT INTO enrichment_runs(barcode,connector,outcome,requested_by,fetched_at) VALUES (?,?,?,?,?)').run(barcode, c.id, r.found ? 'found' : 'not_found', userId, t);
      if (r.found) {
        const ins = db.prepare('INSERT INTO enrichment_candidates(run_id,barcode,field,value,source_name,source_url,license,is_mock,extracted_at) VALUES (?,?,?,?,?,?,?,?,?)');
        for (const [k, v] of Object.entries(r.fields)) if (v) ins.run(Number(run.lastInsertRowid), barcode, k, v, c.name, r.sourceUrl, c.license, c.isMock ? 1 : 0, t);
      }
      per.push({ id: c.id, name: c.name, outcome: r.found ? 'found' : 'not_found', cached: false });
    } catch (e) {
      const unreachable = e instanceof Unreachable;
      db.prepare('INSERT INTO enrichment_runs(barcode,connector,outcome,detail,requested_by,fetched_at) VALUES (?,?,?,?,?,?)').run(barcode, c.id, unreachable ? 'unreachable' : 'error', unreachable ? e.message : 'internal', userId, t);
      per.push({ id: c.id, name: c.name, outcome: unreachable ? 'unreachable' : 'error', cached: false });
    }
  }
  markConflicts(db, barcode);
  const candidates = db.prepare("SELECT id,field,value,source_name,source_url,license,is_mock,conflict_note,review_status,extracted_at FROM enrichment_candidates WHERE barcode=? AND review_status='pending' ORDER BY id").all(barcode) as unknown as Candidate[];
  const any = (o: Outcome) => per.some((p) => p.outcome === o);
  const outcome: Outcome = any('found') ? 'found' : any('unreachable') ? 'unreachable' : any('rate_limited') ? 'rate_limited' : any('error') ? 'error' : 'not_found';
  if (userId) audit(db, userId, 'enrich_lookup', 'barcode', barcode, outcome);
  return { outcome, barcode, conflict: candidates.some((c) => c.conflict_note), candidates, connectors: per };
}

/** Flags pending candidates that disagree with the local product OR with another source for the same field. */
export function markConflicts(db: DB, barcode: string) {
  const local = db.prepare('SELECT name,brand,size,ingredients FROM products WHERE barcode=?').get(barcode) as Record<string, string> | undefined;
  const pend = db.prepare("SELECT id,field,value,source_name FROM enrichment_candidates WHERE barcode=? AND review_status='pending'").all(barcode) as { id: number; field: string; value: string; source_name: string }[];
  const upd = db.prepare('UPDATE enrichment_candidates SET conflict_note=? WHERE id=?');
  for (const c of pend) {
    const notes: string[] = [];
    const lv = local?.[c.field]; const cmp = lv ? compareField(c.field, lv, c.value) : null;
    if (cmp && cmp.match !== 'exact') notes.push(`${cmp.match === 'conflict' ? 'يختلف عن بيانات المحل' : 'تشابه جزئي مع بيانات المحل'}${cmp.note ? ': ' + cmp.note : ''}`);
    const other = pend.find((o) => o.id !== c.id && o.field === c.field && o.source_name !== c.source_name && norm(o.value) !== norm(c.value));
    if (other) notes.push(`يتعارض مع مصدر آخر (${other.source_name})`);
    upd.run(notes.join(' · '), c.id);
  }
}

/** Manager decision. Approval never auto-verifies: product becomes at most 'partial' and `verified` still needs the manager's explicit edit with a source. */
export function reviewCandidate(db: DB, id: number, managerId: number, action: 'approve' | 'reject', override?: string) {
  const c = db.prepare('SELECT * FROM enrichment_candidates WHERE id=?').get(id) as { id: number; barcode: string; field: EnrichField; value: string; source_name: string; source_url: string; is_mock: number; extracted_at: string; review_status: string } | undefined;
  if (!c) return { error: 'not_found' as const };
  if (c.review_status !== 'pending') return { error: 'already_reviewed' as const };
  const t = now();
  if (action === 'reject') { db.prepare("UPDATE enrichment_candidates SET review_status='rejected', reviewed_by=?, reviewed_at=? WHERE id=?").run(managerId, t, id); audit(db, managerId, 'enrich_reject', 'candidate', id); return { ok: true as const }; }
  if (c.field === 'image_url') return { error: 'images_not_supported' as const };
  const p = db.prepare('SELECT id, verification FROM products WHERE barcode=?').get(c.barcode) as { id: number; verification: string } | undefined;
  if (!p) return { error: 'no_product' as const };
  const value = (override ?? c.value).trim(); if (!value) return { error: 'empty' as const };
  const edited = override !== undefined && override.trim() !== c.value;
  db.exec('BEGIN');
  try {
    db.prepare(`UPDATE products SET ${c.field}=?, verification=CASE WHEN verification='verified' THEN 'review' ELSE 'partial' END, source_url=CASE WHEN source_url='' THEN ? ELSE source_url END, updated_at=? WHERE id=?`).run(value, c.is_mock ? '' : c.source_url, t, p.id);
    db.prepare("INSERT INTO product_facts(product_id,field,value,origin,source_name,source_url,extracted_at,verified_at,verified_by,review_status) VALUES (?,?,?,?,?,?,?,?,?, 'approved')").run(p.id, c.field, value, edited ? 'manual' : 'source', c.source_name, c.source_url, c.extracted_at, t, managerId);
    db.prepare("UPDATE enrichment_candidates SET review_status='approved', reviewed_by=?, reviewed_at=? WHERE id=?").run(managerId, t, id);
    // sibling candidates for the same field from other sources are now moot
    db.prepare("UPDATE enrichment_candidates SET review_status='rejected', reviewed_by=?, reviewed_at=?, conflict_note=conflict_note||' · استُبدل بقرار المدير' WHERE barcode=? AND field=? AND review_status='pending'").run(managerId, t, c.barcode, c.field);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  audit(db, managerId, 'enrich_approve', 'candidate', id, c.field);
  markConflicts(db, c.barcode);
  return { ok: true as const };
}

/* ---------- queue: batch with rate limit, backoff and retry; never fires thousands of requests at once ---------- */
export function enqueueBarcodes(db: DB, barcodes: string[]): number {
  const ins = db.prepare("INSERT OR IGNORE INTO enrichment_jobs(barcode,next_at,created_at) VALUES (?,?,?)"); let n = 0; const t = now();
  for (const b of barcodes) n += Number(ins.run(b, t, t).changes);
  return n;
}
export async function processQueueOnce(db: DB, cfg: Config, maxJobs = 5): Promise<{ processed: number; done: number; retried: number; failed: number; stopped: 'empty' | 'rate_limited' | 'batch' }> {
  const out = { processed: 0, done: 0, retried: 0, failed: 0, stopped: 'empty' as 'empty' | 'rate_limited' | 'batch' };
  if (!connectors.length) return out;
  const due = db.prepare("SELECT id, barcode, attempts FROM enrichment_jobs WHERE status='queued' AND next_at<=? ORDER BY id LIMIT ?").all(now(), maxJobs) as { id: number; barcode: string; attempts: number }[];
  for (const j of due) {
    const r = await enrichBarcode(db, cfg, j.barcode, null);
    if (r.outcome === 'rate_limited') { out.stopped = 'rate_limited'; return out; }
    out.processed++;
    if (r.outcome === 'found' || r.outcome === 'not_found') { db.prepare("UPDATE enrichment_jobs SET status='done', attempts=attempts+1 WHERE id=?").run(j.id); out.done++; }
    else if (j.attempts + 1 >= 5) { db.prepare("UPDATE enrichment_jobs SET status='failed', attempts=attempts+1, last_error=? WHERE id=?").run(r.outcome, j.id); out.failed++; }
    else { const delayMin = 2 ** (j.attempts + 1); db.prepare('UPDATE enrichment_jobs SET attempts=attempts+1, last_error=?, next_at=? WHERE id=?').run(r.outcome, new Date(Date.now() + delayMin * 60_000).toISOString(), j.id); out.retried++; }
  }
  if (due.length === maxJobs) out.stopped = 'batch';
  return out;
}
