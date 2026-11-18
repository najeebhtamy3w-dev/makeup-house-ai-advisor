import { z } from 'zod';
import { audit, now, type DB } from './db.ts';
import { HttpError, route, type Ctx } from './http.ts';
import { hashPassword, signToken, verifyPassword } from './security.ts';
import { gtinValid, normalizeBarcode } from './gtin.ts';
import { parseImport } from './importer.ts';
import { advise } from './advisor.ts';

// ---------- helpers ----------
const CATEGORIES = ['العناية بالبشرة', 'العناية بالشعر', 'واقيات الشمس', 'المكياج والجمال', 'العطور والعناية', 'أخرى'] as const;
const dummyHash = hashPassword('dummy-password-for-timing');

export interface ProductRow {
  id: number; barcode: string | null; name: string; brand: string; category: string; size: string;
  availability: 'yes' | 'no' | 'unknown'; availability_updated_at: string | null; availability_updated_by: number | null;
  verification: 'review' | 'partial' | 'verified'; ingredients: string; benefits: string; warnings: string; source_url: string;
  created_by: number | null; created_at: string; updated_at: string;
}

export function presentProduct(p: ProductRow, staleHours: number, nowMs = Date.now()) {
  const age = p.availability_updated_at ? (nowMs - Date.parse(p.availability_updated_at)) / 3.6e6 : Infinity;
  const stale = p.availability === 'yes' && age > staleHours;
  // An unconfirmed or stale "yes" must never be treated as available.
  const effective = p.availability === 'yes' && stale ? 'unknown' : p.availability;
  return { ...p, availability_stale: stale, availability_effective: effective };
}

const loadProduct = (db: DB, id: number) => db.prepare('SELECT * FROM products WHERE id = ?').get(id) as ProductRow | undefined;
const parseId = (s: string) => { const n = Number(s); if (!Number.isInteger(n) || n < 1) throw new HttpError(400, 'معرّف غير صالح'); return n; };

function cleanBarcode(raw: unknown): string | null {
  const b = normalizeBarcode(raw);
  if (!b) return null;
  if (!gtinValid(b)) throw new HttpError(400, 'الباركود غير صالح (الطول أو رقم التحقق). تأكد من القراءة.');
  return b;
}

// ---------- auth ----------
const attempts = new Map<string, { n: number; first: number }>();
export const resetThrottle = () => attempts.clear();

route('POST', '/api/auth/login', 'none', async (c) => {
  const { username, password } = z.object({ username: z.string().min(1).max(64), password: z.string().min(1).max(200) }).strict().parse(await c.body());
  const key = username.toLowerCase();
  const a = attempts.get(key);
  if (a && Date.now() - a.first < 10 * 60_000 && a.n >= 5) throw new HttpError(429, 'محاولات كثيرة. حاول لاحقًا.');
  const u = c.db.prepare('SELECT * FROM users WHERE username = ?').get(username) as { id: number; username: string; display_name: string; role: 'manager' | 'staff'; password_hash: string; active: number } | undefined;
  const ok = verifyPassword(password, u?.password_hash ?? dummyHash) && !!u && !!u.active;
  if (!ok) {
    const cur = a && Date.now() - a.first < 10 * 60_000 ? a : { n: 0, first: Date.now() };
    attempts.set(key, { n: cur.n + 1, first: cur.first });
    throw new HttpError(401, 'اسم المستخدم أو كلمة المرور غير صحيحة');
  }
  attempts.delete(key);
  audit(c.db, u!.id, 'login', 'user', u!.id);
  const token = signToken({ uid: u!.id, role: u!.role, exp: Math.floor(Date.now() / 1000) + c.cfg.tokenTtlSec }, c.cfg.secret);
  return { token, user: { id: u!.id, username: u!.username, display_name: u!.display_name, role: u!.role } };
});

route('GET', '/api/auth/me', 'any', (c) => ({ user: c.user }));

// ---------- users (manager) ----------
route('GET', '/api/users', 'manager', (c) => ({ users: c.db.prepare('SELECT id, username, display_name, role, active, created_at FROM users ORDER BY id').all() }));

route('POST', '/api/users', 'manager', async (c) => {
  const d = z.object({ username: z.string().min(3).max(64), display_name: z.string().min(1).max(100), role: z.enum(['manager', 'staff']), password: z.string().min(10).max(200) }).strict().parse(await c.body());
  try {
    const r = c.db.prepare('INSERT INTO users(username, display_name, role, password_hash, created_at) VALUES (?,?,?,?,?)').run(d.username, d.display_name, d.role, hashPassword(d.password), now());
    audit(c.db, c.user!.id, 'create', 'user', Number(r.lastInsertRowid), d.role);
    return { id: Number(r.lastInsertRowid) };
  } catch (e) { if (String((e as Error).message).includes('UNIQUE')) throw new HttpError(409, 'اسم المستخدم مستخدم'); throw e; }
});

