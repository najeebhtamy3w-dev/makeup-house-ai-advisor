// CP06 on-device "server": the SAME TypeScript routes as the Node server (server/src/*) run here, in a background worker
// inside the Android app, over a real SQLite database file in the app's private storage (OPFS, via SQLite WASM).
// No Node.js, no Render: every local operation is a function call in this worker. The internet is used only by the
// existing Open Beauty Facts connector (optional enrichment / identification).
import './shims/buffer-global.ts';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { LocalDB, migrate, knownMigrations, type WasmDb } from './db.ts';
import { loadConfig, type Config } from '../../server/src/config.ts';
import { dispatch, route, HttpError, RawResponse } from '../../server/src/http.ts';
import '../../server/src/routes.ts';
import '../../server/src/images.ts';
import '../../server/src/discovery.ts';
import { configureConnectors, processQueueOnce } from '../../server/src/enrichment/engine.ts';
import { hashPassword } from '../../server/src/security.ts';
import * as backup from './backup.ts';

export const LOCAL_VERSION = '3.0.0-cp06-local';
const DB_FILE = '/makeup-house.db';
const CHECK_FILE = '/restore-check.db';
const SAFETY_FILE = '/pre-restore.db';

// external requests: drop the User-Agent header (browsers do not let pages set it and it would force a CORS preflight)
const nativeFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = ((input: RequestInfo | URL, init: RequestInit = {}) => { const h = new Headers(init.headers); h.delete('user-agent'); return nativeFetch(input, { ...init, headers: h }); }) as typeof fetch;

type Pool = { OpfsSAHPoolDb: new (f: string) => WasmDb; importDb(f: string, b: Uint8Array): Promise<number>; exportFile(f: string): Uint8Array; unlink(f: string): boolean; getFileNames(): string[] };
let sqlite3: { capi: { sqlite3_js_db_export(p: unknown): Uint8Array } };
let pool: Pool;
let db: LocalDB;
let cfg: Config;

