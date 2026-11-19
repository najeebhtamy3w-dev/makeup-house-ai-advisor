import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './helpers.ts';
import { setConnectors, resetLimiter } from '../server/src/enrichment/engine.ts';
import { resetSearchLimiter } from '../server/src/discovery.ts';
import { classifyIngredients } from '../server/src/enrichment/identity.ts';
import { openBeautyFacts } from '../server/src/enrichment/openbeautyfacts.ts';
import { Unreachable, type Connector } from '../server/src/enrichment/types.ts';

const B1 = '3337875598996', B30 = '4005808801053', B150 = '4005800001192';
/** Recorded-shape fake source: one barcode record + a name search returning the SAME name in different sizes. */
function fakeSource(opts: { down?: boolean } = {}): Connector {
  return {
    id: 'fake', name: 'FakeSource', license: 'test', isMock: false,
    async lookupBarcode(code) {
      if (opts.down) throw new Unreachable('network');
      if (code === B1) return { found: true, sourceUrl: 'https://example.invalid/p/' + code, fields: { name: 'moisturising cream', brand: 'CeraVe', ingredients: 'Eau, glycérine, alcool cétéarylique, triglycéride' }, notes: { ingredients: 'قائمة مترجمة وليست بأسماء INCI القياسية — قارنها بالعبوة قبل الاعتماد', size: 'المصدر ذكر حجمًا بلا وحدة — لم يُقترح' } };
      return { found: false };
    },
    async searchByName() {
      if (opts.down) throw new Unreachable('network');
      return [
        { code: B30, name: 'Nivea Creme', brand: 'Nivea', size: '30 ml', has_image: true, source_url: 'https://example.invalid/p/' + B30 },
        { code: B150, name: 'Nivea Creme', brand: 'Nivea', size: '150 ml', has_image: true, source_url: 'https://example.invalid/p/' + B150 },
        { code: '4005900890504', name: 'Nivea Soft', brand: 'Nivea', size: '200 ml', has_image: false, source_url: 'https://example.invalid/p/4005900890504' },
      ];
    },
  };
}
const reset = () => { resetLimiter(); resetSearchLimiter(); };

test('identify by barcode: store first, then source drafts with quality notes; nothing auto-approved', async () => {
  const t = await boot(); setConnectors([fakeSource()]); reset();
  try {
    const r = await t.call('POST', '/api/discovery/identify', { token: t.staff, body: { barcode: B1 } });
    assert.equal(r.status, 200); assert.equal(r.json.global.mode, 'barcode'); assert.equal(r.json.global.outcome, 'found');
    assert.equal(r.json.global.status, 'تطابق محتمل — يحتاج مراجعة');
    const ing = r.json.global.candidates.find((c: { field: string }) => c.field === 'ingredients');
    assert.match(ing.quality_note, /مترجمة/); assert.ok(!r.json.global.candidates.some((c: { field: string }) => c.field === 'size'), 'no unitless size');
    assert.match(r.json.coverage_note, /تغطيتها جزئية/);
    assert.equal((t.db.prepare('SELECT COUNT(*) n FROM products').get() as { n: number }).n, 0, 'identify never creates a product');
    // once the card exists, the same barcode is reported as already in the store (duplicate prevention)
    const pid = (await t.call('POST', '/api/products', { token: t.staff, body: { name: 'CeraVe cream', barcode: B1 } })).json.id;
    const again = await t.call('POST', '/api/discovery/identify', { token: t.staff, body: { barcode: B1 } });
    assert.equal(again.json.local[0].id, pid); assert.equal(again.json.local[0].status, 'same_barcode');
    // product-scoped suggestions: staff can SEE them, cannot approve them
    const sug = await t.call('GET', `/api/products/${pid}/suggestions`, { token: t.staff });
    assert.ok(sug.json.candidates.length >= 2); assert.ok(sug.json.candidates.every((c: { quality_note: string }) => typeof c.quality_note === 'string'));
    assert.equal((await t.call('POST', `/api/enrichment/candidates/${sug.json.candidates[0].id}/review`, { token: t.staff, body: { action: 'approve' } })).status, 403);
    assert.equal((await t.call('GET', `/api/products/${pid}`, { token: t.staff })).json.product.ingredients, '', 'nothing written to the product');
    assert.ok((await t.call('GET', `/api/products/${pid}`, { token: t.staff })).json.product.pending_suggestions >= 2);
  } finally { setConnectors([]); await t.close(); }
});

