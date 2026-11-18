import { Unreachable, type Connector, type ConnectorResult, type FetchLike, type EnrichField } from './types.ts';

/**
 * Open Beauty Facts connector. CP03: moved from the DEPRECATED v2 endpoint to v3 (`/api/v3/product/{code}`), per the official
 * Open Food Facts API docs (v3 recommended; v2 deprecated). Docs-verified: path, `fields`, `product_type=beauty`, response `status`
 * enum (success|success_with_warnings|success_with_errors|failure), 404 when absent. NOT live-verified — the build environment's
 * egress gateway answers 403 to CONNECT for the OBF host. The returned `product.code` must equal the requested barcode (identity check).
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
        res = await f(`${base}/api/v3/product/${encodeURIComponent(code)}?product_type=beauty&fields=code,product_name,brands,quantity,ingredients_text`, { headers: { 'user-agent': `MakeupHouseAdvisor/3.0 (${opts.contact})`, accept: 'application/json' }, signal: ctl.signal });
      } catch { throw new Unreachable('network'); } finally { clearTimeout(timer); }
      if (res.status === 404) return { found: false };
      if (!res.ok) throw new Unreachable('http_' + res.status);
      let j: any; try { j = await res.json(); } catch { throw new Unreachable('bad_json'); }
      if (!j || typeof j !== 'object') throw new Unreachable('bad_shape');
      const st = j.status;
      // v3: string enum. Legacy v2 numeric (1/0) is still tolerated. Anything else = the API shape changed -> never a silent "not found".
      const ok = typeof st === 'string' ? st.startsWith('success') : st === 1;
      const fail = typeof st === 'string' ? st === 'failure' : st === 0;
      if (!ok && !fail) throw new Unreachable('bad_shape');
      if (fail || !j.product || typeof j.product !== 'object') return { found: false };
      const p = j.product as Record<string, unknown>;
      // Identity: a response for a different code is NOT the requested product.
      const strip = (v: unknown) => String(v ?? '').replace(/^0+/, '');
      if (p.code !== undefined && strip(p.code) !== strip(code)) return { found: false }; const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
      const fields: Partial<Record<EnrichField, string>> = {};
      if (s(p.product_name)) fields.name = s(p.product_name).slice(0, 200);
      if (s(p.brands)) fields.brand = s(p.brands).split(',')[0]!.trim().slice(0, 120);
      if (s(p.quantity)) fields.size = s(p.quantity).slice(0, 60);
      if (s(p.ingredients_text)) fields.ingredients = s(p.ingredients_text).slice(0, 5000);
      return Object.keys(fields).length ? { found: true, fields, sourceUrl: `${base}/product/${encodeURIComponent(code)}` } : { found: false };
    },
  };
}
