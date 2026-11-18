import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { boot, EAN, EAN2 } from './helpers.ts';
import { gtinValid, normalizeBarcode } from '../server/src/gtin.ts';
import { advise } from '../server/src/advisor.ts';
import { parseCSV } from '../server/src/csv.ts';
import { parseImport } from '../server/src/importer.ts';
import { hashPassword, verifyPassword, signToken, verifyToken } from '../server/src/security.ts';
import { openDb, migrate } from '../server/src/db.ts';

let t: Awaited<ReturnType<typeof boot>>;
before(async () => { t = await boot(); });
after(async () => { await t.close(); });

// ---------------- UNIT ----------------
test('unit: GTIN check digit, length, Arabic-Indic digits', () => {
  assert.ok(gtinValid(EAN)); assert.ok(gtinValid('01234565'));
  assert.ok(!gtinValid('6291041500214')); assert.ok(!gtinValid('12345')); assert.ok(!gtinValid('abc'));
  assert.equal(normalizeBarcode(' ٦٢٩١٠٤١٥٠٠٢١٣ '), EAN);
});
test('unit: password hashing and tokens', () => {
  const h = hashPassword('correct horse'); assert.ok(verifyPassword('correct horse', h)); assert.ok(!verifyPassword('wrong', h));
  const tok = signToken({ uid: 1, role: 'staff', exp: Math.floor(Date.now() / 1000) + 60 }, 's');
  assert.equal(verifyToken(tok, 's')?.uid, 1); assert.equal(verifyToken(tok, 'other'), null);
  assert.equal(verifyToken(signToken({ uid: 1, role: 'staff', exp: 1 }, 's'), 's'), null, 'expired');
  const [b] = tok.split('.'); assert.equal(verifyToken(b + '.AAAA', 's'), null, 'forged signature');
});
test('unit: CSV parser handles quotes, CRLF, BOM', () => {
  assert.deepEqual(parseCSV('﻿a,b\r\n"x,1","he said ""hi"""\r\n'), [['a', 'b'], ['x,1', 'he said "hi"']]);
});
test('unit: migrations are idempotent', () => {
  const db = openDb(':memory:'); assert.deepEqual(migrate(db), []); db.close();
});

// ---------------- AUTH / RBAC (integration) ----------------
test('auth: wrong password rejected, no token => 401, bad token => 401', async () => {
  assert.equal((await t.call('POST', '/api/auth/login', { body: { username: 'admin', password: 'nope' } })).status, 401);
  assert.equal((await t.call('GET', '/api/products')).status, 401);
  assert.equal((await t.call('GET', '/api/products', { token: 'garbage.token' })).status, 401);
  const me = await t.call('GET', '/api/auth/me', { token: t.staff }); assert.equal(me.json.user.role, 'staff');
});
test('auth: login throttling after repeated failures', async () => {
  for (let i = 0; i < 5; i++) await t.call('POST', '/api/auth/login', { body: { username: 'ghost', password: 'x' } });
  assert.equal((await t.call('POST', '/api/auth/login', { body: { username: 'ghost', password: 'x' } })).status, 429);
});
test('rbac: staff blocked from manager-only endpoints (server-side)', async () => {
  for (const [m, p] of [['GET', '/api/users'], ['GET', '/api/reports/summary'], ['GET', '/api/requests/summary'], ['POST', '/api/imports/preview'], ['POST', '/api/imports/commit']] as const)
    assert.equal((await t.call(m, p, { token: t.staff })).status, 403, `${m} ${p}`);
  assert.equal((await t.call('GET', '/api/users', { token: t.manager })).status, 200);
});
test('rbac: deactivated user loses access immediately; last manager protected', async () => {
  const mk = await t.call('POST', '/api/users', { token: t.manager, body: { username: 'temp', display_name: 'مؤقت', role: 'staff', password: 'temp-password-1' } });
  const tok = await t.login('temp', 'temp-password-1');
  assert.equal((await t.call('GET', '/api/products', { token: tok })).status, 200);
  await t.call('PATCH', `/api/users/${mk.json.id}`, { token: t.manager, body: { active: false } });
  assert.equal((await t.call('GET', '/api/products', { token: tok })).status, 401);
  assert.equal((await t.call('POST', '/api/auth/login', { body: { username: 'temp', password: 'temp-password-1' } })).status, 401);
  assert.equal((await t.call('PATCH', '/api/users/1', { token: t.manager, body: { role: 'staff' } })).status, 409);
});
test('rbac: weak password rejected on user creation', async () => {
  assert.equal((await t.call('POST', '/api/users', { token: t.manager, body: { username: 'weak', display_name: 'x', role: 'staff', password: 'short' } })).status, 400);
});

