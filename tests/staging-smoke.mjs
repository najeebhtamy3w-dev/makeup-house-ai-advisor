// Staging smoke test — runs against a local OR deployed staging URL, emulating a Samsung Galaxy phone (Chromium).
//   node tests/staging-smoke.mjs https://<host>          (public checks only)
//   SMOKE_USER=.. SMOKE_PASS=.. node tests/staging-smoke.mjs https://<host>   (+ logged-in checks)
// Credentials are read from the environment only and never printed. This is NOT a real-device test.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const base = (process.argv[2] ?? 'http://localhost:8098').replace(/\/$/, '');
const user = process.env.SMOKE_USER, pass = process.env.SMOKE_PASS;
let failed = 0;
const step = async (name, fn) => { try { await fn(); console.log('PASS', name); } catch (e) { failed++; console.log('FAIL', name, '-', String(e.message).split('\n')[0]); } };
const get = async (p) => { const r = await fetch(base + p, { signal: AbortSignal.timeout(90_000) }); return { r, text: await r.text() }; };

await step('health endpoint answers (first call may wake a sleeping free instance)', async () => { const { r, text } = await get('/api/health'); assert.equal(r.status, 200); assert.deepEqual(JSON.parse(text), { ok: true }); });
await step('meta: staging=true with a data-loss notice', async () => { const m = JSON.parse((await get('/api/meta')).text); assert.equal(m.staging, true); assert.ok(m.notice?.length > 20); });
await step('data endpoints require login (401) and errors reveal no server details', async () => {
  const { r, text } = await get('/api/products'); assert.equal(r.status, 401); assert.ok(!/stack|at \w+ \(|node:|sqlite|\/app\//i.test(text), text);
  assert.equal((await get('/api/images/1')).r.status, 401, 'product images need login');
  assert.equal((await get('/api/products/1/images')).r.status, 401);
  const nf = await get('/api/does-not-exist'); assert.equal(nf.r.status, 404); assert.ok(!/stack|node:|sqlite/i.test(nf.text));
  assert.equal(r.headers.get('x-powered-by'), null);
});
await step('noindex everywhere + robots.txt disallow', async () => {
  for (const p of ['/', '/api/meta', '/device-test.html']) assert.match((await get(p)).r.headers.get('x-robots-tag') ?? '', /noindex/, p);
  assert.match((await get('/robots.txt')).text, /Disallow: \//);
});
if (base.startsWith('https://')) await step('HTTPS: secure transport + security headers on the app shell', async () => {
  const { r } = await get('/'); assert.equal(r.status, 200); assert.match(r.headers.get('content-security-policy') ?? '', /default-src 'self'/); assert.equal(r.headers.get('x-frame-options'), 'DENY');
});

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['Galaxy S9+'], locale: 'ar' });
const page = await ctx.newPage(); const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/401|Failed to load resource/.test(m.text())) errors.push(m.text()); });

await step('Samsung (emulated): login screen is RTL, shows the staging banner and the device-test link', async () => {
  await page.goto(base, { timeout: 90_000 }); await page.waitForSelector('.login');
  assert.equal(await page.getAttribute('html', 'dir'), 'rtl');
  assert.match(await page.textContent('.staging-banner'), /تجريبية/);
  assert.ok(await page.$('a[href="/device-test.html"]'));
  const sw = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1); assert.ok(sw, 'no horizontal overflow');
});
await step('wrong password is rejected', async () => {
  await page.fill('input[autocomplete=username]', 'nobody-smoke'); await page.fill('input[type=password]', 'wrong-password-xyz'); await page.click('button[type=submit]');
  await page.waitForSelector('.notice.err');
});
await step('device-test page loads and reports the environment (no login, sends nothing)', async () => {
  const p = await ctx.newPage(); await p.goto(base + '/device-test.html'); await p.waitForSelector('#env b');
  assert.match(await p.textContent('#env'), /BarcodeDetector/); await p.click('#rep'); const rep = JSON.parse(await p.inputValue('#rep-out')); assert.equal(typeof rep.secure_context, 'boolean'); await p.close();
});

if (user && pass) {
  await step('login works and the banner stays visible inside the app', async () => {
    await page.fill('input[autocomplete=username]', user); await page.fill('input[type=password]', pass); await page.click('button[type=submit]');
    await page.waitForSelector('nav.nav'); assert.match(await page.textContent('#main .staging-banner'), /تجريبية/);
  });
  await step('front-end <-> back-end: products list loads with fake demo items', async () => {
    await page.evaluate(() => { location.hash = '#/products'; }); await page.waitForFunction(() => document.querySelectorAll('#main .card h4').length > 0, null, { timeout: 15000 });
    assert.match(await page.textContent('#main'), /تجريبي/);
  });
  await step('advisor answers with an explained recommendation', async () => {
    await page.evaluate(() => { location.hash = '#/advisor'; }); await page.waitForSelector('#main textarea, #main input');
    const box = (await page.$('#main textarea')) ?? (await page.$('#main input')); await box.fill('مرطب للبشرة الجافة بدون عطر'); await box.press('Enter');
    await page.waitForFunction(() => /الملاءمة|مناسب|لا يمكن/.test(document.querySelector('#main').textContent), null, { timeout: 15000 });
  });
  await step('trial feedback: a note is saved on the phone and contains no token/username', async () => {
    await page.evaluate(() => { location.hash = '#/feedback'; }); await page.waitForSelector('#feedback-form');
    await page.fill('#feedback-form textarea >> nth=1', 'اختبار دخان آلي'); await page.click('#feedback-form button[type=submit]');
    const notes = await page.evaluate(() => JSON.parse(localStorage.getItem('mh_feedback_v1') || '[]')); assert.equal(notes.length >= 1, true);
    const tok = await page.evaluate(() => sessionStorage.getItem('mh_token')); const raw = JSON.stringify(notes);
    assert.ok(!raw.includes(tok), 'no token in notes'); assert.ok(!raw.includes(user), 'no username in notes');
    await page.evaluate(() => localStorage.removeItem('mh_feedback_v1'));
  });
} else console.log('SKIP logged-in checks (set SMOKE_USER / SMOKE_PASS to run them)');

await step('no unexpected page/console errors', async () => { assert.deepEqual(errors, []); });
await browser.close();
console.log(failed ? `${failed} FAILED` : 'ALL PASSED'); process.exitCode = failed ? 1 : 0;
