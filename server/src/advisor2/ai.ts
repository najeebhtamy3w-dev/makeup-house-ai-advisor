/**
 * CP06.2 Phase 5A — AIProviderAdapter (provider-neutral) + MockAIProvider + guard + usage/budget accounting.
 * NO real provider is configured or enabled. A real one (e.g. a low-cost model) needs the owner's separate approval, a
 * server-side key and a spend cap at the provider; it would implement the same interface and nothing else changes.
 * The model is a conversational INTERFACE only: it may rephrase the grounded material it is given, never add facts,
 * sources, products, availability or diagnoses. Every output is validated; anything invalid falls back to the
 * deterministic knowledge answer.
 */
import { AIProviderRequest, AIProviderResponse, type TAIProviderRequest, type TAIProviderResponse } from '../contracts.ts';
import { outputViolations } from './safety.ts';
import type { DB } from '../db.ts';

export type AIErrorClass = 'disabled' | 'timeout' | 'unavailable' | 'invalid_output' | 'budget_exceeded' | 'rate_limited' | 'guard_rejected';
export interface AIProviderAdapter {
  id: string; model: string;
  /** USD per 1M tokens (input, output). 0 for the mock. Real values must come from the provider's official price page. */
  price: { input_per_mtok: number; output_per_mtok: number };
  health(): Promise<'ok' | 'down'>;
  generate(req: TAIProviderRequest, signal: AbortSignal): Promise<unknown>;   // raw; validated by the caller
}

/** Deterministic stand-in for development and tests. `behaviour` simulates every failure the real world produces. */
export type MockBehaviour = 'ok' | 'down' | 'slow' | 'invalid' | 'fabricate_source' | 'fabricate_product' | 'unsafe_text' | 'echo_injection';
export function mockAIProvider(behaviour: MockBehaviour = 'ok'): AIProviderAdapter & { calls: number } {
  const self = {
    id: 'mock', model: 'mock-1', price: { input_per_mtok: 0, output_per_mtok: 0 }, calls: 0,
    async health() { return behaviour === 'down' ? 'down' as const : 'ok' as const; },
    async generate(req: TAIProviderRequest, signal: AbortSignal) {
      self.calls++;
      if (behaviour === 'down') throw new Error('unavailable');
      if (behaviour === 'slow') await new Promise((r, j) => { const t = setTimeout(r, 5000); signal.addEventListener('abort', () => { clearTimeout(t); j(new Error('aborted')); }); });
      if (behaviour === 'invalid') return { text: 42 };
      const claims = req.grounding.claims.slice(0, 4);
      let text = claims.map((c) => c.text_ar).join(' ');
      const cited = claims.map((c) => c.id); const prods = req.grounding.products.map((p) => p.id);
      if (behaviour === 'fabricate_source') cited.push('invented-source-123');
      if (behaviour === 'fabricate_product') prods.push(999999);
      if (behaviour === 'unsafe_text') text += ' هذا المنتج يشفي البشرة نهائيًا وسعره 20 ريال.';
      if (behaviour === 'echo_injection') text += ' ' + req.question;   // a careless model that repeats injected instructions
      return { text, cited_claims: cited, cited_products: prods, usage: { input_tokens: Math.ceil(JSON.stringify(req).length / 4), output_tokens: Math.ceil(text.length / 4) } };
    },
  };
  return self;
}

export interface AIConfig { provider: AIProviderAdapter | null; monthly_budget_usd: number; daily_request_cap: number; timeout_ms: number }
const day = (d = new Date()) => d.toISOString().slice(0, 10);
export function usage(db: DB, providerId: string) {
  const today = db.prepare('SELECT requests, est_cost_usd FROM ai_usage WHERE day = ? AND provider = ?').get(day(), providerId) as { requests: number; est_cost_usd: number } | undefined;
  const month = db.prepare('SELECT COALESCE(SUM(est_cost_usd),0) usd, COALESCE(SUM(requests),0) n FROM ai_usage WHERE day >= ? AND provider = ?').get(day().slice(0, 7) + '-01', providerId) as { usd: number; n: number };
  return { today_requests: today?.requests ?? 0, month_usd: month.usd, month_requests: month.n };
}
function record(db: DB, p: AIProviderAdapter, u: { input_tokens: number; output_tokens: number } | null, error: boolean) {
  const cost = u ? (u.input_tokens * p.price.input_per_mtok + u.output_tokens * p.price.output_per_mtok) / 1e6 : 0;
  db.prepare(`INSERT INTO ai_usage(day, provider, requests, input_tokens, output_tokens, est_cost_usd, errors) VALUES (?,?,1,?,?,?,?)
    ON CONFLICT(day, provider) DO UPDATE SET requests = requests + 1, input_tokens = input_tokens + excluded.input_tokens, output_tokens = output_tokens + excluded.output_tokens, est_cost_usd = est_cost_usd + excluded.est_cost_usd, errors = errors + excluded.errors`)
    .run(day(), p.id, u?.input_tokens ?? 0, u?.output_tokens ?? 0, cost, error ? 1 : 0);
}

export type AIResult = { ok: true; response: TAIProviderResponse } | { ok: false; error: AIErrorClass; detail?: string };
/** Call the configured provider with every guard. Never throws. */
export async function composeWithAI(db: DB, cfg: AIConfig, req: TAIProviderRequest): Promise<AIResult> {
  const p = cfg.provider; if (!p) return { ok: false, error: 'disabled' };
  const u = usage(db, p.id);
  if (u.month_usd >= cfg.monthly_budget_usd || u.today_requests >= cfg.daily_request_cap) return { ok: false, error: 'budget_exceeded' };
  const parsedReq = AIProviderRequest.safeParse(req); if (!parsedReq.success) return { ok: false, error: 'invalid_output', detail: 'request' };
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), cfg.timeout_ms);
  let raw: unknown;
  try { raw = await Promise.race([p.generate(parsedReq.data, ctl.signal), new Promise((_, j) => ctl.signal.addEventListener('abort', () => j(new Error('timeout'))))]); }
  catch (e) { record(db, p, null, true); return { ok: false, error: (e as Error).message === 'timeout' || ctl.signal.aborted ? 'timeout' : 'unavailable' }; }
  finally { clearTimeout(timer); }
  const out = AIProviderResponse.safeParse(raw);
  if (!out.success) { record(db, p, null, true); return { ok: false, error: 'invalid_output' }; }
  record(db, p, out.data.usage, false);
  // grounding guard: every cited claim / product must be one we GAVE the model; no URL may appear; no forbidden content
  const claimIds = new Set(req.grounding.claims.map((c) => c.id)), prodIds = new Set(req.grounding.products.map((x) => x.id));
  if (out.data.cited_claims.some((id) => !claimIds.has(id))) return { ok: false, error: 'guard_rejected', detail: 'cited a source that was not provided' };
  if (out.data.cited_products.some((id) => !prodIds.has(id))) return { ok: false, error: 'guard_rejected', detail: 'named a product that was not retrieved' };
  if (/https?:\/\//i.test(out.data.text)) return { ok: false, error: 'guard_rejected', detail: 'links are added by the system, never by the model' };
  const bad = outputViolations(out.data.text); if (bad.length) return { ok: false, error: 'guard_rejected', detail: bad.join(',') };
  if (/(تجاهل|ignore) (كل )?(التعليمات|instructions)|system prompt|you are now/i.test(out.data.text)) return { ok: false, error: 'guard_rejected', detail: 'instruction-like text in output' };
  return { ok: true, response: out.data };
}
