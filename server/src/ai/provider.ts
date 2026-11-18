/**
 * AI Provider abstraction (design + guard). NO provider is configured or enabled: the platform runs retrieval-only.
 * Any future provider may ONLY rephrase the structured advisor result; `guardGrounding` rejects text that mentions
 * catalog products outside the retrieved set, prices, or therapeutic promises. Never auto-enabled; needs the owner's approval + key.
 */
export interface AdvisorContext { query: string; products: { id: number; name: string; brand: string }[]; notes: string[] }
export interface AiProvider { id: string; compose(ctx: AdvisorContext): Promise<string> }
export const noProvider: AiProvider = { id: 'none', async compose() { throw new Error('no_provider'); } };

const PRICE = /(\d+\s*(ريال|درهم|دولار|\$|usd|sar|yer|aed))|(\$\s*\d+)|(سعر|خصم|تخفيض)/i;
const THERAPEUTIC = /(يعالج|علاج نهائي|يشفي|شفاء|يزيل الاكزيما|يختفي المرض)/;
export function guardGrounding(text: string, allowed: { name: string }[], catalogNames: string[]): { ok: boolean; reason?: string } {
  const allow = new Set(allowed.map((a) => a.name));
  const stray = catalogNames.find((n) => n.length >= 4 && !allow.has(n) && text.includes(n));
  if (stray) return { ok: false, reason: 'ذكر منتجًا غير مسترجع: ' + stray };
  if (PRICE.test(text)) return { ok: false, reason: 'يتضمن سعرًا/خصمًا' };
  if (THERAPEUTIC.test(text)) return { ok: false, reason: 'وعد علاجي' };
  return { ok: true };
}
export async function composeGrounded(p: AiProvider, ctx: AdvisorContext, catalogNames: string[]): Promise<{ text: string | null; provider: string; rejected?: string }> {
  try {
    const text = await p.compose(ctx); const g = guardGrounding(text, ctx.products, catalogNames);
    return g.ok ? { text, provider: p.id } : { text: null, provider: p.id, rejected: g.reason };
  } catch { return { text: null, provider: p.id, rejected: 'provider_unavailable' }; }
}
