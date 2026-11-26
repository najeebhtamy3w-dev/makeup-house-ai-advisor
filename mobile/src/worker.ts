import '../../server/src/intelligence/routes.ts';
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
import { processOne } from '../../server/src/queue.ts';
import { activeProviders } from '../../server/src/evidence-routes.ts';
// CP09: the scientific advisor (CP07 knowledge + CP08 understanding, safety, research, review) now runs ON THE PHONE too —
// the same TypeScript as the server, over the local database. Off until a manager switches it on (stored setting).
import '../../server/src/cp07/routes.ts';
import '../../server/src/cp08/routes.ts';
import { setRuntime } from '../../server/src/cp08/features.ts';
setRuntime('device', () => navigator.onLine);

export const LOCAL_VERSION = '3.2.0-dev.1-local';
// CP06.3 — two database slots + a tiny pointer database. A restore is written into the INACTIVE slot, verified there, and
// only then does the pointer switch; the active database is never copied into memory and never touched before that.
// Existing installs: no pointer yet → slot A = the original file name, so nothing moves on upgrade.
const SLOT_A = '/makeup-house.db', SLOT_B = '/makeup-house-b.db', SLOT_DB = '/slot.db';
const LEGACY_FILES = ['/restore-check.db', '/pre-restore.db'];   // CP06/CP06.2 temporary names (cleaned if left behind)

// external requests: drop the User-Agent header (browsers do not let pages set it and it would force a CORS preflight)
const nativeFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = ((input: RequestInfo | URL, init: RequestInit = {}) => { const h = new Headers(init.headers); h.delete('user-agent'); return nativeFetch(input, { ...init, headers: h }); }) as typeof fetch;

type Pool = { OpfsSAHPoolDb: new (f: string) => WasmDb; importDb(f: string, b: Uint8Array | (() => Promise<Uint8Array | undefined>)): Promise<number>; exportFile(f: string): Uint8Array; unlink(f: string): boolean; getFileNames(): string[] };
let sqlite3: unknown;   // CP06.3: sqlite3_js_db_export is no longer used (it materialised the whole database in memory)
let pool: Pool;
let db: LocalDB;
let cfg: Config;

