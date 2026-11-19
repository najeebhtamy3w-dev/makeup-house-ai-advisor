// Dev-only demo data (clearly fake brands). Usage: MH_DB_PATH=... tsx scripts/dev-seed.ts
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { loadConfig } from '../server/src/config.ts';
import { openDb, now } from '../server/src/db.ts';
import { hashPassword } from '../server/src/security.ts';
const cfg = loadConfig();
// Test data must stay in a throw-away database: refuse production / staging / any database outside the temp directory.
const tmp = resolve(process.env.TMPDIR || tmpdir()); const target = resolve(cfg.dbPath);
if (process.env.NODE_ENV === 'production' || cfg.staging || !(target.startsWith(tmp + '/') || cfg.dbPath === ':memory:')) {
  console.error(`dev-seed refused: only for a temporary test database under ${tmp} (got ${cfg.dbPath}).`); process.exit(2);
}
const db = openDb(cfg.dbPath); const t = now();
if ((db.prepare('SELECT COUNT(*) n FROM users').get() as { n: number }).n === 0) {
  db.prepare("INSERT INTO users(username,display_name,role,password_hash,created_at) VALUES ('admin','المدير','manager',?,?)").run(hashPassword('admin-password-1'), t);
  db.prepare("INSERT INTO users(username,display_name,role,password_hash,created_at) VALUES ('sara','سارة','staff',?,?)").run(hashPassword('staff-password-1'), t);
}
const ins = db.prepare('INSERT OR IGNORE INTO products(barcode,name,brand,category,size,availability,availability_updated_at,availability_updated_by,verification,ingredients,benefits,warnings,source_url,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)');
ins.run('6291041500213', 'مرطب وجه خالٍ من العطر (تجريبي)', 'DemoBrand', 'العناية بالبشرة', '50 مل', 'yes', t, 1, 'verified', 'Aqua, Glycerin, Ceramide NP', 'ترطيب يومي للبشرة الجافة', 'للاستخدام الخارجي فقط', 'https://example.com/demo', t, t);
ins.run('6291041500381', 'واقي شمس خفيف (تجريبي)', 'DemoSun', 'واقيات الشمس', '50 مل', 'unknown', null, null, 'review', '', '', '', '', t, t);
ins.run(null, 'شامبو لطيف (تجريبي)', 'DemoHair', 'العناية بالشعر', '250 مل', 'yes', t, 1, 'partial', '', '', '', '', t, t);
console.log('seeded');
