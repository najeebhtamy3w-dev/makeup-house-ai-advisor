/**
 * CP06.2 Phase 5 — resumable enrichment queue (v2). Persistent in SQLite, keyed by product + provider + query
 * (a product without a barcode can be enriched by name). Four independent state machines:
 *   job_state  : queued → leased → done | waiting_retry | waiting_network | dead | cancelled
 *   match      : not_attempted → exact_gtin | strong | ambiguous | none | source_unavailable
 *   review     : none → pending → accepted | partially_accepted | rejected   (people, see evidence routes)
 *   product    : products.verification (unchanged)
 * Pause/resume is a SWITCH (queue_control), not a job or product state.
 * Guarantees: a provider result is written ONLY as evidence (never into products); evidence is idempotent (fingerprint);
 * every job runs in its own small transaction; a crash leaves a lease that simply expires and is picked up again.
 */
import type { DB } from './db.ts';
import { decideMatch } from './matching.ts';
import { callProvider, type ProductProvider } from './providers.ts';
import { normalizeText } from './matching.ts';

export const LEASE_MS = 2 * 60_000;
export const MAX_ATTEMPTS = 5;
export const CACHE_DAYS = 30;
const iso = (ms: number) => new Date(ms).toISOString();

export type JobState = 'queued' | 'leased' | 'waiting_retry' | 'waiting_network' | 'done' | 'dead' | 'cancelled';
/** Allowed job transitions (anything else is a programming error and is refused). */
export const JOB_TRANSITIONS: Record<JobState, JobState[]> = {
  queued: ['leased', 'cancelled'], leased: ['done', 'waiting_retry', 'waiting_network', 'dead', 'cancelled', 'queued'],
  waiting_retry: ['leased', 'cancelled'], waiting_network: ['leased', 'cancelled'], done: [], dead: ['queued'], cancelled: ['queued'],
};
export function canTransition(from: JobState, to: JobState) { return JOB_TRANSITIONS[from].includes(to); }

export const queryKeyFor = (p: { barcode: string | null; name: string; name_en?: string; brand: string }) =>
  p.barcode ? `gtin:${p.barcode}` : `name:${normalizeText([p.brand, p.name_en || p.name].filter(Boolean).join(' ')).slice(0, 120)}`;

export function enqueue(db: DB, productId: number, provider: string, queryKey: string, opts: { priority?: number; batchId?: number | null; nowMs?: number } = {}): boolean {
  const t = iso(opts.nowMs ?? Date.now());
  const r = db.prepare(`INSERT OR IGNORE INTO enrichment_jobs_v2(product_id, provider, query_key, priority, next_at, batch_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`)
    .run(productId, provider, queryKey, opts.priority ?? 0, t, opts.batchId ?? null, t, t);
  return Number(r.changes) > 0;
}

export function setPaused(db: DB, scope: string, paused: boolean, userId: number | null) {
  db.prepare('INSERT INTO queue_control(scope, paused, updated_by, updated_at) VALUES (?,?,?,?) ON CONFLICT(scope) DO UPDATE SET paused=excluded.paused, updated_by=excluded.updated_by, updated_at=excluded.updated_at').run(scope, paused ? 1 : 0, userId, iso(Date.now()));
}
const pausedScopes = (db: DB) => new Set((db.prepare('SELECT scope FROM queue_control WHERE paused = 1').all() as { scope: string }[]).map((r) => r.scope));

export function cancel(db: DB, where: { batchId?: number; productId?: number }): number {
  const cond = where.batchId != null ? 'batch_id = ?' : 'product_id = ?';
  return Number(db.prepare(`UPDATE enrichment_jobs_v2 SET job_state='cancelled', lease_until=NULL, updated_at=? WHERE ${cond} AND job_state IN ('queued','waiting_retry','waiting_network','leased')`).run(iso(Date.now()), where.batchId ?? where.productId!).changes);
}