const count = (d: LocalDB, t: string) => (d.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as { n: number }).n;
let slotDb: LocalDB | null = null;
function activeSlot(): string {
  slotDb ??= new LocalDB(new pool.OpfsSAHPoolDb(SLOT_DB));
  slotDb.exec('CREATE TABLE IF NOT EXISTS active (id INTEGER PRIMARY KEY CHECK (id = 1), file TEXT NOT NULL)');
  return (slotDb.prepare('SELECT file FROM active WHERE id = 1').get() as { file: string } | undefined)?.file ?? SLOT_A;
}
function setActiveSlot(file: string) { activeSlot(); slotDb!.prepare('INSERT INTO active(id, file) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET file = excluded.file').run(file); }
const otherSlot = () => (activeSlot() === SLOT_A ? SLOT_B : SLOT_A);
function openMain() {
  const DB_FILE = activeSlot();
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

/* ---------- CP06.3 bounded-memory backup / restore ---------- */
const integrityOk = (d: LocalDB) => (d.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check === 'ok';
const countsOf = (d: LocalDB) => ({ products: count(d, 'products'), images: count(d, 'product_images'), users: count(d, 'users') });
/** peak bytes held by the backup/restore code at once (instrumentation for the scale test; not a secret) */
export const memStats = { peakChunkBytes: 0, frames: 0 };
const note = (n: number) => { if (n > memStats.peakChunkBytes) memStats.peakChunkBytes = n; };

/** Encrypted backup as a sequence of byte blocks: header, ~1 MiB frames, end frame. Pages are read with sqlite_dbpage
 *  inside ONE read transaction (consistent snapshot; the worker lock keeps every other request out meanwhile). */
async function* backupBlocks(pass: string, d: LocalDB): AsyncGenerator<Uint8Array, { counts: Record<string, number>; frames: number }> {
  if (!integrityOk(d)) throw new HttpError(500, 'قاعدة البيانات الحالية لا تجتاز فحص السلامة — لا تُنشأ نسخة');
  d.exec('BEGIN');
  try {
    const page_size = Number((d.prepare('PRAGMA page_size').get() as { page_size: number }).page_size);
    const page_count = Number((d.prepare('PRAGMA page_count').get() as { page_count: number }).page_count);
    const counts = countsOf(d);
    const w = await backup.BackupWriterV2.create(pass, { app: LOCAL_VERSION, schema: knownMigrations().filter((n) => d.prepare('SELECT 1 FROM schema_migrations WHERE name = ?').get(n)), counts, page_size, page_count });
    yield w.headerBytes;
    const per = Math.max(1, Math.floor(backup.CHUNK_BYTES / page_size)); let frames = 0;
    const stmt = d.raw.prepare('SELECT data FROM sqlite_dbpage WHERE pgno BETWEEN ? AND ? ORDER BY pgno');
    try {
      for (let pg = 1; pg <= page_count; pg += per) {
        const parts: Uint8Array[] = []; stmt.bind([pg, Math.min(page_count, pg + per - 1)]);
        while (stmt.step()) parts.push((stmt.get({}) as { data: Uint8Array }).data);
        (stmt as unknown as { reset(): void }).reset();
        const plain = new Uint8Array(parts.reduce((s2, x) => s2 + x.length, 0)); let o = 0; for (const x of parts) { plain.set(x, o); o += x.length; }
        if (plain.length !== Math.min(per, page_count - pg + 1) * page_size) throw new Error('page read mismatch');
        const fr = await w.data(plain); note(plain.length + fr.length); frames++; yield fr;
      }
    } finally { stmt.finalize(); }
    yield await w.end();
    memStats.frames = frames;
    return { counts, frames };
  } finally { d.exec('COMMIT'); }
}

/** Reads a byte range of the backup file (from the person's file in the main thread, or from memory for small legacy calls). */
type ReadAt = (offset: number, length: number) => Promise<Uint8Array>;
/**
 * Restore, all-or-nothing, never more than ~2 frames in memory for MHBAK2:
 * decrypt + authenticate frame by frame STRAIGHT INTO the inactive slot → integrity_check + known schema + counts match the
 * header + at least one account → (dry: delete the copy) → switch the pointer → reopen + migrate + integrity → delete the old
 * slot. Any failure before the switch leaves the current data untouched; a failure after it switches back.
 * MHBAK1 (CP06 / CP06.2 files) is still accepted: it is decrypted in one piece (its format has a single GCM tag), then
 * written to the inactive slot the same way.
 */
async function restoreFrom(readAt: ReadAt, total: number, pass: string, dry: boolean) {
  memStats.peakChunkBytes = 0;
  const head = await readAt(0, Math.min(total, 65536));
  const target = otherSlot(); const before = activeSlot();
  try { pool.unlink(target); } catch { /* not there */ }
  let header: { created_at: string; counts: Record<string, number>; app: string; schema: string[] };
  try {
    if (new TextDecoder().decode(head.subarray(0, backup.MAGIC2.length)) === backup.MAGIC2) {
      const h2 = backup.readHeaderV2(head); header = h2.header;
      const unknown = header.schema.filter((n) => !new Set(knownMigrations()).has(n));
      if (unknown.length) throw new HttpError(400, `النسخة من إصدار أحدث من التطبيق (${unknown.join('، ')}). حدّث التطبيق أولًا.`);
      const reader = await backup.BackupReaderV2.open(h2.header, h2.line, pass);
      let off = h2.bodyOffset;
      await pool.importDb(target, (async () => {
        for (;;) {
          if (off + 4 > total) throw new Error('النسخة غير مكتملة (انتهى الملف قبل نهايته المسجلة)');
          const len = new DataView((await readAt(off, 4)).buffer).getUint32(0);
          if (len < 17 || len > backup.CHUNK_BYTES + 1024 || off + 4 + len > total) throw new Error('ملف النسخة تالف (طول جزء غير صالح)');
          const ct = await readAt(off + 4, len); off += 4 + len;
          const pt = await reader.frame(ct); note(ct.length + (pt?.length ?? 0));
          if (pt === null) { if (off !== total) throw new Error('بيانات زائدة بعد نهاية النسخة'); return undefined; }
          if (pt.length) return pt;
        }
      }) as never);
      if (!reader.done) throw new Error('النسخة غير مكتملة');
    } else {
      const { header: h1, plain } = await backup.open(await readAt(0, total), pass); header = h1;
      const unknown = header.schema.filter((n) => !new Set(knownMigrations()).has(n));
      if (unknown.length) throw new HttpError(400, `النسخة من إصدار أحدث من التطبيق (${unknown.join('، ')}). حدّث التطبيق أولًا.`);
      note(plain.length);
      await pool.importDb(target, plain);
    }
    const chk = new LocalDB(new pool.OpfsSAHPoolDb(target));
    try {
      if (!integrityOk(chk)) throw new HttpError(400, 'النسخة لا تجتاز فحص سلامة SQLite');
      for (const [t, k] of [['products', 'products'], ['product_images', 'images'], ['users', 'users']] as const) if (count(chk, t) !== header.counts[k]) throw new HttpError(400, `عدد السجلات في «${t}» لا يطابق رأس النسخة`);
      if (count(chk, 'users') < 1) throw new HttpError(400, 'النسخة لا تحتوي أي حساب — لن تتمكن من الدخول بعدها');
    } finally { chk.close(); }
  } catch (e) {
    try { pool.unlink(target); } catch { /* nothing written */ }
    throw e instanceof HttpError ? e : new HttpError(400, (e as Error).message);
  }
  if (dry) { pool.unlink(target); return { ok: true, verified: true, header, mem: { peak_buffer_bytes: memStats.peakChunkBytes } }; }
  db.close();
  try {
    setActiveSlot(target); openMain();
    if (!integrityOk(db)) throw new Error('integrity');
  } catch {
    try { db?.close(); } catch { /* already closed */ }
    setActiveSlot(before); openMain(); try { pool.unlink(target); } catch { /* ignore */ }
    throw new HttpError(500, 'تعذرت الاستعادة؛ أُعيدت البيانات السابقة كما كانت');
  }
  try { pool.unlink(before); } catch { /* ignore */ }
  db.prepare("INSERT INTO audit_log(user_id, action, entity, entity_id, detail, at) VALUES (NULL, 'restore', 'database', 'all', ?, ?)").run(`from ${header.created_at} products=${header.counts.products}`, new Date().toISOString());
  return { ok: true, restored: true, relogin: true, header: { created_at: header.created_at, counts: header.counts, app: header.app }, mem: { peak_buffer_bytes: memStats.peakChunkBytes } };
}

const memReadAt = (buf: Uint8Array): ReadAt => async (o, l) => buf.slice(o, o + l);
const restoreAllowed = (c: { db: unknown; user: { role: string } | null }) => {
  const fresh = count(c.db as never, 'users') === 0;
  if (!fresh && c.user?.role !== 'manager') throw new HttpError(c.user ? 403 : 401, c.user ? 'الاستعادة للمدير فقط' : 'يلزم تسجيل الدخول');
};

/** Whole-file backup in ONE response (kept for compatibility and small tests; the app UI uses the streaming path below). */
route('POST', '/api/local/backup', 'manager', async (c) => {
  const { passphrase } = await c.body() as { passphrase?: string };
  const pass = backup.checkPassphrase(passphrase); const d = c.db as unknown as LocalDB;
  const parts: Uint8Array[] = []; const it = backupBlocks(pass, d); let r = await it.next();
  while (!r.done) { parts.push(r.value); r = await it.next(); }
  const file = new Uint8Array(parts.reduce((s2, x) => s2 + x.length, 0)); let o = 0; for (const x of parts) { file.set(x, o); o += x.length; }
  d.prepare("INSERT INTO audit_log(user_id, action, entity, entity_id, detail, at) VALUES (?, 'backup', 'database', 'all', ?, ?)").run(c.user!.id, `products=${r.value.counts.products} images=${r.value.counts.images}`, new Date().toISOString());
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  return new RawResponse(200, { 'content-type': 'application/octet-stream', 'x-mh-filename': `makeup-house-${stamp}.mhbak`, 'x-mh-counts': JSON.stringify(r.value.counts) }, file);
});
/** Whole-file restore (legacy body format). Body = [u32BE json length][JSON {passphrase, dry}][backup file]. */
route('POST', '/api/local/restore', 'none', async (c) => {
  restoreAllowed(c as never);
  const raw = new Uint8Array(await c.raw()); if (raw.length < 8) throw new HttpError(400, 'لا يوجد ملف');
  const jl = new DataView(raw.buffer, raw.byteOffset).getUint32(0); const opts = JSON.parse(new TextDecoder().decode(raw.subarray(4, 4 + jl))) as { passphrase?: string; dry?: boolean };
  const file = raw.subarray(4 + jl);
  return restoreFrom(memReadAt(file), file.length, backup.checkPassphrase(opts.passphrase), !!opts.dry);
});

/* streaming: a one-time ticket from an authenticated request, then a message conversation with the main thread */
const tickets = new Map<string, { kind: 'backup' | 'restore'; pass: string; dry?: boolean; size?: number; user: number | null; exp: number }>();
const newTicket = (t: Omit<Parameters<typeof tickets.set>[1], 'exp'>) => { const k = [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, '0')).join(''); tickets.set(k, { ...t, exp: Date.now() + 60_000 }); return k; };
route('POST', '/api/local/backup/stream', 'manager', async (c) => {
  const { passphrase } = await c.body() as { passphrase?: string };
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  return { ticket: newTicket({ kind: 'backup', pass: backup.checkPassphrase(passphrase), user: c.user!.id }), filename: `makeup-house-${stamp}.mhbak` };
});
route('POST', '/api/local/restore/stream', 'none', async (c) => {
  restoreAllowed(c as never);
  const b = await c.body() as { passphrase?: string; dry?: boolean; size?: number };
  if (!Number.isFinite(b.size) || (b.size ?? 0) < 32) throw new HttpError(400, 'لا يوجد ملف');
  return { ticket: newTicket({ kind: 'restore', pass: backup.checkPassphrase(b.passphrase), dry: !!b.dry, size: b.size, user: c.user?.id ?? null }) };
});
route('GET', '/api/local/backup/mem', 'manager', (c) => ({ ...memStats, wasm_heap_bytes: (sqlite3 as { wasm: { heap8u(): Uint8Array } }).wasm.heap8u().byteLength, db_bytes: Number((c.db as unknown as LocalDB).prepare('SELECT page_count * page_size AS n FROM pragma_page_count(), pragma_page_size()').get()?.n ?? 0), active_slot: activeSlot() }));
route('POST', '/api/local/backup/mem/reset', 'manager', () => { memStats.peakChunkBytes = 0; memStats.frames = 0; return { ok: true }; });

/* ---------- boot + request bridge ---------- */
const ready = (async () => {
  sqlite3 = await sqlite3InitModule() as never;
  pool = await (sqlite3 as unknown as { installOpfsSAHPoolVfs(o: object): Promise<Pool> }).installOpfsSAHPoolVfs({ name: 'makeup-house', initialCapacity: 8 });
  await (pool as unknown as { reserveMinimumCapacity(n: number): Promise<number> }).reserveMinimumCapacity(10);
  for (const f of LEGACY_FILES) { try { pool.unlink(f); } catch { /* not there */ } }
  openMain();
  // optional background enrichment queue — only does anything when online and products were queued
  setInterval(() => { if (navigator.onLine) processQueueOnce(db as never, cfg, 1).catch(() => { /* offline / source down: retried later */ }); }, 8000);
  // CP06.2: the v2 queue (import batches, evidence for review). Offline, jobs simply wait; results are evidence only, never product data.
  setInterval(() => { processOne(db as never, activeProviders(), { online: navigator.onLine }).catch(() => { /* retried by the queue's own backoff */ }); }, 6000);
})();

// one request at a time: no write can slip into a backup's read transaction or a restore's swap
// CP09: read/write lock. Ordinary requests run concurrently as before CP06.3 (a slow network call — scientific research —
// must not freeze the app); a backup or restore is EXCLUSIVE: it waits for in-flight requests to finish, and new ones wait
// for it. This keeps the CP06.3 guarantee that no write slips into a backup's read transaction or a restore's swap.
let readers = 0; let exclusive: Promise<void> | null = null; let drained: (() => void) | null = null;
async function shared<T>(fn: () => Promise<T>): Promise<T> {
  while (exclusive) await exclusive;
  readers++;
  try { return await fn(); } finally { readers--; if (readers === 0) drained?.(); }
}
async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  while (exclusive) await exclusive;
  let release!: () => void; exclusive = new Promise<void>((r) => { release = r; });
  try { while (readers > 0) await new Promise<void>((r) => { drained = r; }); drained = null; return await fn(); }
  finally { exclusive = null; release(); }
}
const isExclusiveRequest = (method: string, url: string) => method === 'POST' && /^\/api\/local\/(backup|restore)(\?|$)/.test(url);
const replies = new Map<string, (v: unknown) => void>();
const post = (m: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);
const ask = (key: string, m: unknown, transfer: Transferable[] = []) => new Promise<unknown>((resolve) => { replies.set(key, resolve); post(m, transfer); });

