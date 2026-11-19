// node:crypto subset used by server/src/security.ts and config.ts, implemented with audited pure-JS primitives (@noble/hashes)
// and WebCrypto randomness. scrypt parameters equal Node's scryptSync defaults (N=16384, r=8, p=1) so password hashes are
// byte-compatible between the server and the phone (a backup restored on another device keeps working logins).
import { Buffer } from 'buffer';
import { scrypt } from '@noble/hashes/scrypt.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';

const bytes = (v: string | Uint8Array) => (typeof v === 'string' ? new TextEncoder().encode(v) : v);
export function randomBytes(n: number): Buffer { const b = new Uint8Array(n); crypto.getRandomValues(b); return Buffer.from(b); }
export function scryptSync(password: string | Uint8Array, salt: Uint8Array, keylen: number): Buffer {
  return Buffer.from(scrypt(bytes(password), salt, { N: 16384, r: 8, p: 1, dkLen: keylen }));
}
export function createHmac(alg: string, key: string | Uint8Array) {
  if (alg !== 'sha256') throw new Error('only sha256 is supported');
  const parts: Uint8Array[] = [];
  const api = {
    update(d: string | Uint8Array) { parts.push(bytes(d)); return api; },
    digest(enc?: 'base64url' | 'hex') {
      const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { all.set(p, o); o += p.length; }
      const out = Buffer.from(hmac(sha256, bytes(key), all));
      return (enc ? out.toString(enc) : out) as never;
    },
  };
  return api;
}
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) throw new RangeError('Input buffers must have the same byte length');
  let d = 0; for (let i = 0; i < a.length; i++) d |= a[i]! ^ b[i]!; return d === 0;
}
export default { randomBytes, scryptSync, createHmac, timingSafeEqual };
