/**
 * CP07 — knowledge store: seeding (idempotent), the claim state machine, human review and version history.
 * Nothing here is ever called automatically to approve or publish: every transition to approved/published needs a
 * named person, and `review_level` records honestly WHO reviewed (administrative ≠ qualified scientific review).
 */
import type { DB } from '../db.ts';
import { SEED_CLAIMS, SEED_INGREDIENTS, SEED_RELATIONSHIPS, SEED_SOURCES, SEED_TOPICS } from './seed.ts';

const now = () => new Date().toISOString();
export type ClaimState = 'discovered' | 'extracted' | 'pending_review' | 'approved' | 'published' | 'rejected' | 'superseded' | 'needs_update';
export const TRANSITIONS: Record<ClaimState, ClaimState[]> = {
  discovered: ['extracted', 'rejected'],
  extracted: ['pending_review', 'rejected'],
  pending_review: ['approved', 'rejected', 'needs_update'],
  approved: ['published', 'needs_update', 'rejected'],
  published: ['needs_update', 'superseded'],
  needs_update: ['pending_review', 'rejected', 'superseded'],
  rejected: [],
  superseded: [],
};

export interface ClaimRow { id: string; topic_id: string; kind: string; subject: string; stance: string; text_ar: string; structured_en: string; limitations: string; warnings: string; evidence_level: string; state: ClaimState; review_level: 'none' | 'administrative' | 'qualified_scientific'; origin: string; version: number; supersedes: string | null; sci_reviewer: string | null }
export interface SourceRow { id: string; title: string; url: string; publisher: string; source_type: string; evidence_level: string; license_status: string; industry_affiliation: string; accessed_at: string; published_at: string | null }

/** Idempotent: re-running never overwrites a row a person has reviewed or edited (INSERT OR IGNORE only). */
export function seedKnowledge(db: DB): { sources: number; topics: number; claims: number; ingredients: number } {
  const t = now(); let sources = 0, topics = 0, claims = 0, ingredients = 0;
  db.exec('BEGIN');
  try {
    const sIns = db.prepare(`INSERT OR IGNORE INTO knowledge_sources(id,title,url,publisher,source_type,evidence_level,license_status,industry_affiliation,language,published_at,accessed_at,origin,created_at) VALUES (?,?,?,?,?,?,?,?,'en',?,?,'curated_seed',?)`);
    for (const s of SEED_SOURCES) sources += Number(sIns.run(s.id, s.title, s.url, s.publisher, s.source_type, s.evidence_level, s.license_status, s.industry_affiliation ?? '', s.published_at ?? null, s.accessed_at, t).changes);
    const tIns = db.prepare('INSERT OR IGNORE INTO knowledge_topics(id,domain,title_ar,title_en) VALUES (?,?,?,?)');
    for (const x of SEED_TOPICS) topics += Number(tIns.run(x.id, x.domain, x.title_ar, x.title_en).changes);
    const lvl = new Map(SEED_SOURCES.map((s) => [s.id, s.evidence_level]));
    const cIns = db.prepare(`INSERT OR IGNORE INTO knowledge_claims(id,topic_id,kind,subject,stance,text_ar,structured_en,limitations,warnings,evidence_level,state,review_level,origin,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,'',?,'pending_review','none','curated_seed',1,?,?)`);
    const csIns = db.prepare('INSERT OR IGNORE INTO knowledge_claim_sources(claim_id,source_id) VALUES (?,?)');
    for (const c of SEED_CLAIMS) {
      const ch = Number(cIns.run(c.id, c.topic_id, c.kind, c.subject, c.stance, c.text_ar, c.structured_en, c.limitations, strongest(c.sources.map((s) => lvl.get(s) ?? 'unknown')), t, t).changes);
      claims += ch; for (const s of c.sources) csIns.run(c.id, s);
      if (ch) history(db, c.id, 'seeded', null, 'pending_review', null, 'system', 'curated seed (not reviewed)');
    }
    const iIns = db.prepare('INSERT OR IGNORE INTO ingredient_knowledge(inci,names_ar,synonyms,functions,concentration_note,irritation_potential,topic_id) VALUES (?,?,?,?,?,?,?)');
    for (const i of SEED_INGREDIENTS) ingredients += Number(iIns.run(i.inci, JSON.stringify(i.names_ar), JSON.stringify(i.synonyms), JSON.stringify(i.functions), i.concentration_note, i.irritation_potential, i.topic_id).changes);
    const rIns = db.prepare('INSERT OR IGNORE INTO knowledge_relationships(from_id,rel,to_id) VALUES (?,?,?)');
    for (const [a, r, b] of SEED_RELATIONSHIPS) rIns.run(a, r, b);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return { sources, topics, claims, ingredients };
}

const ORDER = ['guideline', 'systematic_review', 'clinical_study', 'narrative_review', 'expert_patient_education', 'regulatory', 'manufacturer_claim', 'unknown'];
export const strongest = (levels: string[]) => levels.sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b))[0] ?? 'unknown';

