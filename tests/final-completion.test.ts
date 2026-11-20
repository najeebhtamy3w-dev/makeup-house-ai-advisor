// Final completion — additional product codes, lookup by any code, cross-product code protection, queue priority,
// bulk classification (manager, optimistic concurrency, scientific fields untouched), manager dashboard (real counts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './helpers.ts';

const GTIN_A = '6291041500213', GTIN_B = '6291041500381', GTIN_C = '4006381333931';
test('additional codes: GTIN check digit, scientific notation refused, one code = one product, lookup by any code, manager-only verify/remove, audited', async () => {
  const t = await boot();
  try {
    const a = (await t.call('POST', '/api/products', { token: t.staff, body: { name: 'غسول أ', brand: 'B', size: '200 ml', barcode: GTIN_A } })).json.id;
    const b = (await t.call('POST', '/api/products', { token: t.staff, body: { name: 'غسول ب', brand: 'B', size: '400 ml' } })).json.id;
    assert.equal((await t.call('POST', `/api/products/${a}/codes`, { token: t.staff, body: { code: '6291041500214', kind: 'gtin' } })).status, 400, 'bad check digit');
    assert.equal((await t.call('POST', `/api/products/${a}/codes`, { token: t.staff, body: { code: '6.29104E+12', kind: 'unverified' } })).status, 400, 'scientific notation');
    const add = await t.call('POST', `/api/products/${a}/codes`, { token: t.staff, body: { code: GTIN_B, kind: 'gtin' } });
    assert.equal(add.status, 200); assert.equal(add.json.verified, false, 'staff adds as unverified');
    assert.equal((await t.call('POST', `/api/products/${b}/codes`, { token: t.staff, body: { code: GTIN_B, kind: 'gtin' } })).status, 409, 'never two products for one code');
    assert.equal((await t.call('POST', `/api/products/${b}/codes`, { token: t.staff, body: { code: GTIN_A, kind: 'gtin' } })).status, 409, "another product's PRIMARY barcode is refused too");
    assert.equal((await t.call('PATCH', `/api/products/${b}`, { token: t.manager, body: { barcode: GTIN_B, version: 1 } })).status, 409, "a primary barcode equal to another product's additional code is refused");
    assert.equal((await t.call('POST', '/api/products', { token: t.staff, body: { name: 'ج', brand: 'B', size: '1', barcode: GTIN_B } })).status, 409, 'create with an additional code of another product is refused');
    const by = await t.call('GET', `/api/products/by-code/${GTIN_B}`, { token: t.staff }); assert.equal(by.json.product.id, a); assert.equal(by.json.matched_by, 'additional_gtin');
    assert.equal((await t.call('GET', `/api/products/by-barcode/${GTIN_B}`, { token: t.staff })).json.product.id, a, 'the scan screen finds it too');
    const codes = (await t.call('GET', `/api/products/${a}/codes`, { token: t.staff })).json.codes; assert.equal(codes.length, 2); assert.equal(codes[0].is_primary, 1);
    assert.equal((await t.call('PATCH', `/api/products/${a}/codes/${add.json.id}`, { token: t.staff, body: { verified: true } })).status, 403);
    assert.equal((await t.call('PATCH', `/api/products/${a}/codes/${add.json.id}`, { token: t.manager, body: { verified: true } })).status, 200);
    assert.equal((await t.call('DELETE', `/api/products/${a}/codes/${codes[0].id}`, { token: t.manager })).status, 409, 'primary is managed in the product card');
    assert.equal((await t.call('DELETE', `/api/products/${a}/codes/${add.json.id}`, { token: t.manager })).status, 200);
    const acts = (t.db.prepare("SELECT action FROM audit_log WHERE action LIKE 'code_%' ORDER BY id").all() as { action: string }[]).map((r) => r.action);
    assert.deepEqual(acts, ['code_add', 'code_verify', 'code_remove']);
  } finally { await t.close(); }
});

