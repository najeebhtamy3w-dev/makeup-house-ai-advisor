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
