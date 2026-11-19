// Node's Buffer for the on-device worker (the shared server code uses Buffer for request bodies, tokens and XLSX parsing).
// The `buffer` package lacks Node's 'base64url' encoding (used by server/src/security.ts for tokens): added here with the
// exact Node semantics (URL-safe alphabet, no padding), so tokens are identical on the server and the phone.
import { Buffer } from 'buffer';
const B = Buffer as unknown as { prototype: { toString: (enc?: string, s?: number, e?: number) => string }; from: (...a: unknown[]) => Buffer };
const toStr = B.prototype.toString;
B.prototype.toString = function (this: Buffer, enc?: string, s?: number, e?: number) {
  if (enc === 'base64url') return toStr.call(this, 'base64', s, e).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return toStr.call(this, enc, s, e);
};
const from = B.from.bind(Buffer);
B.from = (v: unknown, enc?: unknown, len?: unknown) => {
  if (typeof v === 'string' && enc === 'base64url') { const b = v.replace(/-/g, '+').replace(/_/g, '/'); return from(b + '='.repeat((4 - (b.length % 4)) % 4), 'base64'); }
  return from(v, enc, len);
};
(globalThis as unknown as { Buffer: typeof Buffer }).Buffer ??= Buffer;
