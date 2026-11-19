import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './helpers.ts';
import { dispatch } from '../server/src/http.ts';

// CP06: server-side pieces shared with the Android build — transport-neutral dispatch, and no hidden 500-product cap.

test('dispatch() answers without an HTTP server (the path the Android worker uses), with auth enforced', async () => {
  const t = await boot();
  try {
    const raw = async () => Buffer.alloc(0);
    const anon = await dispatch(t.db, t.cfg, { method: 'GET', url: '/api/products?limit=1', raw });
    assert.equal(anon.status, 401);
    const ok = await dispatch(t.db, t.cfg, { method: 'GET', url: '/api/products?limit=1', authorization: 'Bearer ' + t.staff, raw });
    assert.equal(ok.status, 200); assert.equal(JSON.parse(String(ok.body)).total, 0);
    const forbidden = await dispatch(t.db, t.cfg, { method: 'GET', url: '/api/users', authorization: 'Bearer ' + t.staff, raw });
    assert.equal(forbidden.status, 403);
    assert.equal((await dispatch(t.db, t.cfg, { method: 'GET', url: '/api/nope', raw })).status, 404);
  } finally { await t.close(); }
});

test('routine: steps count ALL matching products (no 500 limit), list at most 12, and include unclassified products by name', async () => {
  const t = await boot();
  try {
    const ins = t.db.prepare("INSERT INTO products(name, brand, category, product_type, created_at, updated_at) VALUES (?, '', 'العناية بالبشرة', ?, ?, ?)");
    const now = new Date().toISOString();
    t.db.exec('BEGIN'); for (let i = 0; i < 1200; i++) ins.run(`غسول ${i}`, 'cleanser', now, now); ins.run('غسول بلا تصنيف', '', now, now); t.db.exec('COMMIT');
    const r = await t.call('GET', '/api/routine?area=skin', { token: t.staff });
    assert.equal(r.status, 200);
    const cleanse = r.json.am.find((s: { products: { name: string }[] }) => s.products.some((p) => p.name.startsWith('غسول')));
    assert.ok(cleanse, 'a cleansing step exists');
    assert.equal(cleanse.total, 1201, 'counts beyond 500, including the unclassified one found by name');
    assert.ok(cleanse.products.length <= 12);
    assert.equal((await t.call('GET', '/api/routine?area=skin')).status, 401);
  } finally { await t.close(); }
});

test('availability=stale lists only "yes" answers older than the staleness window (home screen count, no client-side cap)', async () => {
  const t = await boot();
  try {
    const now = new Date().toISOString(); const old = new Date(Date.now() - 72 * 3.6e6).toISOString();
    const ins = t.db.prepare('INSERT INTO products(name, availability, availability_updated_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?)');
    ins.run('متوفر حديثًا', 'yes', now, now, now); ins.run('متوفر قديم', 'yes', old, now, now); ins.run('غير متوفر قديم', 'no', old, now, now);
    const r = await t.call('GET', '/api/products?availability=stale&limit=10', { token: t.staff });
    assert.equal(r.status, 200); assert.equal(r.json.total, 1); assert.equal(r.json.products[0].name, 'متوفر قديم');
    assert.equal(r.json.products[0].availability_effective, 'unknown', 'a stale "yes" is never shown as available');
  } finally { await t.close(); }
});