test('identify by name: candidates with reasons; same name in different sizes stays separate; never auto-approved', async () => {
  const t = await boot(); setConnectors([fakeSource()]); reset();
  try {
    const r = await t.call('POST', '/api/discovery/identify', { token: t.staff, body: { name: 'Nivea Creme', brand: 'Nivea', size: '150 ml' } });
    assert.equal(r.json.global.mode, 'name'); assert.equal(r.json.global.outcome, 'found');
    const hits = r.json.global.hits as { code: string; status: string; reasons: { field: string; match: string; note: string }[] }[];
    assert.equal(hits[0].code, B150, '150 ml ranks first for a 150 ml query');
    const h30 = hits.find((h) => h.code === B30)!; assert.equal(h30.reasons.find((x) => x.field === 'size')!.match, 'conflict');
    assert.ok(hits.every((h) => h.status === 'تطابق محتمل — يحتاج مراجعة'));
    assert.equal((t.db.prepare('SELECT COUNT(*) n FROM enrichment_candidates').get() as { n: number }).n, 0, 'a name search stores nothing');
    assert.equal((await t.call('POST', '/api/discovery/identify', { token: t.staff, body: { name: 'x' } })).status, 400);
    assert.equal((await t.call('POST', '/api/discovery/identify', { token: t.staff, body: { barcode: '4005808801054' } })).status, 400, 'bad check digit');
  } finally { setConnectors([]); await t.close(); }
});

test('identify: local possible duplicates by name, but a different size is labelled, not merged', async () => {
  const t = await boot(); setConnectors([]); reset();
  try {
    await t.call('POST', '/api/products', { token: t.staff, body: { name: 'Nivea Creme', brand: 'Nivea', size: '30 ml' } });
    const r = await t.call('POST', '/api/discovery/identify', { token: t.staff, body: { name: 'Nivea Creme', brand: 'Nivea', size: '150 ml' } });
    assert.equal(r.json.global.mode, 'disabled');
    assert.equal(r.json.local.length, 1); assert.equal(r.json.local[0].status, 'possible_duplicate');
    assert.equal(r.json.local[0].reasons.find((x: { field: string }) => x.field === 'size').match, 'conflict');
  } finally { await t.close(); }
});

test('identify: source down => unreachable (not "not found"); rate limit respected', async () => {
  const t = await boot(); setConnectors([fakeSource({ down: true })]); reset();
  try {
    assert.equal((await t.call('POST', '/api/discovery/identify', { token: t.staff, body: { name: 'Nivea Creme' } })).json.global.outcome, 'unreachable');
    assert.equal((await t.call('POST', '/api/discovery/identify', { token: t.staff, body: { barcode: B1 } })).json.global.outcome, 'unreachable');
    setConnectors([fakeSource()]);
    let last = ''; for (let i = 0; i < 9; i++) last = (await t.call('POST', '/api/discovery/identify', { token: t.staff, body: { name: 'Nivea Creme ' + i } })).json.global.outcome;
    assert.equal(last, 'rate_limited');
  } finally { setConnectors([]); await t.close(); }
});

