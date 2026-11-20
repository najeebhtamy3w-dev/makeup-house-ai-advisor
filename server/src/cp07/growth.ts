/**
 * CP07 Phase 10 — controlled knowledge growth. "Learning" = growing the reviewed knowledge base, never retraining a model.
 *   gap logged (concept key only) → ingestion job (generic English query) → connector (if enabled + online)
 *   → evidence validated → stored as DISCOVERED evidence (knowledge_retrievals) → human writes a claim → pending_review
 *   → manager approves → retrievable. No step publishes automatically.
 */
import type { DB } from '../db.ts';
import { CONNECTORS, guardedSearch, type FetchLike, type RawEvidence } from './connectors.ts';
import { validateEvidence } from './validate.ts';
import { KnowledgeError } from './store.ts';

const now = () => new Date().toISOString();
const LABEL: Record<string, string> = { subject: 'موضوع غير مغطى', ingredient: 'مكوّن', combination: 'جمع مكونات', compare: 'مقارنة', product_type: 'نوع منتج', unrecognized: 'سؤال غير مفهوم' };
const ING_EN: Record<string, string> = { 'ceramide np': 'ceramides', 'sodium hyaluronate': 'hyaluronic acid', exfoliation: 'chemical exfoliation', retinol: 'retinoids' };
const TYPE_EN: Record<string, string> = { cleanser: 'facial cleanser', moisturizer: 'moisturizer', sunscreen: 'sunscreen', serum: 'facial serum', toner: 'facial toner', shampoo: 'shampoo', conditioner: 'hair conditioner', exfoliant: 'exfoliation', hair_oil: 'hair oil', mask: 'face mask' };

export function logGap(db: DB, key: string) {
  // only concept keys, never free text: ASCII concept ids, or a SHORT Arabic noun phrase for an unknown subject (≤ 4 words, letters only)
  if (!/^[a-z_]+:[a-z0-9 +|._-]+$/i.test(key) && !/^subject:[\p{Script=Arabic}a-z0-9 ]{2,40}$/u.test(key)) return;
  if (key.startsWith('subject:') && key.slice(8).trim().split(/\s+/).length > 4) return;
  const [kind, rest] = key.split(':') as [string, string];
  const label = `${LABEL[kind] ?? kind}: ${rest}`;
  db.prepare('INSERT INTO knowledge_gaps(gap_key,label_ar,hits,first_at,last_at) VALUES (?,?,1,?,?) ON CONFLICT(gap_key) DO UPDATE SET hits = hits + 1, last_at = excluded.last_at').run(key, label, now(), now());
}

/** generic English query from a gap key; null when the key carries no searchable concept */
export function queryForGap(key: string): string | null {
  const [kind, rest = ''] = key.split(':');
  const terms = rest.split(/[+|]/).filter((t) => t && t !== 'unrecognized').map((t) => ING_EN[t] ?? TYPE_EN[t] ?? t);
  if (!terms.length || kind === 'unrecognized') return null;
  if (kind === 'combination') return `${terms.join(' and ')} topical combination irritation`;
  if (kind === 'compare') return `${terms.join(' versus ')} skin care`;
  return `${terms.join(' ')} topical skin`;
}

