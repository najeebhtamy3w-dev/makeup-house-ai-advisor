// Encrypted, self-verifying backup file (.mhbak) for the on-device database (products, images, sources, taxonomy,
// verification states, users). Format:
//   "MHBAK1\n" + <header JSON, one line> + "\n" + AES-256-GCM ciphertext of the SQLite database file
// The key comes from the person's passphrase (PBKDF2-SHA256, 310,000 iterations, random salt). GCM authenticates the
// ciphertext; the SHA-256 of the plaintext in the header is checked again after decryption. The header holds no secret.
export const MAGIC = 'MHBAK1\n';
const ITER = 310_000;
export interface BackupHeader {
  format: 1; app: string; created_at: string; schema: string[]; counts: Record<string, number>;
  plain_size: number; plain_sha256: string; kdf: { alg: 'PBKDF2-SHA256'; iter: number; salt: string }; cipher: { alg: 'AES-256-GCM'; iv: string };
}
const b64 = (u: Uint8Array) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
// Web Crypto typings want ArrayBuffer-backed views; our buffers are never SharedArrayBuffer (type-only cast)
const bs = (u: Uint8Array) => u as Uint8Array<ArrayBuffer>;
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
export const sha256hex = async (d: Uint8Array) => hex(await crypto.subtle.digest('SHA-256', bs(d)));

async function key(pass: string, salt: Uint8Array, iter: number) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: bs(salt), iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export function checkPassphrase(p: unknown): string {
  if (typeof p !== 'string' || p.length < 8) throw new Error('كلمة مرور النسخة الاحتياطية 8 أحرف على الأقل');
  return p;
}

export async function seal(plain: Uint8Array, pass: string, meta: Pick<BackupHeader, 'app' | 'schema' | 'counts'>): Promise<Uint8Array> {
  const salt = crypto.getRandomValues(new Uint8Array(16)); const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(pass, salt, ITER), bs(plain)));
  const header: BackupHeader = { format: 1, ...meta, created_at: new Date().toISOString(), plain_size: plain.length, plain_sha256: await sha256hex(plain),
    kdf: { alg: 'PBKDF2-SHA256', iter: ITER, salt: b64(salt) }, cipher: { alg: 'AES-256-GCM', iv: b64(iv) } };
  const head = new TextEncoder().encode(MAGIC + JSON.stringify(header) + '\n');
  const out = new Uint8Array(head.length + ct.length); out.set(head); out.set(ct, head.length);
  return out;
}

export function readHeader(file: Uint8Array): { header: BackupHeader; body: Uint8Array } {
  const magic = new TextDecoder().decode(file.subarray(0, MAGIC.length));
  if (magic !== MAGIC) throw new Error('الملف ليس نسخة احتياطية من ميك أب هاوس (.mhbak)');
  const nl = file.indexOf(10, MAGIC.length); if (nl < 0) throw new Error('ملف النسخة تالف (رأس ناقص)');
  let header: BackupHeader; try { header = JSON.parse(new TextDecoder().decode(file.subarray(MAGIC.length, nl))); } catch { throw new Error('ملف النسخة تالف (رأس غير مقروء)'); }
  if (header.format !== 1) throw new Error('إصدار ملف نسخة غير مدعوم');
  return { header, body: file.subarray(nl + 1) };
}

export async function open(file: Uint8Array, pass: string): Promise<{ header: BackupHeader; plain: Uint8Array }> {
  const { header, body } = readHeader(file);
  let plain: Uint8Array;
  try { plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(header.cipher.iv) }, await key(pass, unb64(header.kdf.salt), header.kdf.iter), bs(body))); }
  catch { throw new Error('كلمة المرور غير صحيحة أو الملف تالف/معدَّل'); }
  if (plain.length !== header.plain_size || (await sha256hex(plain)) !== header.plain_sha256) throw new Error('فشل التحقق من سلامة النسخة (البصمة لا تطابق)');
  return { header, plain };
}

/* =====================================================================================================================
 * CP06.3 — MHBAK2: bounded-memory, chunked format. Neither writing nor reading ever holds the whole database.
 *   "MHBAK2\n" + <header JSON line> + "\n" + frame* + endFrame
 *   frame    = u32BE(length) + AES-256-GCM( type(1 byte) + payload )
 *              iv  = iv_prefix(8 random bytes) + u32BE(frame index)      → a frame cannot be moved or replayed
 *              aad = SHA-256(header line bytes) + u32BE(frame index)     → the header cannot be edited
 *   type 0   = data: raw SQLite file bytes (consecutive pages, ≤ chunk_bytes)
 *   type 1   = end:  JSON { frames, plain_size, plain_sha256 }          → truncation / missing frames are detected
 * The key is derived once (PBKDF2-SHA256, 310,000 iterations). The whole-file SHA-256 is computed incrementally
 * (@noble/hashes) because Web Crypto has no streaming digest.
 * ===================================================================================================================== */
import { sha256 as nobleSha256 } from '@noble/hashes/sha2.js';
export const MAGIC2 = 'MHBAK2\n';
export const CHUNK_BYTES = 1024 * 1024;
export interface BackupHeaderV2 {
  format: 2; app: string; created_at: string; schema: string[]; counts: Record<string, number>;
  page_size: number; page_count: number; chunk_bytes: number;
  kdf: { alg: 'PBKDF2-SHA256'; iter: number; salt: string }; cipher: { alg: 'AES-256-GCM-CHUNKED'; iv_prefix: string };
}
const u32 = (n: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n); return b; };
const cat = (...parts: Uint8Array[]) => { const o = new Uint8Array(parts.reduce((s, p) => s + p.length, 0)); let i = 0; for (const p of parts) { o.set(p, i); i += p.length; } return o; };
const hexOf = (u: Uint8Array) => [...u].map((x) => x.toString(16).padStart(2, '0')).join('');

