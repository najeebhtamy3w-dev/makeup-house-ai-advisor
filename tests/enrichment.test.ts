import { test, after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './helpers.ts';
import { setConnectors, resetLimiter, processQueueOnce, enrichBarcode } from '../server/src/enrichment/engine.ts';
import { openBeautyFacts } from '../server/src/enrichment/openbeautyfacts.ts';
import { Unreachable, type Connector, type FetchLike } from '../server/src/enrichment/types.ts';

const B1 = '5901234123457', B2 = '4006381333931', BX = '6291041500213';
let t: Awaited<ReturnType<typeof boot>>;
let calls = 0;
const fake = (id: string, name: string, data: Record<string, Record<string, string>>, mode: 'ok' | 'down' = 'ok'): Connector => ({
  id, name, license: 'test', isMock: false,
  async lookupBarcode(code) { calls++; if (mode === 'down') throw new Unreachable('network'); const d = data[code]; return d ? { found: true, fields: d, sourceUrl: 'https://example.org/' + code } : { found: false }; },
});
before(async () => { t = await boot({ MH_ENRICH: 'mock' }); });
beforeEach(() => { resetLimiter(); calls = 0; t.db.exec('DELETE FROM enrichment_candidates; DELETE FROM enrichment_runs; DELETE FROM enrichment_jobs; DELETE FROM product_facts; DELETE FROM products;'); });
after(async () => { await t.close(); });
const lookup = (token: string, barcode: string, force = false) => t.call('POST', '/api/enrichment/lookup', { token, body: { barcode, force } });

test('disabled mode: honest "disabled", nothing invented', async () => {
  setConnectors([]); const r = await lookup(t.staff, B1);
  assert.equal(r.json.outcome, 'disabled'); assert.deepEqual(r.json.candidates, []);
});
test('success: candidates are DRAFTS with source, licence, time; local product untouched', async () => {
  setConnectors([fake('a', 'مصدر أ', { [B1]: { name: 'Gentle Cream', brand: 'X', ingredients: 'Aqua, Glycerin' } })]);
  const id = (await t.call('POST', '/api/products', { token: t.staff, body: { name: 'كريمي', barcode: B1 } })).json.id;
  const r = await lookup(t.staff, B1);
  assert.equal(r.json.outcome, 'found'); assert.equal(r.json.candidates.length, 3);
  assert.ok(r.json.candidates.every((c: any) => c.review_status === 'pending' && c.source_name && c.extracted_at && c.source_url));
  const p = (await t.call('GET', `/api/products/${id}`, { token: t.staff })).json.product;
  assert.equal(p.name, 'كريمي'); assert.equal(p.ingredients, ''); assert.equal(p.verification, 'review');
});
test('not found in source => not_found (no candidates, no invented data)', async () => {
  setConnectors([fake('a', 'أ', {})]); const r = await lookup(t.staff, BX);
  assert.equal(r.json.outcome, 'not_found'); assert.equal(r.json.candidates.length, 0);
});
test('offline / source down => unreachable, recorded, not cached as a miss', async () => {
  setConnectors([fake('a', 'أ', {}, 'down')]); const r = await lookup(t.staff, B1);
  assert.equal(r.json.outcome, 'unreachable');
  setConnectors([fake('a', 'أ', { [B1]: { name: 'N' } })]); const r2 = await lookup(t.staff, B1);
  assert.equal(r2.json.outcome, 'found', 'retry after outage actually queries again');
});
test('cache: repeat lookup within 24h makes no external call; manager force bypasses', async () => {
  setConnectors([fake('a', 'أ', { [B1]: { name: 'N' } })]);
  await lookup(t.staff, B1); await lookup(t.staff, B1); assert.equal(calls, 1);
  await lookup(t.staff, B1, true); assert.equal(calls, 1, 'staff cannot force');
  await lookup(t.manager, B1, true); assert.equal(calls, 2);
});
test('conflict: differs from local value AND between two sources => flagged for review', async () => {
  setConnectors([fake('a', 'مصدر أ', { [B1]: { name: 'Alpha Cream', size: '50 ml' } }), fake('b', 'مصدر ب', { [B1]: { name: 'Beta Cream', size: '50 ml' } })]);
  await t.call('POST', '/api/products', { token: t.staff, body: { name: 'منتج محلي', barcode: B1 } });
  const r = await lookup(t.staff, B1);
  assert.equal(r.json.conflict, true);
  const names = r.json.candidates.filter((c: any) => c.field === 'name'); assert.equal(names.length, 2);
  assert.ok(names.every((c: any) => /يتعارض مع مصدر آخر/.test(c.conflict_note) && /يختلف عن بيانات المحل/.test(c.conflict_note)));
  assert.ok(r.json.candidates.filter((c: any) => c.field === 'size').every((c: any) => c.conflict_note === ''), 'agreeing sources are not conflicts');
});
test('review: manager-only; approve applies field, records provenance, caps at "partial" (never auto-verified)', async () => {
  setConnectors([fake('a', 'مصدر أ', { [B1]: { ingredients: 'Aqua, Glycerin', brand: 'Acme' } })]);
  const id = (await t.call('POST', '/api/products', { token: t.staff, body: { name: 'كريمي', barcode: B1 } })).json.id;
  const r = await lookup(t.staff, B1); const cand = r.json.candidates.find((c: any) => c.field === 'ingredients');
  assert.equal((await t.call('POST', `/api/enrichment/candidates/${cand.id}/review`, { token: t.staff, body: { action: 'approve' } })).status, 403);
  assert.equal((await t.call('GET', '/api/enrichment/pending', { token: t.staff })).status, 403);
  assert.equal((await t.call('POST', `/api/enrichment/candidates/${cand.id}/review`, { token: t.manager, body: { action: 'approve' } })).status, 200);
  const p = (await t.call('GET', `/api/products/${id}`, { token: t.staff })).json.product;
  assert.equal(p.ingredients, 'Aqua, Glycerin'); assert.equal(p.verification, 'partial'); assert.equal(p.source_url, 'https://example.org/' + B1);
  const f = t.db.prepare('SELECT * FROM product_facts WHERE product_id=?').get(id) as any;
  assert.equal(f.origin, 'source'); assert.equal(f.source_name, 'مصدر أ'); assert.equal(f.verified_by, 1); assert.ok(f.verified_at && f.extracted_at);
  assert.equal((await t.call('POST', `/api/enrichment/candidates/${cand.id}/review`, { token: t.manager, body: { action: 'approve' } })).status, 409, 'double review blocked');
});
test('review: manager edit is stored as origin=manual; reject changes nothing; approve without a product is refused', async () => {
  setConnectors([fake('a', 'أ', { [B1]: { name: 'Raw Name', brand: 'Br' } })]);
  const r0 = await lookup(t.staff, B1); const nameC = r0.json.candidates.find((c: any) => c.field === 'name'), brandC = r0.json.candidates.find((c: any) => c.field === 'brand');
  assert.equal((await t.call('POST', `/api/enrichment/candidates/${nameC.id}/review`, { token: t.manager, body: { action: 'approve' } })).status, 409);
  const id = (await t.call('POST', '/api/products', { token: t.staff, body: { name: 'م', barcode: B1 } })).json.id;
  await t.call('POST', `/api/enrichment/candidates/${nameC.id}/review`, { token: t.manager, body: { action: 'approve', value: 'اسم معدّل' } });
  await t.call('POST', `/api/enrichment/candidates/${brandC.id}/review`, { token: t.manager, body: { action: 'reject' } });
  const p = (await t.call('GET', `/api/products/${id}`, { token: t.staff })).json.product;
  assert.equal(p.name, 'اسم معدّل'); assert.equal(p.brand, '');
  assert.equal((t.db.prepare("SELECT origin FROM product_facts WHERE field='name'").get() as any).origin, 'manual');
});
test('review: approving over a VERIFIED product drops it back to review', async () => {
  setConnectors([fake('a', 'أ', { [B1]: { size: '75 ml' } })]);
  const id = (await t.call('POST', '/api/products', { token: t.manager, body: { name: 'م', barcode: B1, source_url: 'https://x.org', verification: 'verified' } })).json.id;
  const c = (await lookup(t.staff, B1)).json.candidates[0];
  await t.call('POST', `/api/enrichment/candidates/${c.id}/review`, { token: t.manager, body: { action: 'approve' } });
  assert.equal((await t.call('GET', `/api/products/${id}`, { token: t.staff })).json.product.verification, 'review');
});
test('mock-sourced approval never writes a source URL (cannot be passed off as sourced)', async () => {
  setConnectors([]); const { configureConnectors } = await import('../server/src/enrichment/engine.ts'); configureConnectors({ ...t.cfg, enrich: 'mock' });
  const id = (await t.call('POST', '/api/products', { token: t.staff, body: { name: 'م', barcode: B2 } })).json.id;
  const r = await lookup(t.staff, B2); const c = r.json.candidates.find((x: any) => x.field === 'ingredients'); assert.equal(c.is_mock, 1);
  await t.call('POST', `/api/enrichment/candidates/${c.id}/review`, { token: t.manager, body: { action: 'approve' } });
  assert.equal((await t.call('GET', `/api/products/${id}`, { token: t.staff })).json.product.source_url, '');
});
test('rate limit: over-limit lookups report rate_limited instead of hammering the source', async () => {
  setConnectors([fake('a', 'أ', {})]); const cfg = { ...t.cfg, enrichRatePerMin: 2 };
  const codes = ['6291041500213', '6291041500381', '5901234123457'];
  const outs = []; for (const b of codes) outs.push((await enrichBarcode(t.db, cfg, b, 1)).outcome);
  assert.deepEqual(outs, ['not_found', 'not_found', 'rate_limited']); assert.equal(calls, 2);
});
test('invalid barcode rejected before any external call', async () => {
  setConnectors([fake('a', 'أ', {})]); assert.equal((await lookup(t.staff, '5901234123458')).status, 400); assert.equal(calls, 0);
});
test('queue: batches, respects limit, retries with backoff, gives up after 5 attempts', async () => {
  const cfg = { ...t.cfg, enrichRatePerMin: 100 };
  for (const b of [B1, B2, BX]) await t.call('POST', '/api/products', { token: t.staff, body: { name: 'م' + b, barcode: b } });
  const st = await t.call('POST', '/api/enrichment/queue/start', { token: t.manager }); assert.equal(st.json.queued, 3);
  assert.equal((await t.call('POST', '/api/enrichment/queue/start', { token: t.manager })).json.queued, 0, 'no duplicate jobs');
  assert.equal((await t.call('POST', '/api/enrichment/queue/start', { token: t.staff })).status, 403);
  setConnectors([fake('a', 'أ', { [B1]: { name: 'N' } })]);
  const r1 = await processQueueOnce(t.db, cfg, 2); assert.equal(r1.processed, 2); assert.equal(r1.stopped, 'batch'); assert.equal(calls, 2);
  setConnectors([fake('a', 'أ', {}, 'down')]); t.db.exec("UPDATE enrichment_jobs SET next_at='2000-01-01' WHERE status='queued'");
  const r2 = await processQueueOnce(t.db, cfg, 5); assert.equal(r2.retried, 1);
  const job = t.db.prepare("SELECT * FROM enrichment_jobs WHERE status='queued'").get() as any; assert.equal(job.attempts, 1); assert.ok(Date.parse(job.next_at) > Date.now(), 'backoff scheduled');
  for (let i = 0; i < 5; i++) { t.db.exec("UPDATE enrichment_jobs SET next_at='2000-01-01' WHERE status='queued'"); await processQueueOnce(t.db, cfg, 5); }
  assert.equal((t.db.prepare("SELECT COUNT(*) n FROM enrichment_jobs WHERE status='failed'").get() as any).n, 1);
});
test('queue: rate-limited run stops and leaves jobs queued (no burst)', async () => {
  for (const b of [B1, B2]) await t.call('POST', '/api/products', { token: t.staff, body: { name: 'م' + b, barcode: b } });
  setConnectors([fake('a', 'أ', {})]); await t.call('POST', '/api/enrichment/queue/start', { token: t.manager });
  const r = await processQueueOnce(t.db, { ...t.cfg, enrichRatePerMin: 1 }, 5); assert.equal(r.processed, 1); assert.equal(r.stopped, 'rate_limited');
  assert.equal((t.db.prepare("SELECT COUNT(*) n FROM enrichment_jobs WHERE status='queued'").get() as any).n, 1);
});
test('status endpoint reports mode/connectors/queue honestly', async () => {
  setConnectors([fake('a', 'أ', {})]); const s = (await t.call('GET', '/api/enrichment/status', { token: t.staff })).json;
  assert.equal(s.connectors[0].mock, false); assert.equal(s.connectors[0].id, 'a'); assert.ok('queue' in s);
});
test('no price/cost/quantity columns in enrichment tables', () => {
  const cols = t.db.prepare("SELECT m.name t, p.name c FROM sqlite_master m, pragma_table_info(m.name) p WHERE m.type='table' AND m.name LIKE 'enrichment%'").all() as { c: string }[];
  assert.ok(cols.length > 10); assert.deepEqual(cols.filter((x) => /price|cost|qty|quantity|amount/i.test(x.c)), []);
});

// ---- OBF connector with RECORDED-SHAPE fixtures (no live network) ----
const resp = (status: number, body: unknown): ReturnType<FetchLike> => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
test('OBF connector: parses fields, sends identifying User-Agent, restricts requested fields', async () => {
  let seen: { url: string; ua?: string } = { url: '' };
  const c = openBeautyFacts({ contact: 'ops@example.com', fetchImpl: (u, i) => { seen = { url: u, ua: i?.headers?.['user-agent'] }; return resp(200, { status: 'success', product: { code: B1, product_name: ' Gentle Lotion ', brands: 'Acme, Other', quantity: '200 ml', ingredients_text: 'Aqua, Parfum', price: 12 } }); } });
  const r = await c.lookupBarcode(B1);
  assert.ok(r.found); assert.deepEqual((r as any).fields, { name: 'Gentle Lotion', brand: 'Acme', size: '200 ml', ingredients: 'Aqua, Parfum' });
  assert.match(seen.ua!, /^MakeupHouseAdvisor\/3\.0 \(ops@example\.com\)$/); assert.match(seen.url, /\/api\/v3\/product\/[0-9]+\?product_type=beauty&fields=code,product_name,brands,quantity,ingredients_text/);
  assert.ok(!('price' in (r as any).fields), 'unexpected fields (price) are never read');
});
test('OBF connector: status 0 / 404 => not found; 5xx / network / bad JSON / timeout => Unreachable', async () => {
  const mk = (f: FetchLike, timeoutMs?: number) => openBeautyFacts({ contact: 'x@y.z', fetchImpl: f, timeoutMs });
  assert.equal((await mk(() => resp(200, { status: 'failure' })).lookupBarcode(B1)).found, false);
  assert.equal((await mk(() => resp(200, { status: 0 })).lookupBarcode(B1)).found, false); // legacy v2 shape tolerated
  await assert.rejects(mk(() => resp(200, { unexpected: true })).lookupBarcode(B1), Unreachable); // API shape changed
  await assert.rejects(mk(() => resp(200, 'text')).lookupBarcode(B1), Unreachable);
  assert.equal((await mk(() => resp(200, { status: 'success', product: { code: '9999999999994', product_name: 'Other' } })).lookupBarcode(B1)).found, false); // different product code => not our product
  assert.equal((await mk(() => resp(404, {})).lookupBarcode(B1)).found, false);
  await assert.rejects(mk(() => resp(503, {}) ).lookupBarcode(B1), Unreachable);
  await assert.rejects(mk(() => Promise.reject(new Error('ECONNRESET'))).lookupBarcode(B1), Unreachable);
  await assert.rejects(mk(() => Promise.resolve({ ok: true, status: 200, json: async () => { throw new Error('x'); } })).lookupBarcode(B1), Unreachable);
  await assert.rejects(mk((_u, i) => new Promise((_r, rej) => i!.signal!.addEventListener('abort', () => rej(new Error('abort')))), 30).lookupBarcode(B1), Unreachable);
});

// ---- CP03: product identity / formulation comparison ----
import { compareSize, compareName, compareBrand, compareIngredients, parseSize, inciList } from '../server/src/enrichment/identity.ts';
test('identity: sizes compare by unit-normalised value (200ml == 200 ml == ٢٠٠ مل; 200 ml != 250 ml; oz/ml converted)', () => {
  assert.deepEqual(parseSize('٢٠٠ مل'), { unit: 'ml', v: 200 });
  assert.equal(compareSize('200 ml', '200ml').match, 'exact');
  assert.equal(compareSize('200 ml', '250 ml').match, 'conflict');
  assert.equal(compareSize('1 l', '1000 ml').match, 'exact');
  assert.equal(compareSize('200 ml', '50 g').match, 'conflict');
  assert.equal(compareSize('large', 'big').match, 'partial'); // uninterpretable => needs a human, never silently equal
});
test('identity: name similarity is never proof — variant words give partial/conflict, brand mismatch is a conflict', () => {
  assert.equal(compareName('Gentle Cleanser', 'gentle  cleanser').match, 'exact');
  assert.equal(compareName('Daily Moisturizer SPF 30', 'Daily Moisturizer SPF 50').match, 'partial');
  assert.equal(compareName('Gentle Cleanser', 'Rose Lip Tint').match, 'conflict');
  assert.equal(compareBrand('Acme', 'ACME').match, 'exact'); assert.equal(compareBrand('Acme', 'Other').match, 'conflict');
});
test('identity: INCI comparison — same list exact; reordered = partial (order encodes concentration); different list = conflict', () => {
  assert.deepEqual(inciList('Water, Glycerin (vegetable), Parfum.'), ['aqua', 'glycerin', 'parfum']);
  assert.equal(compareIngredients('Aqua, Glycerin, Parfum', 'Water, Glycerin, Parfum').match, 'exact');
  assert.equal(compareIngredients('Aqua, Glycerin, Parfum', 'Aqua, Parfum, Glycerin').match, 'partial');
  assert.equal(compareIngredients('Aqua, Glycerin, Parfum', 'Aqua, Zinc Oxide, Tocopherol').match, 'conflict');
  assert.equal(compareIngredients('Aqua, Glycerin', '').match, 'partial');
});