test('ingredients classifier: marketing text is not an INCI list; translated lists are flagged', async () => {
  assert.equal(classifyIngredients("La formule maintient l'hydratation & rend votre peau plus douce pendant 48h.").kind, 'not_a_list');
  assert.equal(classifyIngredients('Ce lait hydratant convient aux peaux sèches. Appliquer matin et soir.').kind, 'not_a_list');
  assert.equal(classifyIngredients('Eau, glycérine, alcool cétéarylique').kind, 'translated');
  assert.equal(classifyIngredients('Aqua, Glycerin, Cetearyl Alcohol, Ceramide NP').kind, 'inci');
  assert.equal(classifyIngredients('Paraffinum Liquidum').kind, 'inci');
  // recorded live (2026-11-19, OBF 4005900369581): marketing paragraph + "Ingredients:" + OCR noise
  assert.equal(classifyIngredients('La formule maintient rhydratation & rend votre peau plus douce pendant 48h. NIVEA Nourishing Cocoa Loção foi enriquecida com NIVEA DEEP MOISTURE SERUM e preciosa manteiga de cacau e vitamina E. Ingredients: Aqua, Glycerin, C15-19 Alkane, Cetearyl Alcohol, Dimethicone, 4 005900 369581 Glyceryl Stearate, Linalool').kind, 'not_a_list');
  const c = openBeautyFacts({ contact: 'x', fetchImpl: () => Promise.resolve({ ok: true, status: 200, json: async () => ({ status: 'success', product: { code: B1, product_name: 'lotion', ingredients_text: 'Notre formule hydrate votre peau toute la journée.' } }) }) as never });
  const r = await c.lookupBarcode(B1); assert.ok(r.found && !('ingredients' in r.fields), 'marketing text never proposed as ingredients');
});

test('import: no images/ingredients needed; leading zeros kept; categories mapped; Excel scientific notation refused', async () => {
  const t = await boot();
  try {
    const csv = ['barcode,name,brand,category,size,price,qty', '0012345678905,منتج بصفر,DemoB,skincare,50 ml,9.5,3', '6.29104E+12,منتج علمي,,,,,', ',منتج بلا باركود,,صنف غريب,,,', ',منتج بلا باركود,,صنف غريب,,,'].join('\n');
    const p = await t.call('POST', '/api/imports/preview?filename=a.csv', { token: t.manager, raw: Buffer.from(csv) });
    assert.equal(p.json.new, 2); assert.equal(p.json.duplicates_in_file, 1, 'barcode-less duplicate inside the file'); assert.equal(p.json.invalid, 1);
    assert.match(p.json.invalid_rows[0].reason, /صيغة علمية/); assert.ok(p.json.warnings.some((w: string) => /أخرى/.test(w)));
    assert.deepEqual(p.json.missing, { barcode: 1, brand: 1, size: 1 });
    assert.equal((t.db.prepare('SELECT COUNT(*) n FROM products').get() as { n: number }).n, 0, 'preview writes nothing');
    await t.call('POST', '/api/imports/commit?filename=a.csv', { token: t.manager, raw: Buffer.from(csv) });
    const z = t.db.prepare("SELECT barcode, category FROM products WHERE name = 'منتج بصفر'").get() as { barcode: string; category: string };
    assert.equal(z.barcode, '0012345678905', 'leading zeros preserved'); assert.equal(z.category, 'العناية بالبشرة');
    const odd = t.db.prepare("SELECT id, category FROM products WHERE name = 'منتج بلا باركود'").get() as { id: number; category: string };
    assert.equal(odd.category, 'أخرى');
    assert.equal((await t.call('PATCH', `/api/products/${odd.id}`, { token: t.manager, body: { size: '100 ml' } })).status, 200, 'imported product stays editable');
    const again = await t.call('POST', '/api/imports/commit?filename=a.csv', { token: t.manager, raw: Buffer.from(csv) });
    assert.equal(again.json.new, 0, 're-import creates no duplicates (with or without barcode)');
    assert.equal(again.json.possible_duplicates, 1, 'size now differs on one side only: reported, not imported');
    const cols = (t.db.prepare('PRAGMA table_info(products)').all() as { name: string }[]).map((c) => c.name).join(',');
    assert.doesNotMatch(cols, /price|cost|qty|quantity/i);
  } finally { await t.close(); }
});

