// Final completion — the new routes inside the Android web bundle (dist-mobile/, on-device worker, SQLite WASM), offline.
// Same engine as Android System WebView, but NOT a device test. Run: scripts/local-final-run.sh
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url); const { chromium, devices } = require('playwright');
const base = process.argv[2] ?? 'http://localhost:8076';
let failed = 0; const step = async (n, fn) => { try { await fn(); console.log('PASS', n); } catch (e) { failed++; console.log('FAIL', n, '-', String(e.message).split('\n')[0]); } };
const b = await chromium.launch();
const ctx = await b.newContext({ ...devices['Galaxy S9+'], deviceScaleFactor: 1, locale: 'ar' });
const external = new Set(); ctx.on('request', (r) => { const h = new URL(r.url()).hostname; if (h !== 'localhost' && !/^(blob|data):/.test(r.url())) external.add(h); });
const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const api = (path, init = {}) => p.evaluate(async ([path, init]) => { const r = await fetch(path, { ...init, headers: { authorization: 'Bearer ' + sessionStorage.getItem('mh_token'), ...(init.body ? { 'content-type': 'application/json' } : {}) } }); return { status: r.status, json: await r.json().catch(() => null) }; }, [path, init]);
const J = (m, body) => ({ method: m, body: JSON.stringify(body) });

await step('first run on the phone, then offline', async () => {
  await p.goto(base); await p.waitForSelector('#setup-user', { timeout: 60000 });
  await p.fill('#setup-user', 'owner'); await p.fill('#setup-name', 'المدير'); await p.fill('#setup-pass', 'owner-pass-123'); await p.fill('#setup-pass2', 'owner-pass-123'); await p.click('button[type=submit]');
  await p.waitForSelector('.emptycat'); await ctx.setOffline(true);
});
await step('extra codes offline: add, 409 on another product, lookup by the extra code', async () => {
  const a = (await api('/api/products', J('POST', { name: 'غسول', brand: 'B', size: '200 ml', barcode: '6299999000014' }))).json.id;
  const c = (await api('/api/products', J('POST', { name: 'غسول كبير', brand: 'B', size: '400 ml' }))).json.id;
  assert.equal((await api(`/api/products/${a}/codes`, J('POST', { code: '6299999000021', kind: 'gtin' }))).status, 200);
  assert.equal((await api(`/api/products/${c}/codes`, J('POST', { code: '6299999000021', kind: 'gtin' }))).status, 409);
  assert.equal((await api('/api/products/by-barcode/6299999000021')).json.product.id, a);
});
await step('bulk classify + dashboard offline', async () => {
  const list = (await api('/api/products?view=compact&type=none')).json.products;
  const r = await api('/api/products/bulk-classify', J('POST', { items: list.map((x) => ({ id: x.id, version: x.version })), product_type: 'cleanser' }));
  assert.equal(r.status, 200); assert.equal(r.json.updated, list.length);
  const d = (await api('/api/dashboard')).json; assert.equal(d.catalog.products, 2); assert.equal(d.completeness.additional_codes, 1); assert.equal(d.completeness.unclassified, 0);
  await p.evaluate(() => (location.hash = '#/dashboard')); await p.waitForSelector('#dashboard .dtile');
});
await step('no page errors, nothing contacted outside the phone', async () => { assert.deepEqual(errs, []); assert.deepEqual([...external], []); });
await b.close(); console.log(failed ? `${failed} FAILED` : 'ALL PASSED'); process.exit(failed ? 1 : 0);
