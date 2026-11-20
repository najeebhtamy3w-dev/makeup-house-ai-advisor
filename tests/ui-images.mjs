// CP06.3 — list thumbnails: only ?size=thumb is requested by lists, only for rows near the screen, and missing thumbnails
// are generated once in the browser from the original (which stays unchanged). Chromium 360 px. Run: scripts/ui-images-run.sh
import { createRequire } from 'node:module'; const require = createRequire('/opt/npm-tools/node_modules/');
const { chromium } = require('playwright');
import assert from 'node:assert/strict';
const base = process.argv[2] ?? 'http://localhost:8097';
const browser = await chromium.launch(); let failed = 0;
const step = async (name, fn) => { try { await fn(); console.log('PASS', name); } catch (e) { failed++; console.log('FAIL', name, '-', e.message.split('\n')[0]); } };
const ctx = await browser.newContext({ viewport: { width: 360, height: 700 }, deviceScaleFactor: 1, locale: 'ar' });
const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
const imgReq = []; page.on('request', (r) => { const u = r.url(); if (/\/api\/images\/\d+/.test(u) && r.method() === 'GET') imgReq.push(u); });
const thumbPuts = []; page.on('request', (r) => { if (r.method() === 'PUT' && /\/thumb$/.test(r.url())) thumbPuts.push(r.url()); });
const call = (m, p, body, raw) => page.evaluate(async ([m, p, body, raw]) => { const r = await fetch(p, { method: m, headers: { authorization: 'Bearer ' + sessionStorage.getItem('mh_token'), ...(body ? { 'content-type': raw ? 'image/webp' : 'application/json' } : {}) }, body: raw ? new Uint8Array(body) : body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json().catch(() => null) }; }, [m, p, body, raw]);
await step('setup: 40 products with a large-ish original photo each (no thumbnails yet)', async () => {
  await page.goto(base); await page.fill('input[autocomplete=username]', 'admin'); await page.fill('input[type=password]', 'admin-password-1'); await page.click('button[type=submit]'); await page.waitForSelector('nav.nav');
  const bytes = await page.evaluate(async () => { const c = new OffscreenCanvas(900, 900); const g = c.getContext('2d'); const d = g.createImageData(900, 900); for (let i = 0; i < d.data.length; i++) d.data[i] = i % 4 === 3 ? 255 : (Math.random() * 255) | 0; g.putImageData(d, 0, 0); return [...new Uint8Array(await (await c.convertToBlob({ type: 'image/webp', quality: 0.7 })).arrayBuffer())]; });
  for (let i = 0; i < 40; i++) { const p = await call('POST', '/api/products', { name: `IMG صورة ${String(i).padStart(2, '0')}`, brand: 'Img', size: '50 ml' }); const up = await page.evaluate(async ([id, b]) => (await fetch(`/api/products/${id}/images?kind=front`, { method: 'POST', headers: { authorization: 'Bearer ' + sessionStorage.getItem('mh_token'), 'content-type': 'image/webp' }, body: new Uint8Array(b) })).status, [p.json.id, bytes]); assert.equal(up, 200); }
  const r = await call('GET', '/api/images-report'); assert.equal(r.json.missing_thumbs, 40);
});
await step('list: only thumbnails, only for rows near the screen; missing ones are generated once and are small', async () => {
  imgReq.length = 0;
  await page.evaluate(() => (location.hash = '#/products')); await page.waitForSelector('.prow');
  await page.fill('input[type=search]', 'IMG'); await page.waitForFunction(() => document.querySelectorAll('.prow').length >= 20);
  await page.waitForTimeout(1500);
  assert.ok(imgReq.length > 0, 'some thumbnails loaded'); assert.ok(imgReq.every((u) => u.includes('size=thumb')), 'lists never ask for the original');
  const firstWave = new Set(imgReq).size; assert.ok(firstWave < 20, `lazy: only visible rows (${firstWave})`);
  await page.waitForTimeout(1500);
  const r = await call('GET', '/api/images-report'); assert.ok(r.json.thumbs.n >= firstWave - 1 && r.json.thumbs.n <= firstWave + 2, `thumbs made for shown rows only (${r.json.thumbs.n} vs ${firstWave})`);
  assert.ok(r.json.thumbs.bytes / Math.max(1, r.json.thumbs.n) < 60 * 1024, 'each thumbnail is small');
  assert.ok(r.json.images.bytes > 40 * 30 * 1024, 'originals untouched');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await page.waitForTimeout(1500);
  assert.ok(new Set(imgReq).size > firstWave, 'scrolling loads the next rows');
  assert.deepEqual(errors, []);
});
await browser.close(); console.log(failed ? `${failed} FAILED` : 'ALL PASSED'); process.exit(failed ? 1 : 0);
