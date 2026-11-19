// CP06.2 Phase 1 — product edit navigation & data safety, in Chromium at phone widths (360 and 390 px).
// Run with a fresh seeded server:  scripts/ui-nav-run.sh
import { createRequire } from 'node:module'; const require = createRequire('/opt/npm-tools/node_modules/');
const { chromium } = require('playwright');
import assert from 'node:assert/strict';
const base = process.argv[2] ?? 'http://localhost:8098';
const browser = await chromium.launch();
let failed = 0;
const step = async (name, fn) => { try { await fn(); console.log('PASS', name); } catch (e) { failed++; console.log('FAIL', name, '-', e.message.split('\n')[0]); } };

for (const width of [360, 390]) {
  const ctx = await browser.newContext({ viewport: { width, height: 700 }, deviceScaleFactor: 1, locale: 'ar' });
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const patches = []; page.on('request', (r) => { if (r.method() === 'PATCH' && r.url().includes('/api/products/')) patches.push(r.url()); });
  const tok = () => page.evaluate(() => sessionStorage.getItem('mh_token'));
  const api = async (method, path, body) => page.evaluate(async ([m, p, b, t]) => { const r = await fetch(p, { method: m, headers: { authorization: 'Bearer ' + t, ...(b ? { 'content-type': 'application/json' } : {}) }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, json: await r.json().catch(() => null) }; }, [method, path, body, await tok()]);
  const hash = () => page.evaluate(() => location.hash);
  const P = `NAV${width}`;
  let ids = [];

  await step(`[${width}] setup: manager login, 60 products, list filtered by search`, async () => {
    await page.goto(base); await page.fill('input[autocomplete=username]', 'admin'); await page.fill('input[type=password]', 'admin-password-1'); await page.click('button[type=submit]');
    await page.waitForSelector('nav.nav');
    for (let i = 0; i < 60; i++) { const r = await api('POST', '/api/products', { name: `${P} منتج ${String(i).padStart(2, '0')}`, brand: 'NavBrand', size: '50 ml' }); assert.equal(r.status, 200); ids.push(r.json.id); }
    await page.evaluate(() => (location.hash = '#/products')); await page.waitForSelector('.prow');
    // the seeded catalog has more than 60 rows; "عرض 30 من 60" proves the (debounced) search has been applied
    await page.fill('input[type=search]', P); await page.waitForFunction(() => /عرض 30 من 60(?!\d)/.test(document.querySelector('main').textContent));
  });

  await step(`[${width}] edit screen: visible back button in the header, bottom bar kept (CP05.3) but never covering the save buttons, no overflow`, async () => {
    await page.click('button:has-text("عرض المزيد")'); await page.waitForFunction(() => document.querySelectorAll('.prow').length === 60);
    const target = page.locator('.prow').nth(44); await target.scrollIntoViewIfNeeded(); await page.waitForTimeout(150);
    const name = (await target.locator('.pr-name').textContent()).trim();
    await target.click(); await page.waitForSelector('#f-name'); assert.equal(await page.inputValue('#f-name'), name);
    assert.ok(await page.isVisible('#back-btn'), 'back button visible'); assert.match(await page.textContent('#back-btn'), /منتجات/);
    assert.equal(await page.locator('nav.nav').count(), 1, 'the product card keeps the bottom bar (approved CP05.3 behaviour)');
    assert.equal(await page.locator('.savebar #delete-product').count(), 0, 'delete is not next to save');
    assert.equal(await page.locator('.dangerzone #delete-product').count(), 1, 'manager sees delete in its own section');
    const o = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); assert.ok(o <= 1, 'horizontal overflow ' + o);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await page.waitForTimeout(150);
    const gap = await page.evaluate(() => document.querySelector('nav.nav').getBoundingClientRect().top - document.querySelector('.savebar').getBoundingClientRect().bottom);
    assert.ok(gap >= 0, 'save buttons are above the fixed bottom bar (gap ' + gap + ')');
  });

  await step(`[${width}] back without changes: returns to the list with the same search, the same rows (incl. "show more") and scroll position`, async () => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.click('#back-btn'); await page.waitForSelector('.prow');
    assert.equal(await hash(), '#/products'); assert.equal(await page.inputValue('input[type=search]'), P);
    await page.waitForFunction(() => document.querySelectorAll('.prow').length === 60); await page.waitForTimeout(300);
    const visible = await page.evaluate(() => { const r = document.querySelectorAll('.prow')[44].getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; });
    assert.ok(visible, 'the row the person opened is on screen again');
  });

  await step(`[${width}] unsaved edit + back button -> 3-choice dialog; "keep editing" keeps the value and the screen`, async () => {
    await page.locator('.prow').nth(44).click(); await page.waitForSelector('#f-name');
    await page.fill('#f-brand', 'معدّل غير محفوظ');
    await page.click('#back-btn'); await page.waitForSelector('#leave-dialog');
    assert.equal(await page.locator('#leave-dialog button').count(), 3);
    const o = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); assert.ok(o <= 1, 'dialog overflow ' + o);
    await page.click('#leave-stay'); await page.waitForSelector('#leave-dialog', { state: 'detached' });
    assert.match(await hash(), /^#\/product\/\d+$/); assert.equal(await page.inputValue('#f-brand'), 'معدّل غير محفوظ');
  });

  await step(`[${width}] browser Back with unsaved edits is intercepted too; Esc keeps editing`, async () => {
    const before = await hash();
    await page.goBack(); await page.waitForSelector('#leave-dialog');
    assert.equal(await hash(), before, 'address bar stays on the product while asking');
    await page.keyboard.press('Escape'); await page.waitForSelector('#leave-dialog', { state: 'detached' });
    assert.equal(await page.inputValue('#f-brand'), 'معدّل غير محفوظ');
  });

  await step(`[${width}] leaving by the bottom bar with unsaved edits asks first`, async () => {
    await page.click('nav.nav button:nth-child(2)'); await page.waitForSelector('#leave-dialog'); await page.click('#leave-stay');
    assert.match(await hash(), /^#\/product\/\d+$/); assert.equal(await page.inputValue('#f-brand'), 'معدّل غير محفوظ');
  });

  await step(`[${width}] "إلغاء" uses the same dialog; "leave without saving" leaves and the server value is unchanged`, async () => {
    const id = Number((await hash()).split('/')[2]);
    await page.click('#cancel-edit'); await page.waitForSelector('#leave-dialog'); await page.click('#leave-discard');
    await page.waitForSelector('.prow'); assert.equal(await hash(), '#/products');
    assert.equal((await api('GET', '/api/products/' + id)).json.product.brand, 'NavBrand');
  });

  await step(`[${width}] "save and leave" saves once and returns to the list`, async () => {
    const id = ids[10]; patches.length = 0;
    await page.evaluate((i) => (location.hash = '#/product/' + i), id); await page.waitForSelector('#f-name');
    await page.fill('#f-size', '75 ml'); await page.click('#back-btn'); await page.click('#leave-save');
    await page.waitForSelector('.prow'); assert.equal(await hash(), '#/products');
    assert.equal((await api('GET', '/api/products/' + id)).json.product.size, '75 ml'); assert.equal(patches.length, 1);
  });

  await step(`[${width}] "save and leave" with an invalid field stays on the screen and shows the error`, async () => {
    await page.evaluate((i) => (location.hash = '#/product/' + i), ids[11]); await page.waitForSelector('#f-name');
    await page.fill('#f-name', ''); await page.click('#back-btn'); await page.click('#leave-save');
    await page.waitForSelector('.field.bad'); assert.match(await hash(), /^#\/product\/\d+$/);
    assert.match((await api('GET', '/api/products/' + ids[11])).json.product.name, new RegExp(P));
  });

  await step(`[${width}] no double save: two quick taps on save + Enter send ONE request`, async () => {
    await page.fill('#f-name', `${P} منتج 11`); patches.length = 0;
    await page.fill('#f-size', '100 ml');
    await page.evaluate(() => { const b = document.querySelector('.savebar button[type=submit]'); b.click(); b.click(); document.querySelector('#f-size').form.requestSubmit(); });
    await page.waitForFunction(() => !document.querySelector('.savebar button[disabled]')); await page.waitForTimeout(400);
    assert.equal(patches.length, 1, 'PATCH requests: ' + patches.length);
    assert.equal((await api('GET', '/api/products/' + ids[11])).json.product.size, '100 ml');
    assert.match(await hash(), /^#\/product\/\d+$/, 'a normal save stays on the record');
  });

  await step(`[${width}] tap save then back immediately: no prompt, the save completes, then it leaves`, async () => {
    await page.fill('#f-size', '125 ml'); patches.length = 0;
    await page.evaluate(() => { document.querySelector('.savebar button[type=submit]').click(); document.querySelector('#back-btn').click(); });
    await page.waitForSelector('.prow'); assert.equal(await page.locator('#leave-dialog').count(), 0);
    assert.equal((await api('GET', '/api/products/' + ids[11])).json.product.size, '125 ml'); assert.equal(patches.length, 1);
    await page.evaluate((i) => (location.hash = '#/product/' + i), ids[11]); await page.waitForSelector('#f-name');
  });

  await step(`[${width}] after saving, back leaves without a prompt`, async () => {
    await page.click('#back-btn'); await page.waitForSelector('.prow'); assert.equal(await page.locator('#leave-dialog').count(), 0);
  });

  await step(`[${width}] back returns to where the product was opened from (scan screen), not always the list`, async () => {
    await page.evaluate(() => (location.hash = '#/scan')); await page.waitForSelector('input[aria-label="رقم الباركود"]');
    await page.evaluate((i) => (location.hash = '#/product/' + i), ids[3]); await page.waitForSelector('#f-name');
    assert.match(await page.textContent('#back-btn'), /رجوع/); await page.click('#back-btn');
    await page.waitForSelector('input[aria-label="رقم الباركود"]'); assert.equal(await hash(), '#/scan');
  });

  await step(`[${width}] new product entry is unchanged: leaving keeps the draft (no prompt) and it is restored`, async () => {
    await page.evaluate(() => { sessionStorage.removeItem('mh_new_product_draft'); location.hash = '#/product-new'; }); await page.waitForSelector('.pform.entry');
    await page.fill('#f-name', 'مسودة التنقل'); await page.click('#back-btn'); await page.waitForTimeout(200);
    assert.equal(await page.locator('#leave-dialog').count(), 0);
    await page.evaluate(() => (location.hash = '#/product-new')); await page.waitForSelector('.pform.entry');
    assert.equal(await page.inputValue('#f-name'), 'مسودة التنقل'); await page.evaluate(() => sessionStorage.removeItem('mh_new_product_draft'));
  });

  await step(`[${width}] someone else saved the product meanwhile: my save is refused, nothing is overwritten, I can reopen the latest copy`, async () => {
    const id = ids[20];
    await page.evaluate((i) => (location.hash = '#/product/' + i), id); await page.waitForSelector('#f-name');
    const v = (await api('GET', '/api/products/' + id)).json.product.version;
    assert.equal((await api('PATCH', '/api/products/' + id, { brand: 'تعديل زميل', version: v })).status, 200);
    await page.fill('#f-size', '30 ml'); await page.click('button:has-text("حفظ التعديلات")');
    await page.waitForSelector('#reload-product'); assert.match(await page.textContent('.notice.err'), /عدّل شخص آخر/);
    const p = (await api('GET', '/api/products/' + id)).json.product; assert.equal(p.brand, 'تعديل زميل'); assert.notEqual(p.size, '30 ml');
    await page.click('#reload-product'); await page.waitForFunction(() => document.querySelector('#f-brand')?.value === 'تعديل زميل');
  });

  await step(`[${width}] reload / close with unsaved edits triggers the browser's leave prompt`, async () => {
    await page.evaluate((i) => (location.hash = '#/product/' + i), ids[5]); await page.waitForSelector('#f-name');
    await page.fill('#f-brand', 'سيُفقد');
    const kind = new Promise((r) => page.once('dialog', async (d) => { r(d.type()); await d.dismiss(); }));
    await page.close({ runBeforeUnload: true }); assert.equal(await kind, 'beforeunload');
  });

  await step(`[${width}] staff: no delete section; no page errors`, async () => {
    const p2 = await ctx.newPage(); p2.on('pageerror', (e) => errors.push(String(e)));
    await p2.goto(base); await p2.evaluate(() => sessionStorage.clear()); await p2.goto(base);
    await p2.fill('input[autocomplete=username]', 'sara'); await p2.fill('input[type=password]', 'staff-password-1'); await p2.click('button[type=submit]'); await p2.waitForSelector('nav.nav');
    await p2.evaluate((i) => (location.hash = '#/product/' + i), ids[7]); await p2.waitForSelector('#f-name');
    assert.equal(await p2.locator('#delete-product').count(), 0);
    assert.deepEqual(errors, []); await p2.close();
  });
  await ctx.close();
}
await browser.close();
console.log(failed ? `${failed} FAILED` : 'ALL PASSED'); process.exit(failed ? 1 : 0);
