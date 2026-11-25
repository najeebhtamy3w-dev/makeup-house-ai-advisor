// CP06.3 — backup / restore at scale and under attack, on the Android web bundle (dist-mobile) in Chromium, SQLite WASM + OPFS.
// NOT a device test: memory here is the desktop Chromium worker; Samsung numbers must be measured on the phone.
// Run: scripts/local-backup-scale-run.sh   (env: SCALE_IMAGES=1000 STRESS_IMAGES=2500)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync } from 'node:fs';
import { seal } from '../mobile/src/backup.ts';
import { hashPassword } from '../server/src/security.ts';
const require = createRequire(import.meta.url); const { chromium, devices } = require('playwright');
const base = process.argv[2] ?? 'http://localhost:8076';
const tmp = mkdtempSync(join(tmpdir(), 'mh-bscale-'));
const N_IMG = Number(process.env.SCALE_IMAGES ?? 1000), N_STRESS = Number(process.env.STRESS_IMAGES ?? 2500);
let failed = 0; const step = async (n, fn) => { const t0 = Date.now(); try { await fn(); console.log('PASS', n, `(${((Date.now() - t0) / 1000).toFixed(1)} s)`); } catch (e) { failed++; console.log('FAIL', n, '-', String(e.message).split('\n')[0]); } };
const results = {};
const b = await chromium.launch();
const newPhone = async () => { const ctx = await b.newContext({ ...devices['Galaxy S9+'], deviceScaleFactor: 1, locale: 'ar', acceptDownloads: true }); const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(String(e))); return { ctx, p, errs }; };
const api = (p, path, init = {}) => p.evaluate(async ([path, init]) => { const r = await fetch(path, { ...init, headers: { ...(init.headers ?? {}), authorization: 'Bearer ' + sessionStorage.getItem('mh_token'), ...(init.body ? { 'content-type': 'application/json' } : {}) } }); let j = null; try { j = await r.json(); } catch { /* binary */ } return { status: r.status, json: j }; }, [path, init]);
const setup = async (p) => {
  await p.goto(base); await p.waitForSelector('#setup-user', { timeout: 60000 });
  await p.fill('#setup-user', 'owner'); await p.fill('#setup-name', 'المدير'); await p.fill('#setup-pass', 'owner-pass-123'); await p.fill('#setup-pass2', 'owner-pass-123'); await p.click('button[type=submit]');
  await p.waitForSelector('nav.nav');
};
/** n products, each with its own noise WebP (~50–90 KB, all different so nothing compresses away) */
const fill = (p, n, withImages, prefix) => p.evaluate(async ([n, withImages, prefix]) => {
  const tok = sessionStorage.getItem('mh_token'); let imgBytes = 0;
  const cv = new OffscreenCanvas(256, 256); const g = cv.getContext('2d'); const id = g.createImageData(256, 256);
  for (let i = 0; i < n; i++) {
    const r = await fetch('/api/products', { method: 'POST', headers: { authorization: 'Bearer ' + tok, 'content-type': 'application/json' }, body: JSON.stringify({ name: `${prefix} منتج ${i}`, brand: 'Scale', size: '50 ml', ingredients: 'aqua, glycerin' }) });
    const pid = (await r.json()).id;
    if (withImages) {
      for (let k = 0; k < id.data.length; k++) id.data[k] = (k % 4 === 3) ? 255 : (Math.random() * 255) | 0;
      g.putImageData(id, 0, 0); const blob = await cv.convertToBlob({ type: 'image/webp', quality: 0.8 }); imgBytes += blob.size;
      const up = await fetch(`/api/products/${pid}/images?kind=front`, { method: 'POST', headers: { authorization: 'Bearer ' + tok, 'content-type': blob.type }, body: await blob.arrayBuffer() });
      if (!up.ok) throw new Error('image upload ' + up.status + ' ' + await up.text());
    }
  }
  return imgBytes;
}, [n, withImages, prefix]);
const backupNow = async (P, name) => {
  await api(P.p, '/api/local/backup/mem/reset', { method: 'POST' });
  const t0 = Date.now();
  await P.p.evaluate(() => (location.hash = '#/backup')); await P.p.waitForSelector('#backup-pass');
  await P.p.fill('#backup-pass', 'scale-secret-1'); await P.p.fill('#backup-pass2', 'scale-secret-1');
  const [dl] = await Promise.all([P.p.waitForEvent('download', { timeout: 600000 }), P.p.click('#backup-go')]); await P.p.waitForSelector('#backup-done', { timeout: 600000 });
  const file = join(tmp, name); await dl.saveAs(file);
  const mem = (await api(P.p, '/api/local/backup/mem')).json;
  return { file, ms: Date.now() - t0, size: statSync(file).size, mem };
};
const restoreUi = async (P, file, pass, dry) => P.p.evaluate(async ([pass, dry]) => {
  const f = document.querySelector('#restore-file').files[0];
  try { return { ok: true, r: await window.MHNative.restore(f, pass, dry, sessionStorage.getItem('mh_token')) }; } catch (e) { return { ok: false, error: e.message }; }
}, [pass, dry]);
const openRestore = async (P, file) => { await P.p.evaluate(() => (location.hash = '#/backup')); await P.p.waitForSelector('#restore-file'); await P.p.setInputFiles('#restore-file', file); };