// ---------------- PRODUCTS / NO PRICES ----------------
test('policy: price / cost / quantity fields are rejected, never stored', async () => {
  for (const extra of [{ price: 10 }, { cost: 5 }, { quantity: 3 }, { discount: 1 }, { السعر: 5 }]) {
    const r = await t.call('POST', '/api/products', { token: t.staff, body: { name: 'منتج', ...extra } });
    assert.equal(r.status, 400, JSON.stringify(extra));
  }
});
test('policy: schema has no price/cost/quantity columns anywhere', () => {
  const cols = (t.db.prepare("SELECT m.name t, p.name c FROM sqlite_master m, pragma_table_info(m.name) p WHERE m.type='table'").all() as { t: string; c: string }[]);
  const bad = cols.filter((x) => /price|cost|qty|quantity|profit|discount|balance|amount|سعر/i.test(x.c));
  assert.deepEqual(bad, []);
});
test('product: create, duplicate barcode blocked, invalid barcode rejected', async () => {
  const a = await t.call('POST', '/api/products', { token: t.staff, body: { name: 'مرطب وجه تجريبي', brand: 'CeraTest', category: 'العناية بالبشرة', barcode: EAN } });
  assert.equal(a.status, 200);
  const dup = await t.call('POST', '/api/products', { token: t.staff, body: { name: 'نسخة', barcode: EAN } });
  assert.equal(dup.status, 409);
  assert.equal((await t.call('POST', '/api/products', { token: t.staff, body: { name: 'س', barcode: '6291041500214' } })).status, 400);
  const bc = await t.call('GET', `/api/products/by-barcode/${EAN}`, { token: t.staff });
  assert.ok(bc.json.found); assert.equal(bc.json.product.name, 'مرطب وجه تجريبي');
});
test('barcode: unknown product => not found + enrichment honestly NOT configured (no invented data)', async () => {
  const r = await t.call('GET', `/api/products/by-barcode/${EAN2}`, { token: t.staff });
  assert.equal(r.json.found, false); assert.equal(r.json.product, null); assert.equal(r.json.enrichment.status, 'not_configured');
});
test('barcode: Arabic-Indic digits from a scanner still match existing product', async () => {
  const r = await t.call('GET', `/api/products/by-barcode/${encodeURIComponent('٦٢٩١٠٤١٥٠٠٢١٣')}`, { token: t.staff });
  assert.ok(r.json.found);
});
test('verification: staff cannot approve; manager needs a source; edits revoke approval', async () => {
  const id = (await t.call('POST', '/api/products', { token: t.staff, body: { name: 'منتج للاعتماد', source_url: 'https://example.com/p' } })).json.id;
  assert.equal((await t.call('PATCH', `/api/products/${id}`, { token: t.staff, body: { verification: 'verified' } })).status, 403);
  const id2 = (await t.call('POST', '/api/products', { token: t.manager, body: { name: 'بلا مصدر' } })).json.id;
  assert.equal((await t.call('PATCH', `/api/products/${id2}`, { token: t.manager, body: { verification: 'verified' } })).status, 400);
  assert.equal((await t.call('PATCH', `/api/products/${id}`, { token: t.manager, body: { verification: 'verified' } })).status, 200);
  const r = await t.call('PATCH', `/api/products/${id}`, { token: t.staff, body: { ingredients: 'Aqua, Glycerin' } });
  assert.equal(r.json.verification, 'review');
});
test('product: delete is manager-only', async () => {
  const id = (await t.call('POST', '/api/products', { token: t.staff, body: { name: 'للحذف' } })).json.id;
  assert.equal((await t.call('DELETE', `/api/products/${id}`, { token: t.staff })).status, 403);
  assert.equal((await t.call('DELETE', `/api/products/${id}`, { token: t.manager })).status, 200);
});
test('search: by name and barcode, LIKE wildcards neutralised', async () => {
  assert.ok((await t.call('GET', '/api/products?q=' + encodeURIComponent('مرطب'), { token: t.staff })).json.products.length >= 1);
  assert.ok((await t.call('GET', `/api/products?q=${EAN}`, { token: t.staff })).json.products.length === 1);
  assert.equal((await t.call('GET', '/api/products?q=' + encodeURIComponent('%'), { token: t.staff })).status, 200);
});

