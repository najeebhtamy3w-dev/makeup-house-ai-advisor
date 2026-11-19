/**
 * Audit tool (CP05 final audit): large-catalog behaviour on a THROW-AWAY database in the temp directory.
 * Never touches staging or production data.   Usage: node --import tsx scripts/perf-audit.ts [products=10000]
 */
import { mkdtempSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
import { loadConfig } from '../server/src/config.ts';
import { openDb } from '../server/src/db.ts';
import { buildServer, seedAdmin } from '../server/src/server.ts';

const N = Number(process.argv[2] ?? 10000);
const dir = mkdtempSync(join(tmpdir(), 'mh-perf-')); const path = join(dir, 'perf.db');
const db = openDb(path); seedAdmin(db, 'perf-admin', 'perf-admin-pass-1');
const cfg = loadConfig({ MH_SECRET: 'p'.repeat(40), MH_DB_PATH: path, MH_WEB_DIR: './web' } as NodeJS.ProcessEnv);
const server = buildServer(db, cfg); await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const call = async (m: string, p: string, body?: unknown, raw?: Buffer, tok?: string) => {
  const t0 = performance.now();
  const res = await fetch(base + p, { method: m, headers: { ...(tok ? { authorization: 'Bearer ' + tok } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: raw ? new Uint8Array(raw) : body ? JSON.stringify(body) : undefined });
  const txt = await res.text(); return { ms: Math.round(performance.now() - t0), status: res.status, bytes: txt.length, json: (() => { try { return JSON.parse(txt); } catch { return null; } })() };
};
const tok = (await call('POST', '/api/auth/login', { username: 'perf-admin', password: 'perf-admin-pass-1' })).json.token as string;
const INCI = ['Aqua', 'Glycerin', 'Cetearyl Alcohol', 'Caprylic/Capric Triglyceride', 'Dimethicone', 'Ceramide NP', 'Ceramide AP', 'Niacinamide', 'Sodium Hyaluronate', 'Phenoxyethanol', 'Ethylhexylglycerin', 'Carbomer', 'Tocopherol', 'Butyrospermum Parkii Butter', 'Panthenol', 'Allantoin', 'Parfum', 'Linalool', 'Limonene', 'Citric Acid', 'Sodium Hydroxide', 'Xanthan Gum', 'Disodium EDTA', 'Squalane', 'Cholesterol', 'Behentrimonium Methosulfate', 'Cetyl Alcohol', 'Glyceryl Stearate', 'PEG-100 Stearate', 'Benzyl Alcohol'];
const TYPES = ['كريم', 'غسول', 'سيروم', 'زيت', 'شامبو', 'بلسم', 'لوشن', 'تونر', 'ماسك', 'واقي شمس'];
const gtin = (i: number) => { const b = String(290000000000 + i); const d = b.split('').map(Number); let s = 0; d.reverse().forEach((x, k) => { s += x * (k % 2 === 0 ? 3 : 1); }); return b + ((10 - (s % 10)) % 10); };
const out: Record<string, unknown> = { products: N };

// 1) bulk import (the real import path), in files of <= 10,000 rows
const lines = ['barcode,name,brand,category,product_type,size'];
for (let i = 0; i < N; i++) lines.push(`${gtin(i)},منتج اختبار ${i},Brand${i % 50},skincare,${TYPES[i % TYPES.length]},${50 + (i % 5) * 50} ml`);
const imp = await call('POST', '/api/imports/commit?filename=perf.csv', undefined, Buffer.from(lines.join('\n')), tok);
out.import = { status: imp.status, ms: imp.ms, added: imp.json?.new };
// realistic INCI on every product (20-30 ingredients) — directly, to measure the ADVISOR, not the import
const upd = db.prepare('UPDATE products SET ingredients = ?, verification = ? WHERE id = ?');
db.exec('BEGIN'); for (let i = 1; i <= N; i++) upd.run(INCI.slice(0, 20 + (i % 11)).join(', '), i % 3 ? 'partial' : 'review', i + 0); db.exec('COMMIT');

// 2) catalog screens
out.list_compact_30 = await call('GET', '/api/products?view=compact&limit=30', undefined, undefined, tok).then((r) => ({ ms: r.ms, kb: Math.round(r.bytes / 1024), total: r.json.total }));
out.list_full_500 = await call('GET', '/api/products?limit=500', undefined, undefined, tok).then((r) => ({ ms: r.ms, kb: Math.round(r.bytes / 1024) }));
out.search_name = await call('GET', '/api/products?view=compact&limit=30&q=' + encodeURIComponent('اختبار 77'), undefined, undefined, tok).then((r) => ({ ms: r.ms, total: r.json.total }));
out.filter_type = await call('GET', '/api/products?view=compact&limit=30&type=serum&missing=image', undefined, undefined, tok).then((r) => ({ ms: r.ms, total: r.json.total }));
out.facets = await call('GET', '/api/products/facets', undefined, undefined, tok).then((r) => ({ ms: r.ms }));
// 3) advisor (loads and evaluates every product on each question)
const adv = [];
for (const q of ['مرطب للبشرة الجافة بدون عطر', 'غسول للبشرة الدهنية', 'سيروم للبشرة الحساسة']) adv.push((await call('POST', '/api/advisor/search', { query: q }, undefined, tok)).ms);
out.advisor_ms = adv;
// 4) images inside SQLite: size growth per typical phone photo (~250 KB after compression)
const img = Buffer.alloc(250 * 1024, 7); img.set([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xc0, 0, 17, 8, 4, 0, 3, 0, 3, 1, 34, 0, 2, 17, 1, 3, 17, 1]);
const before = statSync(path).size; const K = 200;
for (let i = 1; i <= K; i++) await call('POST', `/api/products/${i}/images?kind=front&origin=upload`, undefined, img, tok);
db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
const per = (statSync(path).size - before) / K;
out.images = { uploaded: K, db_growth_per_image_kb: Math.round(per / 1024), projected_gb_one_photo_each: +(per * N / 1024 ** 3).toFixed(2) };
out.db_size_mb = Math.round(statSync(path).size / 1024 / 1024);
console.log(JSON.stringify(out, null, 2));
server.close(); (server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.(); db.close(); rmSync(dir, { recursive: true, force: true });
