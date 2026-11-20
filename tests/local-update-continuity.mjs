// Update continuity at the DATA layer: the previous bundle (CP09 baseline) creates data on the "phone"; the new bundle then
// opens the SAME on-device storage (same origin, same browser profile = what an APK update over the same app does to the
// WebView's OPFS). Proves: data survives, migrations apply, the new features work on the old data.
// It does NOT prove the Android package update itself (signature match, versionCode) — that needs a device. Not a device test.
// Usage: node tests/local-update-continuity.mjs <old dist dir> <new dist dir>
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const require = createRequire(import.meta.url); const { chromium } = require('playwright');
const [oldDir, newDir] = process.argv.slice(2); const PORT = 8079, base = `http://localhost:${PORT}`;
const profile = mkdtempSync(join(tmpdir(), 'mh-update-'));
let failed = 0; const step = async (n, fn) => { try { await fn(); console.log('PASS', n); } catch (e) { failed++; console.log('FAIL', n, '-', String(e.message).split('\n')[0]); } };
const serve = async (dir) => { const p = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: dir, stdio: 'ignore' }); for (let i = 0; i < 40; i++) { try { await fetch(base + '/index.html'); break; } catch { await new Promise((r) => setTimeout(r, 250)); } } return p; };
const open = async () => { const ctx = await chromium.launchPersistentContext(profile, { viewport: { width: 412, height: 860 }, locale: 'ar' }); const p = ctx.pages()[0] ?? await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message)); return { ctx, p, errs }; };
const api = (p, path, init = {}) => p.evaluate(async ([path, init]) => { const r = await fetch(path, { ...init, headers: { authorization: 'Bearer ' + sessionStorage.getItem('mh_token'), ...(init.body ? { 'content-type': 'application/json' } : {}) } }); return { status: r.status, json: await r.json().catch(() => null) }; }, [path, init]);
const J = (m, b) => ({ method: m, body: JSON.stringify(b) });
const login = async (p) => { await p.goto(base); await p.waitForSelector('input[autocomplete=username]', { timeout: 60000 }); await p.fill('input[autocomplete=username]', 'owner'); await p.fill('input[type=password]', 'owner-pass-123'); await p.click('button[type=submit]'); await p.waitForSelector('nav.nav'); };
const result = {};

let srv = await serve(oldDir); let A = await open();
await step('previous version: first run, products, a staff account, the scientific-advisor switch on', async () => {
  await A.p.goto(base); await A.p.waitForSelector('#setup-user', { timeout: 60000 });
  await A.p.fill('#setup-user', 'owner'); await A.p.fill('#setup-name', 'المدير'); await A.p.fill('#setup-pass', 'owner-pass-123'); await A.p.fill('#setup-pass2', 'owner-pass-123'); await A.p.click('button[type=submit]'); await A.p.waitForSelector('.emptycat');
  result.old_version = (await api(A.p, '/api/meta')).json.version;
  for (let i = 0; i < 25; i++) assert.equal((await api(A.p, '/api/products', J('POST', { name: `قبل التحديث ${i}`, brand: 'B', size: '50 ml', barcode: i === 0 ? '6299999000014' : undefined, ingredients: 'aqua, glycerin' }))).status, 200);
  assert.equal((await api(A.p, '/api/users', J('POST', { username: 'staff1', display_name: 'موظفة', password: 'staff-pass-123', role: 'staff' }))).status, 200);
  assert.equal((await api(A.p, '/api/features/scientific-advisor', J('POST', { enabled: true }))).status, 200);
  await api(A.p, '/api/products/1/availability', J('POST', { status: 'yes' }));
  assert.deepEqual(A.errs, []);
});
await A.ctx.close(); srv.kill();

srv = await serve(newDir); A = await open();
await step('new version on the same storage: same data, the account still logs in, settings kept', async () => {
  await login(A.p);
  result.new_version = (await api(A.p, '/api/meta')).json.version; assert.notEqual(result.new_version, result.old_version);
  const list = (await api(A.p, '/api/products?limit=100')).json; assert.equal(list.total, 25);
  assert.ok(list.products.some((p) => p.barcode === '6299999000014'));
  assert.equal((await api(A.p, '/api/products/1')).json.ingredients ?? (await api(A.p, '/api/products/1')).json.product?.ingredients, 'aqua, glycerin');
  assert.equal((await api(A.p, '/api/cp08/status')).json.enabled, true, 'feature switch survives');
  const users = (await api(A.p, '/api/users')).json; assert.ok(JSON.stringify(users).includes('staff1'));
});
await step('new features work on the old data (extra code, dashboard)', async () => {
  assert.equal((await api(A.p, '/api/products/2/codes', J('POST', { code: '6299999000021', kind: 'gtin' }))).status, 200);
  assert.equal((await api(A.p, '/api/products/by-barcode/6299999000021')).json.product.id, 2);
  const d = (await api(A.p, '/api/dashboard')).json; assert.equal(d.catalog.products, 25); assert.equal(d.users.staff, 1);
  assert.deepEqual(A.errs, []);
});
await A.ctx.close(); srv.kill();
writeFileSync(join(process.cwd(), 'docs/final/update-continuity-last-run.json'), JSON.stringify({ ...result, at: new Date().toISOString(), note: 'Chromium persistent profile, same origin; data-layer continuity only, not an APK update on a device' }, null, 1));
console.log(failed ? `${failed} FAILED` : 'ALL PASSED'); process.exit(failed ? 1 : 0);
