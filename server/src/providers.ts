/**
 * CP06.2 Phase 4 — replaceable product-data providers behind ONE contract (contracts.ts ProviderQuery -> ProviderResult).
 * - Every provider is a plain object with declared limits, cost and licence facts; the rest of the system never knows
 *   which provider it talks to.
 * - Network access is injected (`fetchImpl`), so tests use recorded fixtures and the Android worker can pass its own fetch.
 * - Nothing here writes to the database; results become reviewable evidence elsewhere (Phase 5).
 * - Providers that need the owner's approval (terms not verified, or real shop data leaving the shop) are DISABLED unless
 *   explicitly enabled in configuration.
 */
import { ProviderResult, type TProviderQuery, type TProviderResult } from './contracts.ts';
import type { Connector, FetchLike } from './enrichment/types.ts';
import { Unreachable } from './enrichment/types.ts';
import { gtinValid } from './gtin.ts';

export interface ProviderInfo {
  id: string; name: string;
  /** what is known about the data licence — never invented */
  license: string; license_status: 'known' | 'unknown' | 'restricted';
  /** documented limits we respect (per minute / per day). null = not documented / not verified */
  limits: { perMinute: number | null; perDay: number | null; source: string; verified: boolean };
  cost_per_request_usd: number;
  requires_owner_approval: boolean;
}
export interface ProductProvider extends ProviderInfo { lookup(q: TProviderQuery, signal?: AbortSignal): Promise<TProviderResult> }

const nowIso = () => new Date().toISOString();
const result = (provider: string, outcome: TProviderResult['outcome'], candidates: TProviderResult['candidates'] = [], extra: Partial<TProviderResult> = {}): TProviderResult =>
  ProviderResult.parse({ provider, outcome, candidates, retrieved_at: nowIso(), cached: false, ...extra });

/** Wrap an existing CP03–CP05 Connector (Open Beauty Facts, the dev mock) into the CP06.2 provider contract. */
export function fromConnector(c: Connector, info: Omit<ProviderInfo, 'id' | 'name'>): ProductProvider {
  return {
    id: c.id, name: c.name, ...info,
    async lookup(q) {
      try {
        if (q.gtin) {
          const r = await c.lookupBarcode(q.gtin);
          if (!r.found) return result(c.id, 'not_found');
          const f = r.fields;
          return result(c.id, 'found', [{ gtin: q.gtin, name: f.name ?? '', brand: f.brand ?? '', size: f.size ?? '', variant: '', manufacturer: '', ingredients: f.ingredients ?? '',
            ...(f.image_url ? { image_url: f.image_url } : {}), ...(r.sourceUrl ? { source_url: r.sourceUrl } : {}), license: info.license, license_status: info.license_status }]);
        }
        if (q.name && c.searchByName) {
          const hits = await c.searchByName({ name: q.name, brand: q.brand });
          return result(c.id, hits.length ? 'found' : 'not_found', hits.slice(0, 10).map((h) => ({ gtin: h.code, name: h.name, brand: h.brand, size: h.size, variant: '', manufacturer: '', ingredients: '', source_url: h.source_url, license: info.license, license_status: info.license_status })));
        }
        return result(c.id, 'not_found');
      } catch (e) { return result(c.id, e instanceof Unreachable ? 'unreachable' : 'error'); }
    },
  };
}

/**
 * UPCitemdb (general retail barcode database). Implemented against its published response shape, but DISABLED by default:
 * its storage/reuse terms are NOT VERIFIED and every call sends a barcode outside the shop (owner approval required).
 * Free "trial" endpoint: no key, documented 100 requests/day (20 of them searches) — re-verify before enabling.
 */
