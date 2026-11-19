/**
 * Live Open Beauty Facts check — run on a machine WITH internet. Produces a JSON report; never invents data.
 *   npm run live:obf -- [--contact you@example.com] 6291041500213 3600523000000 ...
 * Pass REAL barcodes of products you hold (no defaults are invented). Rate: 1 request / 5 s (OBF limit = 15/min/IP).
 * Options: --base <url> (default https://world.openbeautyfacts.org) --out report.json
 */
import { writeFileSync } from 'node:fs';
import { openBeautyFacts } from '../server/src/enrichment/openbeautyfacts.ts';
import { gtinValid as isValidGtin } from '../server/src/gtin.ts';

const a = process.argv.slice(2); const opt = (k: string, d: string) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1]! : d; };
const base = opt('--base', 'https://world.openbeautyfacts.org'); const contact = opt('--contact', '');
const out = opt('--out', `obf-live-report-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
const skip = new Set(['--base', '--contact', '--out']); const codes: string[] = [];
for (let i = 0; i < a.length; i++) { if (skip.has(a[i]!)) { i++; continue; } codes.push(a[i]!); }
if (!codes.length) { console.error('usage: npm run live:obf -- [--contact you@example.com] <barcode> [<barcode> ...]'); process.exit(2); }
if (!contact.includes('@')) console.warn('note: no --contact given; User-Agent will say contact-not-set (OBF asks apps to identify themselves).');
const ua = `MakeupHouseAdvisor/3.0 (${contact || 'contact-not-set'})`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const report: any = { tool: 'obf-live-check', started: new Date().toISOString(), node: process.version, base, results: [], summary: {} };
for (const [i, code] of codes.entries()) {
  if (i) await sleep(5000);
  const r: any = { barcode: code, gtin_valid: isValidGtin(code) };
  const url = `${base}/api/v3/product/${encodeURIComponent(code)}?product_type=beauty&fields=code,product_name,brands,quantity,ingredients_text,image_front_url`;
  r.endpoint = url; const t0 = Date.now();
  try {
    const res = await fetch(url, { headers: { 'user-agent': ua, accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
    r.http_status = res.status; r.content_type = res.headers.get('content-type'); r.ms = Date.now() - t0;
    const txt = await res.text(); r.bytes = txt.length;
    try { const j = JSON.parse(txt); r.top_level_keys = Object.keys(j); r.api_status = j.status; r.product_keys = j.product ? Object.keys(j.product) : null; r.returned_code = j.product?.code ?? null; r.barcode_match = j.product?.code !== undefined ? String(j.product.code).replace(/^0+/, '') === code.replace(/^0+/, '') : null; r.ingredients_present = !!j.product?.ingredients_text; }
    catch { r.json_error = true; r.body_head = txt.slice(0, 200); }
  } catch (e) { r.ms = Date.now() - t0; r.error = String((e as Error).message); }
  try { const c = openBeautyFacts({ contact: contact || 'contact-not-set', baseUrl: base }); const x = await c.lookupBarcode(code); r.connector = x.found ? { found: true, fields: Object.keys(x.fields) } : { found: false }; }
  catch (e) { r.connector = { error: (e as Error).constructor.name + ':' + (e as Error).message }; }
  report.results.push(r); console.log(code, r.http_status ?? 'ERR', r.api_status ?? '', r.connector?.found ? 'FOUND' : (r.connector?.error ?? 'not-found'));
}
const ok = report.results.filter((x: any) => x.http_status === 200 || x.http_status === 404);
report.summary = { total: codes.length, reachable: ok.length, found: report.results.filter((x: any) => x.connector?.found).length, errors: report.results.filter((x: any) => x.error).length,
  verdict: ok.length ? 'LIVE_REACHED — review shape fields above before marking VERIFIED' : 'UNREACHABLE — integration remains BLOCKED/unverified' };
report.finished = new Date().toISOString(); writeFileSync(out, JSON.stringify(report, null, 2)); console.log('report ->', out, '|', report.summary.verdict);
