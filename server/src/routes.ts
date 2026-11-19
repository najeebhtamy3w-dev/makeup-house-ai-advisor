import { approveImageCandidate } from './images.ts';
import { z } from 'zod';
import { audit, now, type DB } from './db.ts';
import { HttpError, route, type Ctx } from './http.ts';
import { hashPassword, signToken, verifyPassword } from './security.ts';
import { gtinValid, normalizeBarcode } from './gtin.ts';
import { parseImport, MAX_IMPORT_ROWS } from './importer.ts';
import { compareName, parseSize } from './enrichment/identity.ts';
import { norm } from './advisor.ts';
import { advise } from './advisor.ts';

// ---------- helpers ----------
import { CATEGORIES, TYPE_IDS, AREA_IDS, FUNCTION_IDS, taxonomyPayload, suggestTypeFromName, typeLabel } from './taxonomy.ts';
const dummyHash = hashPassword('dummy-password-for-timing');

export interface ProductRow {
  id: number; barcode: string | null; name: string; brand: string; category: string; size: string;
  availability: 'yes' | 'no' | 'unknown'; availability_updated_at: string | null; availability_updated_by: number | null;
  verification: 'review' | 'partial' | 'verified'; ingredients: string; benefits: string; warnings: string; source_url: string;
  created_by: number | null; created_at: string; updated_at: string;
  primary_image_id?: number | null;
  pending_suggestions?: number;
  product_type?: string; application_area?: string; functions?: string; classification_status?: string; classification_raw?: string;
  name_ar?: string; name_en?: string; manufacturer?: string; variant?: string; record_status?: 'import_draft' | 'active' | 'archived'; version?: number;
}
/** Product columns + id of its primary image (CP04). */
export const PRODUCT_SELECT = "SELECT products.*, (SELECT i.id FROM product_images i WHERE i.product_id = products.id ORDER BY i.is_primary DESC, i.id LIMIT 1) AS primary_image_id, (SELECT COUNT(*) FROM enrichment_candidates e WHERE e.barcode = products.barcode AND e.review_status = 'pending') AS pending_suggestions FROM products";

export function presentProduct(p: ProductRow, staleHours: number, nowMs = Date.now()) {
  const age = p.availability_updated_at ? (nowMs - Date.parse(p.availability_updated_at)) / 3.6e6 : Infinity;
  const stale = p.availability === 'yes' && age > staleHours;
  // An unconfirmed or stale "yes" must never be treated as available.
  const effective = p.availability === 'yes' && stale ? 'unknown' : p.availability;
  return { ...p, availability_stale: stale, availability_effective: effective };
}

const loadProduct = (db: DB, id: number) => db.prepare(`${PRODUCT_SELECT} WHERE id = ?`).get(id) as ProductRow | undefined;
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
  ingredients: z.string().trim().max(5000).default(''),   // blank text is stored as empty: never mistaken for a documented list
  benefits: z.string().trim().max(3000).default(''),
  warnings: z.string().trim().max(3000).default(''),
  source_url: z.union([z.literal(''), z.string().url().max(500)]).default(''),
  verification: z.enum(['review', 'partial', 'verified']).default('review'),
  availability: z.enum(['yes', 'no', 'unknown']).default('unknown'),
  // CP05 taxonomy (form / area / functions are independent of category; '' = unclassified)
  product_type: z.string().refine((v) => v === '' || TYPE_IDS.has(v), 'نوع غير معروف').default(''),
  application_area: z.string().refine((v) => v === '' || AREA_IDS.has(v), 'منطقة غير معروفة').default(''),
  functions: z.array(z.string().refine((v) => FUNCTION_IDS.has(v))).max(10).default([]),
  client_ref: z.string().regex(/^[A-Za-z0-9-]{8,64}$/).optional(),
  // CP06.2 identity (migration 006). `name` stays the display name; these never change it automatically.
  name_ar: z.string().trim().max(200).default(''),
  name_en: z.string().trim().max(200).default(''),
  manufacturer: z.string().trim().max(160).default(''),
  variant: z.string().trim().max(120).default(''),
  // optimistic concurrency: the version the editor loaded. Omitted = old clients (accepted, as before).
  version: z.number().int().positive().optional(),
}).strict();
/** A person choosing a type in the form confirms it; no type = unknown. */
const classification = (d: { product_type?: string }) => (d.product_type ? 'confirmed' : 'unknown');

