/**
 * CP06.2 Phase 4 — provider feasibility harness. Runs a provider over products whose TRUE identity is known and measures
 * what the owner asked for: coverage, identity precision (via the Phase 3 matching engine), size/variant conflicts caught,
 * INCI completeness, licence clarity, latency, request cost and an ESTIMATED human review time.
 * It works on recorded fixtures / synthetic products, so it never sends real shop data anywhere. Real coverage of the
 * shop's catalogue can only be measured by the owner-approved pilot (blocked until approval).
 */
import { callProvider, type ProductProvider } from './providers.ts';
import { decideMatch, type Side } from './matching.ts';

export interface EvalProduct { truth: Side & { gtin?: string }; query: { gtin?: string; name?: string; brand?: string; size?: string } }
/** seconds a reviewer needs per outcome — ASSUMPTIONS for planning, to be replaced by measured times from the pilot */
export const REVIEW_SECONDS = { exact_gtin: 15, strong: 20, ambiguous: 45, none: 0, source_unavailable: 0, manual_entry: 90 } as const;

export async function evaluateProvider(p: ProductProvider, items: EvalProduct[], opts: { timeoutMs?: number } = {}) {
  const lat: number[] = []; let found = 0, correctAuto = 0, wrongAuto = 0, ambiguous = 0, conflictsCaught = 0, inciComplete = 0, licenseKnown = 0, unreachable = 0, rateLimited = 0, reviewS = 0;
  for (const it of items) {
    const r = await callProvider(p, it.query, opts.timeoutMs ?? 2000); lat.push(r.latency_ms);
    if (r.outcome === 'unreachable' || r.outcome === 'error') { unreachable++; reviewS += REVIEW_SECONDS.manual_entry; continue; }
    if (r.outcome === 'rate_limited') { rateLimited++; continue; }
    if (r.outcome !== 'found' || !r.candidates.length) { reviewS += REVIEW_SECONDS.manual_entry; continue; }
    found++;
    // best candidate by the matching engine against the store query (what the reviewer would be shown first)
    const store: Side = { name: it.query.name ?? it.truth.name, brand: it.query.brand ?? it.truth.brand, size: it.query.size ?? it.truth.size, codes: it.query.gtin ? [it.query.gtin] : [] };
    const order = { exact_gtin: 0, strong: 1, ambiguous: 2, none: 3, source_unavailable: 4 } as const;
    const best = r.candidates.map((c) => ({ c, d: decideMatch(store, { name: c.name, brand: c.brand, size: c.size, variant: c.variant, codes: c.gtin ? [c.gtin] : [] }) })).sort((a, b) => order[a.d.class] - order[b.d.class])[0]!;
    // ground truth: is the best candidate the same sellable item as the truth record?
    const truthDecision = decideMatch(it.truth, { name: best.c.name, brand: best.c.brand, size: best.c.size, variant: best.c.variant, codes: best.c.gtin ? [best.c.gtin] : [] });
    const reallySame = truthDecision.class === 'exact_gtin' || truthDecision.class === 'strong';
    if (best.d.class === 'exact_gtin' || best.d.class === 'strong') { if (reallySame) correctAuto++; else wrongAuto++; }
    else if (best.d.class === 'ambiguous') { ambiguous++; if (best.d.conflicts.length) conflictsCaught++; }
    reviewS += REVIEW_SECONDS[best.d.class];
    if (best.c.ingredients && best.c.ingredients.split(',').length >= 3) inciComplete++;
    if (best.c.license_status === 'known') licenseKnown++;
  }
  lat.sort((a, b) => a - b); const pct = (q: number) => lat.length ? lat[Math.min(lat.length - 1, Math.floor(q * lat.length))]! : 0;
  const n = items.length;
  return {
    provider: p.id, requests: n, coverage: found / n, auto_identified: correctAuto, wrong_auto_identified: wrongAuto, ambiguous_for_review: ambiguous, conflicts_caught: conflictsCaught,
    identity_precision: correctAuto + wrongAuto ? correctAuto / (correctAuto + wrongAuto) : null, inci_complete_share: found ? inciComplete / found : 0,
    license_known_share: found ? licenseKnown / found : 0, unreachable, rate_limited: rateLimited, latency_ms: { p50: pct(0.5), p95: pct(0.95) },
    cost_usd: n * p.cost_per_request_usd, est_review_minutes: Math.round(reviewS / 60), requires_owner_approval: p.requires_owner_approval,
  };
}
