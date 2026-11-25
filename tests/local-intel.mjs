// CP09 — the unified scientific advisor running INSIDE the Android web bundle (dist-mobile, SQLite WASM worker, static files
// only — no server). Chromium, Galaxy S9+ profile. This is the phone's engine, NOT a device test.
// Run: scripts/local-intel-run.sh
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const require = createRequire(import.meta.url); const { chromium, devices } = require('playwright');
const base = process.argv[2] ?? 'http://localhost:8077';
const tmp = mkdtempSync(join(tmpdir(), 'mh-lintel-'));
let failed = 0; const step = async (n, fn) => { try { await fn(); console.log('PASS', n); } catch (e) { failed++; console.log('FAIL', n, '-', String(e.message).split('\n')[0]); } };
const b = await chromium.launch();
const external = new Set();
const newPhone = async () => { const ctx = await b.newContext({ ...devices['Galaxy S9+'], deviceScaleFactor: 1, locale: 'ar', acceptDownloads: true }); ctx.on('request', (r) => { const h = new URL(r.url()).hostname; if (h !== 'localhost' && !r.url().startsWith('blob:') && !r.url().startsWith('data:')) external.add(h); }); const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(String(e))); return { ctx, p, errs }; };
const api = (p, path, init = {}) => p.evaluate(async ([path, init]) => { const r = await fetch(path, { ...init, headers: { ...(init.headers ?? {}), authorization: 'Bearer ' + sessionStorage.getItem('mh_token'), ...(init.body ? { 'content-type': 'application/json' } : {}) } }); let j = null; try { j = await r.json(); } catch { /* binary */ } return { status: r.status, json: j }; }, [path, init]);
const login = async (p, u, pw) => { await p.goto(base); await p.waitForSelector('input[autocomplete=username]', { timeout: 60000 }); await p.fill('input[autocomplete=username]', u); await p.fill('input[type=password]', pw); await p.click('button[type=submit]'); await p.waitForSelector('nav.nav'); };
const ask = async (p, q) => { const n = await p.locator('.ibub').count(); await p.fill('.composer input', q); await p.keyboard.press('Enter'); await p.waitForFunction((k) => document.querySelectorAll('.ibub').length > k && !document.querySelector('.ibub [aria-busy]'), n, { timeout: 30000 }); return p.locator('.ibub').last(); };
const moreItems = (p) => p.evaluate(async () => { document.querySelector('nav.nav button:last-child')?.click(); await new Promise((r) => setTimeout(r, 300)); const t = [...document.querySelectorAll('.sheet .item')].map((x) => x.textContent); document.querySelector('.sheet')?.remove(); return t; });

