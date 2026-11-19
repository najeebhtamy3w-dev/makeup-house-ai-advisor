// Cloud STAGING support (CP03). Additive only: no change to the advisor, science engine or schema.
// - /api/health and /api/meta (public, no data) for the host's health check and the UI's "test copy" banner.
// - seedStagingAccounts(): an optional limited STAFF test account (credentials from the environment). NO products.
import type { DB } from './db.ts';
import { audit, now } from './db.ts';
import { route } from './http.ts';
import { hashPassword } from './security.ts';

export const APP_VERSION = '3.0.0-cp05.4-staging';
export const STAGING_NOTICE = 'نسخة تجريبية: قد تُحذف كل البيانات عند أي إعادة تشغيل للخادم أو سكونه. استخدمها للتجربة فقط، ولا تعتمد عليها كقاعدة بيانات للمحل.';

route('GET', '/api/health', 'none', () => ({ ok: true }));
// commit: Render injects RENDER_GIT_COMMIT at runtime; shown on staging only so a deploy can be verified from outside.
route('GET', '/api/meta', 'none', (c) => ({ version: APP_VERSION, staging: c.cfg.staging, notice: c.cfg.staging ? STAGING_NOTICE : null, ...(c.cfg.staging ? { commit: (process.env.RENDER_GIT_COMMIT ?? '').slice(0, 7) || null } : {}) }));

/**
 * Staging accounts only. CP05 correction: the application NEVER creates products — not on first run, restart, migration
 * or redeploy, and not on staging. (Up to CP05.3 this function inserted 5 demo products on every staging boot.)
 * The only thing set up here is an OPTIONAL limited STAFF test account whose credentials come from the environment.
 */
export function seedStagingAccounts(db: DB, env: NodeJS.ProcessEnv = process.env): { staff: boolean } {
  const su = (env.MH_STAFF_USER ?? '').trim(), sp = env.MH_STAFF_PASSWORD ?? '';
  if (!su || !sp) return { staff: false };
  if (sp.length < 10) throw new Error('MH_STAFF_PASSWORD قصيرة (10 أحرف على الأقل)');
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(su)) return { staff: false };
  const r = db.prepare("INSERT INTO users(username, display_name, role, password_hash, created_at) VALUES (?, 'موظف تجريبي', 'staff', ?, ?)").run(su, hashPassword(sp), now());
  audit(db, Number(r.lastInsertRowid), 'seed', 'user', Number(r.lastInsertRowid));
  return { staff: true };
}
