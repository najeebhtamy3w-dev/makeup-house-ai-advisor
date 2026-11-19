import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openBeautyFacts } from '../server/src/enrichment/openbeautyfacts.ts';
import { fromConnector, upcItemDb, scriptedProvider, callProvider, PROVIDER_FACTS } from '../server/src/providers.ts';
import { evaluateProvider, type EvalProduct } from '../server/src/provider-eval.ts';
import { gtin13 } from './fixtures/match-cases.ts';
import type { FetchLike } from '../server/src/enrichment/types.ts';

// recorded-shape fixtures (synthetic content, real response SHAPES) — no network in any of these tests
const G1 = gtin13('629104150101'), G2 = gtin13('629104150102'), G3 = gtin13('629104150103');
const fakeFetch = (routes: Record<string, { status: number; body?: unknown }>): FetchLike & { urls: string[] } => {
  const urls: string[] = [];
  const f = (async (u: string) => { urls.push(u); const hit = Object.entries(routes).find(([k]) => u.includes(k)); const r = hit?.[1] ?? { status: 404 }; return { ok: r.status < 400, status: r.status, json: async () => { if (r.body === 'BAD') throw new Error('bad json'); return r.body; } }; }) as FetchLike & { urls: string[] };
  f.urls = urls; return f;
};
const OBF_INFO = { license: 'ODbL / DbCL / CC BY-SA', license_status: 'known' as const, limits: { perMinute: 12, perDay: null, source: 'code', verified: false }, cost_per_request_usd: 0, requires_owner_approval: false };

test('Open Beauty Facts adapter returns the contract shape; a different code in the reply is NOT the product', async () => {
  const f = fakeFetch({
    [`/product/${G1}`]: { status: 200, body: { status: 'success', product: { code: G1, product_name: 'Hydrating Cleanser', brands: 'CeraVe', quantity: '236 ml', ingredients_text: 'Aqua, Glycerin, Ceramide NP, Cholesterol', image_front_url: 'https://images.openbeautyfacts.org/images/products/x/front.jpg' } } },
    [`/product/${G2}`]: { status: 200, body: { status: 'success', product: { code: G3, product_name: 'Other' } } },
  });
  const p = fromConnector(openBeautyFacts({ contact: 't', fetchImpl: f }), OBF_INFO);
  const r = await callProvider(p, { gtin: G1 });
  assert.equal(r.outcome, 'found'); assert.equal(r.candidates[0]!.name, 'Hydrating Cleanser'); assert.equal(r.candidates[0]!.license_status, 'known');
  assert.equal((await callProvider(p, { gtin: G2 })).outcome, 'not_found', 'identity mismatch is never accepted');
  assert.equal((await callProvider(p, { gtin: G3 })).outcome, 'not_found');
});

test('UPCitemdb adapter: disabled-by-policy facts, published reply shape, other-EAN items dropped, 429 classified', async () => {
  const up = PROVIDER_FACTS.find((x) => x.id === 'upcitemdb')!; assert.equal(up.requires_owner_approval, true); assert.equal(up.license_status, 'unknown');
  const f = fakeFetch({ [`upc=${G1}`]: { status: 200, body: { code: 'OK', items: [{ ean: G1, title: 'Hydrating Facial Cleanser', brand: 'CeraVe', size: '8 fl oz', images: ['https://example.com/a.jpg'] }, { ean: G3, title: 'Something else' }] } }, [`upc=${G2}`]: { status: 429 } });
  const p = upcItemDb({ fetchImpl: f });
  const r = await callProvider(p, { gtin: G1 }); assert.equal(r.outcome, 'found'); assert.equal(r.candidates.length, 1); assert.equal(r.candidates[0]!.license_status, 'unknown');
  const rl = await callProvider(p, { gtin: G2 }); assert.equal(rl.outcome, 'rate_limited'); assert.ok(rl.retry_after_s! > 0);
});

test('every failure mode becomes a classified outcome, never a crash; timeouts are enforced', async () => {
  const p = scriptedProvider('fail', (q) => ({ [G1]: { kind: 'timeout' }, [G2]: { kind: 'http_500' }, [G3]: { kind: 'malformed' } } as const)[q.gtin!] ?? { kind: 'rate_limited', retry_after_s: 30 }, { timeoutMs: 50 });
  assert.equal((await callProvider(p, { gtin: G1 }, 60)).outcome, 'unreachable');
  assert.equal((await callProvider(p, { gtin: G2 })).outcome, 'unreachable');
  assert.equal((await callProvider(p, { gtin: G3 })).outcome, 'error');
  const rl = await callProvider(p, { name: 'x' }); assert.equal(rl.outcome, 'rate_limited'); assert.equal(rl.retry_after_s, 30);
  const slow = scriptedProvider('slow', () => ({ kind: 'not_found' }), { latencyMs: 500 });
  const t0 = Date.now(); assert.equal((await callProvider(slow, { name: 'x' }, 80)).outcome, 'unreachable'); assert.ok(Date.now() - t0 < 400, 'caller is never blocked past its timeout');
});

test('feasibility harness: coverage, precision, conflicts, INCI, licence, latency, cost and review time are computed', async () => {
  // 20 synthetic products; the scripted source covers 12, returns 3 different-size items, 3 not found, 2 outages
  const items: EvalProduct[] = Array.from({ length: 20 }, (_, i) => { const g = gtin13(String(629104160000 + i)); return { truth: { name: `Gentle Cleanser ${i}`, brand: 'BrandX', size: '200 ml', codes: [g] }, query: { gtin: g, name: `Gentle Cleanser ${i}`, brand: 'BrandX', size: '200 ml' } }; });
  const src = scriptedProvider('fixture', (q) => {
    const i = items.findIndex((x) => x.query.gtin === q.gtin);
    if (i < 12) return { kind: 'found', candidates: [{ gtin: q.gtin, name: `Gentle Cleanser ${i}`, brand: 'BrandX', size: '200 ml', variant: '', manufacturer: '', ingredients: i % 2 ? 'Aqua, Glycerin, Ceramide NP' : '', license: 'x', license_status: i % 3 ? 'known' : 'unknown' }] };
    if (i < 15) return { kind: 'found', candidates: [{ gtin: q.gtin, name: `Gentle Cleanser ${i}`, brand: 'BrandX', size: '400 ml', variant: '', manufacturer: '', ingredients: '', license: '', license_status: 'unknown' }] };
    if (i < 18) return { kind: 'not_found' };
    return { kind: 'http_500' };
  });
  const m = await evaluateProvider(src, items);
  assert.equal(m.coverage, 15 / 20); assert.equal(m.auto_identified, 12); assert.equal(m.wrong_auto_identified, 0, 'different-size items are never auto-identified');
  assert.equal(m.ambiguous_for_review, 3); assert.equal(m.conflicts_caught, 3); assert.equal(m.identity_precision, 1); assert.equal(m.unreachable, 2);
  assert.equal(m.cost_usd, 0); assert.ok(m.est_review_minutes > 0); assert.ok(m.latency_ms.p95 >= m.latency_ms.p50);
  console.log('   harness metrics (synthetic fixtures — NOT real coverage):', JSON.stringify(m));
});