interface JobRow { id: number; product_id: number; provider: string; query_key: string; job_state: JobState; attempts: number; priority: number; batch_id: number | null }
/** Pick the next due job (priority first) and lease it. Expired leases (a crashed worker) are due again. */
export function leaseNext(db: DB, providers: string[], nowMs = Date.now()): JobRow | null {
  const paused = pausedScopes(db); if (paused.has('all')) return null;
  const allowed = providers.filter((p) => !paused.has(`provider:${p}`)); if (!allowed.length) return null;
  const now = iso(nowMs);
  db.exec('BEGIN IMMEDIATE');
  try {
    const rows = db.prepare(`SELECT id, product_id, provider, query_key, job_state, attempts, priority, batch_id FROM enrichment_jobs_v2
      WHERE provider IN (${allowed.map(() => '?').join(',')}) AND (
        (job_state IN ('queued','waiting_retry','waiting_network') AND next_at <= ?) OR (job_state = 'leased' AND lease_until < ?))
      ORDER BY priority DESC, next_at, id LIMIT 20`).all(...allowed, now, now) as unknown as JobRow[];
    const job = rows.find((r) => r.batch_id == null || !paused.has(`batch:${r.batch_id}`)) ?? null;
    if (job) db.prepare("UPDATE enrichment_jobs_v2 SET job_state='leased', lease_until=?, updated_at=? WHERE id=?").run(iso(nowMs + LEASE_MS), now, job.id);
    db.exec('COMMIT'); return job;
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

/** in-memory per-provider minute window (a restart forgets it: the daily budget below is the durable guard) */
const windows = new Map<string, number[]>();
export const resetRateWindows = () => windows.clear();
function underMinuteLimit(p: ProductProvider, nowMs: number) {
  if (!p.limits.perMinute) return true;
  const w = (windows.get(p.id) ?? []).filter((t) => nowMs - t < 60_000); windows.set(p.id, w);
  if (w.length >= p.limits.perMinute) return false; w.push(nowMs); return true;
}
/** durable daily budget: requests actually sent today = provider_cache rows fetched today (every real call is cached, misses too) */
function underDailyBudget(db: DB, p: ProductProvider, budget: number | null, nowMs: number) {
  const cap = Math.min(budget ?? Infinity, p.limits.perDay ?? Infinity); if (!Number.isFinite(cap)) return true;
  const day = iso(nowMs).slice(0, 10);
  return (db.prepare('SELECT COUNT(*) n FROM provider_cache WHERE provider = ? AND fetched_at >= ?').get(p.id, day) as { n: number }).n < cap;
}

const FIELDS = ['name', 'brand', 'size', 'ingredients', 'image_url', 'manufacturer', 'variant'] as const;
/** evidence fingerprint: two independent 32-bit hashes + length (pure JS, so it runs unchanged in the Android worker
 *  without touching its crypto shim). Includes product id, field and provider, so collisions are practically irrelevant. */
export function fp(...parts: (string | number)[]) {
  const s = parts.join('|'); let a = 0x811c9dc5, b = 5381;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = Math.imul(a ^ c, 0x01000193) >>> 0; b = (Math.imul(b, 33) + c) >>> 0; }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0') + s.length.toString(16);
}

export interface ProcessOpts { nowMs?: number; dailyBudget?: Record<string, number>; online?: boolean; timeoutMs?: number; random?: () => number }
export type ProcessOutcome = { job: number | null; result: 'idle' | 'paused_or_empty' | 'done' | 'retry' | 'dead' | 'deferred_rate' | 'deferred_budget' | 'waiting_network' | 'product_gone' };

/** Process ONE job. Never throws for provider problems; never writes into products. */
export async function processOne(db: DB, providers: ProductProvider[], o: ProcessOpts = {}): Promise<ProcessOutcome> {
  const nowMs = o.nowMs ?? Date.now(); const rnd = o.random ?? Math.random;
  const byId = new Map(providers.map((p) => [p.id, p]));
  const job = leaseNext(db, [...byId.keys()], nowMs); if (!job) return { job: null, result: 'paused_or_empty' };
  const p = byId.get(job.provider)!;
  const set = (state: JobState, extra: Record<string, unknown> = {}) => {
    const cols = Object.keys(extra).map((k) => `, ${k}=?`).join('');
    db.prepare(`UPDATE enrichment_jobs_v2 SET job_state=?, lease_until=NULL, updated_at=?${cols} WHERE id=? AND job_state='leased'`).run(state, iso(nowMs), ...(Object.values(extra) as never[]), job.id);
  };
  const product = db.prepare('SELECT id, barcode, name, name_en, brand, size, variant FROM products WHERE id = ?').get(job.product_id) as { id: number; barcode: string | null; name: string; name_en: string; brand: string; size: string; variant: string } | undefined;
  if (!product) { set('cancelled'); return { job: job.id, result: 'product_gone' }; }
  if (o.online === false) { set('waiting_network', { next_at: iso(nowMs + 60_000) }); return { job: job.id, result: 'waiting_network' }; }

  // cache first: the same question is never asked twice within CACHE_DAYS (misses are cached too)
  const cached = db.prepare('SELECT outcome, payload FROM provider_cache WHERE provider = ? AND query_key = ? AND expires_at > ?').get(p.id, job.query_key, iso(nowMs)) as { outcome: string; payload: string } | undefined;
  let outcome: string, candidates: { gtin?: string; name: string; brand: string; size: string; variant: string; manufacturer: string; ingredients: string; image_url?: string; source_url?: string; license: string; license_status: 'known' | 'unknown' | 'restricted' }[] = [], retryAfter: number | undefined;
  if (cached) { outcome = cached.outcome; candidates = cached.payload ? JSON.parse(cached.payload) : []; }
  else {
    if (!underDailyBudget(db, p, o.dailyBudget?.[p.id] ?? null, nowMs)) { set('waiting_retry', { next_at: iso(Date.parse(iso(nowMs).slice(0, 10)) + 86_400_000) }); return { job: job.id, result: 'deferred_budget' }; }
    if (!underMinuteLimit(p, nowMs)) { set('waiting_retry', { next_at: iso(nowMs + 60_000) }); return { job: job.id, result: 'deferred_rate' }; }
    const q = job.query_key.startsWith('gtin:') ? { gtin: job.query_key.slice(5) } : { name: product.name_en || product.name, brand: product.brand || undefined };
    const r = await callProvider(p, q, o.timeoutMs ?? 8000);
    outcome = r.outcome; candidates = r.candidates; retryAfter = r.retry_after_s;
    if (outcome === 'found' || outcome === 'not_found')
      db.prepare('INSERT INTO provider_cache(provider, query_key, outcome, payload, fetched_at, expires_at) VALUES (?,?,?,?,?,?) ON CONFLICT(provider, query_key) DO UPDATE SET outcome=excluded.outcome, payload=excluded.payload, fetched_at=excluded.fetched_at, expires_at=excluded.expires_at')
        .run(p.id, job.query_key, outcome, JSON.stringify(candidates), iso(nowMs), iso(nowMs + CACHE_DAYS * 86_400_000));
  }

  if (outcome === 'rate_limited') { set('waiting_retry', { next_at: iso(nowMs + (retryAfter ?? 60) * 1000) }); return { job: job.id, result: 'deferred_rate' }; }   // Retry-After: not an attempt
  if (outcome === 'unreachable' || outcome === 'error') {
    const attempts = job.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) { set('dead', { attempts, match_outcome: 'source_unavailable', last_error: outcome }); return { job: job.id, result: 'dead' }; }
    const delay = Math.min(6 * 3600_000, 60_000 * 2 ** attempts) * (0.8 + 0.4 * rnd());   // exponential backoff with ±20 % jitter
    set('waiting_retry', { attempts, next_at: iso(nowMs + delay), last_error: outcome }); return { job: job.id, result: 'retry' };
  }

  // found / not_found: decide identity, write evidence (idempotent), all in ONE small transaction
  const store = { name: product.name_en || product.name, brand: product.brand, size: product.size, variant: product.variant, codes: product.barcode ? [product.barcode] : [] };
  const order = { exact_gtin: 0, strong: 1, ambiguous: 2, none: 3, source_unavailable: 4 } as const;
  const ranked = candidates.map((c) => ({ c, d: decideMatch(store, { name: c.name, brand: c.brand, size: c.size, variant: c.variant, codes: c.gtin ? [c.gtin] : [] }) })).sort((a, b) => order[a.d.class] - order[b.d.class]);
  const best = ranked[0];
  db.exec('BEGIN');
  try {
    let wrote = 0;
    if (best && best.d.class !== 'none') {
      const ins = db.prepare(`INSERT OR IGNORE INTO evidence(product_id, field, value, provider, source_url, retrieved_at, match_basis, confidence, license_status, license, fingerprint, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
      for (const f of FIELDS) {
        const v = String((best.c as Record<string, unknown>)[f] ?? '').trim(); if (!v) continue;
        wrote += Number(ins.run(product.id, f, v.slice(0, 20000), p.id, best.c.source_url ?? '', iso(nowMs), best.d.class, best.d.confidence, best.c.license_status, best.c.license, fp(product.id, f, p.id, v), iso(nowMs)).changes);
      }
    }
    // review state comes from the evidence actually waiting (a replayed job writes nothing new but must not hide pending proposals)
    const waiting = wrote || (db.prepare("SELECT COUNT(*) n FROM evidence WHERE product_id = ? AND provider = ? AND review_state = 'pending'").get(product.id, p.id) as { n: number }).n;
    set('done', { match_outcome: best ? best.d.class : 'none', review_state: waiting ? 'pending' : 'none' });
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return { job: job.id, result: 'done' };
}

export function queueStatus(db: DB) {
  const by = (col: string) => Object.fromEntries((db.prepare(`SELECT ${col} k, COUNT(*) n FROM enrichment_jobs_v2 GROUP BY ${col}`).all() as { k: string; n: number }[]).map((r) => [r.k, r.n]));
  const batches = db.prepare(`SELECT batch_id, COUNT(*) total, SUM(job_state IN ('done','dead','cancelled')) finished FROM enrichment_jobs_v2 WHERE batch_id IS NOT NULL GROUP BY batch_id ORDER BY batch_id DESC LIMIT 20`).all();
  return { job_state: by('job_state'), match_outcome: by('match_outcome'), review_state: by('review_state'), paused: [...pausedScopes(db)], batches,
    pending_evidence: (db.prepare("SELECT COUNT(DISTINCT product_id) n FROM evidence WHERE review_state = 'pending'").get() as { n: number }).n };
}
