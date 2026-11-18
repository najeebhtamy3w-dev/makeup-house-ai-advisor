/**
 * Five-real-products pilot runner. Input = a CSV filled by staff FROM THE ACTUAL PACKS (template: docs/pilot/five_products_template.csv).
 * It never invents barcodes/products. For each row it checks the local catalog, asks the enrichment engine (global lookup), compares
 * the found data against what is printed on the pack, and writes pilot-report.json/.md with Found/Exact/Partial/Conflict, ingredients
 * available/missing, source verified/unverified, approval state and error details.
 *   MH_URL=http://localhost:8080 MH_USER=admin MH_PASS=... npm run pilot -- my_products.csv
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { parseCSV } from '../server/src/csv.ts';
import { gtinValid, normalizeBarcode } from '../server/src/gtin.ts';
import { compareField } from '../server/src/enrichment/identity.ts';

const file = process.argv[2]; const url = process.env.MH_URL ?? 'http://localhost:8080';
if (!file || !process.env.MH_USER || !process.env.MH_PASS) { console.error('usage: MH_URL=... MH_USER=... MH_PASS=... npm run pilot -- products.csv'); process.exit(2); }
const rows = parseCSV(readFileSync(file, 'utf8').replace(/^﻿/, '')).filter((r) => r.some((c) => c.trim()));
const head = rows.shift()!.map((h) => h.trim().toLowerCase()); const idx = (k: string) => head.indexOf(k);
const api = async (path: string, init?: RequestInit & { token?: string }) => { const r = await fetch(url + path, { ...init, headers: { 'content-type': 'application/json', ...(init?.token ? { authorization: 'Bearer ' + init.token } : {}) } }); return { status: r.status, body: (await r.json().catch(() => ({}))) as any }; };

const login = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: process.env.MH_USER, password: process.env.MH_PASS }) });
if (!login.body.token) { console.error('login failed', login.status); process.exit(1); }
const token = login.body.token as string;
const out: any[] = []; const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
for (const [n, r] of rows.entries()) {
  const g = (k: string) => (idx(k) >= 0 ? (r[idx(k)] ?? '').trim() : '');
  const barcode = normalizeBarcode(g('barcode')); const res: any = { barcode, pack: { name: g('name'), brand: g('brand'), size: g('size'), variant: g('variant'), market: g('market_country'), photo: g('packaging_photo_file') } };
  if (!gtinValid(barcode)) { res.error = 'invalid_barcode'; out.push(res); continue; }
  if (n) await wait(6000);
  try {
    const loc = await api('/api/products/by-barcode/' + barcode, { token }); res.local_found = !!loc.body.found;
    const lk = await api('/api/enrichment/lookup', { method: 'POST', token, body: JSON.stringify({ barcode }) });
    res.http = lk.status; res.outcome = lk.body.outcome; res.mode = lk.body.mode; res.global_found = lk.body.outcome === 'found';
    const cands: any[] = lk.body.candidates ?? []; res.candidates = cands.length; res.mock = cands.some((c) => c.is_mock);
    const by = (f: string) => cands.find((c) => c.field === f)?.value as string | undefined;
    res.identity = {} as any;
    for (const f of ['name', 'brand', 'size'] as const) { const cv = by(f); const pv = g(f); res.identity[f] = !cv ? 'missing' : !pv ? 'no_pack_value' : compareField(f, pv, cv)!.match; }
    const ing = by('ingredients'); res.ingredients = ing ? 'available' : 'missing';
    res.ingredients_vs_pack = ing && g('inci_from_pack') ? compareField('ingredients', g('inci_from_pack'), ing)!.match : 'not_comparable';
    res.source_verified = cands.length ? (cands.every((c) => c.is_mock) ? 'mock_data_not_a_source' : 'source_recorded_unreviewed') : 'none';
    res.approval = 'needs_review'; // approval is the manager's explicit action in the review screen — never automatic
    const idv = Object.values(res.identity) as string[];
    res.identity_overall = !res.global_found ? 'not_found' : idv.includes('conflict') ? 'conflict' : idv.every((v) => v === 'exact') ? 'exact' : 'partial';
    res.formulation = res.mock ? 'MOCK DATA — not a real result' : res.identity_overall === 'exact' && res.ingredients_vs_pack === 'exact' ? 'matches_pack (manager must still approve)' : 'FORMULATION NOT VERIFIED';
  } catch (e) { res.error = String((e as Error).message); }
  out.push(res); console.log(barcode, res.outcome ?? res.error, res.identity_overall ?? '');
}
writeFileSync('pilot-report.json', JSON.stringify({ generated: new Date().toISOString(), server: url, results: out }, null, 2));
const md = ['# Pilot report', '', '| barcode | found | identity | ingredients | vs pack | source | approval | formulation |', '|---|---|---|---|---|---|---|---|', ...out.map((o) => `| ${o.barcode} | ${o.global_found ?? o.error} | ${o.identity_overall ?? '-'} | ${o.ingredients ?? '-'} | ${o.ingredients_vs_pack ?? '-'} | ${o.source_verified ?? '-'} | ${o.approval ?? '-'} | ${o.formulation ?? '-'} |`)];
writeFileSync('pilot-report.md', md.join('\n')); console.log('wrote pilot-report.json / pilot-report.md');
