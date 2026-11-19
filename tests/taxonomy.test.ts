import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './helpers.ts';
import { PRODUCT_TYPES, AREAS, FUNCTIONS, typeFromValue, suggestTypeFromName, TYPE_IDS } from '../server/src/taxonomy.ts';

test('taxonomy: stable unique ids; one id per synonym across languages; no duplicate labels', () => {
  for (const list of [PRODUCT_TYPES, AREAS, FUNCTIONS]) {
    const ids = list.map((x) => x.id); assert.equal(new Set(ids).size, ids.length);
    assert.ok(ids.every((x) => /^[a-z_]+$/.test(x)), 'ids are stable ascii keys, not display text');
    const ars = list.map((x) => x.ar); assert.equal(new Set(ars).size, ars.length, 'no two entries with the same Arabic label');
  }
  for (const [v, id] of [['Cream', 'cream'], ['كريم', 'cream'], ['crème', 'cream'], ['CREAM', 'cream'], ['Serum', 'serum'], ['سيروم', 'serum'], ['غسول', 'cleanser'], ['Cleanser', 'cleanser'], ['واقي-شمس', 'sunscreen'], ['زيت', 'oil'], ['Shampoo', 'shampoo']] as const) assert.equal(typeFromValue(v), id, v);
  assert.equal(typeFromValue('كريمم'), null, 'no fuzzy matching'); assert.equal(typeFromValue('moisturizer'), null, 'a function word is not a form');
});

test('taxonomy: name suggestions only when unambiguous; form never inferred from a function word', () => {
  assert.equal(suggestTypeFromName('CeraVe Moisturising Cream'), 'cream');
  assert.equal(suggestTypeFromName('كريم أساس سائل'), 'foundation', 'longer phrase wins');
  assert.equal(suggestTypeFromName('غسول وجه لطيف'), 'cleanser');
  assert.equal(suggestTypeFromName('Foaming Cleansing Gel'), null, 'cleanser + gel = ambiguous');
  assert.equal(suggestTypeFromName('مرطب وجه'), null, '"moisturiser" is a function, not a form');
  assert.equal(suggestTypeFromName('Hydrating Serum Cream'), null);
});

test('catalog: filter by type; same form across categories; unclassified never disappears; facets match results', async () => {
  const t = await boot();
  try {
    const mk = (b: Record<string, unknown>) => t.call('POST', '/api/products', { token: t.staff, body: b });
    await mk({ name: 'كريم وجه', category: 'العناية بالبشرة', product_type: 'cream', application_area: 'face', functions: ['moisturizing'] });
    await mk({ name: 'كريم شعر', category: 'العناية بالشعر', product_type: 'cream', application_area: 'hair' });
    await mk({ name: 'غسول CeraVe', brand: 'CeraVe', category: 'العناية بالبشرة', product_type: 'cleanser' });
    await mk({ name: 'سيروم CeraVe', brand: 'CeraVe', category: 'العناية بالبشرة', product_type: 'serum' });
    await mk({ name: 'زيت أرغان', category: 'العناية بالشعر', product_type: 'oil' });
    await mk({ name: 'منتج بلا نوع', category: 'أخرى' });
    const names = async (qs: string) => (await t.call('GET', '/api/products?view=compact&' + qs, { token: t.staff })).json.products.map((p: { name: string }) => p.name).sort();
    assert.deepEqual(await names('type=cream'), ['كريم شعر', 'كريم وجه']);
    assert.deepEqual(await names('type=cleanser'), ['غسول CeraVe']);
    assert.deepEqual(await names('type=serum'), ['سيروم CeraVe']);
    assert.deepEqual(await names('type=cream&category=' + encodeURIComponent('العناية بالبشرة')), ['كريم وجه'], 'face cream and hair cream do not mix under a category');
    assert.deepEqual(await names('type=none'), ['منتج بلا نوع']);
    assert.equal((await names('')).length, 6, '"all" returns everything');
    assert.deepEqual(await names('q=CeraVe&category=' + encodeURIComponent('العناية بالبشرة') + '&type=serum'), ['سيروم CeraVe'], 'search + category + type');
    const facets = (await t.call('GET', '/api/products/facets?category=' + encodeURIComponent('العناية بالبشرة'), { token: t.staff })).json;
    assert.deepEqual(facets.types, { cream: 1, cleanser: 1, serum: 1 });
    for (const [id, n] of Object.entries(facets.types)) assert.equal((await names(`type=${id}&category=${encodeURIComponent('العناية بالبشرة')}`)).length, n, 'facet count = result count');
    // compact rows carry no long text; pagination + total
    const page = (await t.call('GET', '/api/products?view=compact&limit=2&offset=2', { token: t.staff })).json;
    assert.equal(page.products.length, 2); assert.equal(page.total, 6); assert.ok(!('ingredients' in page.products[0])); assert.ok('has' in page.products[0]);
    assert.equal((await t.call('POST', '/api/products', { token: t.staff, body: { name: 'x', product_type: 'not-a-type' } })).status, 400, 'free text is not a type');
    const p = (await t.call('GET', '/api/products?q=' + encodeURIComponent('كريم وجه'), { token: t.staff })).json.products[0];
    assert.equal(p.classification_status, 'confirmed'); assert.equal(p.application_area, 'face'); assert.equal(p.functions, 'moisturizing');
  } finally { await t.close(); }
});