export function upcItemDb(opts: { fetchImpl?: FetchLike; base?: string; timeoutMs?: number } = {}): ProductProvider {
  const f: FetchLike = opts.fetchImpl ?? ((u, i) => fetch(u, i as RequestInit) as never);
  const base = opts.base ?? 'https://api.upcitemdb.com/prod/trial';
  const info: ProviderInfo = { id: 'upcitemdb', name: 'UPCitemdb', license: 'شروط إعادة الاستخدام غير متحقق منها', license_status: 'unknown',
    limits: { perMinute: null, perDay: 100, source: 'upcitemdb.com plan page (via search results, 2026-11-19)', verified: false }, cost_per_request_usd: 0, requires_owner_approval: true };
  const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  return {
    ...info,
    async lookup(q, signal) {
      const url = q.gtin ? `${base}/lookup?upc=${encodeURIComponent(q.gtin)}` : q.name ? `${base}/search?s=${encodeURIComponent([q.brand, q.name].filter(Boolean).join(' ').slice(0, 100))}` : null;
      if (!url) return result(info.id, 'not_found');
      const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 6000); signal?.addEventListener('abort', () => ctl.abort());
      let res;
      try { res = await f(url, { headers: { accept: 'application/json' }, signal: ctl.signal }); } catch { return result(info.id, 'unreachable'); } finally { clearTimeout(timer); }
      if (res.status === 429) return result(info.id, 'rate_limited', [], { retry_after_s: 3600 });
      if (res.status === 404) return result(info.id, 'not_found');
      if (!res.ok) return result(info.id, 'unreachable');
      let j: any; try { j = await res.json(); } catch { return result(info.id, 'error'); }
      if (!j || !Array.isArray(j.items)) return result(info.id, 'error');
      const items = (j.items as Record<string, unknown>[]).filter((it) => gtinValid(s(it.ean)) && (!q.gtin || s(it.ean).replace(/^0+/, '') === q.gtin.replace(/^0+/, '')));
      return result(info.id, items.length ? 'found' : 'not_found', items.slice(0, 10).map((it) => ({ gtin: s(it.ean), name: s(it.title).slice(0, 200), brand: s(it.brand).slice(0, 120), size: s(it.size).slice(0, 60), variant: s(it.color).slice(0, 60), manufacturer: '', ingredients: '',
        ...(Array.isArray(it.images) && typeof it.images[0] === 'string' && /^https:\/\//.test(it.images[0]) ? { image_url: it.images[0] as string } : {}),
        source_url: `https://www.upcitemdb.com/upc/${s(it.ean)}`, license: info.license, license_status: 'unknown' as const })));
    },
  };
}

/** Test/eval provider: answers from a script (recorded fixtures) and can simulate every failure mode. Never used in production. */
export type Scripted = { kind: 'found'; candidates: TProviderResult['candidates'] } | { kind: 'not_found' } | { kind: 'timeout' } | { kind: 'rate_limited'; retry_after_s: number } | { kind: 'http_500' } | { kind: 'malformed' };
export function scriptedProvider(id: string, script: (q: TProviderQuery) => Scripted, opts: { latencyMs?: number; timeoutMs?: number } = {}): ProductProvider & { calls: TProviderQuery[] } {
  const calls: TProviderQuery[] = [];
  return {
    id, name: `SCRIPTED ${id}`, license: 'test fixture', license_status: 'unknown', limits: { perMinute: null, perDay: null, source: 'test', verified: false }, cost_per_request_usd: 0, requires_owner_approval: false, calls,
    async lookup(q, signal) {
      calls.push(q); const s = script(q);
      const wait = s.kind === 'timeout' ? (opts.timeoutMs ?? 50) + 10 : opts.latencyMs ?? 0;
      const aborted = await new Promise<boolean>((r) => { const t = setTimeout(() => r(false), wait); signal?.addEventListener('abort', () => { clearTimeout(t); r(true); }); });
      if (aborted || s.kind === 'timeout') return result(id, 'unreachable');
      if (s.kind === 'found') return result(id, 'found', s.candidates);
      if (s.kind === 'not_found') return result(id, 'not_found');
      if (s.kind === 'rate_limited') return result(id, 'rate_limited', [], { retry_after_s: s.retry_after_s });
      if (s.kind === 'http_500') return result(id, 'unreachable');
      return result(id, 'error');
    },
  };
}

/** Call a provider with a hard timeout; any throw becomes a classified outcome (a provider can never crash a caller). */
export async function callProvider(p: ProductProvider, q: TProviderQuery, timeoutMs = 8000): Promise<TProviderResult & { latency_ms: number }> {
  const t0 = Date.now(); const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await Promise.race([p.lookup(q, ctl.signal), new Promise<TProviderResult>((res) => ctl.signal.addEventListener('abort', () => res(result(p.id, 'unreachable'))))]);
    return { ...r, latency_ms: Date.now() - t0 };
  } catch { return { ...result(p.id, 'error'), latency_ms: Date.now() - t0 }; } finally { clearTimeout(timer); }
}

/** Facts about the providers evaluated in Phase 4 (shown in reports / settings). Nothing is enabled by this list. */
export const PROVIDER_FACTS: ProviderInfo[] = [
  { id: 'obf', name: 'Open Beauty Facts', license: 'ODbL (قاعدة) / DbCL (محتوى) / CC BY-SA (صور)', license_status: 'known',
    limits: { perMinute: 12, perDay: null, source: 'الحد المطبق في الكود (أشد من التوثيق الحالي: 100/د للمنتج، 10/د للبحث — لم يُفتح التوثيق مباشرة)', verified: false }, cost_per_request_usd: 0, requires_owner_approval: false },
  { id: 'upcitemdb', name: 'UPCitemdb', license: 'غير متحقق', license_status: 'unknown', limits: { perMinute: null, perDay: 100, source: 'نتائج بحث 2026-11-19', verified: false }, cost_per_request_usd: 0, requires_owner_approval: true },
];
