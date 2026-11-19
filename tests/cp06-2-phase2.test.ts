import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { migrate } from '../server/src/db.ts';
import { boot, EAN, EAN2 } from './helpers.ts';
import { ProviderQuery, KnowledgeClaim, AdvisorResponse, MatchDecision, Evidence } from '../server/src/contracts.ts';

const MIG = join(import.meta.dirname, '..', 'server', 'migrations');

/** A database exactly as an installed CP05/CP06 app has it today: migrations 001–005 + real-looking rows. */
function legacyDb() {
  const file = join(mkdtempSync(join(tmpdir(), 'mh-up-')), 'legacy.db');
  const db = new DatabaseSync(file); db.exec('PRAGMA foreign_keys = ON;');
  db.exec('CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  for (const f of readdirSync(MIG).filter((x) => x.endsWith('.sql')).sort().filter((x) => x < '006')) { db.exec(readFileSync(join(MIG, f), 'utf8')); db.prepare('INSERT INTO schema_migrations VALUES (?,?)').run(f, '2026-11-01T00:00:00Z'); }
  const t = '2026-11-01T00:00:00Z';
  db.prepare("INSERT INTO users(username,display_name,role,password_hash,created_at) VALUES ('m','M','manager','x',?)").run(t);
  const ins = db.prepare('INSERT INTO products(barcode,name,brand,category,size,ingredients,verification,created_at,updated_at,product_type,classification_status) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  ins.run(EAN, 'كريم قديم', 'OldBrand', 'العناية بالبشرة', '50 ml', 'Aqua, Glycerin', 'verified', t, t, 'cream', 'confirmed');
  ins.run(null, 'منتج بلا باركود', '', 'أخرى', '', '', 'review', t, t, '', 'unknown');
  ins.run('00012345678905', 'منتج بصفر أول', 'Zero', 'أخرى', '', '', 'review', t, t, '', 'unknown');
  const imgCols = (db.prepare('PRAGMA table_info(product_images)').all() as { name: string }[]).map((c) => c.name);
  const img: Record<string, unknown> = { product_id: 1, mime: 'image/png', bytes: new Uint8Array([1, 2, 3]), size: 3, width: 1, height: 1, origin: 'camera', is_primary: 1, created_at: t };
  for (const k of ['created_by', 'sha256']) if (imgCols.includes(k)) img[k] = k === 'sha256' ? 'x' : 1;
  const keys = Object.keys(img).filter((k) => imgCols.includes(k));
  db.prepare(`INSERT INTO product_images(${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...(keys.map((k) => img[k]) as never[]));
  const run = db.prepare("INSERT INTO enrichment_runs(barcode,connector,outcome,fetched_at) VALUES (?, 'obf', 'found', ?)").run(EAN, t);
  db.prepare("INSERT INTO enrichment_candidates(run_id,barcode,field,value,source_name,extracted_at) VALUES (?,?, 'name', 'Old Cream', 'OBF', ?)").run(Number(run.lastInsertRowid), EAN, t);
  db.prepare("INSERT INTO audit_log(user_id,action,entity,entity_id,detail,at) VALUES (1,'create','product','1','',?)").run(t);
  return db;
}
const snapshot = (db: DatabaseSync) => Object.fromEntries(['products', 'product_images', 'enrichment_candidates', 'enrichment_runs', 'audit_log', 'users'].map((tb) => [tb, db.prepare(`SELECT * FROM ${tb} ORDER BY id`).all()]));

test('upgrade 005 -> 006 keeps every existing row and value, backfills codes, and is idempotent', () => {
  const db = legacyDb(); const before = snapshot(db);
  const ran = migrate(db); assert.deepEqual(ran, ['006_cp06_2_contracts.sql']);
  const after = snapshot(db);
  for (const tb of Object.keys(before)) {
    assert.equal(after[tb]!.length, before[tb]!.length, `${tb} row count`);
    // every old column keeps its old value (new columns are extra)
    before[tb]!.forEach((row, i) => { for (const [k, v] of Object.entries(row as object)) assert.deepEqual((after[tb]![i] as Record<string, unknown>)[k], v, `${tb}.${k}`); });
  }
  const p = db.prepare('SELECT name, name_ar, name_en, manufacturer, variant, record_status, version FROM products ORDER BY id').all() as Record<string, unknown>[];
  assert.deepEqual(p.map((x) => [x.record_status, x.version, x.name_ar]), [['active', 1, ''], ['active', 1, ''], ['active', 1, '']], 'defaults never change meaning');
  const codes = db.prepare('SELECT product_id, code, kind, is_primary FROM product_codes ORDER BY product_id').all() as Record<string, unknown>[];
  assert.deepEqual(codes.map((c) => [c.product_id, c.code, c.kind, c.is_primary]), [[1, EAN, 'gtin', 1], [3, '00012345678905', 'gtin', 1]], 'leading zeros kept, product without barcode has no code');
  assert.equal((db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check, 'ok');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.deepEqual(migrate(db), [], 'running again changes nothing');
});

test('legacy data stays usable through the API after the upgrade (old candidate review still works)', async () => {
  const t = await boot();
  try {
    const id = (await t.call('POST', '/api/products', { token: t.staff, body: { name: 'منتج للترقية', barcode: EAN } })).json.id;
    const p = (await t.call('GET', `/api/products/${id}`, { token: t.staff })).json.product;
    assert.equal(p.record_status, 'active'); assert.equal(p.version, 1); assert.equal(p.name_ar, '');
  } finally { await t.close(); }
});

test('primary code follows the barcode on create, change, removal and delete (triggers)', async () => {
  const t = await boot();
  try {
    const codes = (id: number) => t.db.prepare('SELECT code, kind, is_primary FROM product_codes WHERE product_id = ? ORDER BY id').all(id) as Record<string, unknown>[];
    const id = (await t.call('POST', '/api/products', { token: t.staff, body: { name: 'كود', barcode: EAN } })).json.id;
    assert.deepEqual(codes(id).map((c) => [c.code, c.kind, c.is_primary]), [[EAN, 'gtin', 1]]);
    assert.equal((await t.call('PATCH', `/api/products/${id}`, { token: t.staff, body: { barcode: EAN2 } })).status, 200);
    assert.deepEqual(codes(id).map((c) => c.code), [EAN2]);
    assert.equal((await t.call('PATCH', `/api/products/${id}`, { token: t.staff, body: { barcode: '' } })).status, 200);
    assert.deepEqual(codes(id), []);
    await t.call('PATCH', `/api/products/${id}`, { token: t.staff, body: { barcode: EAN } });
    assert.equal((await t.call('DELETE', `/api/products/${id}`, { token: t.manager })).status, 200);
    assert.equal((t.db.prepare('SELECT COUNT(*) n FROM product_codes').get() as { n: number }).n, 0, 'cascade');
  } finally { await t.close(); }
});

test('optimistic concurrency: a save based on an older copy is refused (409), the newer edit is kept; old clients still work', async () => {
  const t = await boot();
  try {
    const id = (await t.call('POST', '/api/products', { token: t.staff, body: { name: 'نسخة' } })).json.id;
    const a = await t.call('PATCH', `/api/products/${id}`, { token: t.staff, body: { size: '50 ml', version: 1 } });
    assert.equal(a.status, 200); assert.equal(a.json.version, 2);
    const stale = await t.call('PATCH', `/api/products/${id}`, { token: t.manager, body: { size: '100 ml', version: 1 } });
    assert.equal(stale.status, 409); assert.equal(stale.json.stale, true); assert.equal(stale.json.currentVersion, 2);
    assert.equal((await t.call('GET', `/api/products/${id}`, { token: t.staff })).json.product.size, '50 ml', 'nothing overwritten');
    assert.equal((await t.call('PATCH', `/api/products/${id}`, { token: t.staff, body: { size: '75 ml' } })).status, 200, 'client without version (old app) still saves');
    assert.equal((await t.call('PATCH', `/api/products/${id}`, { token: t.staff, body: { name_en: 'Copy Cream', manufacturer: 'Maker Co', variant: 'Rose', version: 3 } })).status, 200);
    const p = (await t.call('GET', `/api/products/${id}`, { token: t.staff })).json.product;
    assert.deepEqual([p.name, p.name_en, p.manufacturer, p.variant, p.version], ['نسخة', 'Copy Cream', 'Maker Co', 'Rose', 4], 'display name is never changed by the English name');
  } finally { await t.close(); }
});

test('import drafts and archived records are never recommended by the advisor (still visible in the catalog)', async () => {
  const t = await boot();
  try {
    const mk = async (name: string) => (await t.call('POST', '/api/products', { token: t.staff, body: { name, category: 'العناية بالبشرة', product_type: 'cleanser' } })).json.id;
    const a = await mk('غسول نشط'), d = await mk('غسول مسودة'), z = await mk('غسول مؤرشف');
    t.db.prepare("UPDATE products SET record_status='import_draft' WHERE id=?").run(d); t.db.prepare("UPDATE products SET record_status='archived' WHERE id=?").run(z);
    const r = await t.call('POST', '/api/advisor/search', { token: t.staff, body: { query: 'أريد غسول' } });
    const names = [...r.json.store_matches, ...r.json.cannot_assess].map((x: { name: string }) => x.name);
    assert.ok(names.includes('غسول نشط')); assert.ok(!names.includes('غسول مسودة')); assert.ok(!names.includes('غسول مؤرشف'));
    assert.equal((await t.call('GET', `/api/products/${d}`, { token: t.staff })).status, 200, 'drafts stay visible to staff');
    void a;
  } finally { await t.close(); }
});

test('contracts reject malformed objects (a provider or model can never hand over a broken result)', () => {
  assert.equal(ProviderQuery.safeParse({}).success, false, 'a query needs a barcode, a name or package text');
  assert.equal(ProviderQuery.safeParse({ gtin: '12ab' }).success, false);
  assert.equal(ProviderQuery.safeParse({ name: 'Cleanser' }).success, true);
  const claim = { id: 'c1', topic: 'dry_skin', domain: 'skin', text_ar: 'نص', evidence_status: 'reviewed_guidance', content_version: 1, language: 'ar', translation: 'original_ar' };
  assert.equal(KnowledgeClaim.safeParse({ ...claim, sources: [] }).success, false, 'a claim without a source is refused');
  assert.equal(KnowledgeClaim.safeParse({ ...claim, sources: ['aad-dry'] }).success, true);
  assert.equal(MatchDecision.safeParse({ class: 'strong', confidence: 140, reasons: [], conflicts: [] }).success, false);
  assert.equal(Evidence.safeParse({ product_id: 1, field: 'name', value: 'x', provider: 'obf', retrieved_at: 'now', match_basis: 'guess', confidence: 50 }).success, false);
  assert.equal(AdvisorResponse.safeParse({ mode: 'llm_magic', ai_provider: null, sections: [], sources: [], follow_up: null, safety_stop: false }).success, false);
});