// ---------------- AVAILABILITY ----------------
test('availability: unconfirmed is never "available"; staleness downgrades; updater recorded', async () => {
  const id = (await t.call('POST', '/api/products', { token: t.staff, body: { name: 'منتج توفر' } })).json.id;
  let p = (await t.call('GET', `/api/products/${id}`, { token: t.staff })).json.product;
  assert.equal(p.availability, 'unknown'); assert.notEqual(p.availability_effective, 'yes');
  await t.call('POST', `/api/products/${id}/availability`, { token: t.staff, body: { status: 'yes' } });
  p = (await t.call('GET', `/api/products/${id}`, { token: t.staff })).json.product;
  assert.equal(p.availability_effective, 'yes'); assert.equal(p.availability_updated_by, 2);
  t.db.prepare('UPDATE products SET availability_updated_at=? WHERE id=?').run(new Date(Date.now() - 48 * 3.6e6).toISOString(), id);
  p = (await t.call('GET', `/api/products/${id}`, { token: t.staff })).json.product;
  assert.ok(p.availability_stale); assert.equal(p.availability_effective, 'unknown');
  assert.equal((await t.call('POST', `/api/products/${id}/availability`, { token: t.staff, body: { status: 'maybe' } })).status, 400);
});

// ---------------- IMPORT ----------------
const csv = readFileSync(new URL('./fixtures/import.csv', import.meta.url));
const xlsx = readFileSync(new URL('./fixtures/import.xlsx', import.meta.url));
test('import: CSV and XLSX parse identically; price/quantity columns ignored (names only)', () => {
  const a = parseImport('x.csv', csv), b = parseImport('x.xlsx', xlsx);
  for (const r of [a, b]) {
    assert.equal(r.rows.length, 4); assert.equal(r.invalid.length, 1); // in-file duplicate is caught later, at preview
    assert.deepEqual(r.ignoredColumns.sort(), ['price', 'quantity']);
    assert.ok(r.rows.some((x) => x.barcode === '01234565'), 'leading zero preserved');
    assert.ok(!JSON.stringify(r).includes('1999') && !JSON.stringify(r).includes('777'), 'no price value leaks into output');
  }
  assert.deepEqual(a.rows.map((x) => x.barcode), b.rows.map((x) => x.barcode));
});
test('import: preview writes nothing; commit adds once; re-import creates no duplicates', async () => {
  const before = (t.db.prepare('SELECT COUNT(*) n FROM products').get() as any).n;
  const pv = await t.call('POST', '/api/imports/preview?filename=import.xlsx', { token: t.manager, raw: xlsx });
  assert.equal(pv.status, 200); assert.equal(pv.json.committed, false); assert.equal(pv.json.duplicates_existing + pv.json.duplicates_in_file, 2); assert.equal(pv.json.invalid, 1);
  assert.equal((t.db.prepare('SELECT COUNT(*) n FROM products').get() as any).n, before);
  const c1 = await t.call('POST', '/api/imports/commit?filename=import.xlsx', { token: t.manager, raw: xlsx });
  assert.equal(c1.json.committed, true);
  const after1 = (t.db.prepare('SELECT COUNT(*) n FROM products').get() as any).n;
  assert.ok(after1 > before);
  const c2 = await t.call('POST', '/api/imports/commit?filename=import.xlsx', { token: t.manager, raw: xlsx });
  assert.equal(c2.json.new, 0);
  assert.equal((t.db.prepare('SELECT COUNT(*) n FROM products').get() as any).n, after1);
  const imported = t.db.prepare("SELECT verification FROM products WHERE barcode='01234565'").get() as any;
  assert.equal(imported.verification, 'review', 'imported items are never auto-verified');
});
test('import: no price/qty strings ever stored in DB or import log', () => {
  const dump = JSON.stringify([t.db.prepare('SELECT * FROM import_jobs').all(), t.db.prepare('SELECT * FROM audit_log').all(), t.db.prepare('SELECT * FROM products').all()]);
  assert.ok(!dump.includes('1999') && !dump.includes('"777"'));
});
test('import: bad file type / empty file rejected', async () => {
  assert.equal((await t.call('POST', '/api/imports/preview?filename=a.pdf', { token: t.manager, raw: Buffer.from('x') })).status, 400);
  assert.equal((await t.call('POST', '/api/imports/preview?filename=a.csv', { token: t.manager })).status, 400);
  assert.equal((await t.call('POST', '/api/imports/preview?filename=a.xlsx', { token: t.manager, raw: Buffer.from('not a zip at all, definitely') })).status, 400);
});
test('import: scales to 5000 rows without trouble', async () => {
  const lines = ['name,brand']; for (let i = 0; i < 5000; i++) lines.push(`منتج ${i},B${i % 20}`);
  const t0 = Date.now();
  const r = await t.call('POST', '/api/imports/commit?filename=big.csv', { token: t.manager, raw: Buffer.from(lines.join('\n')) });
  assert.equal(r.json.new, 5000); assert.ok(Date.now() - t0 < 10000);
});

