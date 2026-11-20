/**
 * CP09 — one feature switch and one runtime description, valid on BOTH runtimes (Node server and the Android worker).
 *
 * Before CP09 the scientific advisor (CP07 + CP08) was gated by the Node environment variable MH_CP07, which does not exist
 * inside the Android WebView worker — so on the phone the feature could never be switched on. Now:
 *   - source of truth: knowledge_settings.scientific_advisor_enabled ('1' / '0'), stored in the app database (both runtimes,
 *     included in backups), changed ONLY through the manager-only route below (the route enforces the role; hiding a
 *     button is not the protection);
 *   - MH_CP07=1 on the server still force-enables it (backward compatible; then it cannot be switched off from the app);
 *   - default: OFF on both runtimes.
 * The runtime also decides what "online" means and which research sources are technically usable there.
 */
import type { DB } from '../db.ts';

export type Runtime = 'server' | 'device';
let runtime: Runtime = 'server';
let onlineProbe: () => boolean = () => true;
export const setRuntime = (r: Runtime, probe?: () => boolean) => { runtime = r; if (probe) onlineProbe = probe; };
export const getRuntime = () => runtime;
export const envOf = () => (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

export function scientificAdvisor(db: DB): { enabled: boolean; source: 'env' | 'setting' | 'off' } {
  if (runtime === 'server' && envOf().MH_CP07 === '1') return { enabled: true, source: 'env' };
  let v: string | undefined;
  try { v = (db.prepare("SELECT value FROM knowledge_settings WHERE key = 'scientific_advisor_enabled'").get() as { value: string } | undefined)?.value; } catch { /* before migration 008 */ }
  return v === '1' ? { enabled: true, source: 'setting' } : { enabled: false, source: 'off' };
}
export const setScientificAdvisor = (db: DB, on: boolean) => db.prepare("INSERT OR REPLACE INTO knowledge_settings(key, value) VALUES ('scientific_advisor_enabled', ?)").run(on ? '1' : '0');

/** Is the network usable right now? Server: the configured enrichment mode; phone: navigator.onLine (best effort). */
export const isOnline = (cfg: { enrich?: string }) => (runtime === 'device' ? onlineProbe() : cfg.enrich !== 'off');

/**
 * Research sources usable in this runtime. In the Android WebView a request is a browser request: PubMed (E-utilities) sends
 * `Access-Control-Allow-Origin: *` and works; MedlinePlus' web service sends no CORS header, so the WebView blocks it
 * (checked 2026-11-20). Rather than failing silently, it is declared unavailable on the phone.
 */
export const researchSources = (): { id: 'pubmed' | 'medlineplus'; available: boolean; reason_ar?: string }[] => [
  { id: 'pubmed', available: true },
  runtime === 'device' ? { id: 'medlineplus', available: false, reason_ar: 'MedlinePlus غير متاح من داخل التطبيق على الهاتف (المصدر لا يسمح بطلبات المتصفح)؛ يُستخدم PubMed فقط' } : { id: 'medlineplus', available: true },
];

/** The cloud model needs a trusted server that holds the key; the phone never has one (no key in the APK). */
export const cloudUnavailableReason = () => (runtime === 'device' ? 'غير متاح على الهاتف: النموذج السحابي يتطلب خادمًا آمنًا يحفظ المفتاح، ولا يوضع أي مفتاح داخل التطبيق' : null);
