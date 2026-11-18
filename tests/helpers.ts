import type { AddressInfo } from 'node:net';
import { loadConfig } from '../server/src/config.ts';
import { openDb } from '../server/src/db.ts';
import { buildServer, seedAdmin } from '../server/src/server.ts';
import { resetThrottle } from '../server/src/routes.ts';

export async function boot(env: Record<string, string> = {}) {
  resetThrottle();
  const cfg = loadConfig({ MH_SECRET: 'test-secret', MH_DB_PATH: ':memory:', MH_WEB_DIR: './web', ...env } as NodeJS.ProcessEnv);
  const db = openDb(':memory:');
  seedAdmin(db, 'admin', 'admin-password-1');
  const server = buildServer(db, cfg);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  async function call(method: string, path: string, opt: { token?: string; body?: unknown; raw?: Buffer } = {}) {
    const headers: Record<string, string> = {};
    if (opt.token) headers.authorization = `Bearer ${opt.token}`;
    let body: BodyInit | undefined;
    if (opt.raw) body = new Uint8Array(opt.raw); else if (opt.body !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(opt.body); }
    const res = await fetch(base + path, { method, headers, body });
    const text = await res.text();
    let json: any = null; try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, json, text, headers: res.headers };
  }
  const login = async (username: string, password: string) => (await call('POST', '/api/auth/login', { body: { username, password } })).json?.token as string;
  const manager = await login('admin', 'admin-password-1');
  await call('POST', '/api/users', { token: manager, body: { username: 'sara', display_name: 'سارة', role: 'staff', password: 'staff-password-1' } });
  const staff = await login('sara', 'staff-password-1');
  return { db, cfg, call, manager, staff, login, close: () => new Promise<void>((r) => { server.close(() => r()); (server as any).closeAllConnections?.(); db.close(); }) };
}
export const EAN = '6291041500213';
export const EAN2 = '6291041500381';