function checkVerification(user: NonNullable<Ctx['user']>, verification: string, source: string) {
  if (verification === 'verified') {
    if (user.role !== 'manager') throw new HttpError(403, 'اعتماد المعلومات للمدير فقط');
    if (!source) throw new HttpError(400, 'لا يمكن اعتماد منتج دون رابط مصدر');
  }
}

/** One filter builder for the list AND its facet counts, so the numbers always match the results. `skip` drops one dimension (for its own counts). */
function productFilter(qs: URLSearchParams, skip: '' | 'type' | 'category' = '', staleHours: number | null = null) {
  const where: string[] = []; const args: (string | number)[] = [];
  const q = (qs.get('q') ?? '').trim();
  if (q) { where.push('(products.name LIKE ? OR products.brand LIKE ? OR products.barcode LIKE ?)'); const l = `%${q.replace(/[%_]/g, '')}%`; args.push(l, l, l); }
  const av = qs.get('availability'); if (av && ['yes', 'no', 'unknown'].includes(av)) { where.push('products.availability = ?'); args.push(av); }
  if (av === 'stale' && staleHours != null) { where.push("products.availability = 'yes' AND (products.availability_updated_at IS NULL OR products.availability_updated_at < ?)"); args.push(new Date(Date.now() - staleHours * 3.6e6).toISOString()); }
  const cat = qs.get('category'); if (cat && skip !== 'category') { where.push('products.category = ?'); args.push(cat); }
  const ver = qs.get('verification'); if (ver && ['review', 'partial', 'verified'].includes(ver)) { where.push('products.verification = ?'); args.push(ver); }
  // CP05 product form: an id, or 'none' for unclassified products (they never disappear: they have their own filter)
  const type = qs.get('type');
  if (type && skip !== 'type') { if (type === 'none') where.push("products.product_type = ''"); else if (TYPE_IDS.has(type)) { where.push('products.product_type = ?'); args.push(type); } }
  const area = qs.get('area'); if (area && AREA_IDS.has(area)) { where.push('products.application_area = ?'); args.push(area); }
  const cls = qs.get('classification');
  if (cls === 'review') where.push("products.classification_status IN ('suggested','needs_review')");
  // completeness filters (descriptive only: complete is not the same as correct)
  const missing = qs.get('missing');
  if (missing === 'image') where.push('NOT EXISTS (SELECT 1 FROM product_images i WHERE i.product_id = products.id)');
  if (missing === 'info') where.push("(products.barcode IS NULL OR products.brand = '' OR products.size = '' OR products.ingredients = '')");
  if (missing === 'pending') where.push("products.barcode IN (SELECT barcode FROM enrichment_candidates WHERE review_status = 'pending')");
  return { sql: where.length ? 'WHERE ' + where.join(' AND ') : '', args };
}
/** Compact row for the catalog list: no ingredients / benefits / warnings text (just whether they exist). */
const compact = (p: ReturnType<typeof presentProduct>) => ({ id: p.id, name: p.name, brand: p.brand, size: p.size, barcode: p.barcode, category: p.category, product_type: p.product_type ?? '', classification_status: p.classification_status ?? 'unknown',
  verification: p.verification, availability: p.availability, availability_effective: p.availability_effective, availability_stale: p.availability_stale, primary_image_id: p.primary_image_id ?? null, pending_suggestions: p.pending_suggestions ?? 0,
  has: { ingredients: !!p.ingredients, warnings: !!p.warnings, source: !!p.source_url, barcode: !!p.barcode, brand: !!p.brand, size: !!p.size } });