test('rapid entry: the same submission (double tap / retry) never creates two products; edit keeps the same record', async () => {
  const t = await boot();
  try {
    const body = { name: 'غسول سريع', product_type: 'cleanser', client_ref: 'form-1234-abcd' };
    const [a, b] = await Promise.all([t.call('POST', '/api/products', { token: t.staff, body }), t.call('POST', '/api/products', { token: t.staff, body })]);
    assert.equal(a.json.id, b.json.id); assert.ok(a.json.duplicate_request || b.json.duplicate_request);
    assert.equal((t.db.prepare("SELECT COUNT(*) n FROM products WHERE name = 'غسول سريع'").get() as { n: number }).n, 1);
    const n0 = (t.db.prepare('SELECT COUNT(*) n FROM products').get() as { n: number }).n;
    assert.equal((await t.call('PATCH', `/api/products/${a.json.id}`, { token: t.staff, body: { product_type: 'gel' } })).status, 200);
    assert.equal((t.db.prepare('SELECT COUNT(*) n FROM products').get() as { n: number }).n, n0, 'editing never creates a record');
    assert.equal((await t.call('POST', '/api/products', { token: t.staff, body: { name: 'منتج بلا صورة ولا مصدر' } })).status, 200, 'no image / no enrichment needed');
  } finally { await t.close(); }
});

test('import: old files work; product_type mapped exactly; unknown kept raw for review; name only suggests; ids unchanged', async () => {
  const t = await boot();
  try {
    const old = ['barcode,name,brand,category', '0012345678905,غسول قديم,B,skincare'].join('\n');
    assert.equal((await t.call('POST', '/api/imports/commit?filename=old.csv', { token: t.manager, raw: Buffer.from(old) })).json.new, 1);
    const p1 = t.db.prepare("SELECT id, barcode, product_type, classification_status FROM products WHERE name = 'غسول قديم'").get() as Record<string, string>;
    assert.equal(p1.barcode, '0012345678905'); assert.equal(p1.product_type, 'cleanser'); assert.equal(p1.classification_status, 'suggested', 'name-based = suggestion, not confirmed');
    const csv = ['barcode,name,product_type', ',منتج أ,Cream', ',منتج ب,سيروم', ',منتج ج,Balsamo X', ',منتج د,'].join('\n');
    const pv = await t.call('POST', '/api/imports/preview?filename=t.csv', { token: t.manager, raw: Buffer.from(csv) });
    assert.deepEqual(pv.json.classification, { confirmed: 2, suggested: 0, needs_review: 1, unknown: 1 });
    await t.call('POST', '/api/imports/commit?filename=t.csv', { token: t.manager, raw: Buffer.from(csv) });
    const row = (n: string) => ({ ...(t.db.prepare('SELECT product_type, classification_status, classification_raw FROM products WHERE name = ?').get(n) as Record<string, string>) });
    assert.deepEqual(row('منتج أ'), { product_type: 'cream', classification_status: 'confirmed', classification_raw: '' });
    assert.deepEqual(row('منتج ب'), { product_type: 'serum', classification_status: 'confirmed', classification_raw: '' });
    assert.deepEqual(row('منتج ج'), { product_type: '', classification_status: 'needs_review', classification_raw: 'Balsamo X' });
    const review = (await t.call('GET', '/api/products?classification=review', { token: t.manager })).json.products.map((p: { name: string }) => p.name).sort();
    assert.deepEqual(review, ['غسول قديم', 'منتج ج']);
    // re-classifying never changes identity
    await t.call('PATCH', `/api/products/${p1.id}`, { token: t.manager, body: { product_type: 'gel' } });
    const after = t.db.prepare('SELECT id, barcode FROM products WHERE id = ?').get(p1.id) as Record<string, string>;
    assert.equal(after.barcode, '0012345678905');
  } finally { await t.close(); }
});