route('PATCH', '/api/users/:id', 'manager', async (c) => {
  const id = parseId(c.params.id!);
  const d = z.object({ role: z.enum(['manager', 'staff']).optional(), active: z.boolean().optional(), password: z.string().min(10).max(200).optional(), display_name: z.string().min(1).max(100).optional() }).strict().parse(await c.body());
  const u = c.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as { role: string; active: number } | undefined;
  if (!u) throw new HttpError(404, 'المستخدم غير موجود');
  const losesManager = u.role === 'manager' && u.active && (d.role === 'staff' || d.active === false);
  if (losesManager) {
    const n = (c.db.prepare("SELECT COUNT(*) n FROM users WHERE role='manager' AND active=1").get() as { n: number }).n;
    if (n <= 1) throw new HttpError(409, 'لا يمكن إزالة آخر مدير نشط');
  }
  if (d.role) c.db.prepare('UPDATE users SET role=? WHERE id=?').run(d.role, id);
  if (d.active !== undefined) c.db.prepare('UPDATE users SET active=? WHERE id=?').run(d.active ? 1 : 0, id);
  if (d.display_name) c.db.prepare('UPDATE users SET display_name=? WHERE id=?').run(d.display_name, id);
  if (d.password) c.db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(d.password), id);
  audit(c.db, c.user!.id, 'update', 'user', id, Object.keys(d).filter((k) => k !== 'password').join(','));
});

// ---------- products ----------
// .strict(): any unknown key (price, cost, quantity, discount...) is rejected with 400, never stored.
const productInput = z.object({
  barcode: z.string().max(40).nullish(),
  name: z.string().trim().min(1).max(200),
  brand: z.string().trim().max(120).default(''),
  category: z.enum(CATEGORIES).default('أخرى'),
  size: z.string().trim().max(60).default(''),
  ingredients: z.string().max(5000).default(''),
  benefits: z.string().max(3000).default(''),
  warnings: z.string().max(3000).default(''),
  source_url: z.union([z.literal(''), z.string().url().max(500)]).default(''),
  verification: z.enum(['review', 'partial', 'verified']).default('review'),
  availability: z.enum(['yes', 'no', 'unknown']).default('unknown'),
}).strict();

function checkVerification(user: NonNullable<Ctx['user']>, verification: string, source: string) {
  if (verification === 'verified') {
    if (user.role !== 'manager') throw new HttpError(403, 'اعتماد المعلومات للمدير فقط');
    if (!source) throw new HttpError(400, 'لا يمكن اعتماد منتج دون رابط مصدر');
  }
}

route('GET', '/api/products', 'any', (c) => {
  const q = (c.query.get('q') ?? '').trim();
  const av = c.query.get('availability');
  const cat = c.query.get('category');
  const limit = Math.min(Number(c.query.get('limit') ?? 100) || 100, 500);
  const where: string[] = []; const args: (string | number)[] = [];
  if (q) { where.push('(name LIKE ? OR brand LIKE ? OR barcode LIKE ?)'); const l = `%${q.replace(/[%_]/g, '')}%`; args.push(l, l, l); }
  if (av && ['yes', 'no', 'unknown'].includes(av)) { where.push('availability = ?'); args.push(av); }
  if (cat) { where.push('category = ?'); args.push(cat); }
  const rows = c.db.prepare(`SELECT * FROM products ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY updated_at DESC, id DESC LIMIT ?`).all(...args, limit) as unknown as ProductRow[];
  return { products: rows.map((p) => presentProduct(p, c.cfg.availabilityStaleHours)) };
});

route('GET', '/api/products/by-barcode/:code', 'any', (c) => {
  const b = cleanBarcode(c.params.code);
  const p = b ? (c.db.prepare('SELECT * FROM products WHERE barcode = ?').get(b) as ProductRow | undefined) : undefined;
  // Global enrichment connectors are not implemented yet: say so instead of pretending to search the web.
  return { barcode: b, found: !!p, product: p ? presentProduct(p, c.cfg.availabilityStaleHours) : null, enrichment: p ? null : { status: 'not_configured', message: 'البحث العالمي غير مفعّل بعد. أدخل البيانات يدويًا وستُحفظ بحالة «تحتاج مراجعة».' } };
});

route('GET', '/api/products/:id', 'any', (c) => {
  const p = loadProduct(c.db, parseId(c.params.id!));
  if (!p) throw new HttpError(404, 'المنتج غير موجود');
  return { product: presentProduct(p, c.cfg.availabilityStaleHours) };
});

