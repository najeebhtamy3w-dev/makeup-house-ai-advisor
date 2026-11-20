/**
 * CP08 HTTP routes — same gate as CP07 (404 unless MH_CP07=1; /status answers {enabled:false}), registered on the Node server only.
 *   POST /api/cp08/advisor/chat   { message, session_id?, mode: 'offline' | 'research' | 'cloud' }
 *   GET  /api/cp08/status         modes and their real availability (never a key)
 *   POST /api/cp08/settings       manager: { external_search_enabled?, cloud_llm_enabled? }
 * MODE 1 offline always works. MODE 2 adds an UNREVIEWED research panel (answer unchanged). MODE 3 rephrases with a
 * cloud model only when configured + enabled, with per-sentence fidelity; otherwise the local answer + a status line.
 */
import { z } from 'zod';
import { route, HttpError, type Ctx } from '../http.ts';
import { PRODUCT_SELECT, presentProduct, type ProductRow } from '../routes.ts';
import { openSession, saveTurn } from '../advisor2/session.ts';
import { answerCp07, renderText } from '../cp07/answer.ts';
import { seedKnowledge } from '../cp07/store.ts';
import { externalSearchEnabled, setExternalSearch, type FetchLike } from '../cp07/connectors.ts';
import { runResearch, type ResearchResult } from './research.ts';
import { cloudCompose, cloudProviderFromEnv, cloudStatus, setCloudEnabled, type CloudResult } from './llm.ts';
import type { DB } from '../db.ts';
import { scientificAdvisor, setScientificAdvisor, isOnline, researchSources, cloudUnavailableReason, getRuntime } from './features.ts';
import { redact } from './llm.ts';

