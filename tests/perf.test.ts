import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './helpers.ts';

let t: Awaited<ReturnType<typeof boot>>;
before(async () => {
  t = await boot();
  const ins = t.db.prepare("INSERT INTO products(barcode,name,brand,category,size,availability,availability_updated_at,verification,ingredients,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)");
  const cats = ['العناية بالبشرة', 'العناية بالشعر', 'واقيات الشمس', 'المكياج والجمال'];
  const now = new Date().toISOString(); t.db.exec('BEGIN');
  for (let i = 0; i < 10000; i++) ins.run(null, `${['مرطب', 'شامبو', 'واقي شمس', 'كريم', 'غسول'][i % 5]} رقم ${i}`, 'B' + (i % 50), cats[i % 4], '50 مل', i % 3 ? 'yes' : 'unknown', now, i % 7 ? 'review' : 'partial', i % 2 ? 'Aqua, Glycerin' : '', now, now);
  t.db.exec('COMMIT');
});
after(async () => { await t.close(); });
const ms = async (f: () => Promise<unknown>) => { const s = performance.now(); await f(); return performance.now() - s; };

test('perf @10,000 products: list/search < 400ms, advisor < 1500ms (measured, budget is generous for mid-range hosting)', async () => {
  const list = await ms(() => t.call('GET', '/api/products?limit=100&q=' + encodeURIComponent('مرطب'), { token: t.staff }));
  const filt = await ms(() => t.call('GET', '/api/products?limit=100&category=' + encodeURIComponent('واقيات الشمس') + '&verification=review', { token: t.staff }));
  const adv = await ms(() => t.call('POST', '/api/advisor/search', { token: t.staff, body: { query: 'بشرتها جافة وتريد مرطب بدون عطر' } }));
  console.log(`# perf: list=${list.toFixed(0)}ms filtered=${filt.toFixed(0)}ms advisor=${adv.toFixed(0)}ms`);
  assert.ok(list < 400, `list ${list}`); assert.ok(filt < 400, `filter ${filt}`); assert.ok(adv < 1500, `advisor ${adv}`);
});
test('perf: advisor response size is bounded (does not dump thousands of products to the client)', async () => {
  const r = await t.call('POST', '/api/advisor/search', { token: t.staff, body: { query: 'مرطب' } });
  assert.ok(r.json.store_matches.length <= 8 && r.json.cannot_assess.length <= 6 && r.json.totals.store > 8 && r.json.notes.some((n: string) => n.includes("أفضل 8")), `matches=${r.json.store_matches.length}`);
});

// CP05 audit: the earlier budget used products WITHOUT ingredients. With realistic INCI lists on every product and many
// matches, the advisor spent ~9 s computing "alternatives" for every match (O(n²)). Regression guard on the real shape.
test('perf @10,000 products WITH realistic INCI: advisor stays fast even when thousands of products match', async () => {
  const inci = 'Aqua, Glycerin, Cetearyl Alcohol, Caprylic/Capric Triglyceride, Dimethicone, Ceramide NP, Niacinamide, Sodium Hyaluronate, Phenoxyethanol, Ethylhexylglycerin, Carbomer, Tocopherol, Panthenol, Allantoin, Citric Acid, Xanthan Gum, Disodium EDTA, Squalane, Cholesterol, Glyceryl Stearate';
  t.db.prepare("UPDATE products SET ingredients = ?, verification = 'partial', category = 'العناية بالبشرة'").run(inci);
  for (const q of ['غسول للبشرة الدهنية', 'مرطب للبشرة الجافة', 'كريم للبشرة الحساسة']) {
    let r: { status: number; json: { store_matches: unknown[] } } | undefined;
    const d = await ms(async () => { r = await t.call('POST', '/api/advisor/search', { token: t.staff, body: { query: q } }); });
    assert.equal(r!.status, 200); assert.ok(r!.json.store_matches.length <= 8);
    assert.ok(d < 1500, `${q}: ${Math.round(d)}ms`);
  }
});
