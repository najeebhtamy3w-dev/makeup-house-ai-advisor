/**
 * CP07 HTTP routes — OFF unless MH_CP07=1 (production integration is NOT authorised; the CP06.2 advisor stays the default
 * and its routes are untouched). When off, every /api/cp07/* route answers 404 and nothing is seeded.
 */
import { z } from 'zod';
import { route, HttpError, type Ctx } from '../http.ts';
import { PRODUCT_SELECT, presentProduct, type ProductRow } from '../routes.ts';
import { openSession, saveTurn, resetSession } from '../advisor2/session.ts';
import { answerCp07 } from './answer.ts';
import { seedKnowledge, transition, recordScientificReview, reviseClaim, approveRevision, knowledgeStats, getClaim, claimSources, claimHistory, usableClaims, KnowledgeError, type ClaimState } from './store.ts';
import { dashboard, enqueueGap, claimFromEvidence } from './growth.ts';
import { setExternalSearch, externalSearchEnabled } from './connectors.ts';
import { findConflicts } from './validate.ts';
import type { DB } from '../db.ts';

const env = () => (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
export const cp07Enabled = () => env().MH_CP07 === '1';
const seeded = new WeakSet<DB>();
function ready(c: Ctx) {
  if (!cp07Enabled()) throw new HttpError(404, 'CP07 غير مفعّل');
  if (!seeded.has(c.db)) { seedKnowledge(c.db); seeded.add(c.db); }
}
const wrap = <T>(f: () => T): T => { try { return f(); } catch (e) { if (e instanceof KnowledgeError) throw new HttpError(e.code === 'not_found' ? 404 : e.code === 'forbidden' ? 403 : 400, e.message); throw e; } };

route('POST', '/api/cp07/advisor/chat', 'any', async (c) => {
  ready(c);
  const b = z.object({ message: z.string().trim().min(1).max(1000), session_id: z.string().regex(/^[a-f0-9]{36}$/).optional() }).strict().parse(await c.body());
  const s = openSession(c.db, c.user!.id, b.session_id);
  const products = () => (c.db.prepare(`${PRODUCT_SELECT} WHERE products.record_status = 'active'`).all() as unknown as ProductRow[]).map((p) => presentProduct(p, c.cfg.availabilityStaleHours));
  const a = answerCp07(c.db, b.message, s.ctx, { products });
  const ctx = a.understanding.intent === 'reset' ? { ...a.understanding.conversation_context } : a.understanding.conversation_context;
  saveTurn(c.db, s, b.message, a.sections.map((x) => x.title).join(' / ').slice(0, 300), ctx);
  return { session_id: s.id, answer: a };
});
route('DELETE', '/api/cp07/advisor/session/:id', 'any', (c) => { ready(c); return { deleted: resetSession(c.db, c.user!.id, c.params.id!) }; });

route('GET', '/api/cp07/knowledge/dashboard', 'manager', (c) => {
  ready(c);
  const d = dashboard(c.db);
  const claims = [...usableClaims(c.db), ...(c.db.prepare("SELECT * FROM knowledge_claims WHERE state = 'pending_review' AND origin <> 'curated_seed'").all() as never[])];
  const conflicts = claims.flatMap((x) => findConflicts(x, claims).map((k) => ({ a: x.id, b: k.id, type: k.type, detail: k.detail }))).filter((k) => k.a < k.b);
  return { stats: knowledgeStats(c.db), external_search_enabled: externalSearchEnabled(c.db), conflicts, ...d };
});
route('GET', '/api/cp07/knowledge/claims/:id', 'manager', (c) => { ready(c); const k = getClaim(c.db, c.params.id!); if (!k) throw new HttpError(404, 'غير موجود'); return { claim: k, sources: claimSources(c.db, k.id), history: claimHistory(c.db, k.id) }; });
route('POST', '/api/cp07/knowledge/claims/:id/transition', 'manager', async (c) => {
  ready(c); const b = z.object({ to: z.enum(['extracted', 'pending_review', 'approved', 'published', 'rejected', 'needs_update', 'superseded']), reason: z.string().max(500).default('') }).strict().parse(await c.body());
  return wrap(() => ({ claim: b.to === 'approved' && getClaim(c.db, c.params.id!)?.supersedes ? approveRevision(c.db, c.params.id!, c.user!) : transition(c.db, c.params.id!, b.to as ClaimState, c.user!, b.reason) }));
});
route('POST', '/api/cp07/knowledge/claims/:id/scientific-review', 'manager', async (c) => {
  ready(c); const b = z.object({ reviewer: z.string().max(120), qualification: z.string().max(200), note: z.string().max(500).default('') }).strict().parse(await c.body());
  return wrap(() => ({ claim: recordScientificReview(c.db, c.params.id!, c.user!, b.reviewer, b.qualification, b.note) }));
});
route('POST', '/api/cp07/knowledge/claims/:id/revise', 'manager', async (c) => {
  ready(c); const b = z.object({ text_ar: z.string().max(1000), reason: z.string().max(500) }).strict().parse(await c.body());
  return wrap(() => ({ claim: reviseClaim(c.db, c.params.id!, c.user!, b.text_ar, b.reason) }));
});
route('POST', '/api/cp07/knowledge/gaps/:id/search', 'manager', (c) => { ready(c); return wrap(() => enqueueGap(c.db, Number(c.params.id))); });
route('POST', '/api/cp07/knowledge/evidence/:id/claim', 'manager', async (c) => {
  ready(c); const b = z.object({ topic_id: z.string().max(60), kind: z.enum(['education', 'advice', 'ingredient', 'caution', 'referral', 'comparison', 'interaction']), subject: z.string().max(80), stance: z.enum(['supports', 'cautions', 'avoid', 'neutral']), text_ar: z.string().max(1000), limitations: z.string().max(500).default('') }).strict().parse(await c.body());
  return wrap(() => ({ claim_id: claimFromEvidence(c.db, Number(c.params.id), c.user!, b) }));
});
route('POST', '/api/cp07/knowledge/evidence/:id/reject', 'manager', async (c) => {
  ready(c); const b = z.object({ reason: z.string().min(3).max(500) }).strict().parse(await c.body());
  const n = c.db.prepare("UPDATE knowledge_retrievals SET evidence_state = 'rejected', review_state = 'rejected', validation = json_set(CASE WHEN json_valid(validation) THEN validation ELSE '{}' END, '$.rejected_reason', ?) WHERE id = ? AND evidence_state IN ('pending_review','discovered')").run(b.reason, Number(c.params.id)).changes;
  if (!n) throw new HttpError(404, 'غير موجود أو تمت مراجعته'); return { rejected: true };
});
route('POST', '/api/cp07/knowledge/settings', 'manager', async (c) => {
  ready(c); const b = z.object({ external_search_enabled: z.boolean() }).strict().parse(await c.body());
  setExternalSearch(c.db, b.external_search_enabled); return { external_search_enabled: externalSearchEnabled(c.db) };
});