test('import: completes only EMPTY fields of existing non-verified records; never overwrites; name conflicts reported, not applied', async () => {
  const t = await boot();
  try {
    const a = (await t.call('POST', '/api/products', { token: t.manager, body: { name: 'كريم أ', barcode: B1 } })).json.id;
    const b = (await t.call('POST', '/api/products', { token: t.manager, body: { name: 'كريم ب', brand: 'BrandB', barcode: B30, verification: 'verified', source_url: 'https://example.invalid/b' } })).json.id;
    const cc = (await t.call('POST', '/api/products', { token: t.manager, body: { name: 'كريم ج', brand: 'Old', barcode: B150 } })).json.id;
    const csv = ['barcode,name,brand,size', `${B1},كريم أ,NewBrand,50 ml`, `${B30},كريم ب,Other,75 ml`, `${B150},شامبو مختلف تمامًا,X,1 l`].join('\n');
    const p = await t.call('POST', '/api/imports/preview?filename=b.csv', { token: t.manager, raw: Buffer.from(csv) });
    assert.equal(p.json.new, 0); assert.equal(p.json.completions, 1); assert.equal(p.json.conflicts, 1); assert.equal(p.json.conflict_rows[0].existing_id, cc);
    await t.call('POST', '/api/imports/commit?filename=b.csv', { token: t.manager, raw: Buffer.from(csv) });
    const ga = (await t.call('GET', `/api/products/${a}`, { token: t.manager })).json.product; assert.equal(ga.brand, 'NewBrand'); assert.equal(ga.size, '50 ml'); assert.equal(ga.verification, 'review');
    const gb = (await t.call('GET', `/api/products/${b}`, { token: t.manager })).json.product; assert.equal(gb.brand, 'BrandB'); assert.equal(gb.size, ''); assert.equal(gb.verification, 'verified', 'verified record untouched');
    const gc = (await t.call('GET', `/api/products/${cc}`, { token: t.manager })).json.product; assert.equal(gc.name, 'كريم ج'); assert.equal(gc.brand, 'Old', 'conflicting row changes nothing');
  } finally { await t.close(); }
});

test('import: row cap is enforced with a clear message', async () => {
  const t = await boot();
  try {
    const lines = ['name']; for (let i = 0; i < 10001; i++) lines.push('p' + i);
    const r = await t.call('POST', '/api/imports/preview?filename=big.csv', { token: t.manager, raw: Buffer.from(lines.join('\n')) });
    assert.equal(r.status, 400); assert.match(r.json.error, /قسّمه/);
  } finally { await t.close(); }
});

test('completeness filters: no image / missing info / pending suggestions', async () => {
  const t = await boot(); setConnectors([fakeSource()]); reset();
  try {
    const full = (await t.call('POST', '/api/products', { token: t.staff, body: { name: 'كامل', brand: 'B', size: '50 ml', ingredients: 'Aqua, Glycerin', barcode: B30 } })).json.id;
    const bare = (await t.call('POST', '/api/products', { token: t.staff, body: { name: 'ناقص', barcode: B1 } })).json.id;
    await t.call('POST', '/api/discovery/identify', { token: t.staff, body: { barcode: B1 } });
    const ids = async (m: string) => (await t.call('GET', '/api/products?missing=' + m, { token: t.staff })).json.products.map((p: { id: number }) => p.id);
    assert.deepEqual((await ids('info')).sort(), [bare]);
    assert.deepEqual((await ids('pending')).sort(), [bare]);
    assert.deepEqual((await ids('image')).sort((x: number, y: number) => x - y), [full, bare].sort((x, y) => x - y));
  } finally { setConnectors([]); await t.close(); }
});
