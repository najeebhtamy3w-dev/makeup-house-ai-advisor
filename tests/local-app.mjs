// CP06 acceptance — the Android build's web bundle (dist-mobile/) in Chromium, served as STATIC FILES ONLY (no API server).
// Every /api call is answered by the on-device worker over SQLite WASM. Covers: first run, offline work, persistence,
// images, import, advisor, backup -> restore on a fresh install, wrong passphrase / tampered file, permissions, scale.
// This is the same engine as Android System WebView, but it is NOT a device test.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const require = createRequire(import.meta.url); const { chromium, devices } = require('playwright');
const base = process.argv[2] ?? 'http://localhost:8075';
const tmp = mkdtempSync(join(tmpdir(), 'mh-local-'));
let failed = 0; const step = async (n, fn) => { try { await fn(); console.log('PASS', n); } catch (e) { failed++; console.log('FAIL', n, '-', String(e.message).split('\n')[0], (String(e.stack).match(/local-app\.mjs:(\d+)/g) ?? []).join(' ')); } };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKElEQVR42u3NMQEAAAjDMMC/56EBvlRA01vZJvwHAAAAAAAAAAAAAPgcAAG6AAG1wvQVAAAAAElFTkSuQmCC', 'base64');
const b = await chromium.launch();
const external = new Set();
const watch = (ctx) => ctx.on('request', (r) => { const h = new URL(r.url()).hostname; if (h !== 'localhost' && !r.url().startsWith('blob:') && !r.url().startsWith('data:')) external.add(h); });
const newPhone = async () => { const ctx = await b.newContext({ ...devices['Galaxy S9+'], deviceScaleFactor: 1, locale: 'ar', acceptDownloads: true }); watch(ctx); const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message)); return { ctx, p, errs }; };
const login = async (p, u, pw, ctx) => { if (ctx) await ctx.setOffline(false); await p.goto(base); if (ctx) { await p.waitForFunction(() => window.MH_READY); await ctx.setOffline(true); } await p.waitForSelector('input[autocomplete=username]'); await p.fill('input[autocomplete=username]', u); await p.fill('input[type=password]', pw); await p.click('button[type=submit]'); await p.waitForSelector('nav.nav'); };
const api = (p, path, init = {}) => p.evaluate(async ([path, init]) => { const r = await fetch(path, { ...init, headers: { ...(init.headers ?? {}), authorization: 'Bearer ' + sessionStorage.getItem('mh_token'), ...(init.body ? { 'content-type': 'application/json' } : {}) } }); return { status: r.status, json: await r.json().catch(() => null) }; }, [path, init]);
const rows = (p) => p.$$eval('.prow .pr-name', (l) => l.map((x) => x.textContent));
const go = async (p, hash, sel) => { await p.evaluate((h) => { location.hash = '#/home'; location.hash = h; }, hash); if (sel) await p.waitForSelector(sel); };

