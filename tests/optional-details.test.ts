import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './helpers.ts';

// CP05 correction: package contents (size, INCI) and usage/benefits/warnings are fully OPTIONAL.
// Saving never invents them, never treats their absence as evidence, and never marks the product as verified.
const OPTIONAL = ['size', 'ingredients', 'benefits', 'warnings'] as const;

test('save succeeds with ALL optional details empty (omitted or explicit ""), nothing is invented, status stays "review"', async () => {
  const t = await boot();
  try {
    const a = await t.call('POST', '/api/products', { token: t.staff, body: { name: 'منتج بلا تفاصيل أ' } });
    const b = await t.call('POST', '/api/products', { token: t.staff, body: { name: 'منتج بلا تفاصيل ب', size: '', ingredients: '', benefits: '', warnings: '' } });
    for (const r of [a, b]) {
      assert.equal(r.status, 200, JSON.stringify(r.json));
      const p = (await t.call('GET', `/api/products/${r.json.id}`, { token: t.staff })).json.product;
      for (const k of OPTIONAL) assert.equal(p[k], '', `${k} stays empty — no default text`);
      assert.equal(p.verification, 'review', 'a saved card is never "verified" by itself');
      assert.equal(p.source_url, '');
    }
  } finally { await t.close(); }
});

test('save with ingredients only, and with usage only — only what was entered is stored', async () => {
  const t = await boot();
  try {
    const i = (await t.call('POST', '/api/products', { token: t.staff, body: { name: 'مكونات فقط', ingredients: 'Aqua, Glycerin' } })).json.id;
    const u = (await t.call('POST', '/api/products', { token: t.staff, body: { name: 'استخدام فقط', benefits: 'ترطيب يومي كما يذكر المصنع' } })).json.id;
    const pi = (await t.call('GET', `/api/products/${i}`, { token: t.staff })).json.product;
    const pu = (await t.call('GET', `/api/products/${u}`, { token: t.staff })).json.product;
    assert.deepEqual([pi.ingredients, pi.benefits, pi.warnings, pi.size], ['Aqua, Glycerin', '', '', '']);
    assert.deepEqual([pu.ingredients, pu.benefits, pu.warnings, pu.size], ['', 'ترطيب يومي كما يذكر المصنع', '', '']);
    assert.equal(pi.verification, 'review'); assert.equal(pu.verification, 'review');
  } finally { await t.close(); }
});

test('missing details are marked incomplete and are never evidence: advisor says "insufficient / unknown", never suitable or fragrance-free', async () => {
  const t = await boot();
  try {
    const id = (await t.call('POST', '/api/products', { token: t.manager, body: { name: 'مرطب بلا مكونات', category: 'العناية بالبشرة', product_type: 'cream' } })).json.id;
    // incomplete in the catalog
    const info = (await t.call('GET', '/api/products?missing=info', { token: t.staff })).json.products.map((p: { id: number }) => p.id);
    assert.ok(info.includes(id), 'listed under "missing info"');
    const row = (await t.call('GET', '/api/products?view=compact', { token: t.staff })).json.products.find((p: { id: number }) => p.id === id);
    assert.deepEqual([row.has.ingredients, row.has.warnings], [false, false]);
    // advisor: absence is not safety, not suitability, not fragrance-free
    const r = (await t.call('POST', '/api/advisor/search', { token: t.staff, body: { query: 'مرطب للبشرة الحساسة بدون عطر' } })).json;
    const all = [...r.store_matches, ...r.cannot_assess, ...(r.excluded ?? [])];
    const hit = all.find((x: { id: number }) => x.id === id);
    if (hit) {
      assert.notEqual(hit.suitability?.verdict, 'suitable');
      assert.notEqual(hit.fragrance?.status, 'fragrance_free', 'no list => never "fragrance-free"');
    }
    assert.ok(!r.store_matches.some((x: { id: number; suitability?: { verdict: string } }) => x.id === id && x.suitability?.verdict === 'suitable'));
    const q = (await t.call('POST', '/api/advisor/search', { token: t.staff, body: { query: 'هل مرطب بلا مكونات فيه عطر؟' } })).json;
    if (q.answer?.type === 'fragrance_status') assert.notEqual(q.answer.fragrance.status, 'fragrance_free');
  } finally { await t.close(); }
});

test('whitespace-only text sent straight to the API is not treated as a documented list', async () => {
  const t = await boot();
  try {
    const id = (await t.call('POST', '/api/products', { token: t.manager, body: { name: 'نص فارغ بمسافات', brand: 'B', size: '50 ml', barcode: '3337875598996', ingredients: '   \n  ', warnings: '   ', benefits: '  ' } })).json.id;
    const p = (await t.call('GET', `/api/products/${id}`, { token: t.staff })).json.product;
    assert.deepEqual([p.ingredients, p.warnings, p.benefits], ['', '', ''], 'stored as empty, not as blank text');
    const q = (await t.call('POST', '/api/advisor/search', { token: t.staff, body: { query: 'هل نص فارغ بمسافات فيه عطر؟' } })).json;
    assert.equal(q.answer?.type, 'fragrance_status'); assert.notEqual(q.answer.fragrance.status, 'fragrance_free'); assert.notEqual(q.answer.formulation.status, 'verified');
    const info = (await t.call('GET', '/api/products?missing=info', { token: t.staff })).json.products.map((p: { id: number }) => p.id);
    assert.ok(info.includes(id), 'whitespace counts as missing');
  } finally { await t.close(); }
});

test('completing the details later updates the SAME record (no duplicate) and still does not verify it', async () => {
  const t = await boot();
  try {
    const id = (await t.call('POST', '/api/products', { token: t.staff, body: { name: 'يُستكمل لاحقًا', barcode: '3337875598996' } })).json.id;
    const n0 = (t.db.prepare('SELECT COUNT(*) n FROM products').get() as { n: number }).n;
    assert.equal((await t.call('PATCH', `/api/products/${id}`, { token: t.staff, body: { size: '50 ml' } })).status, 200);
    assert.equal((await t.call('PATCH', `/api/products/${id}`, { token: t.staff, body: { ingredients: 'Aqua, Glycerin', warnings: 'للاستخدام الخارجي فقط' } })).status, 200);
    assert.equal((t.db.prepare('SELECT COUNT(*) n FROM products').get() as { n: number }).n, n0, 'no duplicate');
    const p = (await t.call('GET', `/api/products/${id}`, { token: t.staff })).json.product;
    assert.deepEqual([p.size, p.ingredients, p.warnings, p.benefits], ['50 ml', 'Aqua, Glycerin', 'للاستخدام الخارجي فقط', '']);
    assert.equal(p.verification, 'review', 'entering data does not verify it — only a manager with a source can');
    assert.equal((await t.call('PATCH', `/api/products/${id}`, { token: t.staff, body: { verification: 'verified' } })).status, 403);
  } finally { await t.close(); }
});
