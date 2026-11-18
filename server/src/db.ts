import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type DB = DatabaseSync;

const here = dirname(fileURLToPath(import.meta.url));

export function openDb(path: string): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  migrate(db);
  return db;
}

export function migrate(db: DB): string[] {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const dir = join(here, '..', 'migrations');
  const applied = new Set((db.prepare('SELECT name FROM schema_migrations').all() as { name: string }[]).map((r) => r.name));
  const ran: string[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    if (applied.has(f)) continue;
    db.exec('BEGIN');
    try {
      db.exec(readFileSync(join(dir, f), 'utf8'));
      db.prepare('INSERT INTO schema_migrations(name, applied_at) VALUES (?, ?)').run(f, new Date().toISOString());
      db.exec('COMMIT');
      ran.push(f);
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  return ran;
}

export const now = () => new Date().toISOString();

export function audit(db: DB, userId: number | null, action: string, entity: string, entityId: string | number, detail = '') {
  db.prepare('INSERT INTO audit_log(user_id, action, entity, entity_id, detail, at) VALUES (?,?,?,?,?,?)')
    .run(userId, action, entity, String(entityId), detail, now());
}