route('GET', '/api/products', 'any', (c) => {
  const limit = Math.min(Number(c.query.get('limit') ?? 100) || 100, 500);
  const offset = Math.max(0, Math.min(Number(c.query.get('offset') ?? 0) || 0, 1_000_000));
  const f = productFilter(c.query, '', c.cfg.availabilityStaleHours);
  const rows = c.db.prepare(`${PRODUCT_SELECT} ${f.sql} ORDER BY products.updated_at DESC, products.id DESC LIMIT ? OFFSET ?`).all(...f.args, limit, offset) as unknown as ProductRow[];
  const total = (c.db.prepare(`SELECT COUNT(*) n FROM products ${f.sql}`).get(...f.args) as { n: number }).n;
  const list = rows.map((p) => presentProduct(p, c.cfg.availabilityStaleHours));
  return { products: c.query.get('view') === 'compact' ? list.map(compact) : list, total, offset, limit };
});

/** Counts per product type (with every OTHER active filter applied) and per category — computed by the same filter as the list. */
route('GET', '/api/products/facets', 'any', (c) => {
  const ft = productFilter(c.query, 'type'); const fc = productFilter(c.query, 'category');
  const types = c.db.prepare(`SELECT products.product_type AS id, COUNT(*) AS n FROM products ${ft.sql} GROUP BY products.product_type`).all(...ft.args) as { id: string; n: number }[];
  const categories = c.db.prepare(`SELECT products.category AS id, COUNT(*) AS n FROM products ${fc.sql} GROUP BY products.category`).all(...fc.args) as { id: string; n: number }[];
  return { types: Object.fromEntries(types.map((x) => [x.id || 'none', x.n])), categories: Object.fromEntries(categories.map((x) => [x.id, x.n])) };
});

route('GET', '/api/taxonomy', 'any', () => taxonomyPayload());

/**
 * Routine steps computed over the WHOLE catalog (CP06: the screen used to download at most 500 products).
 * A product matches a step by its classified FORM, or — for products not classified yet — by its name or category.
 * Availability is shown, never used as suitability.
 */
const ROUTINE: Record<string, { am: [string, string[], string[], string?][]; pm: [string, string[], string[], string?][] }> = {
  skin: { am: [['تنظيف لطيف', ['cleanser'], ['غسول', 'منظف', 'تنظيف', 'cleanser']], ['ترطيب', ['cream', 'lotion'], ['مرطب', 'ترطيب', 'moistur']], ['حماية من الشمس', ['sunscreen'], ['واقي', 'شمس', 'spf'], 'واقيات الشمس']],
    pm: [['تنظيف لطيف', ['cleanser'], ['غسول', 'منظف', 'تنظيف', 'cleanser']], ['ترطيب', ['cream', 'lotion'], ['مرطب', 'ترطيب', 'moistur']]] },
  hair: { am: [['غسل الشعر', ['shampoo'], ['شامبو', 'shampoo']], ['بلسم / ترطيب الأطراف', ['conditioner'], ['بلسم', 'ماسك', 'conditioner']]], pm: [] },
};
route('GET', '/api/routine', 'any', (c) => {
  const area = c.query.get('area') === 'hair' ? 'hair' : 'skin';
  const step = ([label, types, words, cat]: [string, string[], string[], string?]) => {
    const conds = [`products.product_type IN (${types.map(() => '?').join(',')})`, `(products.product_type = '' AND (${words.map(() => 'products.name LIKE ?').join(' OR ')}))`];
    const args: (string | number)[] = [...types, ...words.map((w) => `%${w}%`)];
    if (cat) { conds.push('products.category = ?'); args.push(cat); }
    const where = `WHERE (${conds.join(' OR ')})`;
    const rows = c.db.prepare(`${PRODUCT_SELECT} ${where} ORDER BY (products.availability = 'yes') DESC, products.updated_at DESC LIMIT 12`).all(...args) as unknown as ProductRow[];
    const total = (c.db.prepare(`SELECT COUNT(*) n FROM products ${where}`).get(...args) as { n: number }).n;
    return { label, total, products: rows.map((p) => presentProduct(p, c.cfg.availabilityStaleHours)).map((p) => ({ id: p.id, name: p.name, verification: p.verification, warnings: p.warnings, availability_effective: p.availability_effective })) };
  };
  const d = ROUTINE[area]!;
  return { area, am: d.am.map(step), pm: d.pm.map(step) };
});
/** Name -> form SUGGESTION (only when unambiguous). The person decides; nothing is stored. */
route('GET', '/api/taxonomy/suggest', 'any', (c) => { const t = suggestTypeFromName((c.query.get('name') ?? '').slice(0, 200)); return { type: t, label: t ? typeLabel(t) : null, status: t ? 'suggested' : 'unknown' }; });

