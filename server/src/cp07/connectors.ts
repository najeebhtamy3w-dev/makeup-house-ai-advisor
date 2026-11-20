/**
 * CP07 Phase 3 — scientific source connectors. Free, official APIs only:
 *   - MedlinePlus Web Service (wsearch.nlm.nih.gov/ws/query, NLM; documented limit 85 requests/minute/IP)
 *   - PubMed E-utilities (eutils.ncbi.nlm.nih.gov; documented limit 3 requests/second without an API key)
 * Not connected (see docs/CP07_SCIENTIFIC_SOURCE_AUDIT.md): AAD and DermNet (copyright / non-commercial terms: link + human
 * summary only), NHS (content API needs a registered subscription key), Google / AI Overviews (no licence; never a source).
 *
 * Every connector: OFF by default (knowledge_settings.external_search_enabled = '0'), offline-aware, rate-limited,
 * cached 30 days, retried with exponential backoff + jitter, guarded by a circuit breaker, timeout per call.
 * Queries are generic English concept terms derived from a knowledge GAP key — never staff text, customer data or shop
 * product data. Results are UNTRUSTED DATA: stored as discovered evidence for human review, never as instructions,
 * never as approved knowledge.
 */
import type { DB } from '../db.ts';

export interface RawEvidence { title: string; url: string; publisher: string; published_at: string | null; pub_types: string[]; snippet: string; affiliation: string }
export type FetchLike = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; text(): Promise<string>; headers?: { get(n: string): string | null } }>;
export interface Connector { id: string; label: string; min_interval_ms: number; daily_cap: number; search(q: string, f: FetchLike, signal: AbortSignal): Promise<RawEvidence[]> }

const strip = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
/** retrieved text is data: cap its size and drop anything shaped like an instruction to a model or a script */
export const sanitizeSnippet = (s: string) => strip(s).replace(/(ignore (all|previous|the above)[^.]*\.|system prompt[^.]*\.|you are now[^.]*\.|<\/?script)/gi, '[removed]').slice(0, 400);

export const medlinePlus: Connector = {
  id: 'medlineplus', label: 'MedlinePlus (NLM)', min_interval_ms: 1000, daily_cap: 300,
  async search(q, f, signal) {
    const r = await f(`https://wsearch.nlm.nih.gov/ws/query?db=healthTopics&term=${encodeURIComponent(q)}&retmax=5`, { signal });
    if (!r.ok) throw Object.assign(new Error(`http ${r.status}`), { status: r.status });
    const xml = await r.text(); const out: RawEvidence[] = [];
    for (const m of xml.matchAll(/<document[^>]*url="([^"]+)"[^>]*>([\s\S]*?)<\/document>/g)) {
      const body = m[2]!; const get = (n: string) => strip(body.match(new RegExp(`<content name="${n}">([\\s\\S]*?)</content>`))?.[1] ?? '');
      if (!/^https:\/\/medlineplus\.gov\//.test(m[1]!)) continue;
      out.push({ title: get('title'), url: m[1]!, publisher: 'U.S. National Library of Medicine (MedlinePlus)', published_at: null, pub_types: ['health topic'], snippet: sanitizeSnippet(get('FullSummary') || get('snippet')), affiliation: '' });
    }
    return out;
  },
};