async function streamBackup(id: number, t: { pass: string; user: number | null }) {
  const it = backupBlocks(t.pass, db); let seq = 0; let r = await it.next();
  while (!r.done) { const buf = r.value.slice().buffer; await ask(`${id}:ack:${seq}`, { type: 'backup-chunk', id, seq, bytes: buf }, [buf]); seq++; r = await it.next(); }
  db.prepare("INSERT INTO audit_log(user_id, action, entity, entity_id, detail, at) VALUES (?, 'backup', 'database', 'all', ?, ?)").run(t.user, `products=${r.value.counts.products} images=${r.value.counts.images} stream`, new Date().toISOString());
  post({ type: 'backup-done', id, counts: r.value.counts, frames: r.value.frames });
}
async function streamRestore(id: number, t: { pass: string; dry?: boolean; size?: number }) {
  let n = 0;
  const readAt: ReadAt = async (offset, length) => new Uint8Array(await ask(`${id}:data:${n}`, { type: 'restore-need', id, n: n++, offset, length }) as ArrayBuffer);
  const res = await restoreFrom(readAt, t.size!, t.pass, !!t.dry);
  post({ type: 'restore-done', id, result: res });
}

self.onmessage = async (e: MessageEvent) => {
  const m = e.data as { id: number; type?: string; seq?: number; n?: number; bytes?: ArrayBuffer; ticket?: string; method: string; url: string; authorization?: string; body?: ArrayBuffer | null };
  // replies from the main thread inside a running stream (never wait for the lock: the stream holds it)
  if (m.type === 'ack') { replies.get(`${m.id}:ack:${m.seq}`)?.(true); replies.delete(`${m.id}:ack:${m.seq}`); return; }
  if (m.type === 'restore-data') { replies.get(`${m.id}:data:${m.n}`)?.(m.bytes); replies.delete(`${m.id}:data:${m.n}`); return; }
  if (m.type === 'backup-stream' || m.type === 'restore-stream') {
    const t = tickets.get(m.ticket ?? ''); tickets.delete(m.ticket ?? '');
    if (!t || t.exp < Date.now() || (m.type === 'backup-stream') !== (t.kind === 'backup')) { post({ type: 'stream-error', id: m.id, error: 'طلب غير صالح أو منتهي الصلاحية' }); return; }
    await ready;
    withLock(() => (t.kind === 'backup' ? streamBackup(m.id, t) : streamRestore(m.id, t)))
      .catch((err) => post({ type: 'stream-error', id: m.id, error: (err as Error).message, status: (err as { status?: number }).status ?? 500 }));
    return;
  }
  try {
    await ready;
    const run = isExclusiveRequest(m.method, m.url) ? withLock : shared;
    const res = await run(() => dispatch(db as never, cfg, { method: m.method, url: m.url, authorization: m.authorization, raw: async () => Buffer.from(m.body ? new Uint8Array(m.body) : new Uint8Array()) as never }));
    const body = typeof res.body === 'string' ? res.body : res.body.slice().buffer;
    (self as unknown as Worker).postMessage({ id: m.id, status: res.status, headers: res.headers, body }, typeof body === 'string' ? [] : [body as ArrayBuffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id: m.id, status: 500, headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify({ error: 'تعذر تشغيل قاعدة البيانات المحلية: ' + (err as Error).message }) })
  }
};
ready.then(() => (self as unknown as Worker).postMessage({ type: 'ready' })).catch((err) => (self as unknown as Worker).postMessage({ type: 'fatal', error: String((err as Error)?.message ?? err) }));
