// CP06.3 — Android hardware Back semantics + unsaved-edit draft recovery, in Chromium at 360 / 390 px.
// The native listener (mobile/src/client.ts, @capacitor/app 'backButton') calls window.MH_onBack(); this test calls the SAME
// function. It proves the web-side decisions; the native event itself is a device check (NOT VERIFIED here).
// Run: scripts/ui-android-back-run.sh
import { createRequire } from 'node:module'; const require = createRequire('/opt/npm-tools/node_modules/');
const { chromium } = require('playwright');
import assert from 'node:assert/strict';
const base = process.argv[2] ?? 'http://localhost:8099';
const browser = await chromium.launch(); let failed = 0;
const step = async (name, fn) => { try { await fn(); console.log('PASS', name); } catch (e) { failed++; console.log('FAIL', name, '-', e.message.split('\n')[0]); } };

for (const width of [360, 390]) {
  const ctx = await browser.newContext({ viewport: { width, height: 720 }, deviceScaleFactor: 1, locale: 'ar' });
  let page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  const patches = []; const track = (p) => p.on('request', (r) => { if (r.method() === 'PATCH' && r.url().includes('/api/products/')) patches.push(r.url()); }); track(page);
  const login = async (p) => { await p.goto(base); await p.fill('input[autocomplete=username]', 'admin'); await p.fill('input[type=password]', 'admin-password-1'); await p.click('button[type=submit]'); await p.waitForSelector('nav.nav'); };
  const back = (p = page) => p.evaluate(() => window.MH_onBack());
  const hash = (p = page) => p.evaluate(() => location.hash);
  // wait until the previous product form is really gone (the list renders asynchronously after leaving), then open
  const open = async (p, id) => { await p.evaluate(() => (location.hash = '#/products')); await p.waitForFunction(() => !document.querySelector('#f-name') && document.querySelector('nav.nav')); await p.evaluate((i) => (location.hash = '#/product/' + i), id); await p.waitForSelector('#f-name'); };
  let id; const NAME = `BACK${width} أصلي`;

  await step(`[${width}] Back with no edits leaves the product screen to its list, without a dialog; Back on home = minimise`, async () => {
    await login(page);
    id = await page.evaluate(async (n) => { const r = await fetch('/api/products', { method: 'POST', headers: { authorization: 'Bearer ' + sessionStorage.getItem('mh_token'), 'content-type': 'application/json' }, body: JSON.stringify({ name: n, brand: 'B', size: '50 ml' }) }); return (await r.json()).id; }, NAME);
    await open(page, id);
    assert.equal(await back(), 'handled'); await page.waitForFunction(() => location.hash === '#/products');
    assert.equal(await page.locator('#leave-dialog').count(), 0);
    await page.evaluate(() => (location.hash = '#/advisor')); await page.waitForSelector('nav.nav');
    assert.equal(await back(), 'handled'); await page.waitForFunction(() => location.hash === '#/home');
    assert.equal(await back(), 'exit', 'home: the app is minimised, not killed');
  });
  await step(`[${width}] Back with unsaved edits asks; a second Back closes the dialog and keeps the edit; discard leaves without saving`, async () => {
    await open(page, id); await page.fill('#f-name', `${NAME} معدل`);
    await back(); await page.waitForSelector('#leave-dialog');
    assert.equal(await back(), 'handled'); await page.waitForSelector('#leave-dialog', { state: 'detached' });
    assert.match(await hash(), /#\/product\//); assert.equal(await page.inputValue('#f-name'), `${NAME} معدل`, 'edit kept');
    await back(); await page.waitForSelector('#leave-dialog'); await page.click('#leave-discard');
    await page.waitForFunction(() => location.hash === '#/products');
    await open(page, id); assert.equal(await page.inputValue('#f-name'), NAME, 'nothing saved');
    assert.equal(await page.locator('#edit-draft-banner').count(), 0, 'discard also drops the draft');
  });
  await step(`[${width}] app killed in the background: the edit is OFFERED back on the next open (not saved), then saved once`, async () => {
    await page.fill('#f-name', `${NAME} من مسودة`); await page.fill('#f-size', '75 ml');
    await page.evaluate(() => document.dispatchEvent(new Event('mh:pause')));   // what client.ts sends on Android 'pause'
    const n0 = patches.length;
    await page.close({ runBeforeUnload: false });                              // the process dies: no save, no prompt
    assert.equal(patches.length, n0, 'nothing was saved by going to the background');
    page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(String(e))); track(page);
    await login(page); await open(page, id);
    assert.equal(await page.inputValue('#f-name'), NAME, 'the database still holds the saved value');
    await page.waitForSelector('#edit-draft-banner');
    await page.click('#edit-draft-restore');
    assert.equal(await page.inputValue('#f-name'), `${NAME} من مسودة`); assert.equal(await page.inputValue('#f-size'), '75 ml');
    await back(); await page.waitForSelector('#leave-dialog');                 // restored = unsaved: the guard protects it
    const n1 = patches.length; await page.click('#leave-save');
    await page.waitForFunction(() => location.hash === '#/products');
    assert.equal(patches.length - n1, 1, 'exactly one save');
    await open(page, id); assert.equal(await page.inputValue('#f-name'), `${NAME} من مسودة`);
    assert.equal(await page.locator('#edit-draft-banner').count(), 0, 'saved: draft cleared');
  });
  await step(`[${width}] double tap on save sends one request; no page errors`, async () => {
    await page.fill('#f-size', '100 ml'); const n = patches.length;
    await page.locator('.savebar button').first().dblclick(); await page.waitForTimeout(800);
    assert.equal(patches.length - n, 1, 'one PATCH for a double tap');
    assert.deepEqual(errors, []);
  });
  await ctx.close();
}
await browser.close(); console.log(failed ? `${failed} FAILED` : 'ALL PASSED'); process.exit(failed ? 1 : 0);