test('existing data: conservative suggestion run is reported, dry-run writes nothing, confirmed types are never touched', async () => {
  const t = await boot();
  try {
    t.db.prepare("INSERT INTO products(name, created_at, updated_at) VALUES ('كريم يدين قديم', 'x', 'x'), ('منتج غامض', 'x', 'x')").run();
    t.db.prepare("INSERT INTO products(name, product_type, classification_status, created_at, updated_at) VALUES ('سيروم مؤكد', 'oil', 'confirmed', 'x', 'x')").run();
    const dry = (await t.call('POST', '/api/taxonomy/suggest-existing?dry=1', { token: t.manager })).json;
    assert.equal(dry.applied, false); assert.equal(dry.suggested, 1); assert.equal(dry.unclassifiable, 1);
    assert.equal((t.db.prepare("SELECT product_type FROM products WHERE name = 'كريم يدين قديم'").get() as { product_type: string }).product_type, '');
    assert.equal((await t.call('POST', '/api/taxonomy/suggest-existing', { token: t.staff })).status, 403);
    await t.call('POST', '/api/taxonomy/suggest-existing', { token: t.manager });
    assert.deepEqual({ ...t.db.prepare("SELECT product_type, classification_status FROM products WHERE name = 'كريم يدين قديم'").get() }, { product_type: 'cream', classification_status: 'suggested' });
    assert.deepEqual({ ...t.db.prepare("SELECT product_type, classification_status FROM products WHERE name = 'سيروم مؤكد'").get() }, { product_type: 'oil', classification_status: 'confirmed' }, 'a confirmed (even odd) type is not overwritten');
    const stored = (t.db.prepare("SELECT DISTINCT product_type FROM products WHERE product_type <> ''").all() as { product_type: string }[]).map((r) => r.product_type);
    assert.ok(stored.every((x) => TYPE_IDS.has(x)));
    const cols = (t.db.prepare('PRAGMA table_info(products)').all() as { name: string }[]).map((c) => c.name).join(',');
    assert.doesNotMatch(cols, /price|cost|qty|quantity|discount|invoice|sale/i);
  } finally { await t.close(); }
});

test('advisor: a requested FORM narrows retrieval only — it is not evidence of suitability', async () => {
  const t = await boot();
  try {
    await t.call('POST', '/api/products', { token: t.manager, body: { name: 'منتج سيروم', category: 'العناية بالبشرة', product_type: 'serum' } });
    await t.call('POST', '/api/products', { token: t.manager, body: { name: 'منتج آخر', category: 'العناية بالبشرة', product_type: 'oil' } });
    const r = (await t.call('POST', '/api/advisor/search', { token: t.staff, body: { query: 'أبغى سيروم للبشرة الدهنية' } })).json;
    const all = [...r.store_matches, ...r.cannot_assess];
    const s = all.find((x: { name: string }) => x.name === 'منتج سيروم'); assert.ok(s, 'serum retrieved');
    assert.equal(s.product_type_label, 'سيروم');
    assert.notEqual(s.suitability?.verdict, 'suitable', 'no ingredients => never "suitable" just because it is a serum');
    assert.ok(all.findIndex((x: { name: string }) => x.name === 'منتج سيروم') <= Math.max(0, all.findIndex((x: { name: string }) => x.name === 'منتج آخر')));
  } finally { await t.close(); }
});
