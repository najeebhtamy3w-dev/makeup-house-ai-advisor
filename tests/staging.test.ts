import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './helpers.ts';
import { seedStagingAccounts } from '../server/src/staging.ts';
import { bootstrap } from '../server/src/server.ts';
import { openDb } from '../server/src/db.ts';
import { loadConfig } from '../server/src/config.ts';

test('staging: /api/health and /api/meta are public, data-free, and flag the test copy', async () => {
  const t = await boot({ MH_STAGING: '1' });
  try {
    const hz = await t.call('GET', '/api/health'); assert.equal(hz.status, 200); assert.deepEqual(hz.json, { ok: true });
    const m = await t.call('GET', '/api/meta'); assert.equal(m.status, 200); assert.equal(m.json.staging, true); assert.match(m.json.notice, /تُحذف/);
    assert.deepEqual(Object.keys(m.json).sort(), ['commit', 'notice', 'staging', 'version']);
    assert.equal((await t.call('GET', '/api/products')).status, 401, 'data stays behind login');
  } finally { await t.close(); }
});

test('production (non-staging): meta says staging=false with no notice', async () => {
  const t = await boot();
  try { const m = await t.call('GET', '/api/meta'); assert.equal(m.json.staging, false); assert.equal(m.json.notice, null); } finally { await t.close(); }
});

test('staging: every response is marked noindex; robots.txt disallows all', async () => {
  const t = await boot({ MH_STAGING: '1' });
  try {
    for (const p of ['/', '/api/meta', '/api/products', '/device-test.html', '/nope']) assert.match((await t.call('GET', p)).headers.get('x-robots-tag') ?? '', /noindex/, p);
    const r = await t.call('GET', '/robots.txt'); assert.equal(r.status, 200); assert.match(r.text, /Disallow: \//);
  } finally { await t.close(); }
});

test('CP05: the catalog starts EMPTY — fresh database, first start, restart, migrations and staging never create products', async () => {
  const { mkdtempSync, readdirSync, readFileSync } = await import('node:fs');
  const { join } = await import('node:path'); const { tmpdir } = await import('node:os');
  const path = join(mkdtempSync(join(tmpdir(), 'mh-empty-')), 'app.db');
  const env = { NODE_ENV: 'production', MH_STAGING: '1', MH_SECRET: 'x'.repeat(40), MH_DB_PATH: path, MH_ADMIN_USER: 'owner', MH_ADMIN_PASSWORD: 'owner-password-1', MH_STAFF_USER: 'staff-test', MH_STAFF_PASSWORD: 'staff-test-pass-1' } as NodeJS.ProcessEnv;
  const count = (db: ReturnType<typeof openDb>, table: string) => (db.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as { n: number }).n;
  for (let run = 1; run <= 3; run++) {   // first start, restart, restart (same file, as after a redeploy with a persistent disk)
    const db = openDb(path); bootstrap(db, loadConfig(env), env);
    assert.equal(count(db, 'products'), 0, `run ${run}: no product created`);
    assert.equal(count(db, 'product_images'), 0); assert.equal(count(db, 'enrichment_candidates'), 0);
    assert.equal(count(db, 'users'), 2, 'manager + optional staff test account are still set up');
    db.close();
  }
  const roles = (() => { const db = openDb(path); const r = (db.prepare('SELECT username, role FROM users ORDER BY id').all() as { username: string; role: string }[]).map((u) => `${u.username}:${u.role}`); db.close(); return r; })();
  assert.deepEqual(roles, ['owner:manager', 'staff-test:staff'], 'roles unchanged');
  // no migration inserts products
  for (const f of readdirSync(new URL('../server/migrations/', import.meta.url))) assert.doesNotMatch(readFileSync(new URL('../server/migrations/' + f, import.meta.url), 'utf8'), /INSERT\s+(OR\s+\w+\s+)?INTO\s+products/i, f);
  // taxonomy (reference data) is still served
  const t = await boot({ MH_STAGING: '1' });
  try { assert.ok((await t.call('GET', '/api/taxonomy', { token: t.staff })).json.product_types.length > 10); assert.equal((await t.call('GET', '/api/products', { token: t.staff })).json.total, 0); } finally { await t.close(); }
});

test('CP05: only user actions (create / import) insert products — no other server code path does', async () => {
  const { readdirSync, readFileSync } = await import('node:fs');
  const dir = new URL('../server/src/', import.meta.url); const offenders: string[] = [];
  const walk = (u: URL) => { for (const e of readdirSync(u, { withFileTypes: true })) { const c = new URL(e.name + (e.isDirectory() ? '/' : ''), u); if (e.isDirectory()) walk(c); else if (/INSERT\s+(OR\s+\w+\s+)?INTO\s+products\s*\(/i.test(readFileSync(c, 'utf8')) && !c.pathname.endsWith('/server/src/routes.ts')) offenders.push(c.pathname); } };
  walk(dir); assert.deepEqual(offenders, []);
  const routes = readFileSync(new URL('routes.ts', dir), 'utf8');
  assert.equal((routes.match(/INSERT\s+INTO\s+products\s*\(/gi) ?? []).length, 2, 'POST /api/products and the import commit only');
});

test('staging accounts: optional limited staff test account, idempotent, weak password refused; scope has no financial columns', async () => {
  const t = await boot({ MH_STAGING: '1' });
  try {
    const r1 = seedStagingAccounts(t.db, { MH_STAFF_USER: 'staff-test', MH_STAFF_PASSWORD: 'staff-test-pass-1' } as NodeJS.ProcessEnv);
    assert.deepEqual(r1, { staff: true });
    assert.deepEqual(seedStagingAccounts(t.db, { MH_STAFF_USER: 'staff-test', MH_STAFF_PASSWORD: 'staff-test-pass-1' } as NodeJS.ProcessEnv), { staff: false });
    const tok = await t.login('staff-test', 'staff-test-pass-1'); assert.ok(tok);
    assert.equal((await t.call('GET', '/api/users', { token: tok })).status, 403, 'staff test account cannot open manager endpoints');
    assert.throws(() => seedStagingAccounts(t.db, { MH_STAFF_USER: 'x2', MH_STAFF_PASSWORD: 'short' } as NodeJS.ProcessEnv), /10/);
    assert.equal((t.db.prepare('SELECT COUNT(*) n FROM products').get() as { n: number }).n, 0);
    const cols = (t.db.prepare('PRAGMA table_info(products)').all() as Array<{ name: string }>).map((c) => c.name).join(',');
    assert.doesNotMatch(cols, /price|cost|qty|quantity/i, 'scope: no financial / stock columns');
  } finally { await t.close(); }
});