export function enqueueGap(db: DB, gapId: number, connectors = ['medlineplus', 'pubmed']) {
  const g = db.prepare('SELECT * FROM knowledge_gaps WHERE id = ?').get(gapId) as { gap_key: string } | undefined;
  if (!g) throw new KnowledgeError('not_found', 'gap not found');
  const q = queryForGap(g.gap_key); if (!q) throw new KnowledgeError('no_query', 'this gap has no searchable concept');
  const t = now(); let n = 0;
  for (const c of connectors) n += Number(db.prepare('INSERT OR IGNORE INTO knowledge_ingestion_jobs(gap_id,connector,query,state,next_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(gapId, c, q, 'queued', t, t, t).changes);
  db.prepare("UPDATE knowledge_gaps SET status = 'searching' WHERE id = ?").run(gapId);
  return { queued: n, query: q };
}

/** Validate and store connector results as DISCOVERED evidence (pending review or rejected). Shared by growth jobs and CP08 research. */
export function storeEvidence(db: DB, connector: string, query: string, items: RawEvidence[], at: string, jobId: number | null, gapId: number | null): number {
  let stored = 0;
  const ins = db.prepare(`INSERT OR IGNORE INTO knowledge_retrievals(source,query_key,title,url,snippet,language,retrieved_at,review_state,publisher,pub_types,published_at,license_status,evidence_level,validation,evidence_state,job_id,gap_id)
    VALUES (?,?,?,?,?,'en',?,'unreviewed',?,?,?,?,?,?,?,?,?)`);
  for (const e of items) {
    const v = validateEvidence({ title: e.title, url: e.url, publisher: e.publisher, published_at: e.published_at, pub_types: e.pub_types, snippet: e.snippet, affiliation: e.affiliation });
    stored += Number(ins.run(connector, query, e.title, e.url, e.snippet, at, e.publisher, e.pub_types.join('; '), e.published_at, connector === 'pubmed' ? 'metadata_only' : 'link_and_summary_only', v.evidence_level, JSON.stringify(v), v.verdict === 'blocked' ? 'rejected' : 'pending_review', jobId, gapId).changes);
  }
  return stored;
}

/** Process ONE due job. Never throws for connector problems: the job records why it is waiting. */
export async function runIngestionOnce(db: DB, env: { fetch: FetchLike; online: boolean; nowMs?: number; sleep?: (ms: number) => Promise<void> }) {
  const t = new Date(env.nowMs ?? Date.now()).toISOString();
  const job = db.prepare("SELECT * FROM knowledge_ingestion_jobs WHERE state IN ('queued','blocked_offline','blocked_disabled') AND next_at <= ? ORDER BY id LIMIT 1").get(t) as { id: number; gap_id: number; connector: string; query: string; attempts: number } | undefined;
  if (!job) return null;
  const c = CONNECTORS[job.connector]; if (!c) { db.prepare("UPDATE knowledge_ingestion_jobs SET state='failed', error='unknown connector', updated_at=? WHERE id=?").run(t, job.id); return { id: job.id, state: 'failed' }; }
  const r = await guardedSearch(db, c, job.query, env);
  const later = (min: number) => new Date((env.nowMs ?? Date.now()) + min * 60_000).toISOString();
  if (r.status !== 'ok') {
    const state = r.status === 'disabled' ? 'blocked_disabled' : r.status === 'offline' ? 'blocked_offline' : job.attempts >= 4 ? 'failed' : 'queued';
    db.prepare('UPDATE knowledge_ingestion_jobs SET state=?, attempts=attempts+1, error=?, next_at=?, updated_at=? WHERE id=?').run(state, r.status + (('error' in r && r.error) ? `: ${r.error}` : ''), later(r.status === 'disabled' ? 60 : 5 * 2 ** Math.min(job.attempts, 5)), t, job.id);
    return { id: job.id, state, reason: r.status };
  }
  const stored = storeEvidence(db, job.connector, job.query, r.items, t, job.id, job.gap_id);
  db.prepare("UPDATE knowledge_ingestion_jobs SET state='done', attempts=attempts+1, found=?, error='', updated_at=? WHERE id=?").run(stored, t, job.id);
  db.prepare("UPDATE knowledge_gaps SET status='evidence_pending' WHERE id = ? AND status = 'searching'").run(job.gap_id);
  return { id: job.id, state: 'done', found: stored };
}

/**
 * A reviewer turns ONE discovered evidence item into a claim (pending_review). The Arabic text is written by the person;
 * the system never extracts claim text automatically from retrieved content. Source metadata is copied with provenance.
 */
export function claimFromEvidence(db: DB, evidenceId: number, actor: { id: number; role: string }, input: { topic_id: string; kind: string; subject: string; stance: string; text_ar: string; limitations?: string }) {
  if (actor.role !== 'manager') throw new KnowledgeError('forbidden', 'manager only');
  const e = db.prepare('SELECT * FROM knowledge_retrievals WHERE id = ?').get(evidenceId) as { id: number; title: string; url: string; publisher: string; published_at: string | null; evidence_level: string; license_status: string; evidence_state: string; source: string } | undefined;
  if (!e) throw new KnowledgeError('not_found', 'evidence not found');
  if (e.evidence_state !== 'pending_review') throw new KnowledgeError('bad_state', 'only evidence that passed validation can become a claim');
  if (input.text_ar.trim().length < 15) throw new KnowledgeError('text_required', 'write the claim in Arabic');
  if (!db.prepare('SELECT 1 FROM knowledge_topics WHERE id = ?').get(input.topic_id)) throw new KnowledgeError('bad_topic', 'unknown topic');
  const t = now(); const srcId = `ev-${e.source}-${e.id}`; const id = `ev${e.id}-${Date.now().toString(36)}`;
  db.exec('BEGIN');
  try {
    db.prepare(`INSERT OR IGNORE INTO knowledge_sources(id,title,url,publisher,source_type,evidence_level,license_status,industry_affiliation,language,published_at,accessed_at,origin,created_at) VALUES (?,?,?,?,?,?,?,'', 'en',?,?,'connector',?)`)
      .run(srcId, e.title, e.url, e.publisher, e.source === 'pubmed' ? 'peer_reviewed_review' : 'health_agency', e.evidence_level, e.license_status, e.published_at, t.slice(0, 10), t);
    const sid = (db.prepare('SELECT id FROM knowledge_sources WHERE url = ?').get(e.url) as { id: string }).id;
    db.prepare(`INSERT INTO knowledge_claims(id,topic_id,kind,subject,stance,text_ar,structured_en,limitations,warnings,evidence_level,state,review_level,origin,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,'',?,'pending_review','none','connector',1,?,?)`)
      .run(id, input.topic_id, input.kind, input.subject, input.stance, input.text_ar.trim(), e.title, input.limitations ?? '', e.evidence_level, t, t);
    db.prepare('INSERT INTO knowledge_claim_sources(claim_id,source_id,locator) VALUES (?,?,?)').run(id, sid, 'evidence #' + e.id);
    db.prepare("UPDATE knowledge_retrievals SET evidence_state = 'extracted' WHERE id = ?").run(e.id);
    db.prepare('INSERT INTO knowledge_review_history(claim_id,action,from_state,to_state,actor_id,actor_role,reason,snapshot,at) VALUES (?,?,?,?,?,?,?,?,?)').run(id, 'created_from_evidence', null, 'pending_review', actor.id, actor.role, `evidence #${e.id}`, '', t);
    db.exec('COMMIT');
  } catch (err) { db.exec('ROLLBACK'); throw err; }
  return id;
}

export function dashboard(db: DB) {
  const all = <T>(sql: string, ...a: (string | number)[]) => db.prepare(sql).all(...a) as T[];
  return {
    topics: all<{ id: string; domain: string; title_ar: string; claims: number; usable: number }>(`SELECT t.id, t.domain, t.title_ar, COUNT(c.id) claims, SUM(CASE WHEN c.state IN ('approved','published') OR (c.state='pending_review' AND c.origin='curated_seed') THEN 1 ELSE 0 END) usable FROM knowledge_topics t LEFT JOIN knowledge_claims c ON c.topic_id = t.id GROUP BY t.id ORDER BY t.domain, t.id`),
    gaps: all('SELECT * FROM knowledge_gaps ORDER BY hits DESC, last_at DESC LIMIT 50'),
    pending_claims: all("SELECT id, topic_id, kind, text_ar, origin, review_level FROM knowledge_claims WHERE state = 'pending_review' ORDER BY origin DESC, id LIMIT 200"),
    evidence: all("SELECT id, source, title, url, publisher, published_at, evidence_level, evidence_state, validation FROM knowledge_retrievals WHERE evidence_state IN ('pending_review','rejected','discovered') ORDER BY id DESC LIMIT 100"),
    sources: all('SELECT id, title, url, publisher, source_type, evidence_level, license_status, industry_affiliation FROM knowledge_sources ORDER BY source_type, id'),
    outdated: all("SELECT k.id, k.text_ar, s.published_at FROM knowledge_claims k JOIN knowledge_claim_sources cs ON cs.claim_id = k.id JOIN knowledge_sources s ON s.id = cs.source_id WHERE s.published_at IS NOT NULL AND CAST(substr(s.published_at,1,4) AS INTEGER) <= CAST(strftime('%Y','now') AS INTEGER) - 15 AND k.state NOT IN ('rejected','superseded')"),
    jobs: all('SELECT id, gap_id, connector, query, state, attempts, found, error, updated_at FROM knowledge_ingestion_jobs ORDER BY id DESC LIMIT 50'),
  };
}