export const pubMed: Connector = {
  id: 'pubmed', label: 'PubMed (NCBI E-utilities)', min_interval_ms: 400, daily_cap: 500,
  async search(q, f, signal) {
    const term = `${q} AND (review[pt] OR systematic review[pt] OR practice guideline[pt]) AND english[la]`;
    const s = await f(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&sort=relevance&retmax=5&tool=mh-advisor-cp07&term=${encodeURIComponent(term)}`, { signal });
    if (!s.ok) throw Object.assign(new Error(`http ${s.status}`), { status: s.status });
    const ids: string[] = JSON.parse(await s.text())?.esearchresult?.idlist ?? [];
    if (!ids.length) return [];
    await new Promise((r) => setTimeout(r, 350));   // stay under 3 requests / second
    const d = await f(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&tool=mh-advisor-cp07&id=${ids.join(',')}`, { signal });
    if (!d.ok) throw Object.assign(new Error(`http ${d.status}`), { status: d.status });
    const res = JSON.parse(await d.text())?.result ?? {};
    // metadata only (title, journal, year, publication types). Abstract text is copyrighted by publishers: not stored.
    return ids.filter((id) => res[id]).map((id) => ({ title: strip(res[id].title ?? ''), url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`, publisher: `PubMed — ${strip(res[id].source ?? '')}`, published_at: String(res[id].pubdate ?? '').slice(0, 4) || null, pub_types: res[id].pubtype ?? [], snippet: '', affiliation: '' }));
  },
};
export const CONNECTORS: Record<string, Connector> = { medlineplus: medlinePlus, pubmed: pubMed };

/* ---------------- guarded call: switch, offline, rate limit, daily cap, cache, retry, breaker ---------------- */
const BREAKER_FAILS = 5, BREAKER_OPEN_MS = 15 * 60_000, CACHE_DAYS = 30;
export type CallOutcome = { status: 'ok'; items: RawEvidence[]; cached: boolean } | { status: 'disabled' | 'offline' | 'breaker_open' | 'daily_cap' | 'failed'; items: []; error?: string };
export const externalSearchEnabled = (db: DB) => (db.prepare("SELECT value FROM knowledge_settings WHERE key = 'external_search_enabled'").get() as { value: string } | undefined)?.value === '1';
export const setExternalSearch = (db: DB, on: boolean) => db.prepare("INSERT OR REPLACE INTO knowledge_settings(key, value) VALUES ('external_search_enabled', ?)").run(on ? '1' : '0');

export async function guardedSearch(db: DB, c: Connector, q: string, env: { fetch: FetchLike; online: boolean; nowMs?: number; sleep?: (ms: number) => Promise<void>; timeoutMs?: number }): Promise<CallOutcome> {
  const nowMs = env.nowMs ?? Date.now(); const iso = new Date(nowMs).toISOString(); const day = iso.slice(0, 10);
  const sleep = env.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  if (!externalSearchEnabled(db)) return { status: 'disabled', items: [] };
  const key = `${c.id}:${q.toLowerCase()}`;
  const hit = db.prepare('SELECT body, fetched_at FROM knowledge_cache WHERE key = ?').get(key) as { body: string; fetched_at: string } | undefined;
  if (hit && nowMs - Date.parse(hit.fetched_at) < CACHE_DAYS * 86_400_000) return { status: 'ok', items: JSON.parse(hit.body), cached: true };
  if (!env.online) return { status: 'offline', items: [] };
  db.prepare('INSERT OR IGNORE INTO knowledge_connector_state(connector) VALUES (?)').run(c.id);
  const st = db.prepare('SELECT * FROM knowledge_connector_state WHERE connector = ?').get(c.id) as { failures: number; open_until: string | null; last_call_at: string | null; day: string; calls_today: number };
  if (st.open_until && Date.parse(st.open_until) > nowMs) return { status: 'breaker_open', items: [] };
  const calls = st.day === day ? st.calls_today : 0;
  if (calls >= c.daily_cap) return { status: 'daily_cap', items: [] };
  const wait = st.last_call_at ? c.min_interval_ms - (nowMs - Date.parse(st.last_call_at)) : 0;
  if (wait > 0) await sleep(wait);
  let lastErr = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    db.prepare('UPDATE knowledge_connector_state SET last_call_at = ?, day = ?, calls_today = ? WHERE connector = ?').run(new Date(env.nowMs ?? Date.now()).toISOString(), day, calls + attempt + 1, c.id);
    const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), env.timeoutMs ?? 8000);
    try {
      const items = await c.search(q, env.fetch, ac.signal);
      clearTimeout(timer);
      db.prepare('UPDATE knowledge_connector_state SET failures = 0, open_until = NULL WHERE connector = ?').run(c.id);
      db.prepare('INSERT OR REPLACE INTO knowledge_cache(key, body, fetched_at) VALUES (?,?,?)').run(key, JSON.stringify(items), iso);
      return { status: 'ok', items, cached: false };
    } catch (e) {
      clearTimeout(timer); lastErr = (e as Error).message;
      const status = (e as { status?: number }).status;
      if (status && status >= 400 && status < 500 && status !== 429) break;     // a client error will not improve with retries
      await sleep(Math.min(8000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250));
    }
  }
  const f = st.failures + 1;
  db.prepare('UPDATE knowledge_connector_state SET failures = ?, open_until = ? WHERE connector = ?').run(f, f >= BREAKER_FAILS ? new Date(nowMs + BREAKER_OPEN_MS).toISOString() : null, c.id);
  return { status: 'failed', items: [], error: lastErr };
}