/** Manager: conservative, reported conversion of EXISTING unclassified products — name-based SUGGESTIONS only (never confirmed). */
route('POST', '/api/taxonomy/suggest-existing', 'manager', (c) => {
  const dry = c.query.get('dry') === '1';
  const rows = c.db.prepare("SELECT id, name FROM products WHERE product_type = '' AND classification_status IN ('unknown','needs_review')").all() as { id: number; name: string }[];
  const plan = rows.map((r) => ({ id: r.id, name: r.name, type: suggestTypeFromName(r.name) }));
  const sug = plan.filter((p) => p.type); const none = plan.filter((p) => !p.type);
  if (!dry) {
    const upd = c.db.prepare("UPDATE products SET product_type = ?, classification_status = 'suggested' WHERE id = ? AND product_type = ''");
    c.db.exec('BEGIN'); try { for (const p of sug) upd.run(p.type, p.id); c.db.exec('COMMIT'); } catch (e) { c.db.exec('ROLLBACK'); throw e; }
    audit(c.db, c.user!.id, 'taxonomy_suggest', 'products', sug.length, `unclassifiable=${none.length}`);
  }
  return { applied: !dry, suggested: sug.length, unclassifiable: none.length, sample: sug.slice(0, 20).map((p) => ({ id: p.id, name: p.name, type: p.type, label: typeLabel(p.type!) })), unclassifiable_sample: none.slice(0, 20).map((p) => ({ id: p.id, name: p.name })) };
});

route('GET', '/api/products/by-barcode/:code', 'any', (c) => {
  const b = cleanBarcode(c.params.code);
  const p = b ? (c.db.prepare(`${PRODUCT_SELECT} WHERE barcode = ?`).get(b) as ProductRow | undefined) : undefined;
  // Global enrichment connectors are not implemented yet: say so instead of pretending to search the web.
  return { barcode: b, found: !!p, product: p ? presentProduct(p, c.cfg.availabilityStaleHours) : null, enrichment: p ? null : c.cfg.enrich === 'off' ? { status: 'not_configured', message: 'البحث العالمي غير مفعّل على هذا الخادم. أدخل البيانات يدويًا وستُحفظ بحالة «تحتاج مراجعة».' } : { status: 'available', message: 'يمكن البحث في المصادر العالمية. النتائج مسودات تحتاج مراجعة المدير.' } };
});

route('GET', '/api/products/:id', 'any', (c) => {
  const p = loadProduct(c.db, parseId(c.params.id!));
  if (!p) throw new HttpError(404, 'المنتج غير موجود');
  return { product: presentProduct(p, c.cfg.availabilityStaleHours) };
});

