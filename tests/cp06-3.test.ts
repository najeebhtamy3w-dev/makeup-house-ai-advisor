// CP06.3 — image thumbnails (additive migration 009), storage report, and migration-chain safety.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { migrate } from '../server/src/db.ts';
import { boot } from './helpers.ts';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKElEQVR42u3NMQEAAAjDMMC/56EBvlRA01vZJvwHAAAAAAAAAAAAAPgcAAG6AAG1wvQVAAAAAElFTkSuQmCC', 'base64');

test('migration chain: unique, ordered names; 009 is additive and keeps every original image byte', () => {
  const files = readdirSync(new URL('../server/migrations/', import.meta.url)).filter((f) => f.endsWith('.sql')).sort();
  const nums = files.map((f) => f.slice(0, 3)); assert.equal(new Set(nums).size, nums.length, 'no duplicate migration numbers');
  assert.deepEqual(nums, nums.map((_, i) => String(i + 1).padStart(3, '0')), 'no gaps');
  const sql = readFileSync(new URL('../server/migrations/009_cp06_3_image_thumbs.sql', import.meta.url), 'utf8');
  assert.doesNotMatch(sql.replace(/^--.*$/gm, ''), /\b(DROP|DELETE|UPDATE)\b/i);
  const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys = ON; CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  for (const f of files.filter((f) => f < '009')) { db.exec(readFileSync(new URL(`../server/migrations/${f}`, import.meta.url), 'utf8')); db.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(f, 'x'); }
  db.prepare("INSERT INTO products(name, created_at, updated_at) VALUES ('P', 'x', 'x')").run();
  db.prepare("INSERT INTO product_images(product_id, mime, bytes, size, origin, created_at) VALUES (1, 'image/png', ?, ?, 'upload', 'x')").run(PNG, PNG.length);
  assert.deepEqual(migrate(db as never), ['009_cp06_3_image_thumbs.sql']);
  const r = db.prepare('SELECT bytes, thumb FROM product_images').get() as { bytes: Uint8Array; thumb: null };
  assert.deepEqual(Buffer.from(r.bytes), PNG); assert.equal(r.thumb, null);
  assert.deepEqual(migrate(db as never), [], 'idempotent');
});

test('thumbnails: lists get the original flagged "missing" until a thumb exists; the thumb is set once; originals unchanged; report is manager-only', async () => {
  const t = await boot();
  try {
    const p = await t.call('POST', '/api/products', { token: t.staff, body: { name: 'منتج صورة', brand: 'B', size: '50 ml' } });
    const id = p.json.id;
    const img = await t.call('POST', `/api/products/${id}/images?kind=front`, { token: t.staff, raw: PNG });
    assert.equal(img.status, 200); const iid = img.json.id;
    let g = await t.call('GET', `/api/images/${iid}?size=thumb`, { token: t.staff });
    assert.equal(g.status, 200); assert.equal(g.headers.get('x-mh-thumb'), 'missing');
    assert.equal((await t.call('PUT', `/api/images/${iid}/thumb`, { token: t.staff, raw: Buffer.from('not an image') })).status, 400);
    assert.equal((await t.call('PUT', `/api/images/${iid}/thumb`, { token: t.staff, raw: Buffer.alloc(70 * 1024, 1) })).status, 413);
    const ok = await t.call('PUT', `/api/images/${iid}/thumb`, { token: t.staff, raw: PNG }); assert.equal(ok.status, 200); assert.equal(ok.json.kept, false);
    assert.equal((await t.call('PUT', `/api/images/${iid}/thumb`, { token: t.staff, raw: PNG })).json.kept, true, 'set once, never overwritten');
    g = await t.call('GET', `/api/images/${iid}?size=thumb`, { token: t.staff }); assert.equal(g.headers.get('x-mh-thumb'), null);
    const full = await t.call('GET', `/api/images/${iid}`, { token: t.staff }); assert.equal(full.status, 200);
    const list = await t.call('GET', `/api/products/${id}/images`, { token: t.staff }); assert.ok(!JSON.stringify(list.json).includes('thumb'), 'no thumbnail bytes in JSON listings');
    assert.equal((await t.call('GET', '/api/images-report', { token: t.staff })).status, 403);
    const rep = await t.call('GET', '/api/images-report', { token: t.manager });
    assert.equal(rep.status, 200); assert.equal(rep.json.orphans, 0); assert.equal(rep.json.missing_thumbs, 0); assert.equal(rep.json.thumbs.n, 1);
  } finally { await t.close(); }
});

test('interrupted migration (process killed mid-way) leaves the database at the previous version, and the next start completes it', async () => {
  const { mkdtempSync } = await import('node:fs'); const { join } = await import('node:path'); const { tmpdir } = await import('node:os');
  const path = join(mkdtempSync(join(tmpdir(), 'mh-mig-')), 'app.db');
  const files = readdirSync(new URL('../server/migrations/', import.meta.url)).filter((f) => f.endsWith('.sql')).sort();
  let db = new DatabaseSync(path); db.exec('CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  for (const f of files.filter((f) => f < '009')) { db.exec(readFileSync(new URL(`../server/migrations/${f}`, import.meta.url), 'utf8')); db.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(f, 'x'); }
  db.prepare("INSERT INTO products(name, created_at, updated_at) VALUES ('P', 'x', 'x')").run();
  // the app dies after the first statement of 009, before COMMIT (same BEGIN … COMMIT as migrate() on server and phone)
  db.exec('BEGIN'); db.exec('ALTER TABLE product_images ADD COLUMN thumb BLOB'); db.close();   // no COMMIT
  db = new DatabaseSync(path);
  const cols = (db.prepare("SELECT name FROM pragma_table_info('product_images')").all() as { name: string }[]).map((r) => r.name);
  assert.ok(!cols.includes('thumb'), 'the half-applied migration was rolled back');
  assert.equal((db.prepare("SELECT COUNT(*) n FROM schema_migrations WHERE name LIKE '009%'").get() as { n: number }).n, 0);
  assert.deepEqual(migrate(db as never), files.filter(f => f >= '009'), 'all pending migrations completed on the next start');
  assert.equal((db.prepare('SELECT COUNT(*) n FROM products').get() as { n: number }).n, 1, 'no data lost');
  db.close();
});
