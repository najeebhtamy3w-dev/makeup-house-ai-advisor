// CP04 product images: camera / gallery uploads and manager-approved images from a global source (Open Beauty Facts).
// Security: type is decided by MAGIC BYTES (never by the client's header or file name), size and dimensions are capped,
// remote images are fetched ONLY from an allow-list of https hosts, without redirects. Bytes are served behind login.
import { z } from 'zod';
import { audit, now, type DB } from './db.ts';
import { HttpError, RawResponse, route, type Ctx } from './http.ts';

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;   // after client-side compression a phone photo is typically 150–500 KB
export const MAX_IMAGE_SIDE = 6000;
export const MAX_IMAGES_PER_PRODUCT = 8;
export const KINDS = ['front', 'package', 'ingredients', 'other'] as const;
export const REMOTE_IMAGE_HOSTS = new Set(['images.openbeautyfacts.org', 'static.openbeautyfacts.org']);
export const OBF_IMAGE_LICENSE = 'CC BY-SA 3.0';
export const OBF_IMAGE_ATTRIBUTION = 'Open Beauty Facts contributors';

export type ImageMime = 'image/jpeg' | 'image/png' | 'image/webp';
export interface ImageInfo { mime: ImageMime; width: number | null; height: number | null }

/** Identifies JPEG / PNG / WebP from the bytes and reads the pixel size from the header. Anything else => null. */
export function sniffImage(b: Uint8Array): ImageInfo | null {
  const u16 = (i: number) => (b[i]! << 8) | b[i + 1]!;
  const le16 = (i: number) => b[i]! | (b[i + 1]! << 8);
  const le24 = (i: number) => b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16);
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return { mime: 'image/png', width: dv.getUint32(16), height: dv.getUint32(20) };
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1]!;
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7) || m === 0xff) { i += m === 0xff ? 1 : 2; continue; }
      const len = u16(i + 2);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { mime: 'image/jpeg', height: u16(i + 5), width: u16(i + 7) };
      if (len < 2) break;
      i += 2 + len;
    }
    return { mime: 'image/jpeg', width: null, height: null };
  }
  if (b.length > 30 && String.fromCharCode(...b.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...b.subarray(8, 12)) === 'WEBP') {
    const fmt = String.fromCharCode(...b.subarray(12, 16));
    if (fmt === 'VP8 ' && b.length > 30) return { mime: 'image/webp', width: le16(26) & 0x3fff, height: le16(28) & 0x3fff };
    if (fmt === 'VP8L' && b.length > 25) { const v = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24); return { mime: 'image/webp', width: (v & 0x3fff) + 1, height: ((v >>> 14) & 0x3fff) + 1 }; }
    if (fmt === 'VP8X' && b.length > 30) return { mime: 'image/webp', width: le24(24) + 1, height: le24(27) + 1 };
    return { mime: 'image/webp', width: null, height: null };
  }
  return null;
}

/** Throws HttpError(400/413) with a clear Arabic message when the bytes are not an acceptable image. */
export function validateImage(b: Uint8Array): ImageInfo {
  if (!b.length) throw new HttpError(400, 'الملف فارغ');
  if (b.length > MAX_IMAGE_BYTES) throw new HttpError(413, `حجم الصورة أكبر من ${MAX_IMAGE_BYTES / 1024 / 1024} ميغابايت بعد الضغط`);
  const info = sniffImage(b);
  if (!info) throw new HttpError(400, 'نوع الملف غير مدعوم. المسموح: JPEG أو PNG أو WebP');
  if ((info.width ?? 1) < 1 || (info.height ?? 1) < 1 || (info.width ?? 0) > MAX_IMAGE_SIDE || (info.height ?? 0) > MAX_IMAGE_SIDE) throw new HttpError(400, 'أبعاد الصورة غير صالحة');
  return info;
}

/* ---------- storage helpers ---------- */
interface ImageRow { id: number; product_id: number; kind: string; is_primary: number; mime: string; size: number; width: number | null; height: number | null; origin: string; source_name: string; source_url: string; license: string; attribution: string; identity_note: string; created_by: number | null; created_at: string }
const META = 'id, product_id, kind, is_primary, mime, size, width, height, origin, source_name, source_url, license, attribution, identity_note, created_by, created_at';
export const listImages = (db: DB, productId: number) => db.prepare(`SELECT ${META} FROM product_images WHERE product_id = ? ORDER BY is_primary DESC, id`).all(productId) as unknown as ImageRow[];
const getImage = (db: DB, id: number) => db.prepare(`SELECT ${META} FROM product_images WHERE id = ?`).get(id) as ImageRow | undefined;

