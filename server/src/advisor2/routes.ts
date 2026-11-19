/**
 * CP06.2 Phase 5A — conversational advisor HTTP routes. The old POST /api/advisor/search stays unchanged (compatibility).
 * AI provider: NONE unless configured. `MH_AI_PROVIDER=mock` is accepted ONLY in tests (NODE_ENV=test) so a demo can never
 * present the mock as "AI". A real provider needs the owner's approval, a server-side key and a provider-side spend cap.
 */
import { z } from 'zod';
import { route, HttpError } from '../http.ts';
import { PRODUCT_SELECT, presentProduct, type ProductRow } from '../routes.ts';
import { consultAndSave, type GlobalHit } from './compose.ts';
import { resetSession, turns } from './session.ts';
import { mockAIProvider, usage, type AIConfig } from './ai.ts';
import { activeProviders } from '../evidence-routes.ts';
import { callProvider } from '../providers.ts';
import type { DB } from '../db.ts';

let override: Partial<AIConfig> | null = null;
/** tests only: inject a provider / budget */
export const setAIConfigForTests = (c: Partial<AIConfig> | null) => { override = c; };
export function aiConfig(): AIConfig {
  const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
  const provider = env.MH_AI_PROVIDER === 'mock' && env.NODE_ENV === 'test' ? mockAIProvider() : null;
  return { provider, monthly_budget_usd: Number(env.MH_AI_MONTHLY_BUDGET_USD ?? 5) || 5, daily_request_cap: Number(env.MH_AI_DAILY_CAP ?? 200) || 200, timeout_ms: 8000, ...override };
}

/** global search through the ENABLED product providers only (OBF on Render staging); generic product-type words, never shop data */
async function globalSearch(db: DB, q: { name: string }): Promise<GlobalHit[]> {
  const key = `advisor:${q.name}`;
  const cached = db.prepare("SELECT payload FROM provider_cache WHERE provider = 'advisor_global' AND query_key = ? AND expires_at > ?").get(key, new Date().toISOString()) as { payload: string } | undefined;
  if (cached) return JSON.parse(cached.payload);
  const out: GlobalHit[] = [];
  for (const p of activeProviders()) {
    const r = await callProvider(p, { name: q.name }, 4000);
    if (r.outcome === 'found') out.push(...r.candidates.slice(0, 3).map((c) => ({ name: c.name, brand: c.brand, size: c.size, source_url: c.source_url, provider: p.name })));
  }
  db.prepare("INSERT OR REPLACE INTO provider_cache(provider, query_key, outcome, payload, fetched_at, expires_at) VALUES ('advisor_global', ?, ?, ?, ?, ?)").run(key, out.length ? 'found' : 'not_found', JSON.stringify(out), new Date().toISOString(), new Date(Date.now() + 7 * 86_400_000).toISOString());
  return out;
}

route('POST', '/api/advisor/chat', 'any', async (c) => {
  const b = z.object({ message: z.string().trim().min(1).max(1000), session_id: z.string().regex(/^[a-f0-9]{36}$/).optional() }).strict().parse(await c.body());
  const db = c.db; const cfg = aiConfig();
  const products = () => (db.prepare(`${PRODUCT_SELECT} WHERE products.record_status = 'active'`).all() as unknown as ProductRow[]).map((p) => presentProduct(p, c.cfg.availabilityStaleHours));
  const conflictIds = new Set((db.prepare("SELECT DISTINCT p.id FROM products p JOIN enrichment_candidates e ON e.barcode = p.barcode WHERE e.review_status='pending' AND e.conflict_note <> ''").all() as { id: number }[]).map((r) => r.id));
  const online = c.cfg.enrich !== 'off';
  return consultAndSave(db, c.user!.id, b.session_id, b.message, { products, conflictIds, ai: cfg, online, globalSearch: online ? (q) => globalSearch(db, q) : undefined });
});
route('GET', '/api/advisor/session/:id', 'any', (c) => { const t = turns(c.db, c.user!.id, c.params.id!); if (!t) throw new HttpError(404, 'الجلسة غير موجودة أو منتهية'); return { turns: t }; });
route('DELETE', '/api/advisor/session/:id', 'any', (c) => ({ deleted: resetSession(c.db, c.user!.id, c.params.id!) }));
route('GET', '/api/advisor/status', 'any', (c) => {
  const cfg = aiConfig();
  return { ai: cfg.provider ? { provider: cfg.provider.id, model: cfg.provider.model, ...usage(c.db, cfg.provider.id), monthly_budget_usd: cfg.monthly_budget_usd } : null,
    mode: cfg.provider ? 'ai_composed' : 'knowledge_fallback', note: cfg.provider ? null : 'لا يوجد نموذج لغوي مفعّل: الإجابات من معرفة منظمة وقواعد ثابتة.' };
});