const count = (d: LocalDB, t: string) => (d.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as { n: number }).n;
function openMain() {
  db = new LocalDB(new pool.OpfsSAHPoolDb(DB_FILE));
  db.exec('PRAGMA foreign_keys = ON;');
  migrate(db);
  // per-install token key (never shipped in the APK); kept in the database so it survives app restarts
  db.exec('CREATE TABLE IF NOT EXISTS local_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
  let secret = (db.prepare("SELECT v FROM local_meta WHERE k = 'token_secret'").get() as { v: string } | undefined)?.v;
  if (!secret) { const b = new Uint8Array(32); crypto.getRandomValues(b); secret = [...b].map((x) => x.toString(16).padStart(2, '0')).join(''); db.prepare("INSERT INTO local_meta(k, v) VALUES ('token_secret', ?)").run(secret); }
  cfg = loadConfig({ MH_SECRET: secret, MH_DB_PATH: DB_FILE, MH_ENRICH: 'obf', MH_WEB_DIR: '' } as never);
  configureConnectors(cfg);
}

/* ---------- local-only routes ---------- */
route('GET', '/api/health', 'none', () => ({ ok: true }));
route('GET', '/api/meta', 'none', (c) => ({ version: LOCAL_VERSION, staging: false, local: true, notice: null, setup_required: count(c.db as never, 'users') === 0 }));

/** First run on a new phone: the person creates the manager account. Only possible while there is no user at all. */
route('POST', '/api/local/setup', 'none', async (c) => {
  if (count(c.db as never, 'users') > 0) throw new HttpError(409, 'تم إعداد التطبيق مسبقًا. سجّل الدخول.');
  const b = await c.body() as { username?: string; display_name?: string; password?: string };
  const username = String(b.username ?? '').trim(); const password = String(b.password ?? '');
  if (!/^[\p{L}\p{N}._-]{3,32}$/u.test(username)) throw new HttpError(400, 'اسم المستخدم 3–32 حرفًا (حروف/أرقام/نقطة/شرطة)');
  if (password.length < 10) throw new HttpError(400, 'كلمة المرور 10 أحرف على الأقل');
  const r = c.db.prepare("INSERT INTO users(username, display_name, role, password_hash, created_at) VALUES (?, ?, 'manager', ?, ?)").run(username, String(b.display_name ?? '').trim() || 'المدير', hashPassword(password), new Date().toISOString());
  c.db.prepare("INSERT INTO audit_log(user_id, action, entity, entity_id, detail, at) VALUES (?, 'setup', 'user', ?, 'first manager on device', ?)").run(Number(r.lastInsertRowid), String(r.lastInsertRowid), new Date().toISOString());
  return { ok: true };
});

route('GET', '/api/local/backup/info', 'manager', (c) => {
  const d = c.db as unknown as LocalDB;
  return { schema: (d.prepare('SELECT name FROM schema_migrations ORDER BY name').all() as { name: string }[]).map((r) => r.name),
    counts: { products: count(d, 'products'), images: count(d, 'product_images'), users: count(d, 'users') },
    db_bytes: Number(d.prepare('SELECT page_count * page_size AS n FROM pragma_page_count(), pragma_page_size()').get()?.n ?? 0) };
});

/** Create an encrypted backup of the WHOLE database (products, images, sources, taxonomy, verification, users). */
route('POST', '/api/local/backup', 'manager', async (c) => {
  const { passphrase } = await c.body() as { passphrase?: string };
  const pass = backup.checkPassphrase(passphrase);
  const d = c.db as unknown as LocalDB;
  if ((d.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check !== 'ok') throw new HttpError(500, 'قاعدة البيانات الحالية لا تجتاز فحص السلامة — لا تُنشأ نسخة');
  const plain = sqlite3.capi.sqlite3_js_db_export(d.raw.pointer);
  const counts = { products: count(d, 'products'), images: count(d, 'product_images'), users: count(d, 'users') };
  const file = await backup.seal(plain, pass, { app: LOCAL_VERSION, schema: knownMigrations().filter((n) => d.prepare('SELECT 1 FROM schema_migrations WHERE name = ?').get(n)), counts });
  d.prepare("INSERT INTO audit_log(user_id, action, entity, entity_id, detail, at) VALUES (?, 'backup', 'database', 'all', ?, ?)").run(c.user!.id, `products=${counts.products} images=${counts.images}`, new Date().toISOString());
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  return new RawResponse(200, { 'content-type': 'application/octet-stream', 'x-mh-filename': `makeup-house-${stamp}.mhbak`, 'x-mh-counts': JSON.stringify(counts) }, file);
});

/**
 * Restore. Body = [4-byte big-endian length][JSON {passphrase, dry}][backup file]. Order (all-or-nothing):
 * decrypt + checksum -> open a SEPARATE check copy -> integrity_check + known schema + counts match the header ->
 * only then keep a safety copy of the current database and replace it -> reopen + migrate + integrity again;
 * any failure after the swap puts the safety copy back. Allowed for a manager, or on a fresh install (no user yet).
 */
route('POST', '/api/local/restore', 'none', async (c) => {
  const fresh = count(c.db as never, 'users') === 0;
  if (!fresh && c.user?.role !== 'manager') throw new HttpError(c.user ? 403 : 401, c.user ? 'الاستعادة للمدير فقط' : 'يلزم تسجيل الدخول');
  const raw = new Uint8Array(await c.raw()); if (raw.length < 8) throw new HttpError(400, 'لا يوجد ملف');
  const jl = new DataView(raw.buffer, raw.byteOffset).getUint32(0); const opts = JSON.parse(new TextDecoder().decode(raw.subarray(4, 4 + jl))) as { passphrase?: string; dry?: boolean };
  const file = raw.subarray(4 + jl);
  let header, plain: Uint8Array;
  try { ({ header, plain } = await backup.open(file, backup.checkPassphrase(opts.passphrase))); } catch (e) { throw new HttpError(400, (e as Error).message); }
  const known = new Set(knownMigrations());
  const unknown = header.schema.filter((n) => !known.has(n));
  if (unknown.length) throw new HttpError(400, `النسخة من إصدار أحدث من التطبيق (${unknown.join('، ')}). حدّث التطبيق أولًا.`);
  // 1) verify on a separate copy — the current data is not touched yet
  await pool.importDb(CHECK_FILE, plain);
  try {
    const chk = new LocalDB(new pool.OpfsSAHPoolDb(CHECK_FILE));
    try {
      if ((chk.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check !== 'ok') throw new HttpError(400, 'النسخة لا تجتاز فحص سلامة SQLite');
      for (const [t, k] of [['products', 'products'], ['product_images', 'images'], ['users', 'users']] as const) if (count(chk, t) !== header.counts[k]) throw new HttpError(400, `عدد السجلات في «${t}» لا يطابق رأس النسخة`);
      if (count(chk, 'users') < 1) throw new HttpError(400, 'النسخة لا تحتوي أي حساب — لن تتمكن من الدخول بعدها');
    } finally { chk.close(); }
  } finally { pool.unlink(CHECK_FILE); }
  if (opts.dry) return { ok: true, verified: true, header };
  // 2) swap with a safety copy
  const before = sqlite3.capi.sqlite3_js_db_export(db.raw.pointer);
  await pool.importDb(SAFETY_FILE, before);
  db.close();
  try {
    await pool.importDb(DB_FILE, plain); openMain();
    if ((db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check !== 'ok') throw new Error('integrity');
  } catch {
    try { db?.close(); } catch { /* already closed */ }
    await pool.importDb(DB_FILE, before); openMain(); pool.unlink(SAFETY_FILE);
    throw new HttpError(500, 'تعذرت الاستعادة؛ أُعيدت البيانات السابقة كما كانت');
  }
  pool.unlink(SAFETY_FILE);
  db.prepare("INSERT INTO audit_log(user_id, action, entity, entity_id, detail, at) VALUES (NULL, 'restore', 'database', 'all', ?, ?)").run(`from ${header.created_at} products=${header.counts.products}`, new Date().toISOString());
  return { ok: true, restored: true, relogin: true, header: { created_at: header.created_at, counts: header.counts, app: header.app } };
});

/* ---------- boot + request bridge ---------- */
const ready = (async () => {
  sqlite3 = await sqlite3InitModule() as never;
  pool = await (sqlite3 as unknown as { installOpfsSAHPoolVfs(o: object): Promise<Pool> }).installOpfsSAHPoolVfs({ name: 'makeup-house', initialCapacity: 8 });
  openMain();
  // optional background enrichment queue — only does anything when online and products were queued
  setInterval(() => { if (navigator.onLine) processQueueOnce(db as never, cfg, 1).catch(() => { /* offline / source down: retried later */ }); }, 8000);
})();

self.onmessage = async (e: MessageEvent) => {
  const m = e.data as { id: number; method: string; url: string; authorization?: string; body?: ArrayBuffer | null };
  try {
    await ready;
    const res = await dispatch(db as never, cfg, { method: m.method, url: m.url, authorization: m.authorization, raw: async () => Buffer.from(m.body ? new Uint8Array(m.body) : new Uint8Array()) as never });
    const body = typeof res.body === 'string' ? res.body : res.body.slice().buffer;
    (self as unknown as Worker).postMessage({ id: m.id, status: res.status, headers: res.headers, body }, typeof body === 'string' ? [] : [body as ArrayBuffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id: m.id, status: 500, headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify({ error: 'تعذر تشغيل قاعدة البيانات المحلية: ' + (err as Error).message }) });
  }
};
ready.then(() => (self as unknown as Worker).postMessage({ type: 'ready' })).catch((err) => (self as unknown as Worker).postMessage({ type: 'fatal', error: String((err as Error)?.message ?? err) }));