// ------------------------------------------------------------------ scales ------------------------------------------------------------------
for (const [label, n, imgs] of [['100 products', 100, false], [`${N_IMG} products with images`, N_IMG, true], [`stress: ${N_STRESS} products with images`, N_STRESS, true]]) {
  if (!n) continue;
  const A = await newPhone(); const B = await newPhone(); let bk, imgBytes = 0;
  await step(`[${label}] build catalogue on phone A`, async () => { await setup(A.p); imgBytes = await fill(A.p, n, imgs, label.slice(0, 4)); });
  await step(`[${label}] streamed encrypted backup; worker never holds more than ~one frame`, async () => {
    const before = (await api(A.p, '/api/local/backup/mem')).json;
    bk = await backupNow(A, `${n}.mhbak`);
    assert.equal(readFileSync(bk.file).subarray(0, 7).toString(), 'MHBAK2\n');
    assert.ok(bk.mem.peakChunkBytes <= 2 * 1024 * 1024 + 4096, `peak ${bk.mem.peakChunkBytes}`);
    results[label] = { products: n, image_bytes: imgBytes, db_bytes: before.db_bytes, backup_bytes: bk.size, backup_ms: bk.ms, frames: bk.mem.frames, peak_buffer_bytes_backup: bk.mem.peakChunkBytes, wasm_heap_before: before.wasm_heap_bytes, wasm_heap_after_backup: bk.mem.wasm_heap_bytes };
    assert.ok(bk.mem.wasm_heap_bytes - before.wasm_heap_bytes < 8 * 1024 * 1024, 'WASM heap did not grow by the database size');
  });
  await step(`[${label}] fresh phone B: dry verify, then restore; counts, a product and its image are intact`, async () => {
    await B.p.goto(base); await B.p.waitForSelector('#setup-user', { timeout: 60000 }); await B.p.click('text=لديّ نسخة احتياطية'); await B.p.waitForSelector('#restore-file');
    await B.p.setInputFiles('#restore-file', bk.file);
    const t0 = Date.now(); const dry = await restoreUi(B, bk.file, 'scale-secret-1', true); assert.ok(dry.ok, dry.error);
    const real = await restoreUi(B, bk.file, 'scale-secret-1', false); assert.ok(real.ok, real.error);
    results[label].restore_ms = Date.now() - t0; results[label].peak_buffer_bytes_restore = real.r.mem.peak_buffer_bytes;
    assert.ok(real.r.mem.peak_buffer_bytes > 0 && real.r.mem.peak_buffer_bytes <= 2 * 1024 * 1024 + 4096, `restore peak ${real.r.mem.peak_buffer_bytes}`);
    await B.p.goto(base); await B.p.waitForSelector('input[autocomplete=username]'); await B.p.fill('input[autocomplete=username]', 'owner'); await B.p.fill('input[type=password]', 'owner-pass-123'); await B.p.click('button[type=submit]'); await B.p.waitForSelector('nav.nav');
    const info = (await api(B.p, '/api/local/backup/info')).json;
    assert.equal(info.counts.products, n); assert.equal(info.counts.images, imgs ? n : 0);
    const mem = (await api(B.p, '/api/local/backup/mem')).json;
    results[label].wasm_heap_after_restore_and_reopen = mem.wasm_heap_bytes; results[label].active_slot_after = mem.active_slot;
    if (imgs) { const list = (await api(B.p, '/api/products?limit=1')).json.products[0]; const img = await B.p.evaluate(async (id) => (await fetch(`/api/images/${id}`, { headers: { authorization: 'Bearer ' + sessionStorage.getItem('mh_token') } })).status, list.primary_image_id); assert.equal(img, 200); }
  });
  if (n === 100) {
    // ------------------------------------------- attacks on the small file: the current data must survive every one -------------------------------------------
    await step('attacks: wrong passphrase, truncated, frames swapped, header edited, extra bytes — all refused; existing data untouched', async () => {
      const f = readFileSync(bk.file); const nl = f.indexOf(10, 7) + 1;
      const frames = []; let o = nl; while (o < f.length) { const len = f.readUInt32BE(o); frames.push(f.subarray(o, o + 4 + len)); o += 4 + len; }
      assert.ok(frames.length >= 2);
      const variants = {
        truncated: Buffer.concat([f.subarray(0, nl), ...frames.slice(0, -1)]),
        swapped: frames.length >= 3 ? Buffer.concat([f.subarray(0, nl), frames[1], frames[0], ...frames.slice(2)]) : Buffer.concat([f.subarray(0, nl), frames[1], frames[0]]),
        header_edited: Buffer.from(f.toString('latin1').replace('"products":100', '"products":101'), 'latin1'),
        extra_bytes: Buffer.concat([f, Buffer.from([0, 0, 0, 20]), Buffer.alloc(20)]),
        bitflip: (() => { const t = Buffer.from(f); t[nl + 50] ^= 1; return t; })(),
      };
      const before = (await api(B.p, '/api/local/backup/info')).json;
      await openRestore(B, bk.file);
      const pw = await restoreUi(B, bk.file, 'not-the-pass-1', true); assert.equal(pw.ok, false); assert.match(pw.error, /كلمة المرور/);
      for (const [k, buf] of Object.entries(variants)) {
        const path = join(tmp, `${k}.mhbak`); writeFileSync(path, buf); await openRestore(B, path);
        const r = await restoreUi(B, path, 'scale-secret-1', false);
        assert.equal(r.ok, false, `${k} must be refused`);
        const now = (await api(B.p, '/api/local/backup/info')).json; assert.deepEqual(now.counts, before.counts, `${k}: data unchanged`);
      }
    });
    // ------------------------------------------- an MHBAK1 file from CP06 / CP06.2 still restores -------------------------------------------
    await step('legacy: an MHBAK1 backup (CP06.2 schema 001–007) restores into the slot layout and migrates to the current schema', async () => {
      const dbPath = join(tmp, `legacy-${n}-${imgs}.db`); const d = new DatabaseSync(dbPath);
      for (const m of readdirSync('server/migrations').filter((x) => x.endsWith('.sql') && x < '008').sort()) d.exec(readFileSync(join('server/migrations', m), 'utf8'));
      d.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
      for (const m of readdirSync('server/migrations').filter((x) => x.endsWith('.sql') && x < '008').sort()) d.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(m, 'x');
      d.prepare("INSERT INTO users(username, display_name, role, password_hash, created_at) VALUES ('legacy', 'قديم', 'manager', ?, 'x')").run(hashPassword('legacy-pass-123'));
      d.prepare("INSERT INTO products(name, created_at, updated_at) VALUES ('منتج من نسخة قديمة', 'x', 'x')").run(); d.close();
      const file = await seal(new Uint8Array(readFileSync(dbPath)), 'legacy-secret-1', { app: '3.0.0-cp06.2-local', schema: readdirSync('server/migrations').filter((x) => x.endsWith('.sql') && x < '008').sort(), counts: { products: 1, images: 0, users: 1 } });
      const path = join(tmp, 'legacy.mhbak'); writeFileSync(path, file); assert.equal(Buffer.from(file).subarray(0, 7).toString(), 'MHBAK1\n');
      await openRestore(B, path);
      const r = await restoreUi(B, path, 'legacy-secret-1', false); assert.ok(r.ok, r.error);
      await B.p.goto(base); await B.p.waitForSelector('input[autocomplete=username]'); await B.p.fill('input[autocomplete=username]', 'legacy'); await B.p.fill('input[type=password]', 'legacy-pass-123'); await B.p.click('button[type=submit]'); await B.p.waitForSelector('nav.nav');
      const info = (await api(B.p, '/api/local/backup/info')).json;
      assert.equal(info.counts.products, 1); assert.ok(info.schema.includes('008_cp07_knowledge.sql'), 'the old database was migrated to the current schema after restore');
    });
  }
  await step(`[${label}] no page errors`, async () => { assert.deepEqual([...A.errs, ...B.errs], []); });
  await A.ctx.close(); await B.ctx.close();
}
writeFileSync(join(process.cwd(), `docs/cp06-3/backup-scale-last-run-${N_IMG}-${N_STRESS}.json`), JSON.stringify({ at: new Date().toISOString(), environment: 'Chromium (Playwright) on a 4-core x64 cloud VM — NOT a phone', results }, null, 1));
console.log(JSON.stringify(results, null, 1));
await b.close(); console.log(failed ? `${failed} FAILED` : 'ALL PASSED'); process.exit(failed ? 1 : 0);
