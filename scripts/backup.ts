// Consistent online backup (SQLite VACUUM INTO) + restore verification.  Usage: tsx scripts/backup.ts <db> <outfile>
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
const [src, out] = process.argv.slice(2);
if (!src || !out) { console.error('usage: backup.ts <db> <outfile>'); process.exit(2); }
if (existsSync(out)) { console.error('refusing to overwrite', out); process.exit(2); }
const db = new DatabaseSync(src); db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`); db.close();
const chk = new DatabaseSync(out); const ok = (chk.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check;
const n = (chk.prepare('SELECT COUNT(*) n FROM products').get() as { n: number }).n; chk.close();
console.log(`backup ok=${ok} products=${n} -> ${out}`); process.exit(ok === 'ok' ? 0 : 1);