const env = () => (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const enabled = (db: DB) => scientificAdvisor(db).enabled;
const seeded = new WeakSet<DB>();
function ready(c: Ctx) { if (!enabled(c.db)) throw new HttpError(404, 'غير مفعّل'); if (!seeded.has(c.db)) { seedKnowledge(c.db); seeded.add(c.db); } }
let fetchOverride: FetchLike | null = null;
/** tests only: inject the network */
export const setResearchFetchForTests = (f: FetchLike | null) => { fetchOverride = f; };

route('GET', '/api/cp08/status', 'any', (c) => {
  // answers 200 even when off, so the web app can decide whether to show the menu without a failed request
  if (!enabled(c.db)) return { enabled: false, can_enable: c.user?.role === 'manager', runtime: getRuntime() };
  ready(c);
  const online = isOnline(c.cfg);
  return { enabled: true, modes: { offline: { available: true }, research: { available: externalSearchEnabled(c.db) && online, enabled: externalSearchEnabled(c.db), online, sources: researchSources() }, cloud: cloudUnavailableReason() ? { configured: false, enabled: false, provider: null, model: null, reason: cloudUnavailableReason()!, monthly_budget_usd: 0 } : cloudStatus(c.db, env()) }, runtime: getRuntime(), source: scientificAdvisor(c.db).source, note_ar: 'الوضع المحلي يعمل دائمًا؛ الأدلة المكتشفة من الإنترنت غير مراجعة؛ النموذج السحابي اختياري ومعطّل ما لم يُضبط ويُفعّل.' };
});
/** CP09: the one switch for the scientific advisor (manager only — enforced here, in the runtime that owns the data). */
route('POST', '/api/features/scientific-advisor', 'manager', async (c) => {
  const b = z.object({ enabled: z.boolean() }).strict().parse(await c.body());
  const cur = scientificAdvisor(c.db);
  if (cur.source === 'env' && !b.enabled) throw new HttpError(409, 'مفعّل من إعدادات الخادم (MH_CP07) ولا يُعطّل من التطبيق');
  setScientificAdvisor(c.db, b.enabled);
  c.db.prepare("INSERT INTO audit_log(user_id, action, entity, entity_id, detail, at) VALUES (?, 'feature', 'scientific_advisor', '1', ?, ?)").run(c.user!.id, b.enabled ? 'enabled' : 'disabled', new Date().toISOString());
  return { enabled: scientificAdvisor(c.db).enabled };
});
route('POST', '/api/cp08/settings', 'manager', async (c) => {
  ready(c); const b = z.object({ external_search_enabled: z.boolean().optional(), cloud_llm_enabled: z.boolean().optional() }).strict().parse(await c.body());
  if (b.external_search_enabled !== undefined) setExternalSearch(c.db, b.external_search_enabled);
  if (b.cloud_llm_enabled !== undefined) setCloudEnabled(c.db, b.cloud_llm_enabled);
  return { external_search_enabled: externalSearchEnabled(c.db), cloud: cloudStatus(c.db, env()) };
});
route('POST', '/api/cp08/advisor/chat', 'any', async (c) => {
  ready(c);
  const b = z.object({ message: z.string().trim().min(1).max(1000), session_id: z.string().regex(/^[a-f0-9]{36}$/).optional(), mode: z.enum(['offline', 'research', 'cloud']).default('offline') }).strict().parse(await c.body());
  const s = openSession(c.db, c.user!.id, b.session_id);
  const products = () => (c.db.prepare(`${PRODUCT_SELECT} WHERE products.record_status = 'active'`).all() as unknown as ProductRow[]).map((p) => presentProduct(p, c.cfg.availabilityStaleHours));
  const t0 = Date.now();
  const answer = answerCp07(c.db, b.message, s.ctx, { products });
  // CP09 multi-turn safety: once an urgent sign was mentioned in this conversation, later turns keep the referral first and
  // recommend no products until «محادثة جديدة» (the person may still ask for general information).
  const ctx = answer.understanding.conversation_context;
  if (answer.understanding.medical_red_flags.length) { if (!ctx.safety_flags.includes('urgent')) ctx.safety_flags.push('urgent'); }
  else if (s.ctx.safety_flags?.includes('urgent') && answer.understanding.intent !== 'reset') {
    if (!ctx.safety_flags.includes('urgent')) ctx.safety_flags.push('urgent');
    answer.sections = [{ kind: 'referral', title: 'تذكير: ذُكرت أعراض تحتاج تقييمًا صحيًا', items: [{ text: 'في هذه المحادثة ذُكرت علامات قد تحتاج طبيبًا أو مختصًا صحيًا. لا تُقترح منتجات قبل ذلك؛ ابدئي «محادثة جديدة» لعميلة أخرى.', source_ids: [] }] }, ...answer.sections.filter((x) => x.kind !== 'products')];
    answer.products = null; answer.text = renderText(answer);
  }
  let research: ResearchResult | null = null; let cloud: CloudResult | null = null;
  if (b.mode === 'research' && !answer.understanding.medical_red_flags.length) research = await runResearch(c.db, answer.understanding, { fetch: fetchOverride ?? (globalThis.fetch as unknown as FetchLike), online: isOnline(c.cfg) });
  if (b.mode === 'cloud') { const { provider } = cloudProviderFromEnv(env()); cloud = await cloudCompose(c.db, answer, b.message, { provider, monthly_budget_usd: Number(env().MH_AI_MONTHLY_BUDGET_USD ?? 5) || 5, daily_request_cap: Number(env().MH_AI_DAILY_CAP ?? 200) || 200, timeout_ms: 12_000 }); }
  // privacy: phone numbers / e-mails typed into the consultation are not stored in the session history
  saveTurn(c.db, s, redact(b.message), answer.sections.map((x) => x.title).join(' / ').slice(0, 300), ctx);
  const mode_used = cloud?.mode_used === 'cloud_assisted' ? 'cloud' : research && research.status === 'ok' ? 'research' : 'offline';
  return { session_id: s.id, mode_requested: b.mode, mode_used, ms: Date.now() - t0, answer, research, cloud };
});
