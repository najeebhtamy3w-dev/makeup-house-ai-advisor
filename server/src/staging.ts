// Cloud STAGING support (CP03). Additive only: no change to the advisor, science engine or schema.
// - /api/health and /api/meta (public, no data) for the host's health check and the UI's "test copy" banner.
// - seedStaging(): FAKE demo products + an optional limited STAFF test account whose password comes from the
//   environment (never from the repository). Runs only when MH_STAGING=1 and is idempotent.
import type { DB } from './db.ts';
import { audit, now } from './db.ts';
import { route } from './http.ts';
import { hashPassword } from './security.ts';

export const APP_VERSION = '3.0.0-cp03-staging';
export const STAGING_NOTICE = 'نسخة تجريبية: كل البيانات وهمية وقد تُحذف عند أي إعادة تشغيل للخادم. لا تُدخل بيانات حقيقية لعملاء أو موظفين، ولا تعتمد عليها كقاعدة بيانات للمحل.';

route('GET', '/api/health', 'none', () => ({ ok: true }));
route('GET', '/api/meta', 'none', (c) => ({ version: APP_VERSION, staging: c.cfg.staging, notice: c.cfg.staging ? STAGING_NOTICE : null }));

/** Clearly fake demo catalogue. Barcodes use the GS1 "restricted/internal" prefix 200-299 so they can never be a real product. */
const DEMO: Array<[string | null, string, string, string, string, 'yes' | 'no' | 'unknown', 'verified' | 'partial' | 'review', string, string, string]> = [
  ['2000000000015', 'مرطب وجه خالٍ من العطر (تجريبي)', 'DemoBrand', 'العناية بالبشرة', '50 مل', 'yes', 'verified', 'Aqua, Glycerin, Ceramide NP', 'ترطيب يومي للبشرة الجافة', 'للاستخدام الخارجي فقط'],
  ['2000000000022', 'واقي شمس خفيف (تجريبي)', 'DemoSun', 'واقيات الشمس', '50 مل', 'unknown', 'review', '', '', ''],
  ['2000000000039', 'غسول وجه لطيف (تجريبي)', 'DemoBrand', 'العناية بالبشرة', '150 مل', 'no', 'partial', 'Aqua, Sodium Laureth Sulfate, Glycerin, Parfum', 'تنظيف يومي', 'يتجنب ملامسة العينين'],
  ['2000000000046', 'كريم يدين معطر (تجريبي)', 'DemoCare', 'العطور والعناية', '75 مل', 'yes', 'partial', 'Aqua, Glycerin, Parfum, Linalool', 'ترطيب اليدين', ''],
  [null, 'شامبو لطيف (تجريبي)', 'DemoHair', 'العناية بالشعر', '250 مل', 'yes', 'partial', '', '', ''],
];

export function seedStaging(db: DB, env: NodeJS.ProcessEnv = process.env): { products: number; staff: boolean } {
  const t = now();
  const mgr = db.prepare("SELECT id FROM users WHERE role = 'manager' ORDER BY id LIMIT 1").get() as { id: number } | undefined;
  const by = mgr?.id ?? null;
  let staff = false;
  const su = (env.MH_STAFF_USER ?? '').trim(), sp = env.MH_STAFF_PASSWORD ?? '';
  if (su && sp) {
    if (sp.length < 10) throw new Error('MH_STAFF_PASSWORD قصيرة (10 أحرف على الأقل)');
    const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(su);
    if (!exists) {
      const r = db.prepare("INSERT INTO users(username, display_name, role, password_hash, created_at) VALUES (?, 'موظف تجريبي', 'staff', ?, ?)").run(su, hashPassword(sp), t);
      audit(db, Number(r.lastInsertRowid), 'seed', 'user', Number(r.lastInsertRowid)); staff = true;
    }
  }
  const n = (db.prepare('SELECT COUNT(*) n FROM products').get() as { n: number }).n;
  if (n > 0) return { products: 0, staff };
  const ins = db.prepare('INSERT INTO products(barcode,name,brand,category,size,availability,availability_updated_at,availability_updated_by,verification,ingredients,benefits,warnings,source_url,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  for (const [bc, name, brand, cat, size, av, ver, ingr, ben, warn] of DEMO) ins.run(bc, name, brand, cat, size, av, av === 'unknown' ? null : t, av === 'unknown' ? null : by, ver, ingr, ben, warn, ver === 'verified' ? 'https://example.invalid/demo-source' : '', by, t, t);
  return { products: DEMO.length, staff };
}