const A = await newPhone();
await step('phone: fresh setup; the scientific advisor is OFF by default and only the manager is offered to switch it on', async () => {
  await A.p.goto(base); await A.p.waitForSelector('#setup-user', { timeout: 60000 });
  await A.p.fill('#setup-user', 'owner'); await A.p.fill('#setup-name', 'المدير'); await A.p.fill('#setup-pass', 'owner-pass-123'); await A.p.fill('#setup-pass2', 'owner-pass-123'); await A.p.click('button[type=submit]'); await A.p.waitForSelector('nav.nav');
  const st = (await api(A.p, '/api/cp08/status')).json; assert.equal(st.enabled, false); assert.equal(st.runtime, 'device');
  await A.p.waitForTimeout(400);
  const items = await moreItems(A.p); assert.ok(items.some((t) => /تفعيل المستشار العلمي/.test(t)), items.join('|'));
  assert.equal((await api(A.p, '/api/users', { method: 'POST', body: JSON.stringify({ username: 'sara', display_name: 'سارة', role: 'staff', password: 'staff-password-1' }) })).status, 200);
});
await step('OFFLINE (airplane mode): manager switches it on; consultation runs on the phone with the right modes', async () => {
  // In the APK every file is inside the app (Capacitor serves it locally), so lazy screens load offline. A desktop browser
  // cannot fetch a not-yet-loaded file in airplane mode, so the lazy module is loaded once while online (= present on the phone).
  await A.p.evaluate(() => import('/js/views-intel.js'));
  await A.ctx.setOffline(true);
  await A.p.evaluate(() => (location.hash = '#/intel-enable')); await A.p.waitForSelector('#intel-enable-go'); await A.p.click('#intel-enable-go');
  await A.p.waitForSelector('#intel-status input#mode-offline', { timeout: 30000 });
  assert.equal(await A.p.locator('#mode-research').isDisabled(), true); assert.equal(await A.p.locator('#mode-cloud').isDisabled(), true);
  assert.match(await A.p.locator('#intel-status').textContent(), /الهاتف/);
  const t = await (await ask(A.p, 'بشرتي جافة وحساسة وأشتي غسول')).textContent();
  assert.match(t, /المطلوب: غسول/); assert.match(t, /كيف تختارين غسول/); assert.match(t, /لم يراجعه مختص مؤهل بعد/);
});
await step('OFFLINE: follow-up pronoun resolves; urgent sign → alert; the next product request keeps the referral and shows no products', async () => {
  await ask(A.p, 'ايش فايدة النياسيناميد');
  const f = await (await ask(A.p, 'طيب لو استخدمته مع الريتينول؟')).textContent(); assert.match(f, /النياسيناميد/); assert.match(f, /الريتينول/);
  const red = await ask(A.p, 'عيوني منفوخة وحمرا من الكحل الجديد'); assert.equal(await red.locator('[role=alert]').count(), 1);
  const after = await (await ask(A.p, 'طيب أشتي غسول')).textContent(); assert.match(after, /تذكير/); assert.doesNotMatch(after, /منتجات المحل/);
});
await step('staff on the phone: can consult, cannot switch the feature or open knowledge review (the worker enforces the role)', async () => {
  // sara's token on THIS phone (the account lives in this phone's database)
  const tok = await A.p.evaluate(async () => { const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'sara', password: 'staff-password-1' }) }); return (await r.json()).token; });
  const call = (m, p, body) => A.p.evaluate(async ([m, p, body, tok]) => (await fetch(p, { method: m, headers: { authorization: 'Bearer ' + tok, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })).status, [m, p, body, tok]);
  assert.equal(await call('POST', '/api/cp08/advisor/chat', { message: 'بشرتي دهنية' }), 200);
  assert.equal(await call('POST', '/api/features/scientific-advisor', { enabled: false }), 403);
  assert.equal(await call('GET', '/api/cp07/knowledge/dashboard'), 403);
  assert.equal(await call('POST', '/api/cp08/settings', { external_search_enabled: true }), 403);
});
await step('manager: knowledge review loads on the phone (74 seeded claims pending, 0 approved)', async () => {
  await A.p.evaluate(() => (location.hash = '#/knowledge')); await A.p.waitForSelector('#k-pending', { timeout: 30000 });
  const d = (await api(A.p, '/api/cp07/knowledge/dashboard')).json;
  assert.equal(d.stats.claims_by_state.pending_review, 74); assert.equal(d.stats.claims_by_state.approved ?? 0, 0);
});
await step('concurrency: requests keep flowing while a research call waits on the network', async () => {
  await A.ctx.setOffline(false);
  // PubMed answers slowly (3 s). Routing covers worker requests in this Chromium; if it does not, the request fails fast and the
  // timing assertion still holds (the point is that other requests are not blocked).
  await A.ctx.route(/eutils\.ncbi\.nlm\.nih\.gov/, async (route) => { await new Promise((r) => setTimeout(r, 3000)); const u = route.request().url(); await route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: u.includes('esearch') ? JSON.stringify({ esearchresult: { idlist: ['1'] } }) : JSON.stringify({ result: { uids: ['1'], 1: { title: 'Tranexamic acid for melasma: a review', source: 'J', pubdate: '2023', pubtype: ['Review'] } } }) }); });
  await api(A.p, '/api/cp08/settings', { method: 'POST', body: JSON.stringify({ external_search_enabled: true }) });
  const res = A.p.evaluate(async () => { const t0 = performance.now(); const r = await fetch('/api/cp08/advisor/chat', { method: 'POST', headers: { authorization: 'Bearer ' + sessionStorage.getItem('mh_token'), 'content-type': 'application/json' }, body: JSON.stringify({ message: 'هل حمض الترانيكساميك ينفع للكلف', mode: 'research' }) }); return { ms: performance.now() - t0, j: await r.json() }; });
  await A.p.waitForTimeout(300);
  const fast = await A.p.evaluate(async () => { const t0 = performance.now(); await fetch('/api/products?limit=5', { headers: { authorization: 'Bearer ' + sessionStorage.getItem('mh_token') } }); return performance.now() - t0; });
  assert.ok(fast < 1500, `other requests are not blocked by research (${Math.round(fast)} ms)`);
  const r = await res;
  console.log(`   research on the phone: status=${r.j.research.status}, total ${Math.round(r.ms)} ms (mock delays PubMed 3 s); concurrent list request ${Math.round(fast)} ms`);
  assert.ok(r.j.research.status === 'ok' && r.ms >= 2900, `the worker's PubMed request was intercepted and slow (${r.j.research.status}, ${Math.round(r.ms)} ms)`);
  if (r.j.research.status === 'ok') assert.ok(r.j.research.items.every((i) => i.connector === 'pubmed'), 'only PubMed on the phone');
  assert.ok(r.j.research.notes_ar.some((n) => /MedlinePlus/.test(n)));
  await A.ctx.unroute(/eutils\.ncbi\.nlm\.nih\.gov/);
});
let bk;
await step('backup on the phone carries the knowledge state and the switch; restore on a fresh phone brings both back', async () => {
  assert.equal((await api(A.p, '/api/local-ai/config', { method: 'POST', body: JSON.stringify({ model_id: 'qwen35-2b-q4km', desired_active: true }) })).status, 200);
  const claim = (await api(A.p, '/api/cp07/knowledge/dashboard')).json.pending_claims[0].id;
  assert.equal((await api(A.p, `/api/cp07/knowledge/claims/${encodeURIComponent(claim)}/transition`, { method: 'POST', body: JSON.stringify({ to: 'approved' }) })).status, 200);
  await A.p.evaluate(() => (location.hash = '#/backup')); await A.p.waitForSelector('#backup-pass');
  await A.p.fill('#backup-pass', 'intel-secret-1'); await A.p.fill('#backup-pass2', 'intel-secret-1');
  // 20 writes fired WHILE the backup runs: the exclusive lock must keep them out of the snapshot (restore re-checks the header counts)
  const writes = A.p.evaluate(async () => { await new Promise((r) => setTimeout(r, 30)); return Promise.all(Array.from({ length: 20 }, (_, i) => fetch('/api/products', { method: 'POST', headers: { authorization: 'Bearer ' + sessionStorage.getItem('mh_token'), 'content-type': 'application/json' }, body: JSON.stringify({ name: 'أثناء النسخ ' + i, brand: 'C', size: '1' }) }).then((r) => r.status))); });
  const [dl] = await Promise.all([A.p.waitForEvent('download'), A.p.click('#backup-go')]); await A.p.waitForSelector('#backup-done');
  assert.deepEqual([...new Set(await writes)], [200], 'every concurrent write succeeded (after or before the snapshot, never inside it)');
  bk = join(tmp, 'intel.mhbak'); await dl.saveAs(bk);
  const B = await newPhone();
  await B.p.goto(base); await B.p.waitForSelector('#setup-user', { timeout: 60000 }); await B.p.click('text=لديّ نسخة احتياطية'); await B.p.waitForSelector('#restore-file');
  await B.p.setInputFiles('#restore-file', bk); await B.p.fill('#restore-pass', 'intel-secret-1'); await B.p.click('text=التحقق من النسخة');
  B.p.once('dialog', (d) => d.accept()); await B.p.waitForSelector('#restore-go'); await B.p.click('#restore-go'); await B.p.waitForSelector('#restore-done', { timeout: 60000 });
  await login(B.p, 'owner', 'owner-pass-123');
  assert.equal((await api(B.p, '/api/cp08/status')).json.enabled, true, 'switch restored');
  assert.deepEqual((await api(B.p, '/api/local-ai/config')).json.metadata, { model_id: 'qwen35-2b-q4km', desired_active: true }, 'model metadata restored without weights or automatic activation');
  const d = (await api(B.p, '/api/cp07/knowledge/dashboard')).json; assert.equal(d.stats.claims_by_state.approved, 1, 'review decision restored');
  const h = (await api(B.p, `/api/cp07/knowledge/claims/${encodeURIComponent(claim)}`)).json; assert.ok(h.history.some((x) => x.action === 'state:approved'), 'review history restored');
  await B.ctx.close();
});
await step('no page errors; nothing contacted except the (mocked) research source', async () => {
  assert.deepEqual(A.errs, [], A.errs.join(' | ').slice(0, 400));
  assert.ok([...external].every((h) => h === 'eutils.ncbi.nlm.nih.gov'), [...external].join(','));
});
await b.close(); console.log(failed ? `${failed} FAILED` : 'ALL PASSED'); process.exit(failed ? 1 : 0);
