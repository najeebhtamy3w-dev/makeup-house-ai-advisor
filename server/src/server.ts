import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { loadConfig, type Config } from './config.ts';
import { audit, now, openDb, type DB } from './db.ts';
import { makeHandler } from './http.ts';
import { hashPassword } from './security.ts';
import './routes.ts';
import { seedStagingAccounts } from './staging.ts';
import './images.ts';
import { processOne } from './queue.ts';
import { activeProviders } from './evidence-routes.ts';
import './discovery.ts';
import { configureConnectors, processQueueOnce } from './enrichment/engine.ts';

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8', '.csv': 'text/csv; charset=utf-8', '.png': 'image/png' };

export function seedAdmin(db: DB, user?: string, pass?: string) {
  const n = (db.prepare('SELECT COUNT(*) n FROM users').get() as { n: number }).n;
  if (n > 0) return false;
  if (!user || !pass) throw new Error('لا يوجد مستخدمون. عيّن MH_ADMIN_USER و MH_ADMIN_PASSWORD (10 أحرف على الأقل) لإنشاء أول مدير.');
  if (pass.length < 10) throw new Error('كلمة مرور المدير قصيرة (10 أحرف على الأقل)');
  const r = db.prepare("INSERT INTO users(username, display_name, role, password_hash, created_at) VALUES (?,?, 'manager', ?, ?)").run(user, 'المدير', hashPassword(pass), now());
  audit(db, Number(r.lastInsertRowid), 'seed', 'user', Number(r.lastInsertRowid));
  return true;
}

/** Everything the server does to a database at startup: accounts only. It never creates products (CP05 correction). */
export function bootstrap(db: DB, cfg: Config, env: NodeJS.ProcessEnv = process.env) {
  seedAdmin(db, env.MH_ADMIN_USER, env.MH_ADMIN_PASSWORD);
  if (cfg.staging) { const s = seedStagingAccounts(db, env); console.log(`[staging] staff test account created: ${s.staff}; products are never seeded`); }
}

export function buildServer(db: DB, cfg: Config) {
  const api = makeHandler(db, cfg);
  const root = resolve(cfg.webDir);
  return createServer(async (req, res) => {
    if (await api(req, res)) return;
    let dec: string; try { dec = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname); } catch { res.writeHead(400).end(); return; }
    const p = normalize(dec).replace(/^(\.\.[/\\])+/, '');
    const file = resolve(join(root, p === '/' || p === '.' ? 'index.html' : p));
    if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    try {
      const data = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'x-content-type-options': 'nosniff', 'x-robots-tag': 'noindex, nofollow', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; media-src 'self'; frame-ancestors 'none'", 'cache-control': extname(file) === '.html' ? 'no-cache' : 'public, max-age=300' }).end(data);
    } catch { res.writeHead(404, { 'x-robots-tag': 'noindex, nofollow' }).end('Not found'); }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cfg = loadConfig();
  const db = openDb(cfg.dbPath);
  bootstrap(db, cfg);
  configureConnectors(cfg);
  if (cfg.enrich !== 'off') setInterval(() => { processQueueOnce(db, cfg, 1).catch((e) => console.error('[queue]', (e as Error).message)); }, 6000).unref();
  // CP06.2 v2 queue: one job per tick, provider limits/budgets/cache inside; a sleeping free Render service simply resumes later
  if (cfg.enrich !== 'off') setInterval(() => { processOne(db, activeProviders()).catch((e) => console.error('[queue2]', (e as Error).message)); }, 5000).unref();
  buildServer(db, cfg).listen(cfg.port, () => console.log(`MAKEUP HOUSE listening on :${cfg.port}`));
}
