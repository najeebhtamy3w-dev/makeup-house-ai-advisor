import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Config } from './config.ts';
import type { DB } from './db.ts';
import { verifyToken } from './security.ts';
import { ZodError } from 'zod';

export interface User { id: number; username: string; display_name: string; role: 'manager' | 'staff' }
export interface Ctx { db: DB; cfg: Config; params: Record<string, string>; query: URLSearchParams; user: User | null; body: () => Promise<unknown>; raw: () => Promise<Buffer> }

export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
/** Non-JSON response (e.g. image bytes). Return it from a handler. */
export class RawResponse { constructor(public status: number, public headers: Record<string, string>, public body: Uint8Array) {} }

export type Handler = (c: Ctx) => unknown | Promise<unknown>;
interface Route { method: string; re: RegExp; keys: string[]; handler: Handler; auth: 'none' | 'any' | 'manager' }
const routes: Route[] = [];

export function route(method: string, path: string, auth: Route['auth'], handler: Handler) {
  const keys: string[] = [];
  const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler, auth });
}

const MAX_BODY = 8 * 1024 * 1024;

function readRaw(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []; let n = 0;
    req.on('data', (d: Buffer) => { n += d.length; if (n > MAX_BODY) { reject(new HttpError(413, 'الحجم كبير جدًا')); req.destroy(); } else chunks.push(d); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export function requireRole(c: Ctx, role: 'manager' | 'any'): User {
  if (!c.user) throw new HttpError(401, 'يلزم تسجيل الدخول');
  if (role === 'manager' && c.user.role !== 'manager') throw new HttpError(403, 'هذه العملية للمدير فقط');
  return c.user;
}

/** Transport-neutral request (CP06): the Node server and the on-device worker (Android) feed the SAME routes through this. */
export interface ApiRequest { method: string; url: string; authorization?: string; raw: () => Promise<Buffer> }
export interface ApiResponse { status: number; headers: Record<string, string>; body: Uint8Array | string }
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-robots-tag': 'noindex, nofollow' };

export async function dispatch(db: DB, cfg: Config, req: ApiRequest): Promise<ApiResponse> {
  const url = new URL(req.url, 'http://x');
  const send = (status: number, payload: unknown): ApiResponse => ({ status, headers: { ...JSON_HEADERS }, body: JSON.stringify(payload) });
  try {
    const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
    if (!r) throw new HttpError(404, 'غير موجود');
    const m = r.re.exec(url.pathname)!;
    const params: Record<string, string> = {};
    r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1]!)));
    let user: User | null = null;
    const tok = /^Bearer (.+)$/.exec(String(req.authorization ?? ''))?.[1];
    if (tok) {
      const p = verifyToken(tok, cfg.secret);
      if (p) {
        // Re-read from DB each request: role changes / deactivation take effect immediately (server-side authz).
        const u = db.prepare('SELECT id, username, display_name, role, active FROM users WHERE id = ?').get(p.uid) as (User & { active: number }) | undefined;
        if (u && u.active) user = { id: u.id, username: u.username, display_name: u.display_name, role: u.role };
      }
    }
    if (r.auth !== 'none') requireRole({ user } as Ctx, r.auth === 'manager' ? 'manager' : 'any');
    let rawCache: Promise<Buffer> | null = null;
    const raw = () => (rawCache ??= req.raw());
    const body = async () => { const b = await raw(); if (!b.length) return {}; try { return JSON.parse(b.toString('utf8')); } catch { throw new HttpError(400, 'JSON غير صالح'); } };
    const out = await r.handler({ db, cfg, params, query: url.searchParams, user, body, raw });
    if (out instanceof RawResponse) return { status: out.status, headers: { ...out.headers, 'x-robots-tag': 'noindex, nofollow' }, body: out.body };
    return send(200, out ?? { ok: true });
  } catch (e) {
    if (e instanceof HttpError) { const x = e as HttpError & { existingId?: number; stale?: boolean; currentVersion?: number };
      return send(e.status, { error: e.message, ...(x.existingId ? { existingId: x.existingId } : {}), ...(x.stale ? { stale: true, currentVersion: x.currentVersion } : {}) }); }
    if (e instanceof ZodError) return send(400, { error: 'بيانات غير صالحة', fields: e.issues.map((i) => i.path.join('.')) });
    console.error('[internal]', (e as Error).message); return send(500, { error: 'خطأ داخلي' });
  }
}

export function makeHandler(db: DB, cfg: Config) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (!url.pathname.startsWith('/api/')) return false;
    const out = await dispatch(db, cfg, { method: req.method ?? 'GET', url: req.url ?? '/', authorization: req.headers.authorization, raw: () => readRaw(req) });
    const body = typeof out.body === 'string' ? out.body : Buffer.from(out.body.buffer, out.body.byteOffset, out.body.byteLength);
    res.writeHead(out.status, typeof out.body === 'string' ? out.headers : { ...out.headers, 'content-length': String(body.length) }).end(body);
    return true;
  };
}