// ---------------- ADVISOR ----------------
test('advisor: only documented ingredients; unknown composition is "cannot assess", never invented', async () => {
  await t.call('POST', '/api/products', { token: t.manager, body: { name: 'مرطب موثق', category: 'العناية بالبشرة', ingredients: 'Aqua, Glycerin, Ceramide NP', source_url: 'https://example.com/a', verification: 'verified', availability: 'yes' } });
  await t.call('POST', '/api/products', { token: t.manager, body: { name: 'مرطب معطر', category: 'العناية بالبشرة', ingredients: 'Aqua, Parfum, Glycerin', availability: 'yes' } });
  await t.call('POST', '/api/products', { token: t.manager, body: { name: 'مرطب بلا بيانات', category: 'العناية بالبشرة', availability: 'yes' } });
  const r = (await t.call('POST', '/api/advisor/search', { token: t.staff, body: { query: 'بشرتها جافة وحساسة وتريد مرطب خالي من العطر' } })).json;
  const names = r.store_matches.map((x: any) => x.name);
  assert.ok(names.includes('مرطب موثق')); assert.ok(!names.includes('مرطب معطر'), 'documented fragrance excluded');
  assert.ok(!names.includes('مرطب بلا بيانات')); assert.ok(r.cannot_assess.some((x: any) => x.name === 'مرطب بلا بيانات'));
  assert.equal(r.llm, false); assert.equal(r.global_alternatives.status, 'not_configured');
  assert.ok(r.notes.some((n: string) => n.includes('آمن لجميع')), 'sensitivity disclaimer present');
});
test('advisor: severe symptoms => no product recommendation, refer to professional', () => {
  const r = advise('عندها تورم وحروق في الوجه', []);
  assert.ok(r.safety_note); assert.equal(r.store_matches.length, 0);
});
test('advisor: stale/unconfirmed availability is flagged, not promised', () => {
  const p = { id: 1, name: 'واقي شمس', brand: '', category: 'واقيات الشمس', size: '', ingredients: '', warnings: '', verification: 'review', availability_effective: 'unknown', availability_stale: true };
  const r = advise('أريد واقي شمس', [p]) as any;
  assert.equal(r.store_matches[0].availability, 'unknown'); assert.match(r.store_matches[0].availability_note, /قديم/);
});