route('POST', '/api/products', 'any', async (c) => {
  const d = productInput.parse(await c.body());
  const user = c.user!;
  checkVerification(user, d.verification, d.source_url);
  const barcode = cleanBarcode(d.barcode);
  if (barcode) {
    const ex = c.db.prepare('SELECT id, name FROM products WHERE barcode = ?').get(barcode) as { id: number; name: string } | undefined;
    if (ex) throw Object.assign(new HttpError(409, 'الباركود مسجل مسبقًا. افتح السجل الموجود.'), { existingId: ex.id });
  }
  const t = now();
  const avSet = d.availability !== 'unknown';
  const r = c.db.prepare(`INSERT INTO products(barcode,name,brand,category,size,availability,availability_updated_at,availability_updated_by,verification,ingredients,benefits,warnings,source_url,created_by,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(barcode, d.name, d.brand, d.category, d.size, d.availability, avSet ? t : null, avSet ? user.id : null, d.verification, d.ingredients, d.benefits, d.warnings, d.source_url, user.id, t, t);
  audit(c.db, user.id, 'create', 'product', Number(r.lastInsertRowid));
  return { id: Number(r.lastInsertRowid) };
});

route('PATCH', '/api/products/:id', 'any', async (c) => {
  const id = parseId(c.params.id!);
  const cur = loadProduct(c.db, id);
  if (!cur) throw new HttpError(404, 'المنتج غير موجود');
  const user = c.user!;
  const d = productInput.omit({ availability: true }).partial().parse(await c.body());
  if (d.barcode !== undefined) {
    const b = cleanBarcode(d.barcode);
    if (b) { const ex = c.db.prepare('SELECT id FROM products WHERE barcode = ? AND id <> ?').get(b, id); if (ex) throw new HttpError(409, 'الباركود مسجل لمنتج آخر'); }
    (d as Record<string, unknown>).barcode = b;
  }
  const next = { ...cur, ...d } as ProductRow;
  const contentChanged = (['name', 'brand', 'category', 'size', 'ingredients', 'benefits', 'warnings', 'source_url', 'barcode'] as const).some((k) => k in d && (d as Record<string, unknown>)[k] !== (cur as unknown as Record<string, unknown>)[k]);
  if (user.role === 'manager') {
    if (d.verification) checkVerification(user, d.verification, next.source_url);
    else if (contentChanged && cur.verification === 'verified') next.verification = 'review'; // edits invalidate prior approval
  } else {
    if (d.verification === 'verified') throw new HttpError(403, 'اعتماد المعلومات للمدير فقط');
    if (contentChanged) next.verification = 'review';
  }
  if (next.verification === 'verified' && !next.source_url) throw new HttpError(400, 'لا يمكن اعتماد منتج دون رابط مصدر');
  c.db.prepare(`UPDATE products SET barcode=?,name=?,brand=?,category=?,size=?,ingredients=?,benefits=?,warnings=?,source_url=?,verification=?,updated_at=? WHERE id=?`)
    .run(next.barcode, next.name, next.brand, next.category, next.size, next.ingredients, next.benefits, next.warnings, next.source_url, next.verification, now(), id);
  audit(c.db, user.id, 'update', 'product', id, Object.keys(d).join(','));
  return { verification: next.verification };
});

route('POST', '/api/products/:id/availability', 'any', async (c) => {
  const id = parseId(c.params.id!);
  const { status } = z.object({ status: z.enum(['yes', 'no', 'unknown']) }).strict().parse(await c.body());
  if (!loadProduct(c.db, id)) throw new HttpError(404, 'المنتج غير موجود');
  c.db.prepare('UPDATE products SET availability=?, availability_updated_at=?, availability_updated_by=?, updated_at=? WHERE id=?').run(status, now(), c.user!.id, now(), id);
  audit(c.db, c.user!.id, 'availability', 'product', id, status);
});

route('DELETE', '/api/products/:id', 'manager', (c) => {
  const id = parseId(c.params.id!);
  if (!loadProduct(c.db, id)) throw new HttpError(404, 'المنتج غير موجود');
  c.db.prepare('DELETE FROM products WHERE id=?').run(id);
  audit(c.db, c.user!.id, 'delete', 'product', id);
});

// ---------- unmet requests ----------
const normKey = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[ً-ٟـ]/g, '').replace(/[إأآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/\s+/g, ' ').trim();
const looksPersonal = (s: string) => /\d{7,}/.test(s.replace(/[\s\-+()]/g, '')) || /\S+@\S+\.\S+/.test(s);

route('POST', '/api/requests', 'any', async (c) => {
  const d = z.object({ text: z.string().trim().min(2).max(200), category: z.string().max(60).default(''), brand: z.string().max(120).default(''), note: z.string().max(300).default('') }).strict().parse(await c.body());
  if (looksPersonal(d.text) || looksPersonal(d.note)) throw new HttpError(400, 'لا تُدخل أرقام هاتف أو بريدًا أو بيانات شخصية للعملاء.');
  const r = c.db.prepare('INSERT INTO unmet_requests(key,text,category,brand,note,created_by,created_at) VALUES (?,?,?,?,?,?,?)').run(normKey(d.text), d.text, d.category, d.brand, d.note, c.user!.id, now());
  return { id: Number(r.lastInsertRowid) };
});

route('GET', '/api/requests/summary', 'manager', (c) => ({
  items: c.db.prepare('SELECT key, MIN(text) AS text, MAX(category) AS category, MAX(brand) AS brand, COUNT(*) AS count, MAX(created_at) AS last_at FROM unmet_requests GROUP BY key ORDER BY count DESC, last_at DESC LIMIT 200').all(),
}));

// ---------- import ----------
async function runImport(c: Ctx, commit: boolean) {
  const filename = (c.query.get('filename') ?? '').slice(0, 200);
  const buf = await c.raw();
  if (!buf.length) throw new HttpError(400, 'لا يوجد ملف');
  let parsed;
  try { parsed = parseImport(filename, buf); } catch (e) { throw new HttpError(400, (e as Error).message); }
  const existing = new Set((c.db.prepare('SELECT barcode FROM products WHERE barcode IS NOT NULL').all() as { barcode: string }[]).map((r) => r.barcode));
  const seen = new Set<string>();
  const fresh = []; let dupDb = 0, dupFile = 0;
  for (const r of parsed.rows) {
    if (r.barcode) {
      if (existing.has(r.barcode)) { dupDb++; continue; }
      if (seen.has(r.barcode)) { dupFile++; continue; }
      seen.add(r.barcode);
    }
    fresh.push(r);
  }
  const summary = { total: parsed.rows.length + parsed.invalid.length, new: fresh.length, duplicates_existing: dupDb, duplicates_in_file: dupFile, invalid: parsed.invalid.length, invalid_rows: parsed.invalid.slice(0, 50), ignored_columns: parsed.ignoredColumns, warnings: parsed.warnings, sample: fresh.slice(0, 10) };
  if (!commit) return { committed: false, ...summary };
  const t = now(); const uid = c.user!.id;
  c.db.exec('BEGIN');
  try {
    const ins = c.db.prepare(`INSERT INTO products(barcode,name,brand,category,size,availability,availability_updated_at,availability_updated_by,verification,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?, 'review',?,?,?)`);
    for (const r of fresh) ins.run(r.barcode || null, r.name, r.brand, r.category, r.size, r.availability ?? 'unknown', r.availability ? t : null, r.availability ? uid : null, uid, t, t);
    c.db.prepare('INSERT INTO import_jobs(filename,status,total,added,duplicates,invalid,ignored_columns,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(filename, 'committed', summary.total, fresh.length, dupDb + dupFile, parsed.invalid.length, parsed.ignoredColumns.join(' | '), uid, t);
    c.db.exec('COMMIT');
  } catch (e) { c.db.exec('ROLLBACK'); throw e; }
  audit(c.db, uid, 'import', 'products', filename.replace(/[^\w.\-]/g, '_'), `added=${fresh.length}`);
  return { committed: true, ...summary };
}
route('POST', '/api/imports/preview', 'manager', (c) => runImport(c, false));
route('POST', '/api/imports/commit', 'manager', (c) => runImport(c, true));

// ---------- advisor (retrieval-only baseline: NO language model yet) ----------
route('POST', '/api/advisor/search', 'any', async (c) => {
  const { query } = z.object({ query: z.string().trim().min(1).max(500) }).strict().parse(await c.body());
  const rows = c.db.prepare('SELECT * FROM products').all() as unknown as ProductRow[];
  return advise(query, rows.map((p) => presentProduct(p, c.cfg.availabilityStaleHours)));
});

// ---------- reports (manager) ----------
route('GET', '/api/reports/summary', 'manager', (c) => {
  const one = (sql: string) => (c.db.prepare(sql).get() as { n: number }).n;
  const staleCut = new Date(Date.now() - c.cfg.availabilityStaleHours * 3.6e6).toISOString();
  return {
    products: one('SELECT COUNT(*) n FROM products'),
    needs_review: one("SELECT COUNT(*) n FROM products WHERE verification <> 'verified'"),
    availability: c.db.prepare('SELECT availability AS status, COUNT(*) AS count FROM products GROUP BY availability').all(),
    stale_available: (c.db.prepare("SELECT COUNT(*) n FROM products WHERE availability='yes' AND (availability_updated_at IS NULL OR availability_updated_at < ?)").get(staleCut) as { n: number }).n,
    unmet_requests: one('SELECT COUNT(*) n FROM unmet_requests'),
  };
});
