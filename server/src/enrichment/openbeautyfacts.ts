import { allowedRemoteImage } from '../images.ts';
import { classifyIngredients } from './identity.ts';
import { gtinValid } from '../gtin.ts';
import { Unreachable, type SearchHit, type Connector, type ConnectorResult, type FetchLike, type EnrichField } from './types.ts';

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
        res = await f(`${base}/api/v3/product/${encodeURIComponent(code)}?product_type=beauty&fields=code,product_name,brands,quantity,ingredients_text,image_front_url`, { headers: { 'user-agent': `MakeupHouseAdvisor/3.0 (${opts.contact})`, accept: 'application/json' }, signal: ctl.signal });
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
      // CP04: a bare number (e.g. "177") has no unit -> ambiguous (ml? g? oz?) -> never proposed as the pack size.
      if (s(p.quantity) && /[0-9\u0660-\u0669\u06f0-\u06f9]/.test(s(p.quantity)) && /[a-z\u0621-\u064a]/i.test(s(p.quantity))) fields.size = s(p.quantity).slice(0, 60);
      const notes: Partial<Record<EnrichField, string>> = {};
      if (s(p.ingredients_text)) {
        // CP05: marketing text is never proposed as an ingredient list; translated lists are proposed WITH a caveat.
        const k = classifyIngredients(s(p.ingredients_text));
        if (k.kind !== 'not_a_list') { fields.ingredients = s(p.ingredients_text).slice(0, 5000); if (k.note) notes.ingredients = k.note; }
      }
      if (s(p.quantity) && !fields.size) notes.size = 'المصدر ذكر حجمًا بلا وحدة — لم يُقترح';
      // CP04: front photo of the SAME record (identity already checked above). Only an allow-listed https image host is accepted.
      if (s(p.image_front_url) && allowedRemoteImage(s(p.image_front_url))) fields.image_url = s(p.image_front_url).slice(0, 500);
      return Object.keys(fields).length ? { found: true, fields, sourceUrl: `${base}/product/${encodeURIComponent(code)}`, ...(Object.keys(notes).length ? { notes } : {}) } : { found: false };
    },
    /** Full-text search (OBF /cgi/search.pl). Coverage is partial and ranking is the source's: results are POSSIBLE matches only. */
    async searchByName(q): Promise<SearchHit[]> {
      const terms = [q.brand, q.name].map((x) => (x ?? '').trim()).filter(Boolean).join(' ').slice(0, 120);
      if (terms.length < 2) return [];
      const u = `${base}/cgi/search.pl?search_terms=${encodeURIComponent(terms)}&search_simple=1&json=1&page_size=12&fields=code,product_name,brands,quantity,image_front_small_url`;
      const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), (opts.timeoutMs ?? 6000) + 4000);
      let res;
      try { res = await f(u, { headers: { 'user-agent': `MakeupHouseAdvisor/3.0 (${opts.contact})`, accept: 'application/json' }, signal: ctl.signal }); } catch { throw new Unreachable('network'); } finally { clearTimeout(timer); }
      if (!res.ok) throw new Unreachable('http_' + res.status);
      let j: any; try { j = await res.json(); } catch { throw new Unreachable('bad_json'); }
      if (!j || !Array.isArray(j.products)) throw new Unreachable('bad_shape');
      const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
      const out: SearchHit[] = [];
      for (const p of j.products as Record<string, unknown>[]) {
        const code = s(p.code).replace(/\D/g, '');
        if (!code || !gtinValid(code)) continue;   // a hit we cannot identify by a valid barcode is useless for matching
        const size = s(p.quantity);
        out.push({ code, name: s(p.product_name).slice(0, 200), brand: s(p.brands).split(',')[0]!.trim().slice(0, 120),
          size: /[0-9\u0660-\u0669]/.test(size) && /[a-z\u0621-\u064a]/i.test(size) ? size.slice(0, 60) : '', has_image: allowedRemoteImage(s(p.image_front_small_url)), source_url: `${base}/product/${code}` });
      }
      return out;
    },
  };
}