// ---------------- UNMET REQUESTS / REPORTS ----------------
test('requests: repeats are counted; personal data rejected; manager-only summary', async () => {
  await t.call('POST', '/api/requests', { token: t.staff, body: { text: 'مرطب خالٍ من العطر' } });
  await t.call('POST', '/api/requests', { token: t.staff, body: { text: 'مرطّب خالٍ من العطر' } });
  assert.equal((await t.call('POST', '/api/requests', { token: t.staff, body: { text: 'كريم', note: 'اتصلوا على 777123456' } })).status, 400);
  assert.equal((await t.call('POST', '/api/requests', { token: t.staff, body: { text: 'كريم', note: 'a@b.com' } })).status, 400);
  const s = (await t.call('GET', '/api/requests/summary', { token: t.manager })).json.items;
  assert.equal(s[0].count, 2);
});
test('reports: summary has counts only, no financial fields', async () => {
  const r = (await t.call('GET', '/api/reports/summary', { token: t.manager })).json;
  assert.ok(r.products > 0); assert.ok(!/price|cost|revenue|profit|سعر/i.test(JSON.stringify(Object.keys(r))));
});

// ---------------- SECURITY / PERSISTENCE ----------------
test('security: path traversal on static server blocked; security headers present', async () => {
  const r = await t.call('GET', '/..%2f..%2fetc%2fpasswd'); assert.ok([403, 404].includes(r.status));
  const r2 = await t.call('GET', '/%E0%A4%A'); assert.ok([400, 404].includes(r2.status));
  const h = await t.call('GET', '/api/auth/me'); assert.equal(h.headers.get('x-content-type-options'), 'nosniff');
});
test('security: SQL-injection-like input is treated as data', async () => {
  const r = await t.call('POST', '/api/products', { token: t.staff, body: { name: "x'); DROP TABLE products;--" } });
  assert.equal(r.status, 200); assert.equal((await t.call('GET', '/api/products', { token: t.staff })).status, 200);
});
test('security: passwords never returned by API', async () => {
  const r = await t.call('GET', '/api/users', { token: t.manager }); assert.ok(!/password|hash|scrypt/i.test(r.text));
});
test('persistence: data survives close/reopen of an on-disk DB', async () => {
  const { mkdtempSync } = await import('node:fs'); const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
  const path = join(mkdtempSync(join(tmpdir(), 'mh-')), 'p.db');
  const a = openDb(path); a.prepare("INSERT INTO products(name,created_at,updated_at) VALUES ('باقٍ','t','t')").run(); a.close();
  const b = openDb(path); assert.equal((b.prepare('SELECT name FROM products').get() as any).name, 'باقٍ'); b.close();
});

test('api: duplicate-barcode 409 tells the UI which record to open', async () => {
  const r = await t.call('POST', '/api/products', { token: t.staff, body: { name: 'مكرر', barcode: EAN } });
  assert.equal(r.status, 409); assert.ok(Number.isInteger(r.json.existingId));
});

test('backup: VACUUM INTO produces a verifiable, restorable copy', async () => {
  const { mkdtempSync } = await import('node:fs'); const { tmpdir } = await import('node:os'); const { join } = await import('node:path'); const { execFileSync } = await import('node:child_process');
  const d = mkdtempSync(join(tmpdir(), 'mh-bk-')); const a = openDb(join(d, 'a.db')); a.prepare("INSERT INTO products(name,created_at,updated_at) VALUES ('x','t','t')").run(); a.close();
  const out = execFileSync('node', ['--no-warnings', '--import', 'tsx', 'scripts/backup.ts', join(d, 'a.db'), join(d, 'b.db')], { encoding: 'utf8' });
  assert.match(out, /ok=ok products=1/);
  const b = openDb(join(d, 'b.db')); assert.equal((b.prepare('SELECT COUNT(*) n FROM products').get() as any).n, 1); b.close();
});

test('security: XLSX zip-bomb (≈100KB file expanding to >100MB) is rejected with 400, server stays up', async () => {
  const bomb = readFileSync(new URL('./fixtures/zipbomb.xlsx', import.meta.url));
  assert.ok(bomb.length < 1_000_000);
  const r = await t.call('POST', '/api/imports/preview?filename=bomb.xlsx', { token: t.manager, raw: bomb });
  assert.equal(r.status, 400); assert.equal((await t.call('GET', '/api/auth/me', { token: t.manager })).status, 200);
});
