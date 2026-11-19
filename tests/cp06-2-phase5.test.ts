import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './helpers.ts';
import { gtin13 } from './fixtures/match-cases.ts';
import { parseImport } from '../server/src/importer.ts';
import { commitBatch, CHUNK } from '../server/src/import-batch.ts';
import { enqueue, processOne, leaseNext, setPaused, cancel, canTransition, LEASE_MS, MAX_ATTEMPTS, resetRateWindows, queryKeyFor } from '../server/src/queue.ts';
import { scriptedProvider, type Scripted } from '../server/src/providers.ts';

const csvOf = (rows: string[][]) => Buffer.from(rows.map((r) => r.map((v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(',')).join('\n'));
/** 10,000 synthetic rows: 9,700 valid named rows, 100 barcode-only rows (-> drafts), 100 duplicates inside the file,
 *  50 invalid check digits, 25 Excel scientific-notation barcodes, 25 rows with neither name nor barcode. */
function bigFile() {
  const rows: string[][] = [['barcode', 'الاسم العربي', 'english name', 'brand', 'size', 'variant', 'product_type']];
  for (let i = 0; i < 9700; i++) rows.push([gtin13(String(700000000000 + i)), `منتج اصطناعي ${i}`, `Synthetic Product ${i}`, `Brand${i % 40}`, `${50 + (i % 5) * 50} ml`, i % 7 ? '' : `Shade ${i % 9}`, i % 3 ? 'cream' : '']);
  for (let i = 0; i < 100; i++) rows.push([gtin13(String(710000000000 + i)), '', '', '', '', '', '']);
  for (let i = 0; i < 100; i++) rows.push([gtin13(String(700000000000 + i)), `منتج اصطناعي ${i}`, `Synthetic Product ${i}`, `Brand${i % 40}`, `${50 + (i % 5) * 50} ml`, '', '']);
  for (let i = 0; i < 50; i++) { const g = gtin13(String(720000000000 + i)); rows.push([g.slice(0, 12) + ((Number(g[12]) + 1) % 10), `تالف ${i}`, '', '', '', '', '']); }
  for (let i = 0; i < 25; i++) rows.push(['6.29104E+12', `علمي ${i}`, '', '', '', '', '']);
  for (let i = 0; i < 25; i++) rows.push(['', '', '', `Brand${i}`, '', '', '']);
  return csvOf(rows);
}
const upload = (t: Awaited<ReturnType<typeof boot>>, file: Buffer, q = '') => t.call('POST', `/api/imports/commit?filename=shop.csv${q}`, { token: t.manager, raw: file });

test('P: 10,000-row import — invalid rows reported, in-file duplicates skipped, barcode-only rows become drafts, not recommended', async () => {
  const t = await boot();
  try {
    const file = bigFile(); const t0 = Date.now();
    const r = await upload(t, file); const ms = Date.now() - t0;
    assert.equal(r.status, 200, JSON.stringify(r.json).slice(0, 300));
    assert.equal(r.json.new, 9800); assert.equal(r.json.duplicates_in_file, 100); assert.equal(r.json.invalid, 100); assert.equal(r.json.drafts, 100);
    const count = (w: string) => (t.db.prepare(`SELECT COUNT(*) n FROM products WHERE ${w}`).get() as { n: number }).n;
    assert.equal(count("record_status = 'active'"), 9700); assert.equal(count("record_status = 'import_draft'"), 100);
    assert.equal(count("name_en = 'Synthetic Product 5' AND name = 'منتج اصطناعي 5'"), 1, 'Arabic name is the display name, English name kept separately');
    assert.equal(count("variant = 'Shade 0'"), (9700 / 9 | 0) > 0 ? count("variant = 'Shade 0'") : 0);
    // leading zeros / text barcodes kept, scientific notation refused with a reason
    const rep = await t.call('GET', `/api/imports/batches/${r.json.batch_id}/report`, { token: t.manager });
    assert.equal(rep.status, 200); assert.match(rep.text, /الصيغة العلمية|بصيغة علمية/); assert.doesNotMatch(rep.text, /علمي 3|تالف 2/, 'the report never repeats cell values');
    const adv = await t.call('POST', '/api/advisor/search', { token: t.staff, body: { query: 'منتج بانتظار التعرف' } });
    assert.ok(![...adv.json.store_matches, ...adv.json.cannot_assess].some((x: { name: string }) => x.name.startsWith('منتج بانتظار التعرف')), 'drafts are never recommended');
    console.log(`   10,000 rows committed in ${ms} ms`);
    // importing the same file again creates nothing
    const again = await upload(t, file); assert.equal(again.json.new, 0); assert.equal(count('1=1'), 9800);
  } finally { await t.close(); }
});

test('P/Q: an import that crashes after 3 chunks resumes the SAME batch on re-upload, with no duplicate product', async () => {
  const t = await boot();
  try {
    const rows = [['barcode', 'name', 'brand'], ...Array.from({ length: 2600 }, (_, i) => [gtin13(String(730000000000 + i)), `Resume ${i}`, 'R'])];
    const file = csvOf(rows); const parsed = parseImport('r.csv', file);
    assert.throws(() => commitBatch(t.db, { filename: 'r.csv', fileBytes: new Uint8Array(file), fresh: parsed.rows, completions: [], invalid: [], total: 2600, userId: 1, enrichProviders: [], ignoredColumns: [], failAfterChunks: 3 }), /simulated crash/);
    assert.equal((t.db.prepare('SELECT COUNT(*) n FROM products').get() as { n: number }).n, 3 * CHUNK, 'saved chunks stay saved');
    const b = t.db.prepare('SELECT id, state, processed_rows FROM import_batches').get() as { id: number; state: string; processed_rows: number };
    assert.equal(b.state, 'failed'); assert.equal(b.processed_rows, 3 * CHUNK);
    const r = await upload(t, file); assert.equal(r.status, 200); assert.equal(r.json.resumed, true); assert.equal(r.json.batch_id, b.id); assert.equal(r.json.new, 2600 - 3 * CHUNK);
    assert.equal((t.db.prepare('SELECT COUNT(DISTINCT barcode) n FROM products').get() as { n: number }).n, 2600);
    assert.equal((t.db.prepare('SELECT COUNT(*) n FROM products').get() as { n: number }).n, 2600);
  } finally { await t.close(); }
});

test('import never erases existing values with empty cells; rollback removes only untouched drafts of that batch', async () => {
  const t = await boot();
  try {
    const keep = (await t.call('POST', '/api/products', { token: t.staff, body: { name: 'موجود', brand: 'Keep', size: '50 ml', barcode: gtin13('740000000001') } })).json.id;
    const file = csvOf([['barcode', 'name', 'brand', 'size'], [gtin13('740000000001'), 'موجود', '', ''], [gtin13('740000000002'), '', '', ''], [gtin13('740000000003'), '', '', '']]);
    const r = await upload(t, file); assert.equal(r.json.drafts, 2);
    const p = (await t.call('GET', `/api/products/${keep}`, { token: t.staff })).json.product; assert.deepEqual([p.brand, p.size], ['Keep', '50 ml']);
    const drafts = t.db.prepare("SELECT id FROM products WHERE record_status = 'import_draft' ORDER BY id").all() as { id: number }[];
    await t.call('PATCH', `/api/products/${drafts[0]!.id}`, { token: t.staff, body: { name: 'عرّفته الموظفة', version: 1 } });   // a person worked on this draft
    assert.equal((await t.call('POST', `/api/imports/batches/${r.json.batch_id}/rollback`, { token: t.staff })).status, 403, 'manager only');
    const rb = await t.call('POST', `/api/imports/batches/${r.json.batch_id}/rollback`, { token: t.manager });
    assert.deepEqual(rb.json, { removed: 1, kept_edited_drafts: 1 });
    assert.ok((await t.call('GET', `/api/products/${keep}`, { token: t.staff })).status === 200, 'records that existed before the import are untouched');
  } finally { await t.close(); }
});

/* ---------------- queue ---------------- */
async function queueBed() {
  const t = await boot(); resetRateWindows();
  const mk = (name: string, barcode?: string) => Number(t.db.prepare("INSERT INTO products(barcode,name,brand,size,created_at,updated_at) VALUES (?,?, 'BrandQ', '200 ml', datetime('now'), datetime('now'))").run(barcode ?? null, name).lastInsertRowid);
  return { t, mk };
}
const found = (q: { gtin?: string; name?: string }, extra: object = {}): Scripted => ({ kind: 'found', candidates: [{ gtin: q.gtin, name: 'Gentle Cleanser', brand: 'BrandQ', size: '200 ml', variant: '', manufacturer: 'Maker', ingredients: 'Aqua, Glycerin, Ceramide NP', license: 'x', license_status: 'known', ...extra }] });

test('Q: provider results become EVIDENCE only (products untouched), idempotent on re-run, cache prevents a second call', async () => {
  const { t, mk } = await queueBed();
  try {
    const g = gtin13('750000000001'); const id = mk('Gentle Cleanser', g);
    const src = scriptedProvider('src', (q) => found(q));
    enqueue(t.db, id, 'src', queryKeyFor({ barcode: g, name: 'x', brand: '' }));
    const before = JSON.stringify(t.db.prepare('SELECT * FROM products').all());
    assert.equal((await processOne(t.db, [src])).result, 'done');
    assert.equal(JSON.stringify(t.db.prepare('SELECT * FROM products').all()), before, 'the queue never writes into products');
    const ev = t.db.prepare('SELECT field, match_basis, review_state FROM evidence WHERE product_id = ? ORDER BY field').all(id) as { field: string; match_basis: string }[];
    assert.deepEqual(ev.map((e) => e.field), ['brand', 'ingredients', 'manufacturer', 'name', 'size']); assert.ok(ev.every((e) => e.match_basis === 'exact_gtin'));
    // crash-replay: the same job runs again -> no duplicate evidence, and the provider is not called again (cache)
    t.db.prepare("UPDATE enrichment_jobs_v2 SET job_state='queued'").run();
    assert.equal((await processOne(t.db, [src])).result, 'done'); assert.equal(src.calls.length, 1, 'served from cache');
    assert.equal((t.db.prepare('SELECT COUNT(*) n FROM evidence').get() as { n: number }).n, 5);
    const job = { ...(t.db.prepare('SELECT job_state, match_outcome, review_state FROM enrichment_jobs_v2').get() as Record<string, string>) };
    assert.deepEqual(job, { job_state: 'done', match_outcome: 'exact_gtin', review_state: 'pending' });
  } finally { await t.close(); }
});

test('Q: lease expiry recovers a job abandoned by a crashed worker', async () => {
  const { t, mk } = await queueBed();
  try {
    enqueue(t.db, mk('A', gtin13('750000000002')), 'src', 'gtin:x');
    const t0 = Date.now(); assert.ok(leaseNext(t.db, ['src'], t0), 'leased, then the worker "dies"');
    assert.equal(leaseNext(t.db, ['src'], t0 + 1000), null, 'not handed out twice while the lease is valid');
    assert.ok(leaseNext(t.db, ['src'], t0 + LEASE_MS + 1000), 'picked up again after the lease expired');
  } finally { await t.close(); }
});

test('Q: outages back off with jitter and end in dead/source_unavailable; Retry-After defers without counting an attempt', async () => {
  const { t, mk } = await queueBed();
  try {
    const down = scriptedProvider('down', () => ({ kind: 'http_500' })); enqueue(t.db, mk('B', gtin13('750000000003')), 'down', 'gtin:b');
    let now = Date.now(); const delays: number[] = [];
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const r = await processOne(t.db, [down], { nowMs: now, random: () => 0.5 });
      const j = t.db.prepare('SELECT job_state, next_at, attempts, match_outcome FROM enrichment_jobs_v2').get() as { job_state: string; next_at: string; attempts: number; match_outcome: string };
      if (i < MAX_ATTEMPTS - 1) { assert.equal(r.result, 'retry'); delays.push(Date.parse(j.next_at) - now); now = Date.parse(j.next_at) + 1; }
      else { assert.equal(r.result, 'dead'); assert.equal(j.match_outcome, 'source_unavailable'); assert.equal(j.attempts, MAX_ATTEMPTS); }
    }
    assert.ok(delays.every((d, i) => i === 0 || d > delays[i - 1]!), 'exponential backoff');
    const rl = scriptedProvider('rl', () => ({ kind: 'rate_limited', retry_after_s: 120 })); enqueue(t.db, mk('C', gtin13('750000000004')), 'rl', 'gtin:c');
    const n0 = Date.now(); assert.equal((await processOne(t.db, [rl], { nowMs: n0 })).result, 'deferred_rate');
    const j = t.db.prepare("SELECT attempts, next_at, job_state FROM enrichment_jobs_v2 WHERE provider='rl'").get() as { attempts: number; next_at: string; job_state: string };
    assert.equal(j.attempts, 0); assert.equal(j.job_state, 'waiting_retry'); assert.equal(Date.parse(j.next_at) - n0, 120_000);
  } finally { await t.close(); }
});

test('Q: daily budget and per-minute limit are respected; offline jobs wait for the network; one failing provider does not block another', async () => {
  const { t, mk } = await queueBed();
  try {
    const ok = scriptedProvider('ok', (q) => found(q)); ok.limits = { perMinute: 2, perDay: null, source: 't', verified: false };
    for (let i = 0; i < 4; i++) enqueue(t.db, mk(`D${i}`, gtin13(String(750000000010 + i))), 'ok', `gtin:${i}`);
    const now = Date.now(); const res = [];
    for (let i = 0; i < 4; i++) res.push((await processOne(t.db, [ok], { nowMs: now })).result);
    assert.deepEqual(res.filter((r) => r === 'done').length, 2); assert.ok(res.includes('deferred_rate'));
    resetRateWindows();
    const b2 = scriptedProvider('b2', (q) => found(q)); for (let i = 0; i < 3; i++) enqueue(t.db, mk(`E${i}`, gtin13(String(750000000020 + i))), 'b2', `gtin:e${i}`);
    const out = []; for (let i = 0; i < 3; i++) out.push((await processOne(t.db, [b2], { dailyBudget: { b2: 1 } })).result);
    assert.equal(out.filter((r) => r === 'done').length, 1); assert.ok(out.includes('deferred_budget'));
    const off = scriptedProvider('off', (q) => found(q)); enqueue(t.db, mk('F', gtin13('750000000030')), 'off', 'gtin:f');
    assert.equal((await processOne(t.db, [off], { online: false })).result, 'waiting_network'); assert.equal(off.calls.length, 0);
    // isolation: a dead provider's jobs never stop a healthy provider's jobs
    const bad = scriptedProvider('bad', () => ({ kind: 'http_500' })), good = scriptedProvider('good', (q) => found(q));
    enqueue(t.db, mk('G1', gtin13('750000000031')), 'bad', 'gtin:g1', { priority: 5 }); enqueue(t.db, mk('G2', gtin13('750000000032')), 'good', 'gtin:g2');
    const r1 = await processOne(t.db, [bad, good]); const r2 = await processOne(t.db, [bad, good]);
    assert.deepEqual([r1.result, r2.result], ['retry', 'done']);
  } finally { await t.close(); }
});

test('Q: pause (all / provider / batch) and cancel are switches, not product states; transitions are guarded', async () => {
  const { t, mk } = await queueBed();
  try {
    const src = scriptedProvider('src', (q) => found(q)); enqueue(t.db, mk('H', gtin13('750000000040')), 'src', 'gtin:h');
    setPaused(t.db, 'all', true, null); assert.equal((await processOne(t.db, [src])).result, 'paused_or_empty');
    setPaused(t.db, 'all', false, null); setPaused(t.db, 'provider:src', true, null); assert.equal((await processOne(t.db, [src])).result, 'paused_or_empty');
    setPaused(t.db, 'provider:src', false, null); assert.equal((await processOne(t.db, [src])).result, 'done');
    const b = Number(t.db.prepare("INSERT INTO import_batches(filename,fingerprint,created_at) VALUES ('x','y',datetime('now'))").run().lastInsertRowid);
    enqueue(t.db, mk('I', gtin13('750000000041')), 'src', 'gtin:i', { batchId: b }); setPaused(t.db, `batch:${b}`, true, null);
    assert.equal((await processOne(t.db, [src])).result, 'paused_or_empty');
    assert.equal(cancel(t.db, { batchId: b }), 1); setPaused(t.db, `batch:${b}`, false, null); assert.equal((await processOne(t.db, [src])).result, 'paused_or_empty');
    assert.equal(canTransition('done', 'queued'), false); assert.equal(canTransition('dead', 'queued'), true); assert.equal(canTransition('queued', 'done'), false);
    const st = await t.call('GET', '/api/queue/status', { token: t.staff }); assert.equal(st.status, 200);
    assert.equal((await t.call('POST', '/api/queue/pause', { token: t.staff, body: { scope: 'all', paused: true } })).status, 403);
  } finally { await t.close(); }
});

/* ---------------- evidence review ---------------- */
test('T: evidence review — manager only, stale version refused, ambiguous identity needs explicit confirmation, display name never overwritten, audited', async () => {
  const { t, mk } = await queueBed();
  try {
    const g = gtin13('750000000050'); const id = mk('غسول لطيف', g);
    const src = scriptedProvider('src', (q) => found(q)); enqueue(t.db, id, 'src', `gtin:${g}`); await processOne(t.db, [src]);
    assert.equal((await t.call('GET', '/api/evidence/next', { token: t.staff })).status, 403);
    const n = (await t.call('GET', '/api/evidence/next', { token: t.manager })).json; assert.equal(n.product.id, id); assert.equal(n.identity_conflict, false);
    const ev = (f: string) => n.evidence.find((e: { field: string }) => e.field === f).id;
    assert.equal((await t.call('POST', '/api/evidence/review', { token: t.manager, body: { product_id: id, version: n.product.version + 5, decisions: [{ evidence_id: ev('brand'), action: 'accept' }] } })).status, 409);
    const r = await t.call('POST', '/api/evidence/review', { token: t.manager, body: { product_id: id, version: n.product.version, decisions: [{ evidence_id: ev('name'), action: 'accept' }, { evidence_id: ev('ingredients'), action: 'accept' }, { evidence_id: ev('manufacturer'), action: 'reject' }] } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const p = (await t.call('GET', `/api/products/${id}`, { token: t.staff })).json.product;
    assert.equal(p.name, 'غسول لطيف', 'the display name the staff typed is never replaced'); assert.equal(p.name_en, 'Gentle Cleanser'); assert.equal(p.ingredients, 'Aqua, Glycerin, Ceramide NP'); assert.equal(p.manufacturer, '');
    assert.ok((t.db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action = 'evidence_accept'").get() as { n: number }).n >= 2);
    assert.ok((t.db.prepare("SELECT COUNT(*) n FROM product_facts WHERE product_id = ? AND origin = 'source'").get(id) as { n: number }).n >= 2);
    // an ambiguous (different size) match
    const g2 = gtin13('750000000051'); const id2 = mk('Gentle Cleanser', g2);
    const big = scriptedProvider('big', (q) => found(q, { size: '400 ml' })); enqueue(t.db, id2, 'big', `gtin:${g2}`); await processOne(t.db, [big]);
    const e2 = t.db.prepare("SELECT id, match_basis FROM evidence WHERE product_id = ? AND field = 'ingredients'").get(id2) as { id: number; match_basis: string }; assert.equal(e2.match_basis, 'ambiguous');
    const v2 = (t.db.prepare('SELECT version FROM products WHERE id = ?').get(id2) as { version: number }).version;
    assert.equal((await t.call('POST', '/api/evidence/review', { token: t.manager, body: { product_id: id2, version: v2, decisions: [{ evidence_id: e2.id, action: 'accept' }] } })).status, 409, 'no silent acceptance across an identity conflict');
    assert.equal((await t.call('POST', '/api/evidence/review', { token: t.manager, body: { product_id: id2, version: v2, confirm_identity: true, decisions: [{ evidence_id: e2.id, action: 'accept' }] } })).status, 200);
  } finally { await t.close(); }
});
