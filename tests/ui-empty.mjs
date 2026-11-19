// CP05 empty catalog — runs against a FRESH, isolated staging-mode server (temp DB, no dev seed). See scripts/ui-empty-run.sh.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url); const { chromium, devices } = require('playwright');
const base = process.argv[2];
let failed = 0; const step = async (n, fn) => { try { await fn(); console.log('PASS', n); } catch (e) { failed++; console.log('FAIL', n, '-', String(e.message).split('\n')[0]); } };
const b = await chromium.launch(); const ctx = await b.newContext({ ...devices['Galaxy S9+'], deviceScaleFactor: 1, locale: 'ar' }); const page = await ctx.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
const login = async (u, p) => { await page.goto(base); await page.evaluate(() => sessionStorage.clear()); await page.goto(base); await page.fill('input[autocomplete=username]', u); await page.fill('input[type=password]', p); await page.click('button[type=submit]'); await page.waitForSelector('nav.nav'); };
const rows = () => page.$$eval('.prow .pr-name', (l) => l.map((x) => x.textContent));
const api = (p) => page.evaluate(async (path) => (await fetch(path, { headers: { authorization: 'Bearer ' + sessionStorage.getItem('mh_token') } })).json(), p);
const openProducts = async () => { await page.evaluate(() => { sessionStorage.removeItem('mh_catalog_filters'); location.hash = '#/home'; }); await page.waitForSelector('.hero'); await page.evaluate(() => (location.hash = '#/products')); await page.waitForSelector('.prow, .emptycat'); };

await login('owner-empty', 'owner-empty-pass-1');
await step('fresh database: zero products via the API', async () => { const r = await api('/api/products?limit=5'); assert.equal(r.total, 0); assert.deepEqual(r.products, []); });
await step('empty-catalog screen: message, "add first product" + "import" (manager), no bars, no counts, no demo cards', async () => {
  await openProducts(); await page.waitForSelector('.emptycat');
  const t = await page.textContent('.emptycat'); assert.match(t, /لا توجد منتجات بعد/); assert.match(t, /ابدأ بإضافة أول منتج إلى قاعدة بيانات ميك أب هاوس، أو استورد قائمة منتجاتك من Excel\./);
  assert.ok(await page.$('.emptycat button:has-text("إضافة أول منتج")')); assert.ok(await page.$('.emptycat button:has-text("استيراد منتجات")'));
  for (const sel of ['.chipbar[aria-label="الفئة"]', '.chipbar[aria-label="نوع المنتج"]', '.searchrow']) assert.equal(await page.isVisible(sel), false, sel + ' hidden');
  assert.equal((await rows()).length, 0); assert.doesNotMatch(await page.textContent('#main'), /\(تجريبي\)|Demo(Brand|Sun|Hair|Care)/, 'no demo products');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  await page.screenshot({ path: process.env.SHOTS ? process.env.SHOTS + '/empty-catalog.png' : '/dev/null' }).catch(() => {});
});
await step('filters and search still work on an empty catalog (no errors, clear message)', async () => {
  const r = await api('/api/products?view=compact&type=cream&missing=image&q=x'); assert.equal(r.total, 0);
  const f = await api('/api/products/facets'); assert.deepEqual(f, { types: {}, categories: {} });
});
await step('"import" opens the import screen; "add first product" opens the entry screen', async () => {
  await page.click('.emptycat button:has-text("استيراد منتجات")'); await page.waitForSelector('input[type=file]');
  await openProducts(); await page.click('.emptycat button:has-text("إضافة أول منتج")'); await page.waitForSelector('.pform.entry');
});
await step('adding ONE real product shows exactly one product', async () => {
  await page.fill('#f-name', 'منتج حقيقي أول'); await page.click('button:has-text("حفظ وإضافة منتج آخر")'); await page.waitForSelector('.savedbar');
  await openProducts(); assert.deepEqual(await rows(), ['منتج حقيقي أول']);
});
// the runner restarts the server on the same DB, then creates GO_FILE
const { existsSync, writeFileSync } = await import('node:fs');
writeFileSync(process.env.READY_FILE, 'ready'); for (let i = 0; i < 240 && !existsSync(process.env.GO_FILE); i++) await new Promise((r) => setTimeout(r, 250));
await step('after a server restart on the same database: still exactly that one product (nothing re-seeded)', async () => {
  await login('owner-empty', 'owner-empty-pass-1'); const r = await api('/api/products?limit=50'); assert.equal(r.total, 1); assert.equal(r.products[0].name, 'منتج حقيقي أول');
});
await step('import adds only the imported rows', async () => {
  await page.evaluate(() => (location.hash = '#/import')); await page.waitForSelector('input[type=file]');
  await page.setInputFiles('input[type=file]', { name: 'shop.csv', mimeType: 'text/csv', buffer: Buffer.from('name,product_type\nمستورد أ,كريم\nمستورد ب,غسول\n') });
  await page.waitForSelector('text=معاينة'); await page.click('button:has-text("اعتماد:")'); await page.waitForSelector('text=تم الاستيراد');
  await openProducts(); assert.deepEqual((await rows()).sort(), ['مستورد أ', 'مستورد ب', 'منتج حقيقي أول'].sort());
});
await step('import endpoint still requires login (permissions unchanged)', async () => {
  const r = await page.evaluate(async () => (await fetch('/api/imports/preview?filename=a.csv', { method: 'POST', headers: { authorization: 'Bearer x' }, body: 'name\na' })).status); assert.equal(r, 401);
});
await step('no page errors', async () => { assert.deepEqual(errors, []); });
await b.close(); console.log(failed ? `${failed} FAILED` : 'ALL PASSED'); process.exit(failed ? 1 : 0);