test('bulk classification: manager only; sets form + confirmed; never touches scientific fields; skips rows changed meanwhile', async () => {
  const t = await boot();
  try {
    const ids: number[] = [];
    for (let i = 0; i < 4; i++) ids.push((await t.call('POST', '/api/products', { token: t.manager, body: { name: `منتج ${i}`, brand: 'X', size: '50 ml', ingredients: 'aqua, glycerin', warnings: 'تجنب العين' } })).json.id);
    const v = (id: number) => (t.db.prepare('SELECT version FROM products WHERE id = ?').get(id) as { version: number }).version;
    const items = ids.map((id) => ({ id, version: v(id) }));
    assert.equal((await t.call('POST', '/api/products/bulk-classify', { token: t.staff, body: { items, product_type: 'cleanser' } })).status, 403);
    assert.equal((await t.call('POST', '/api/products/bulk-classify', { token: t.manager, body: { items, product_type: 'not-a-type' } })).status, 400);
    await t.call('PATCH', `/api/products/${ids[3]}`, { token: t.manager, body: { size: '75 ml', version: v(ids[3]!) } });   // changed by someone else meanwhile
    const r = await t.call('POST', '/api/products/bulk-classify', { token: t.manager, body: { items, product_type: 'cleanser', category: 'العناية بالبشرة' } });
    assert.equal(r.status, 200); assert.equal(r.json.updated, 3); assert.deepEqual(r.json.skipped_changed_meanwhile, [ids[3]]);
    const row = t.db.prepare('SELECT product_type, classification_status, ingredients, warnings, verification FROM products WHERE id = ?').get(ids[0]) as Record<string, string>;
    assert.equal(row.product_type, 'cleanser'); assert.equal(row.classification_status, 'confirmed');
    assert.equal(row.ingredients, 'aqua, glycerin'); assert.equal(row.warnings, 'تجنب العين'); assert.equal(row.verification, 'review', 'verification untouched');
    assert.equal((t.db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action = 'bulk_classify'").get() as { n: number }).n, 1);
  } finally { await t.close(); }
});

test('queue priority: GTIN rows before name+brand rows before the rest; a product asked about now jumps to the front', async () => {
  const { openDb } = await import('../server/src/db.ts');
  const { commitBatch } = await import('../server/src/import-batch.ts');
  const db = openDb(':memory:'); db.prepare("INSERT INTO users(id, username, display_name, role, password_hash, created_at) VALUES (1,'m','m','manager','x','x')").run();
  const rows = [{ name: 'بلا شيء', brand: '' }, { name: 'باسم', name_en: 'Gentle Wash', brand: 'Acme' }, { name: 'بباركود', brand: '', barcode: GTIN_C }].map((r) => ({ category: 'العناية بالبشرة', size: '', availability: null, product_type: '', classification_status: 'unknown', classification_raw: '', name_ar: '', name_en: '', manufacturer: '', variant: '', draft: false, barcode: '', ...r }));
  commitBatch(db as never, { filename: 'p.csv', fileBytes: new TextEncoder().encode('prio'), fresh: rows as never, completions: [], invalid: [], total: 3, userId: 1, enrichProviders: ['openbeautyfacts'], ignoredColumns: [] });
  const pr = db.prepare('SELECT p.name, j.priority FROM enrichment_jobs_v2 j JOIN products p ON p.id = j.product_id ORDER BY j.priority DESC').all() as { name: string; priority: number }[];
  assert.deepEqual(pr.map((x) => [x.name, x.priority]), [['بباركود', 50], ['باسم', 20]], 'a row with neither barcode, English name nor brand is not queued; order follows the rule');
  db.close();
  const t = await boot();
  try {
    const id = (await t.call('POST', '/api/products', { token: t.staff, body: { name: 'مطلوب الآن', brand: 'B', size: '1' } })).json.id;
    t.db.prepare("INSERT INTO enrichment_jobs_v2(product_id, provider, query_key, priority, next_at, created_at, updated_at) VALUES (?, 'openbeautyfacts', 'k', 0, 'x', 'x', 'x')").run(id);
    assert.equal((await t.call('POST', `/api/queue/prioritize/${id}`, { token: t.staff })).json.prioritized, 1);
    assert.equal((t.db.prepare('SELECT priority FROM enrichment_jobs_v2 WHERE product_id = ?').get(id) as { priority: number }).priority, 100);
  } finally { await t.close(); }
});

test('manager dashboard: real counts from the database; staff refused', async () => {
  const t = await boot();
  try {
    await t.call('POST', '/api/products', { token: t.manager, body: { name: 'كامل', brand: 'B', size: '1', barcode: GTIN_A, ingredients: 'aqua', product_type: 'cleanser', category: 'العناية بالبشرة' } });
    await t.call('POST', '/api/products', { token: t.manager, body: { name: 'ناقص', brand: 'B', size: '1' } });
    assert.equal((await t.call('GET', '/api/dashboard', { token: t.staff })).status, 403);
    const d = (await t.call('GET', '/api/dashboard', { token: t.manager })).json;
    assert.equal(d.catalog.products, 2); assert.equal(d.completeness.without_ingredients, 1); assert.equal(d.completeness.without_barcode, 1); assert.equal(d.completeness.without_image, 2);
    assert.equal(d.users.manager, 1); assert.equal(d.users.staff, 1); assert.equal(d.backup.last, null);
    assert.ok(!/price|cost|sale|profit/i.test(JSON.stringify(d)), 'no financial metric');
  } finally { await t.close(); }
});