/** Encrypts a stream of plaintext chunks. Memory: one chunk + its ciphertext. */
export class BackupWriterV2 {
  private n = 0; private size = 0; private hash = nobleSha256.create();
  private constructor(private k: CryptoKey, private prefix: Uint8Array, private headHash: Uint8Array, readonly headerBytes: Uint8Array, readonly header: BackupHeaderV2) {}
  static async create(pass: string, meta: Pick<BackupHeaderV2, 'app' | 'schema' | 'counts' | 'page_size' | 'page_count'>): Promise<BackupWriterV2> {
    const salt = crypto.getRandomValues(new Uint8Array(16)); const prefix = crypto.getRandomValues(new Uint8Array(8));
    const header: BackupHeaderV2 = { format: 2, ...meta, created_at: new Date().toISOString(), chunk_bytes: CHUNK_BYTES, kdf: { alg: 'PBKDF2-SHA256', iter: ITER, salt: b64(salt) }, cipher: { alg: 'AES-256-GCM-CHUNKED', iv_prefix: b64(prefix) } };
    const line = new TextEncoder().encode(JSON.stringify(header));
    const headHash = new Uint8Array(await crypto.subtle.digest('SHA-256', bs(line)));
    return new BackupWriterV2(await key(pass, salt, ITER), prefix, headHash, cat(new TextEncoder().encode(MAGIC2), line, new Uint8Array([10])), header);
  }
  private async frame(type: number, payload: Uint8Array) {
    const i = this.n++;
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: bs(cat(this.prefix, u32(i))), additionalData: bs(cat(this.headHash, u32(i))) }, this.k, bs(cat(new Uint8Array([type]), payload))));
    return cat(u32(ct.length), ct);
  }
  async data(plain: Uint8Array) { this.hash.update(plain); this.size += plain.length; return this.frame(0, plain); }
  async end() { return this.frame(1, new TextEncoder().encode(JSON.stringify({ frames: this.n, plain_size: this.size, plain_sha256: hexOf(this.hash.digest()) }))); }
}

/** Parses the header from the first bytes of a file (≤ 64 KiB is always enough). */
export function readHeaderV2(head: Uint8Array): { header: BackupHeaderV2; line: Uint8Array; bodyOffset: number } {
  if (new TextDecoder().decode(head.subarray(0, MAGIC2.length)) !== MAGIC2) throw new Error('الملف ليس نسخة احتياطية من ميك أب هاوس بالإصدار 2');
  const nl = head.indexOf(10, MAGIC2.length); if (nl < 0) throw new Error('ملف النسخة تالف (رأس ناقص)');
  const line = head.subarray(MAGIC2.length, nl);
  let header: BackupHeaderV2; try { header = JSON.parse(new TextDecoder().decode(line)); } catch { throw new Error('ملف النسخة تالف (رأس غير مقروء)'); }
  if (header.format !== 2 || header.cipher?.alg !== 'AES-256-GCM-CHUNKED') throw new Error('إصدار ملف نسخة غير مدعوم');
  return { header, line: line.slice(), bodyOffset: nl + 1 };
}

/** Decrypts and authenticates frames one by one; verifies order, count, size and the whole-file SHA-256 at the end. */
export class BackupReaderV2 {
  private n = 0; private size = 0; private hash = nobleSha256.create(); done = false;
  private constructor(private k: CryptoKey, private prefix: Uint8Array, private headHash: Uint8Array) {}
  static async open(header: BackupHeaderV2, line: Uint8Array, pass: string) {
    return new BackupReaderV2(await key(pass, unb64(header.kdf.salt), header.kdf.iter), unb64(header.cipher.iv_prefix), new Uint8Array(await crypto.subtle.digest('SHA-256', bs(line))));
  }
  /** Returns the plaintext of a data frame, or null for the (verified) end frame. Throws on any tampering. */
  async frame(ct: Uint8Array): Promise<Uint8Array | null> {
    if (this.done) throw new Error('بيانات زائدة بعد نهاية النسخة');
    const i = this.n++;
    let pt: Uint8Array;
    try { pt = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bs(cat(this.prefix, u32(i))), additionalData: bs(cat(this.headHash, u32(i))) }, this.k, bs(ct))); }
    catch { throw new Error(i === 0 ? 'كلمة المرور غير صحيحة أو الملف تالف/معدَّل' : 'الملف تالف أو معدَّل (فشل التحقق من جزء منه)'); }
    if (pt[0] === 0) { const d = pt.subarray(1); this.hash.update(d); this.size += d.length; return d; }
    if (pt[0] !== 1) throw new Error('ملف النسخة تالف (نوع جزء غير معروف)');
    const end = JSON.parse(new TextDecoder().decode(pt.subarray(1))) as { frames: number; plain_size: number; plain_sha256: string };
    if (end.frames !== i || end.plain_size !== this.size || end.plain_sha256 !== hexOf(this.hash.digest())) throw new Error('فشل التحقق من سلامة النسخة (البصمة أو الحجم لا يطابق)');
    this.done = true; return null;
  }
}