function history(db: DB, claimId: string, action: string, from: string | null, to: string | null, actor: number | null, role: string, reason: string, snapshot = '') {
  db.prepare('INSERT INTO knowledge_review_history(claim_id,action,from_state,to_state,actor_id,actor_role,reason,snapshot,at) VALUES (?,?,?,?,?,?,?,?,?)').run(claimId, action, from, to, actor, role, reason, snapshot, now());
}

export const getClaim = (db: DB, id: string) => db.prepare('SELECT * FROM knowledge_claims WHERE id = ?').get(id) as ClaimRow | undefined;
export const claimSources = (db: DB, id: string) => db.prepare('SELECT s.* FROM knowledge_claim_sources cs JOIN knowledge_sources s ON s.id = cs.source_id WHERE cs.claim_id = ? ORDER BY s.id').all(id) as unknown as SourceRow[];
export const claimHistory = (db: DB, id: string) => db.prepare('SELECT * FROM knowledge_review_history WHERE claim_id = ? ORDER BY id').all(id);

export class KnowledgeError extends Error { constructor(public code: string, msg: string) { super(msg); } }

/** One guarded transition. Approve requires ≥1 source with a URL; reasons are mandatory for reject / needs_update. */
export function transition(db: DB, id: string, to: ClaimState, actor: { id: number; role: string }, reason = ''): ClaimRow {
  const c = getClaim(db, id); if (!c) throw new KnowledgeError('not_found', 'claim not found');
  if (!TRANSITIONS[c.state].includes(to)) throw new KnowledgeError('bad_transition', `${c.state} → ${to} is not allowed`);
  if ((to === 'approved' || to === 'published') && actor.role !== 'manager') throw new KnowledgeError('forbidden', 'only a manager can approve or publish knowledge');
  if ((to === 'rejected' || to === 'needs_update') && !reason.trim()) throw new KnowledgeError('reason_required', 'a reason is required');
  if (to === 'approved' && !claimSources(db, id).length) throw new KnowledgeError('no_source', 'a claim without a source cannot be approved');
  const t = now();
  const extra = to === 'approved' ? ", review_level = CASE WHEN review_level = 'qualified_scientific' THEN review_level ELSE 'administrative' END, admin_approved_by = ?, admin_approved_at = ?" : '';
  const args: (string | number | null)[] = [to, t]; if (extra) args.push(actor.id, t); args.push(id);
  db.prepare(`UPDATE knowledge_claims SET state = ?, updated_at = ?${extra} WHERE id = ?`).run(...args);
  history(db, id, `state:${to}`, c.state, to, actor.id, actor.role, reason, c.text_ar);
  return getClaim(db, id)!;
}

/** Records a qualified scientific review. The app cannot verify credentials: the manager attests the reviewer's identity
 *  and qualification, both mandatory and both logged. Without this call nothing is ever shown as scientifically reviewed. */
export function recordScientificReview(db: DB, id: string, actor: { id: number; role: string }, reviewer: string, qualification: string, note = ''): ClaimRow {
  if (actor.role !== 'manager') throw new KnowledgeError('forbidden', 'only a manager can record a review');
  if (reviewer.trim().length < 3 || qualification.trim().length < 3) throw new KnowledgeError('reviewer_required', 'reviewer name and qualification are required');
  const c = getClaim(db, id); if (!c) throw new KnowledgeError('not_found', 'claim not found');
  if (!['pending_review', 'approved', 'published'].includes(c.state)) throw new KnowledgeError('bad_state', 'claim is not reviewable');
  db.prepare("UPDATE knowledge_claims SET review_level = 'qualified_scientific', sci_reviewer = ?, sci_reviewer_qualification = ?, sci_reviewed_at = ?, updated_at = ? WHERE id = ?").run(reviewer.trim(), qualification.trim(), now(), now(), id);
  history(db, id, 'scientific_review', c.state, c.state, actor.id, actor.role, `${reviewer} (${qualification}) ${note}`.trim(), c.text_ar);
  return getClaim(db, id)!;
}

