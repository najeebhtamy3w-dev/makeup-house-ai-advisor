// Final completion — extra codes in the product card, manager dashboard, bulk classification. Chromium 360 px.
// Run: scripts/ui-final-run.sh. Chromium results are not device evidence.
import { createRequire } from 'node:module'; const require = createRequire('/opt/npm-tools/node_modules/');
const { chromium } = require('playwright');
import assert from 'node:assert/strict';
const base = process.argv[2] ?? 'http://localhost:8098';
const browser = await chromium.launch(); let failed = 0;
const step = async (name, fn) => { try { await fn(); console.log('PASS', name); } catch (e) { failed++; console.log('FAIL', name, '-', e.message.split('\n')[0]); } };
const ctx = await browser.newContext({ viewport: { width: 360, height: 700 }, deviceScaleFactor: 1, locale: 'ar' });
const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
const call = (m, p, body) => page.evaluate(async ([m, p, body]) => { const r = await fetch(p, { method: m, headers: { authorization: 'Bearer ' + sessionStorage.getItem('mh_token'), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json().catch(() => null) }; }, [m, p, body]);
let pid;
await step('setup', async () => {
  await page.goto(base); await page.fill('input[autocomplete=username]', 'admin'); await page.fill('input[type=password]', 'admin-password-1'); await page.click('button[type=submit]'); await page.waitForSelector('nav.nav');
  pid = (await call('POST', '/api/products', { name: 'FINAL غسول', brand: 'F', size: '200 ml', barcode: '6299999000014' })).json.id;
  for (let i = 0; i < 3; i++) await call('POST', '/api/products', { name: `FINAL بلا تصنيف ${i}`, brand: 'F', size: '50 ml' });
});
await step('product card: add an extra GTIN; a wrong check digit is explained; the code finds the product', async () => {
  await page.evaluate((id) => (location.hash = '#/product/' + id), pid); await page.waitForSelector('#codes-section .coderow');
  await page.fill('#code-new', '6299999000015'); await page.click('#code-add'); await page.waitForSelector('#codes-section .notice.err');
  assert.match(await page.textContent('#codes-section .notice.err'), /خانة التحقق/);
  await page.fill('#code-new', '6299999000021'); await page.click('#code-add');
  await page.waitForFunction(() => document.querySelectorAll('#codes-section .coderow').length === 2);
  assert.equal((await call('GET', '/api/products/by-barcode/6299999000021')).json.product.id, pid);
  const w = await page.evaluate(() => document.documentElement.scrollWidth); assert.ok(w <= 360, `no horizontal scroll (${w})`);
});
await step('dashboard: real counts, no financial figure, no horizontal scroll', async () => {
  await page.evaluate(() => (location.hash = '#/dashboard')); await page.waitForSelector('#dashboard .dtile');
  const txt = await page.textContent('#dashboard'); assert.ok(!/سعر|تكلفة|مبيعات|ربح|فاتورة/.test(txt), 'no financial wording');
  const d = (await call('GET', '/api/dashboard')).json; assert.ok(txt.includes(String(d.catalog.products)));
  const w = await page.evaluate(() => document.documentElement.scrollWidth); assert.ok(w <= 360, `no horizontal scroll (${w})`);
});
await step('bulk classify: choose 2 unclassified, apply, they leave the list', async () => {
  await page.evaluate(() => (location.hash = '#/bulk-classify')); await page.waitForSelector('#bulk-list .bulkrow');
  const before = await page.$$eval('#bulk-list .bulkrow', (r) => r.length);
  const boxes = await page.$$('#bulk-list input[type=checkbox]'); await boxes[0].check(); await boxes[1].check();
  await page.selectOption('#bulk-type', 'cleanser'); await page.click('#bulk-apply'); await page.waitForSelector('#bulk-result');
  assert.match(await page.textContent('#bulk-result'), /صُنّف 2/);
  await page.waitForFunction((b) => document.querySelectorAll('#bulk-list .bulkrow').length === b - 2, before);
  assert.deepEqual(errors, []);
});
await browser.close(); console.log(failed ? `${failed} FAILED` : 'ALL PASSED'); process.exit(failed ? 1 : 0);