export function insertImage(db: DB, d: { productId: number; kind: string; bytes: Uint8Array; info: ImageInfo; origin: 'camera' | 'upload' | 'source'; userId: number; sourceName?: string; sourceUrl?: string; license?: string; attribution?: string; identityNote?: string; makePrimary?: boolean }): number {
  const count = (db.prepare('SELECT COUNT(*) n FROM product_images WHERE product_id = ?').get(d.productId) as { n: number }).n;
  if (count >= MAX_IMAGES_PER_PRODUCT) throw new HttpError(409, `الحد الأقصى ${MAX_IMAGES_PER_PRODUCT} صور للمنتج. احذف صورة أولًا.`);
  const primary = count === 0 || !!d.makePrimary;
  db.exec('BEGIN');
  try {
    if (primary) db.prepare('UPDATE product_images SET is_primary = 0 WHERE product_id = ?').run(d.productId);
    const r = db.prepare('INSERT INTO product_images(product_id, kind, is_primary, mime, bytes, size, width, height, origin, source_name, source_url, license, attribution, identity_note, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(d.productId, d.kind, primary ? 1 : 0, d.info.mime, d.bytes, d.bytes.length, d.info.width, d.info.height, d.origin, d.sourceName ?? '', d.sourceUrl ?? '', d.license ?? '', d.attribution ?? '', d.identityNote ?? '', d.userId, now());
    db.exec('COMMIT');
    const id = Number(r.lastInsertRowid);
    audit(db, d.userId, 'image_add', 'product', d.productId, `${id}:${d.origin}:${d.kind}`);
    return id;
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

function canModify(user: NonNullable<Ctx['user']>, img: ImageRow) {
  if (user.role === 'manager' || img.created_by === user.id) return;
  throw new HttpError(403, 'تعديل أو حذف صورة أضافها شخص آخر للمدير فقط');
}

/* ---------- remote (global source) images ---------- */
export type ImageFetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal; redirect: 'error' }) => Promise<{ ok: boolean; status: number; arrayBuffer: () => Promise<ArrayBuffer> }>;
let imageFetch: ImageFetch = (u, i) => fetch(u, i) as never;
export const setImageFetch = (f: ImageFetch | null) => { imageFetch = f ?? ((u, i) => fetch(u, i) as never); };

export function allowedRemoteImage(url: string): boolean {
  try { const u = new URL(url); return u.protocol === 'https:' && REMOTE_IMAGE_HOSTS.has(u.hostname) && !u.username && !u.password && (u.port === '' || u.port === '443'); } catch { return false; }
}

const remoteCache = new Map<string, { bytes: Uint8Array; info: ImageInfo; at: number }>();
export async function fetchRemoteImage(url: string, contact = 'contact-not-set'): Promise<{ bytes: Uint8Array; info: ImageInfo }> {
  if (!allowedRemoteImage(url)) throw new HttpError(400, 'مصدر الصورة غير مسموح');
  const hit = remoteCache.get(url); if (hit && Date.now() - hit.at < 3600_000) return hit;
  let res;
  try { res = await imageFetch(url, { headers: { 'user-agent': `MakeupHouseAdvisor/3.0 (${contact})`, accept: 'image/jpeg,image/png,image/webp' }, signal: AbortSignal.timeout(10_000), redirect: 'error' }); }
  catch { throw new HttpError(502, 'تعذر تحميل الصورة من المصدر'); }
  if (!res.ok) throw new HttpError(502, `تعذر تحميل الصورة من المصدر (${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const info = validateImage(bytes);
  if (remoteCache.size > 40) remoteCache.delete(remoteCache.keys().next().value!);
  remoteCache.set(url, { bytes, info, at: Date.now() });
  return { bytes, info };
}
export const clearRemoteImageCache = () => remoteCache.clear();

/** Manager approval of an image candidate: download from the allow-listed source, store with source + licence + attribution. */
export async function approveImageCandidate(db: DB, candidateId: number, managerId: number, contact: string) {
  const c = db.prepare("SELECT id, barcode, field, value, source_name, source_url, license, is_mock, review_status FROM enrichment_candidates WHERE id = ?").get(candidateId) as { id: number; barcode: string; field: string; value: string; source_name: string; source_url: string; license: string; is_mock: number; review_status: string } | undefined;
  if (!c) throw new HttpError(404, 'غير موجود');
  if (c.field !== 'image_url') throw new HttpError(400, 'ليست صورة');
  if (c.review_status !== 'pending') throw new HttpError(409, 'تمت مراجعته مسبقًا');
  if (c.is_mock) throw new HttpError(400, 'صور المصدر التجريبي لا تُعتمد');
  const p = db.prepare('SELECT id FROM products WHERE barcode = ?').get(c.barcode) as { id: number } | undefined;
  if (!p) throw new HttpError(409, 'أنشئ بطاقة المنتج أولًا ثم اعتمد الصورة');
  const { bytes, info } = await fetchRemoteImage(c.value, contact);
  const t = now();
  const imageId = insertImage(db, { productId: p.id, kind: 'front', bytes, info, origin: 'source', userId: managerId, sourceName: c.source_name, sourceUrl: c.source_url, license: OBF_IMAGE_LICENSE, attribution: OBF_IMAGE_ATTRIBUTION,
    identityNote: `صورة من ${c.source_name} لنفس الباركود ${c.barcode}. اعتمدها المدير بعد مقارنتها بالعبوة (الحجم والإصدار).` });
  db.prepare("UPDATE enrichment_candidates SET review_status='approved', reviewed_by=?, reviewed_at=? WHERE id=?").run(managerId, t, c.id);
  db.prepare("UPDATE enrichment_candidates SET review_status='rejected', reviewed_by=?, reviewed_at=? WHERE barcode=? AND field='image_url' AND review_status='pending'").run(managerId, t, c.barcode);
  audit(db, managerId, 'enrich_approve', 'candidate', c.id, 'image_url');
  return { ok: true, image_id: imageId };
}

/* ---------- routes ---------- */
const parseId = (s: string) => { const n = Number(s); if (!Number.isInteger(n) || n < 1) throw new HttpError(400, 'معرّف غير صالح'); return n; };
const productExists = (db: DB, id: number) => { if (!db.prepare('SELECT 1 FROM products WHERE id = ?').get(id)) throw new HttpError(404, 'المنتج غير موجود'); };
const imageResponse = (bytes: Uint8Array, mime: string) => new RawResponse(200, { 'content-type': mime, 'cache-control': 'private, max-age=86400', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'", 'content-disposition': 'inline' }, bytes);

route('GET', '/api/products/:id/images', 'any', (c) => { const id = parseId(c.params.id!); productExists(c.db, id); return { images: listImages(c.db, id), limits: { max_bytes: MAX_IMAGE_BYTES, max_images: MAX_IMAGES_PER_PRODUCT } }; });

route('POST', '/api/products/:id/images', 'any', async (c) => {
  const id = parseId(c.params.id!); productExists(c.db, id);
  const kind = z.enum(KINDS).parse(c.query.get('kind') ?? 'front');
  const origin = z.enum(['camera', 'upload']).parse(c.query.get('origin') ?? 'upload');
  const bytes = new Uint8Array(await c.raw());
  const info = validateImage(bytes);
  const imageId = insertImage(c.db, { productId: id, kind, bytes, info, origin, userId: c.user!.id, makePrimary: c.query.get('primary') === '1',
    identityNote: origin === 'camera' ? 'التقطها موظف المحل للعبوة الموجودة.' : 'رفعها موظف المحل من معرض الهاتف.' });
  return { id: imageId, image: getImage(c.db, imageId) };
});

route('GET', '/api/images/:id', 'any', (c) => {
  const r = c.db.prepare('SELECT mime, bytes FROM product_images WHERE id = ?').get(parseId(c.params.id!)) as { mime: string; bytes: Uint8Array } | undefined;
  if (!r) throw new HttpError(404, 'الصورة غير موجودة');
  return imageResponse(r.bytes, r.mime);
});

route('PATCH', '/api/images/:id', 'any', async (c) => {
  const img = getImage(c.db, parseId(c.params.id!)); if (!img) throw new HttpError(404, 'الصورة غير موجودة');
  canModify(c.user!, img);
  const d = z.object({ kind: z.enum(KINDS).optional(), primary: z.literal(true).optional() }).strict().parse(await c.body());
  c.db.exec('BEGIN');
  try {
    if (d.kind) c.db.prepare('UPDATE product_images SET kind = ? WHERE id = ?').run(d.kind, img.id);
    if (d.primary) { c.db.prepare('UPDATE product_images SET is_primary = 0 WHERE product_id = ?').run(img.product_id); c.db.prepare('UPDATE product_images SET is_primary = 1 WHERE id = ?').run(img.id); }
    c.db.exec('COMMIT');
  } catch (e) { c.db.exec('ROLLBACK'); throw e; }
  audit(c.db, c.user!.id, 'image_update', 'product', img.product_id, String(img.id));
  return { image: getImage(c.db, img.id) };
});

route('DELETE', '/api/images/:id', 'any', (c) => {
  const img = getImage(c.db, parseId(c.params.id!)); if (!img) throw new HttpError(404, 'الصورة غير موجودة');
  canModify(c.user!, img);
  c.db.prepare('DELETE FROM product_images WHERE id = ?').run(img.id);
  if (img.is_primary) c.db.prepare('UPDATE product_images SET is_primary = 1 WHERE id = (SELECT id FROM product_images WHERE product_id = ? ORDER BY id LIMIT 1)').run(img.product_id);
  audit(c.db, c.user!.id, 'image_delete', 'product', img.product_id, String(img.id));
});

/** Preview of a not-yet-approved source image, proxied so the phone never loads third-party content directly. */
route('GET', '/api/enrichment/candidates/:id/image', 'any', async (c) => {
  const cand = c.db.prepare("SELECT field, value, is_mock FROM enrichment_candidates WHERE id = ?").get(parseId(c.params.id!)) as { field: string; value: string; is_mock: number } | undefined;
  if (!cand || cand.field !== 'image_url' || cand.is_mock) throw new HttpError(404, 'لا توجد صورة');
  const { bytes, info } = await fetchRemoteImage(cand.value, c.cfg.enrichContact);
  return imageResponse(bytes, info.mime);
});
