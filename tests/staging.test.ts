import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './helpers.ts';
import { seedStaging } from '../server/src/staging.ts';
import { gtinValid } from '../server/src/gtin.ts';

test('staging: /api/health and /api/meta are public, data-free, and flag the test copy', async () => {
  const t = await boot({ MH_STAGING: '1' });
  try {
    const hz = await t.call('GET', '/api/health'); assert.equal(hz.status, 200); assert.deepEqual(hz.json, { ok: true });
    const m = await t.call('GET', '/api/meta'); assert.equal(m.status, 200); assert.equal(m.json.staging, true); assert.match(m.json.notice, /وهمية/);
    assert.deepEqual(Object.keys(m.json).sort(), ['notice', 'staging', 'version']);
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

test('staging seed: fake demo products only (GS1 internal 2xx barcodes), idempotent, staff account limited, weak password refused', async () => {
  const t = await boot({ MH_STAGING: '1' });
  try {
    t.db.prepare('DELETE FROM products').run();
    const r1 = seedStaging(t.db, { MH_STAFF_USER: 'staff-test', MH_STAFF_PASSWORD: 'staff-test-pass-1' } as NodeJS.ProcessEnv);
    assert.ok(r1.products >= 4); assert.equal(r1.staff, true);
    const rows = t.db.prepare('SELECT barcode, name FROM products').all() as Array<{ barcode: string | null; name: string }>;
    for (const p of rows) { assert.match(p.name, /تجريبي/); if (p.barcode) { assert.ok(p.barcode.startsWith('2'), 'internal-use prefix'); assert.ok(gtinValid(p.barcode)); } }
    const r2 = seedStaging(t.db, { MH_STAFF_USER: 'staff-test', MH_STAFF_PASSWORD: 'staff-test-pass-1' } as NodeJS.ProcessEnv);
    assert.deepEqual(r2, { products: 0, staff: false });
    const tok = await t.login('staff-test', 'staff-test-pass-1'); assert.ok(tok);
    assert.equal((await t.call('GET', '/api/users', { token: tok })).status, 403, 'staff test account cannot open manager endpoints');
    assert.equal((await t.call('GET', '/api/products', { token: tok })).status, 200);
    assert.throws(() => seedStaging(t.db, { MH_STAFF_USER: 'x2', MH_STAFF_PASSWORD: 'short' } as NodeJS.ProcessEnv), /10/);
    const cols = (t.db.prepare('PRAGMA table_info(products)').all() as Array<{ name: string }>).map((c) => c.name).join(',');
    assert.doesNotMatch(cols, /price|cost|qty|quantity/i, 'scope: no financial / stock columns');
  } finally { await t.close(); }
});