route('POST', '/api/products', 'any', async (c) => {
  const d = productInput.parse(await c.body());
  const user = c.user!;
  // idempotency: a repeated submission of the SAME form (double tap, network retry) returns the record already created
  if (d.client_ref) { const prev = c.db.prepare('SELECT id FROM products WHERE client_ref = ?').get(d.client_ref) as { id: number } | undefined; if (prev) return { id: prev.id, duplicate_request: true }; }
  checkVerification(user, d.verification, d.source_url);
  const barcode = cleanBarcode(d.barcode);
  if (barcode) {
    const ex = c.db.prepare('SELECT id, name FROM products WHERE barcode = ?').get(barcode) as { id: number; name: string } | undefined;
    if (ex) throw Object.assign(new HttpError(409, 'الباركود مسجل مسبقًا. افتح السجل الموجود.'), { existingId: ex.id });
  }
  const t = now();
  const avSet = d.availability !== 'unknown';
  let r;
  try {
    r = c.db.prepare(`INSERT INTO products(barcode,name,brand,category,size,availability,availability_updated_at,availability_updated_by,verification,ingredients,benefits,warnings,source_url,created_by,created_at,updated_at,product_type,application_area,functions,classification_status,client_ref,name_ar,name_en,manufacturer,variant)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(barcode, d.name, d.brand, d.category, d.size, d.availability, avSet ? t : null, avSet ? user.id : null, d.verification, d.ingredients, d.benefits, d.warnings, d.source_url, user.id, t, t,
      d.product_type, d.application_area, [...new Set(d.functions)].join(','), classification(d), d.client_ref ?? null, d.name_ar, d.name_en, d.manufacturer, d.variant);
  } catch (e) {
    // two identical submissions racing: the unique index on client_ref is the server-side guarantee
    const prev = d.client_ref ? c.db.prepare('SELECT id FROM products WHERE client_ref = ?').get(d.client_ref) as { id: number } | undefined : undefined;
    if (prev) return { id: prev.id, duplicate_request: true };
    throw e;
  }
  audit(c.db, user.id, 'create', 'product', Number(r.lastInsertRowid));
  return { id: Number(r.lastInsertRowid) };
});

route('PATCH', '/api/products/:id', 'any', async (c) => {
  const id = parseId(c.params.id!);
  const cur = loadProduct(c.db, id);
  if (!cur) throw new HttpError(404, 'المنتج غير موجود');
  const user = c.user!;
  const d = productInput.omit({ availability: true, client_ref: true }).partial().parse(await c.body());
  // CP06.2: a save based on an older copy of the record is refused instead of silently overwriting someone else's edit
  if (d.version !== undefined && d.version !== cur.version) throw Object.assign(new HttpError(409, 'عدّل شخص آخر هذا المنتج بعد فتحك له. أعد فتح المنتج لترى آخر نسخة، ثم أعد تعديلك.'), { stale: true, currentVersion: cur.version });
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
  // classification is not scientific content: changing it does not reset verification; a person choosing a type confirms it
  const cls = d.product_type !== undefined ? { product_type: d.product_type, classification_status: classification(d), classification_raw: d.product_type ? '' : cur.classification_raw ?? '' } : { product_type: cur.product_type ?? '', classification_status: cur.classification_status ?? 'unknown', classification_raw: cur.classification_raw ?? '' };
  c.db.prepare(`UPDATE products SET barcode=?,name=?,brand=?,category=?,size=?,ingredients=?,benefits=?,warnings=?,source_url=?,verification=?,updated_at=?,product_type=?,application_area=?,functions=?,classification_status=?,classification_raw=?,name_ar=?,name_en=?,manufacturer=?,variant=?,version=version+1 WHERE id=?`)
    .run(next.barcode, next.name, next.brand, next.category, next.size, next.ingredients, next.benefits, next.warnings, next.source_url, next.verification, now(),
      cls.product_type, d.application_area ?? cur.application_area ?? '', d.functions ? [...new Set(d.functions)].join(',') : cur.functions ?? '', cls.classification_status, cls.classification_raw,
      d.name_ar ?? cur.name_ar ?? '', d.name_en ?? cur.name_en ?? '', d.manufacturer ?? cur.manufacturer ?? '', d.variant ?? cur.variant ?? '', id);
  audit(c.db, user.id, 'update', 'product', id, Object.keys(d).filter((k) => k !== 'version').join(','));
  return { verification: next.verification, version: (cur.version ?? 1) + 1 };
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
  // CP05 import decisions. Existing records are NEVER overwritten: only EMPTY brand/size of a non-verified product may be completed.
  type Ex = { id: number; barcode: string | null; name: string; brand: string; size: string; variant: string; verification: string; product_type: string };
  const all = c.db.prepare('SELECT id, barcode, name, brand, size, variant, verification, product_type FROM products').all() as Ex[];
  const byBarcode = new Map(all.filter((p) => p.barcode).map((p) => [p.barcode!, p]));
  const sizeKey = (v: string) => { const p = parseSize(v); return p ? `${p.v}${p.unit}` : norm(v); };
  // CP06.2: the variant (shade / scent / edition) is part of the identity — a different variant is a different product
  const idKey = (r: { name: string; brand: string; size: string; variant?: string }) => `${norm(r.name)}|${norm(r.brand)}|${sizeKey(r.size)}|${norm(r.variant ?? '')}`;
  const byIdentity = new Map(all.filter((p) => !p.barcode).map((p) => [idKey(p), p]));
  // without a barcode and with a size missing on either side, "same name + brand" is ambiguous: never import it silently
  const byNameBrand = new Map<string, Ex>(); for (const p of all) if (!p.barcode) byNameBrand.set(`${norm(p.name)}|${norm(p.brand)}`, p);
  const possible: { line: number; reason: string; existing_id: number }[] = [];
  const seen = new Set<string>();
  const fresh: typeof parsed.rows = []; const completions: { id: number; line: number; brand?: string; size?: string; product_type?: string }[] = [];
  const conflicts: { line: number; reason: string; existing_id: number }[] = [];
  let dupDb = 0, dupFile = 0;
  for (const r of parsed.rows) {
    const key = r.barcode ? 'b:' + r.barcode : 'n:' + idKey(r);
    if (seen.has(key)) { dupFile++; continue; }
    seen.add(key);
    const ex = r.barcode ? byBarcode.get(r.barcode) : byIdentity.get(idKey(r));
    if (!ex && !r.barcode) {
      const nb = byNameBrand.get(`${norm(r.name)}|${norm(r.brand)}`);
      if (nb && (!r.size || !nb.size)) { possible.push({ line: r.line, reason: 'منتج بنفس الاسم والعلامة موجود والحجم غير محدد في أحدهما — لم يُستورد لتجنب التكرار؛ أضف الباركود أو الحجم', existing_id: nb.id }); continue; }
    }
    if (!ex) { fresh.push(r); continue; }
    dupDb++;
    if (r.barcode && compareName(ex.name, r.name).match === 'conflict') { conflicts.push({ line: r.line, reason: 'نفس الباركود مسجل في المحل باسم مختلف — لم يُغيَّر شيء، راجع السجل يدويًا', existing_id: ex.id }); continue; }
    if (ex.verification === 'verified') continue;
    const fill: { brand?: string; size?: string; product_type?: string } = {};
    if (!ex.brand && r.brand) fill.brand = r.brand;
    if (!ex.size && r.size) fill.size = r.size;
    if (!ex.product_type && r.product_type && r.classification_status === 'confirmed') fill.product_type = r.product_type;
    if (Object.keys(fill).length) completions.push({ id: ex.id, line: r.line, ...fill });
  }
  const missing = { barcode: fresh.filter((r) => !r.barcode).length, brand: fresh.filter((r) => !r.brand).length, size: fresh.filter((r) => !r.size).length };
  const summary = { total: parsed.rows.length + parsed.invalid.length, new: fresh.length, duplicates_existing: dupDb, duplicates_in_file: dupFile, invalid: parsed.invalid.length, invalid_rows: parsed.invalid.slice(0, 50),
    completions: completions.length, completion_rows: completions.slice(0, 20).map((x) => ({ line: x.line, fields: Object.keys(x).filter((k) => k === 'brand' || k === 'size' || k === 'product_type') })),
    classification: { confirmed: fresh.filter((r) => r.classification_status === 'confirmed').length, suggested: fresh.filter((r) => r.classification_status === 'suggested').length, needs_review: fresh.filter((r) => r.classification_status === 'needs_review').length, unknown: fresh.filter((r) => r.classification_status === 'unknown').length },
    conflicts: conflicts.length, conflict_rows: conflicts.slice(0, 50), possible_duplicates: possible.length, possible_rows: possible.slice(0, 50), missing, max_rows: MAX_IMPORT_ROWS,
    ignored_columns: parsed.ignoredColumns, warnings: parsed.warnings, sample: fresh.slice(0, 10), drafts: fresh.filter((r) => r.draft).length };
  if (!commit) return { committed: false, ...summary };
  // CP06.2: resumable batch (chunks of 500, each in its own transaction); drafts for barcode-only rows; v2 enrichment jobs
  const providers = c.query.get('enrich') === '1' && c.cfg.enrich !== 'off' ? getConnectors().map((x) => x.id) : [];
  let res;
  try { res = commitBatch(c.db, { filename, fileBytes: new Uint8Array(buf), fresh, completions, invalid: parsed.invalid, total: summary.total, userId: c.user!.id, enrichProviders: providers, ignoredColumns: parsed.ignoredColumns }); }
  catch (e) { const x = e as Error & { batchId?: number; savedSoFar?: number }; throw Object.assign(new HttpError(500, `توقف الاستيراد بعد حفظ ${x.savedSoFar ?? 0} صف. أعد رفع الملف نفسه للمتابعة من حيث توقف (لن يتكرر أي منتج).`), {}); }
  const queued = res.enrich_queued;
  return { committed: true, enrich_queued: queued, batch_id: res.batch_id, resumed: res.resumed, ...summary };
}
route('POST', '/api/imports/preview', 'manager', (c) => runImport(c, false));
route('POST', '/api/imports/commit', 'manager', (c) => runImport(c, true));

// ---------- advisor (retrieval-only baseline: NO language model yet) ----------
route('POST', '/api/advisor/search', 'any', async (c) => {
  const { query } = z.object({ query: z.string().trim().min(1).max(500) }).strict().parse(await c.body());
  // CP06.2: import drafts and archived records are visible to staff but never recommended
  const rows = c.db.prepare(`${PRODUCT_SELECT} WHERE products.record_status = 'active'`).all() as unknown as ProductRow[];
  const conflictIds = new Set((c.db.prepare("SELECT DISTINCT p.id FROM products p JOIN enrichment_candidates e ON e.barcode = p.barcode WHERE e.review_status='pending' AND e.conflict_note <> ''").all() as { id: number }[]).map((r) => r.id));
  return advise(query, rows.map((p) => presentProduct(p, c.cfg.availabilityStaleHours)), { conflictIds });
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

// ---------- enrichment (global product knowledge). Drafts only: nothing here becomes "verified" automatically ----------
import { enrichBarcode, reviewCandidate, enqueueBarcodes, processQueueOnce, getConnectors } from './enrichment/engine.ts';
import { commitBatch, rollbackDrafts, batchReportCsv } from './import-batch.ts';

route('POST', '/api/enrichment/lookup', 'any', async (c) => {
  const { barcode, force } = z.object({ barcode: z.string().max(40), force: z.boolean().optional() }).strict().parse(await c.body());
  const b = cleanBarcode(barcode); if (!b) throw new HttpError(400, 'أدخل الباركود');
  const r = await enrichBarcode(c.db, c.cfg, b, c.user!.id, { force: !!force && c.user!.role === 'manager' });
  const local = c.db.prepare('SELECT id,name,brand,size,ingredients FROM products WHERE barcode=?').get(b) ?? null;
  return { ...r, local_product: local, mode: c.cfg.enrich };
});

route('GET', '/api/enrichment/status', 'any', (c) => {
  const n = (sql: string) => (c.db.prepare(sql).get() as { n: number }).n;
  return {
    mode: c.cfg.enrich, connectors: getConnectors().map((x) => ({ id: x.id, name: x.name, license: x.license, mock: x.isMock })),
    pending_candidates: n("SELECT COUNT(DISTINCT barcode) n FROM enrichment_candidates WHERE review_status='pending'"),
    queue: { queued: n("SELECT COUNT(*) n FROM enrichment_jobs WHERE status='queued'"), done: n("SELECT COUNT(*) n FROM enrichment_jobs WHERE status='done'"), failed: n("SELECT COUNT(*) n FROM enrichment_jobs WHERE status='failed'") },
  };
});

route('GET', '/api/enrichment/pending', 'manager', (c) => {
  const rows = c.db.prepare("SELECT id,barcode,field,value,source_name,source_url,license,is_mock,conflict_note,quality_note,extracted_at FROM enrichment_candidates WHERE review_status='pending' ORDER BY barcode,field,id LIMIT 500").all() as { barcode: string; [k: string]: unknown }[];
  const byCode = new Map<string, typeof rows>();
  for (const r of rows) byCode.set(r.barcode, [...(byCode.get(r.barcode) ?? []), r]);
  return { items: [...byCode].map(([barcode, candidates]) => ({ barcode, local_product: c.db.prepare(`SELECT p.id,p.name,p.brand,p.size,p.ingredients,p.verification,(SELECT i.id FROM product_images i WHERE i.product_id=p.id ORDER BY i.is_primary DESC, i.id LIMIT 1) AS primary_image_id FROM products p WHERE p.barcode=?`).get(barcode) ?? null, candidates })) };
});

route('POST', '/api/enrichment/candidates/:id/review', 'manager', async (c) => {
  const id = parseId(c.params.id!);
  const d = z.object({ action: z.enum(['approve', 'reject']), value: z.string().max(5000).optional() }).strict().parse(await c.body());
  if (d.action === 'approve' && (c.db.prepare('SELECT field FROM enrichment_candidates WHERE id = ?').get(id) as { field: string } | undefined)?.field === 'image_url') return approveImageCandidate(c.db, id, c.user!.id, c.cfg.enrichContact);
  const r = reviewCandidate(c.db, id, c.user!.id, d.action, d.value);
  const err = (r as { error?: 'not_found' | 'already_reviewed' | 'no_product' | 'images_not_supported' | 'empty' }).error;
  if (err) {
    const map = { not_found: [404, 'غير موجود'], already_reviewed: [409, 'تمت مراجعته مسبقًا'], no_product: [409, 'أنشئ بطاقة المنتج أولًا ثم اعتمد المعلومات'], images_not_supported: [400, 'اعتماد الصور غير مدعوم في هذه النسخة (ترخيص CC BY-SA)'], empty: [400, 'القيمة فارغة'] } as const;
    throw new HttpError(map[err][0], map[err][1]);
  }
  return { ok: true };
});

route('POST', '/api/enrichment/queue/start', 'manager', (c) => {
  if (c.cfg.enrich === 'off') throw new HttpError(409, 'الإثراء الإلكتروني غير مفعّل (MH_ENRICH).');
  const codes = (c.db.prepare("SELECT barcode FROM products WHERE barcode IS NOT NULL AND (ingredients='' OR brand='' OR size='' OR NOT EXISTS (SELECT 1 FROM product_images i WHERE i.product_id = products.id)) AND barcode NOT IN (SELECT barcode FROM enrichment_runs WHERE outcome IN ('found','not_found'))").all() as { barcode: string }[]).map((r) => r.barcode);
  audit(c.db, c.user!.id, 'enrich_queue', 'products', codes.length);
  return { queued: enqueueBarcodes(c.db, codes), candidates_total: codes.length };
});
route('POST', '/api/enrichment/queue/run', 'manager', async (c) => ({ ...(await processQueueOnce(c.db, c.cfg, 5)) }));
import './evidence-routes.ts';