/** Editing text never overwrites: a new version is created in pending_review and the old one is superseded on approval of the new. */
export function reviseClaim(db: DB, id: string, actor: { id: number; role: string }, text_ar: string, reason: string): ClaimRow {
  const c = getClaim(db, id); if (!c) throw new KnowledgeError('not_found', 'claim not found');
  if (!reason.trim() || text_ar.trim().length < 10) throw new KnowledgeError('reason_required', 'new text and a reason are required');
  if (['rejected', 'superseded'].includes(c.state)) throw new KnowledgeError('bad_state', 'cannot revise a closed claim');
  const nid = `${c.id.replace(/@v\d+$/, '')}@v${c.version + 1}`, t = now();
  db.exec('BEGIN');
  try {
    db.prepare(`INSERT INTO knowledge_claims(id,topic_id,kind,subject,stance,text_ar,structured_en,limitations,warnings,evidence_level,state,review_level,origin,version,supersedes,created_at,updated_at)
      SELECT ?,topic_id,kind,subject,stance,?,structured_en,limitations,warnings,evidence_level,'pending_review','none','manual',version+1,id,?,? FROM knowledge_claims WHERE id = ?`).run(nid, text_ar.trim(), t, t, id);
    db.prepare('INSERT INTO knowledge_claim_sources(claim_id,source_id,locator) SELECT ?,source_id,locator FROM knowledge_claim_sources WHERE claim_id = ?').run(nid, id);
    history(db, nid, 'revision_created', null, 'pending_review', actor.id, actor.role, reason, '');
    if (c.state === 'published' || c.state === 'approved') { /* old stays usable until the new one is approved */ } else {
      db.prepare("UPDATE knowledge_claims SET state = 'superseded', updated_at = ? WHERE id = ?").run(t, id);
      history(db, id, 'state:superseded', c.state, 'superseded', actor.id, actor.role, `replaced by ${nid}`, c.text_ar);
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return getClaim(db, nid)!;
}

/** When a revision is approved, its predecessor is superseded (history kept). */
export function approveRevision(db: DB, id: string, actor: { id: number; role: string }) {
  const c = transition(db, id, 'approved', actor);
  if (c.supersedes) { const old = getClaim(db, c.supersedes); if (old && !['superseded', 'rejected'].includes(old.state)) { db.prepare("UPDATE knowledge_claims SET state = 'superseded', updated_at = ? WHERE id = ?").run(now(), old.id); history(db, old.id, 'state:superseded', old.state, 'superseded', actor.id, actor.role, `replaced by ${id}`, old.text_ar); } }
  return c;
}

/**
 * Which claims may appear in an answer, and how they must be labelled:
 *  - approved / published                           → usable; label per review_level
 *  - pending_review AND origin = curated_seed       → usable ONLY with the «not reviewed» label (CP06.2 behaviour)
 *  - anything discovered by a connector, rejected, superseded, needs_update → never used
 */
export const USABLE_SQL = "(state IN ('approved','published') OR (state = 'pending_review' AND origin = 'curated_seed'))";
export function usableClaims(db: DB): ClaimRow[] { return db.prepare(`SELECT * FROM knowledge_claims WHERE ${USABLE_SQL}`).all() as unknown as ClaimRow[]; }
export function trustLabel(c: Pick<ClaimRow, 'state' | 'review_level'>): { level: 'scientific' | 'administrative' | 'unreviewed'; label_ar: string } {
  if (c.review_level === 'qualified_scientific' && (c.state === 'approved' || c.state === 'published')) return { level: 'scientific', label_ar: 'راجعه مختص مؤهل' };
  if (c.state === 'approved' || c.state === 'published') return { level: 'administrative', label_ar: 'معتمد إداريًا — لم يراجعه مختص مؤهل بعد' };
  return { level: 'unreviewed', label_ar: 'مرجع منظم لم يراجعه مختص مؤهل بعد' };
}

export function knowledgeStats(db: DB) {
  const q = (sql: string) => (db.prepare(sql).all() as { k: string; n: number }[]).reduce((o, r) => ({ ...o, [r.k]: r.n }), {} as Record<string, number>);
  return {
    claims_by_state: q('SELECT state k, COUNT(*) n FROM knowledge_claims GROUP BY state'),
    claims_by_review: q('SELECT review_level k, COUNT(*) n FROM knowledge_claims GROUP BY review_level'),
    sources_by_type: q('SELECT source_type k, COUNT(*) n FROM knowledge_sources GROUP BY source_type'),
    topics: (db.prepare('SELECT COUNT(*) n FROM knowledge_topics').get() as { n: number }).n,
    ingredients: (db.prepare('SELECT COUNT(*) n FROM ingredient_knowledge').get() as { n: number }).n,
    industry_affiliated_sources: (db.prepare("SELECT COUNT(*) n FROM knowledge_sources WHERE industry_affiliation <> ''").get() as { n: number }).n,
  };
}
