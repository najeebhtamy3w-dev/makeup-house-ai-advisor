import { Unreachable, type Connector, type ConnectorResult, type FetchLike, type EnrichField } from './types.ts';

/**
 * Open Beauty Facts connector. STATUS: implemented against the public v2 product endpoint, verified only with
 * recorded-shape fixtures — a LIVE call could not be made from the build environment (outbound HTTPS blocked).
 * Terms checked: ODbL database / DbCL contents / images CC BY-SA; custom User-Agent `App/Version (contact)`; 15 product reads/min/IP.
 * Images are NOT stored or displayed in this version (licence + attribution handling pending).
 */
export function openBeautyFacts(opts: { contact: string; fetchImpl?: FetchLike; baseUrl?: string; timeoutMs?: number }): Connector {
  const f: FetchLike = opts.fetchImpl ?? ((u, i) => fetch(u, i as RequestInit) as never);
  const base = opts.baseUrl ?? 'https://world.openbeautyfacts.org';
  return {
    id: 'obf', name: 'Open Beauty Facts', license: 'ODbL / DbCL (صور: CC BY-SA)', isMock: false,
    async lookupBarcode(code): Promise<ConnectorResult> {
      const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 6000);
      let res;
      try {
        res = await f(`${base}/api/v2/product/${encodeURIComponent(code)}.json?fields=code,product_name,brands,quantity,ingredients_text`, { headers: { 'user-agent': `MakeupHouseAdvisor/3.0 (${opts.contact})`, accept: 'application/json' }, signal: ctl.signal });
      } catch { throw new Unreachable('network'); } finally { clearTimeout(timer); }
      if (res.status === 404) return { found: false };
      if (!res.ok) throw new Unreachable('http_' + res.status);
      let j: any; try { j = await res.json(); } catch { throw new Unreachable('bad_json'); }
      if (!j || j.status !== 1 || !j.product) return { found: false };
      const p = j.product as Record<string, unknown>; const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
      const fields: Partial<Record<EnrichField, string>> = {};
      if (s(p.product_name)) fields.name = s(p.product_name).slice(0, 200);
      if (s(p.brands)) fields.brand = s(p.brands).split(',')[0]!.trim().slice(0, 120);
      if (s(p.quantity)) fields.size = s(p.quantity).slice(0, 60);
      if (s(p.ingredients_text)) fields.ingredients = s(p.ingredients_text).slice(0, 5000);
      return Object.keys(fields).length ? { found: true, fields, sourceUrl: `${base}/product/${encodeURIComponent(code)}` } : { found: false };
    },
  };
}