// ---------------- phone A ----------------
const A = await newPhone(); let backupFile;
await step('first run: setup screen (no account, no demo data), manager created, empty catalog', async () => {
  await A.p.goto(base); await A.p.waitForSelector('#setup-user', { timeout: 60000 });
  await A.p.fill('#setup-user', 'owner'); await A.p.fill('#setup-name', 'المدير'); await A.p.fill('#setup-pass', 'owner-pass-123'); await A.p.fill('#setup-pass2', 'owner-pass-123'); await A.p.click('button[type=submit]');
  await A.p.waitForSelector('.emptycat'); assert.equal((await api(A.p, '/api/products?limit=1')).json.total, 0);
  assert.equal((await api(A.p, '/api/meta')).json.local, true);
  assert.equal((await api(A.p, '/api/local/setup', { method: 'POST', body: JSON.stringify({ username: 'x2', password: 'another-pass-1' }) })).status, 409, 'setup only once');
});
await step('OFFLINE (airplane mode): add a product with barcode, category, form, photo and INCI; rapid entry returns an empty form', async () => {
  await A.ctx.setOffline(true);
  await go(A.p, '#/product-new', '.pform.entry');
  await A.p.fill('#f-barcode', '6291041500213'); await A.p.fill('#f-name', 'كريم محلي أوفلاين'); await A.p.fill('#f-brand', 'DemoBrand');
  await A.p.click('.tchip[data-type=cream]');
  const [fc] = await Promise.all([A.p.waitForEvent('filechooser'), A.p.click('.tile:has-text("الاستوديو")')]); await fc.setFiles({ name: 'p.png', mimeType: 'image/png', buffer: PNG });
  await A.p.waitForSelector('.imgprev'); await A.p.click('.imgprev >> text=حفظ الصورة');
  await A.p.click('details.fold:not([open]) > summary:has-text("محتوى العبوة")'); await A.p.fill('#f-ingredients', 'Aqua, Glycerin, Ceramide NP'); await A.p.fill('#f-size', '50 ml');
  await A.p.click('button:has-text("حفظ وإضافة منتج آخر")'); await A.p.waitForSelector('.savedbar:has-text("كريم محلي أوفلاين")');
  assert.equal(await A.p.inputValue('#f-name'), '');
  await A.p.fill('#f-name', 'غسول محلي'); await A.p.click('.tchip[data-type=cleanser]'); await A.p.click('button:has-text("حفظ وإضافة منتج آخر")'); await A.p.waitForSelector('.savedbar:has-text("غسول محلي")');
});
await step('OFFLINE: catalog, form filter, barcode search, photo shown from local storage, edit stays on the record', async () => {
  await go(A.p, '#/products', '.prow'); assert.deepEqual((await rows(A.p)).sort(), ['غسول محلي', 'كريم محلي أوفلاين'].sort());
  await A.p.click('.chipbar[aria-label="نوع المنتج"] .chip:has-text("كريم")'); await A.p.waitForFunction(() => document.querySelectorAll('.prow').length === 1);
  const r = await api(A.p, '/api/products/by-barcode/6291041500213'); assert.equal(r.json.found, true);
  await A.p.click('.prow'); await A.p.waitForFunction(() => { const i = document.querySelector('.phead .th img'); return i && i.naturalWidth > 0; });
  await A.p.click('details.fold:not([open]) > summary:has-text("محتوى العبوة")').catch(() => {}); await A.p.fill('#f-size', '75 ml'); await A.p.click('button:has-text("حفظ التعديلات")');
  await A.p.waitForFunction(() => document.querySelector('#f-size')?.value === '75 ml'); assert.match(await A.p.evaluate(() => location.hash), /^#\/product\/\d+$/);
});
await step('OFFLINE: scan screen finds the local product; the global source reports "unreachable" without losing anything', async () => {
  await go(A.p, '#/scan', 'input[aria-label="رقم الباركود"]'); await A.p.fill('input[aria-label="رقم الباركود"]', '6291041500213'); await A.p.keyboard.press('Enter');
  await A.p.waitForSelector('text=المنتج مسجّل مسبقًا');
  const id = await api(A.p, '/api/discovery/identify', { method: 'POST', body: JSON.stringify({ barcode: '3337875598996' }) });
  assert.equal(id.status, 200); assert.equal(id.json.global.outcome, 'unreachable');
});
await step('OFFLINE: CSV import into the phone database; advisor and routine run locally', async () => {
  const csv = 'barcode,name,brand,category,product_type\n,سيروم مستورد,B,skincare,سيروم\n,شامبو مستورد,B,hair,شامبو\n';
  await go(A.p, '#/import', 'input[type=file]'); await A.p.setInputFiles('input[type=file]', { name: 'shop.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await A.p.waitForSelector('text=معاينة'); await A.p.click('button:has-text("اعتماد:")'); await A.p.waitForSelector('text=تم الاستيراد');
  assert.equal((await api(A.p, '/api/products?limit=1')).json.total, 4);
  const adv = await api(A.p, '/api/advisor/search', { method: 'POST', body: JSON.stringify({ query: 'كريم للبشرة الجافة' }) });
  assert.equal(adv.status, 200); assert.equal(adv.json.llm, false); assert.ok([...adv.json.store_matches, ...adv.json.cannot_assess].some((x) => x.name === 'كريم محلي أوفلاين'));
  const rt = await api(A.p, '/api/routine?area=hair'); assert.ok(rt.json.am[0].products.some((x) => x.name === 'شامبو مستورد'));
  await go(A.p, '#/advisor', '.composer input'); await A.p.fill('.composer input', 'كريم مرطب'); await A.p.keyboard.press('Enter'); await A.p.waitForFunction(() => document.querySelectorAll('.bub.res').length > 0 && !document.querySelector('.bub.res .skel'));
});
await step('OFFLINE: manager adds a staff account; staff cannot open backup/restore', async () => {
  assert.equal((await api(A.p, '/api/users', { method: 'POST', body: JSON.stringify({ username: 'sara', display_name: 'سارة', role: 'staff', password: 'staff-pass-123' }) })).status, 200);
  // one app window at a time (as on the phone): sign out, sign in as staff on the same page
  await A.p.evaluate(() => sessionStorage.clear()); await login(A.p, 'sara', 'staff-pass-123', A.ctx);
  assert.equal((await api(A.p, '/api/local/backup', { method: 'POST', body: JSON.stringify({ passphrase: 'whatever-123' }) })).status, 403);
  assert.equal((await api(A.p, '/api/local/backup/info')).status, 403);
  assert.equal(await A.p.locator('text=النسخ الاحتياطي').count(), 0, 'no backup entry for staff');
  await A.p.evaluate(() => sessionStorage.clear());
});
await step('app reopened (new window, token gone): data is still on the device', async () => {
  await A.p.close(); const p2 = await A.ctx.newPage(); p2.on('pageerror', (e) => A.errs.push(e.message)); A.p = p2;
  await login(p2, 'owner', 'owner-pass-123', A.ctx); assert.equal((await api(p2, '/api/products?limit=1')).json.total, 4);
  assert.equal((await api(p2, '/api/products?limit=1&missing=image')).json.total, 3, 'exactly one product has a photo');
});
await step('backup: encrypted .mhbak created (passphrase), verified header, no plaintext inside', async () => {
  await A.ctx.setOffline(false);
  await go(A.p, '#/backup', '#backup-pass'); await A.p.fill('#backup-pass', 'backup-secret-1'); await A.p.fill('#backup-pass2', 'backup-secret-1');
  const [dl] = await Promise.all([A.p.waitForEvent('download'), A.p.click('#backup-go')]); await A.p.waitForSelector('#backup-done');
  backupFile = join(tmp, dl.suggestedFilename()); await dl.saveAs(backupFile);
  const buf = readFileSync(backupFile); assert.equal(buf.subarray(0, 7).toString(), 'MHBAK2\n');   // CP06.3: streamed, chunk-authenticated format (MHBAK1 files still restore — tests/local-backup-scale.mjs)
  const header = JSON.parse(buf.subarray(7, buf.indexOf(10, 7)).toString()); assert.deepEqual(header.counts, { products: 4, images: 1, users: 2 });
  assert.equal(buf.includes(Buffer.from('كريم محلي أوفلاين')), false, 'product names are not readable in the file'); assert.equal(buf.includes(Buffer.from('scrypt$')), false, 'no password hashes in clear');
});

// ---------------- phone B: fresh install, restore ----------------
const B = await newPhone();
await step('fresh install: wrong passphrase and tampered file are refused, nothing changes', async () => {
  await B.p.goto(base); await B.p.waitForSelector('#setup-user', { timeout: 60000 }); await B.p.click('text=لديّ نسخة احتياطية'); await B.p.waitForSelector('#restore-file');
  await B.p.setInputFiles('#restore-file', backupFile); await B.p.fill('#restore-pass', 'wrong-pass-999'); await B.p.click('text=التحقق من النسخة');
  await B.p.waitForSelector('.notice.err:has-text("كلمة المرور غير صحيحة")');
  const t = readFileSync(backupFile); t[t.length - 100] ^= 0xff; const tampered = join(tmp, 'tampered.mhbak'); writeFileSync(tampered, t);
  await B.p.setInputFiles('#restore-file', tampered); await B.p.fill('#restore-pass', 'backup-secret-1'); await B.p.click('text=التحقق من النسخة');
  await B.p.waitForSelector('.notice.err');
  assert.equal((await B.p.evaluate(async () => (await (await fetch('/api/meta')).json()).setup_required)), true, 'still a fresh install');
});
await step('fresh install: verify then restore; login with the backup accounts; products, photo, roles restored', async () => {
  await B.p.setInputFiles('#restore-file', backupFile); await B.p.fill('#restore-pass', 'backup-secret-1'); await B.p.click('text=التحقق من النسخة');
  await B.p.waitForSelector('text=النسخة سليمة');
  B.p.once('dialog', (d) => d.accept()); await B.p.click('#restore-go');
  await B.p.waitForSelector('#restore-done, .notice.err', { timeout: 30000 }); const err = await B.p.$('.notice.err'); if (err) throw new Error('restore said: ' + await err.textContent());
  await login(B.p, 'owner', 'owner-pass-123'); assert.equal((await api(B.p, '/api/products?limit=1')).json.total, 4);
  await go(B.p, '#/products', '.prow'); await B.p.click('.prow:has-text("كريم محلي أوفلاين")'); await B.p.waitForFunction(() => { const i = document.querySelector('.phead .th img'); return i && i.naturalWidth > 0; });
  await B.p.evaluate(() => sessionStorage.clear()); await login(B.p, 'sara', 'staff-pass-123'); assert.equal((await api(B.p, '/api/users')).status, 403, 'staff stays staff');
  await B.p.evaluate(() => sessionStorage.clear()); await login(B.p, 'owner', 'owner-pass-123');
});
await step('restore over existing data keeps it when the passphrase is wrong (all-or-nothing)', async () => {
  const before = (await api(B.p, '/api/products?limit=1')).json.total;
  await api(B.p, '/api/products', { method: 'POST', body: JSON.stringify({ name: 'بعد الاستعادة' }) });
  const r = await B.p.evaluate(async (bytes) => { const file = new Uint8Array(bytes); const j = new TextEncoder().encode(JSON.stringify({ passphrase: 'wrong-pass-999' })); const body = new Uint8Array(4 + j.length + file.length); new DataView(body.buffer).setUint32(0, j.length); body.set(j, 4); body.set(file, 4 + j.length);
    const res = await fetch('/api/local/restore', { method: 'POST', headers: { authorization: 'Bearer ' + sessionStorage.getItem('mh_token') }, body }); return res.status; }, [...readFileSync(backupFile)]);
  assert.equal(r, 400); assert.equal((await api(B.p, '/api/products?limit=1')).json.total, before + 1);
});

// ---------------- scale ----------------
const C = await newPhone();
await step('scale on the device engine: 10,000 products imported, paging past 500, search/filter/facets/advisor/routine timings', async () => {
  await C.p.goto(base); await C.p.waitForSelector('#setup-user', { timeout: 60000 }); await C.p.fill('#setup-user', 'owner'); await C.p.fill('#setup-pass', 'owner-pass-123'); await C.p.fill('#setup-pass2', 'owner-pass-123'); await C.p.click('button[type=submit]'); await C.p.waitForSelector('.emptycat');
  const T = ['كريم', 'غسول', 'سيروم', 'زيت', 'شامبو'];
  const gt = (i) => { const s = String(290000000000 + i); const d = s.split('').map(Number); let x = 0; d.reverse().forEach((v, k) => { x += v * (k % 2 === 0 ? 3 : 1); }); return s + ((10 - (x % 10)) % 10); };
  const mk = (from, to) => ['barcode,name,brand,category,product_type,size', ...Array.from({ length: to - from }, (_, k) => { const i = from + k; return `${gt(i)},منتج اختبار ${i},Brand${i % 50},skincare,${T[i % 5]},${50 + (i % 4) * 50} ml`; })].join('\n');
  const measure = (csv) => C.p.evaluate(async (csv) => {
    const tok = sessionStorage.getItem('mh_token'); const t = async (f) => { const s = performance.now(); const r = await f(); return [Math.round(performance.now() - s), r]; };
    const call = async (path, init = {}) => (await fetch(path, { ...init, headers: { ...(init.headers ?? {}), authorization: 'Bearer ' + tok } })).json();
    const [imp, ir] = await t(() => call('/api/imports/commit?filename=big.csv', { method: 'POST', body: new TextEncoder().encode(csv) }));
    const out = { import_ms: imp, added: ir.new };
    [out.list_ms, out.list_total] = await t(async () => (await call('/api/products?view=compact&limit=30')).total);
    const last = out.list_total - 10;
    [out.last_page_ms, out.last_page_rows] = await t(async () => (await call('/api/products?view=compact&limit=30&offset=' + last)).products.length);
    [out.search_ms] = await t(() => call('/api/products?view=compact&limit=30&q=' + encodeURIComponent('اختبار 77')));
    [out.filter_ms] = await t(() => call('/api/products?view=compact&limit=30&type=serum'));
    [out.facets_ms] = await t(() => call('/api/products/facets'));
    [out.advisor_ms] = await t(() => call('/api/advisor/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: 'غسول للبشرة الدهنية' }) }));
    [out.routine_ms] = await t(() => call('/api/routine?area=skin'));
    out.heap_mb = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null;
    return out;
  }, csv);
  let res;
  for (const [from, to] of [[0, 100], [100, 1000], [1000, 10000]]) {
    res = await measure(mk(from, to)); console.log(`   scale ${to}:`, JSON.stringify(res));
    assert.equal(res.added, to - from); assert.equal(res.list_total, to); assert.equal(res.last_page_rows, 10, 'the last products are reachable');
    for (const k of ['list_ms', 'search_ms', 'filter_ms', 'facets_ms']) assert.ok(res[k] < 1500, `${to}: ${k} ${res[k]}`);
  }
  assert.ok(res.advisor_ms < 5000, `advisor ${res.advisor_ms}`);
});
await step('no request ever left the device except optional online lookups (no Render, no hidden server)', async () => {
  const unexpected = [...external].filter((h) => h !== 'world.openbeautyfacts.org' && h !== 'images.openbeautyfacts.org');
  assert.deepEqual(unexpected, []); assert.ok(![...external].some((h) => h.includes('onrender')));
});
await step('no page errors', async () => { assert.deepEqual([...A.errs, ...B.errs, ...C.errs], []); });
await b.close(); console.log(failed ? `${failed} FAILED` : 'ALL PASSED'); process.exit(failed ? 1 : 0);
