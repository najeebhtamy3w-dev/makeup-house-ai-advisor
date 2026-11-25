// Synthetic fixture products and stock only; these tests do not establish a real shop's inventory.
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './helpers.ts';
import { checkValidBatches, isInventoryDate } from '../server/src/intelligence/inventory.ts';

async function fixture(t: Awaited<ReturnType<typeof boot>>, verified = true) {
  const r = await t.call('POST', '/api/products', { token: t.manager, body: { name: 'منتج اختبار اصطناعي', ingredients: 'Aqua, Glycerin', verification: verified ? 'verified' : 'review', source_url: verified ? 'https://example.test/synthetic-fixture' : '', availability: 'yes' } });
  assert.equal(r.status, 200); return r.json.id as number;
}
test('inventory dates: real Gregorian dates, no normalization of invalid calendar days', () => {
  for (const date of ['2024-02-29', '2026-11-25', '2027-12-31']) assert.equal(isInventoryDate(date), true);
  for (const date of ['2026-02-29', '2027-02-30', '2026-13-01', '2026-11-31', '2026-1-01', '25/11/2026', '2026-11-25T00:00:00Z']) assert.equal(isInventoryDate(date), false, date);
});
test('inventory: no invented stock from legacy yes; only positive unexpired reviewed-active batches establish availability', async () => {
  const t = await boot();
  try {
    const id = await fixture(t);
    assert.equal(checkValidBatches(t.db, id, '2026-11-25').availability, 'unknown');
    for (const [batch_code, quantity, expires_on] of [['expired', 9, '2026-11-24'], ['empty', 0, '2027-01-01'], ['today', 2, '2026-11-25'], ['future', 3, '2027-01-01']] as const) {
      assert.equal((await t.call('POST', '/api/inventory/batches', { token: t.manager, body: { product_id: id, batch_code, quantity, expires_on } })).status, 200);
    }
    const available = checkValidBatches(t.db, id, '2026-11-25');
    assert.equal(available.availability, 'yes'); assert.equal(available.valid_quantity, 5); assert.deepEqual(available.valid_batches.map(b => b.batch_code), ['today', 'future']);
    assert.equal(checkValidBatches(t.db, id, '2028-01-01').availability, 'no');
    t.db.prepare("UPDATE products SET verification='review' WHERE id=?").run(id);
    assert.equal(checkValidBatches(t.db, id, '2026-11-25').availability, 'unknown');
    t.db.prepare("UPDATE products SET verification='verified',record_status='archived' WHERE id=?").run(id);
    assert.equal(checkValidBatches(t.db, id, '2026-11-25').availability, 'unknown');
    assert.equal(checkValidBatches(t.db, 2147483647, '2026-11-25').reason, 'product_not_found');
  } finally { await t.close(); }
});
test('inventory: manager write permissions, strict inputs, duplicate prevention, optimistic version and audited changes', async () => {
  const t = await boot();
  try {
    const id = await fixture(t), body = { product_id: id, batch_code: 'fixture-A', quantity: 5, expires_on: '2027-12-31' };
    assert.equal((await t.call('POST', '/api/inventory/batches', { body })).status, 401);
    assert.equal((await t.call('POST', '/api/inventory/batches', { token: t.staff, body })).status, 403);
    for (const quantity of [-1, 0.5, '5', 1_000_000_001, null]) assert.equal((await t.call('POST', '/api/inventory/batches', { token: t.manager, body: { ...body, quantity } })).status, 400);
    assert.equal((await t.call('POST', '/api/inventory/batches', { token: t.manager, body: { ...body, expires_on: '2027-02-30' } })).status, 400);
    assert.equal((await t.call('POST', '/api/inventory/batches', { token: t.manager, body: { ...body, price: 10 } })).status, 400);
    assert.equal((await t.call('POST', '/api/inventory/batches', { token: t.manager, body: { ...body, product_id: 2147483647 } })).status, 404);
    const added = await t.call('POST', '/api/inventory/batches', { token: t.manager, body }); assert.equal(added.status, 200);
    const bid = added.json.batch.id;
    assert.equal((await t.call('POST', '/api/inventory/batches', { token: t.manager, body })).status, 409);
    assert.equal((await t.call('GET', `/api/inventory/batches?product_id=${id}`, { token: t.staff })).json.total, 1);
    assert.equal((await t.call('GET', `/api/inventory/availability/${id}`, { token: t.staff })).status, 200);
    assert.equal((await t.call('PATCH', `/api/inventory/batches/${bid}`, { token: t.staff, body: { version: 1, quantity: 0 } })).status, 403);
    const edited = await t.call('PATCH', `/api/inventory/batches/${bid}`, { token: t.manager, body: { version: 1, quantity: 0 } }); assert.equal(edited.status, 200); assert.equal(edited.json.batch.version, 2);
    assert.equal((await t.call('PATCH', `/api/inventory/batches/${bid}`, { token: t.manager, body: { version: 1, quantity: 9 } })).status, 409);
    assert.equal((await t.call('GET', `/api/inventory/batches?product_id=${id}`, { token: t.staff })).json.batches[0].quantity, 0);
    assert.deepEqual((t.db.prepare("SELECT action FROM audit_log WHERE entity='inventory_batch' ORDER BY id").all() as { action: string }[]).map(r => r.action), ['inventory_batch_create', 'inventory_batch_update']);
    assert.equal((await t.call('GET', '/api/inventory/batches?limit=100000', { token: t.staff })).status, 400);
  } finally { await t.close(); }
});
test('inventory: corrupt stored dates are never accepted as unexpired stock', async () => {
  const t = await boot();
  try {
    const id = await fixture(t);
    t.db.prepare("INSERT INTO inventory_batches(product_id,batch_code,quantity,expires_on,created_at,updated_at) VALUES(?, 'corrupt-fixture', 1, '2027-02-30', 'x', 'x')").run(id);
    assert.equal(checkValidBatches(t.db, id, '2026-11-25').availability, 'no');
    const insert = t.db.prepare("INSERT INTO inventory_batches(product_id,batch_code,quantity,expires_on,created_at,updated_at) VALUES(?,?,1,'2027-12-31','x','x')");
    for (let i = 0; i < 201; i++) insert.run(id, 'bounded-fixture-' + i);
    const bounded = checkValidBatches(t.db, id, '2026-11-25');
    assert.equal(bounded.availability, 'unknown'); assert.equal(bounded.reason, 'batch_scan_limit'); assert.equal(bounded.valid_batches.length, 0);
  } finally { await t.close(); }
});
test('inventory: an audit write failure rolls back the stock mutation', async () => {
  const t = await boot();
  try {
    const id = await fixture(t);
    t.db.exec("CREATE TRIGGER inventory_test_audit_failure BEFORE INSERT ON audit_log WHEN NEW.entity='inventory_batch' BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END");
    const failed = await t.call('POST', '/api/inventory/batches', { token: t.manager, body: { product_id: id, batch_code: 'audit-fixture', quantity: 5, expires_on: '2027-12-31' } });
    assert.equal(failed.status, 500);
    assert.equal((t.db.prepare('SELECT COUNT(*) n FROM inventory_batches WHERE product_id=?').get(id) as { n: number }).n, 0);
    t.db.exec('DROP TRIGGER inventory_test_audit_failure');
    const added = await t.call('POST', '/api/inventory/batches', { token: t.manager, body: { product_id: id, batch_code: 'audit-fixture', quantity: 5, expires_on: '2027-12-31' } });
    const bid = added.json.batch.id;
    t.db.exec("CREATE TRIGGER inventory_test_audit_failure BEFORE INSERT ON audit_log WHEN NEW.entity='inventory_batch' BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END");
    assert.equal((await t.call('PATCH', `/api/inventory/batches/${bid}`, { token: t.manager, body: { version: 1, quantity: 0 } })).status, 500);
    const unchanged = t.db.prepare('SELECT quantity,version FROM inventory_batches WHERE id=?').get(bid) as { quantity: number; version: number };
    assert.equal(unchanged.quantity, 5); assert.equal(unchanged.version, 1);
  } finally { await t.close(); }
});
