import { randomBytes } from 'node:crypto';

export interface Config {
  port: number;
  dbPath: string;
  secret: string;
  tokenTtlSec: number;
  availabilityStaleHours: number;
  webDir: string;
  enrich: 'off' | 'mock' | 'obf';
  enrichBaseUrl: string;
  enrichContact: string;
  enrichRatePerMin: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const prod = env.NODE_ENV === 'production';
  if (prod && !env.MH_SECRET) throw new Error('MH_SECRET is required in production');
  return {
    port: Number(env.PORT ?? 8080),
    dbPath: env.MH_DB_PATH ?? './data/makeup-house.db',
    // dev/test: random per process (tokens die on restart) — never hardcode a secret.
    secret: env.MH_SECRET ?? randomBytes(32).toString('hex'),
    tokenTtlSec: Number(env.MH_TOKEN_TTL_SEC ?? 60 * 60 * 12),
    availabilityStaleHours: Number(env.MH_AVAILABILITY_STALE_HOURS ?? 24),
    webDir: env.MH_WEB_DIR ?? './web',
    enrich: (['mock', 'obf'].includes(env.MH_ENRICH ?? '') ? env.MH_ENRICH : 'off') as 'off' | 'mock' | 'obf',
    enrichBaseUrl: env.MH_OBF_BASE ?? 'https://world.openbeautyfacts.org',
    enrichContact: env.MH_ENRICH_CONTACT ?? 'contact-not-set',
    enrichRatePerMin: Math.min(Number(env.MH_ENRICH_RATE_PER_MIN ?? 12) || 12, 14), // OBF documents 15 product reads/min/IP
  };
}
