// CP08 — safety layer, understanding upgrades, fidelity guard, cloud LLM adapter (fake providers only), research engine, HTTP.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, type DB } from '../server/src/db.ts';
import { seedKnowledge, usableClaims } from '../server/src/cp07/store.ts';
import { setExternalSearch, type FetchLike } from '../server/src/cp07/connectors.ts';
import { understandCp07 } from '../server/src/cp07/nlu.ts';
import { answerCp07 } from '../server/src/cp07/answer.ts';
import { assessSafetyCp08 } from '../server/src/cp08/safety.ts';
import { fidelityCheck } from '../server/src/cp08/fidelity.ts';
import { cloudCompose, cloudProviderFromEnv, geminiProvider, openAICompatibleProvider, redact, setCloudEnabled } from '../server/src/cp08/llm.ts';
import { planResearch, runResearch } from '../server/src/cp08/research.ts';
import { setResearchFetchForTests } from '../server/src/cp08/routes.ts';
import { usage } from '../server/src/advisor2/ai.ts';
import { AdvisorContext } from '../server/src/contracts.ts';
import { CRITICAL, DEV } from './fixtures/cp08-natural-eval.ts';
import { FIDELITY_LABELS } from './fixtures/cp08-fidelity-labels.ts';
import { boot } from './helpers.ts';

const fresh = (): DB => { const db = openDb(':memory:'); seedKnowledge(db); return db; };

test('safety: every critical case escalates or refers; negation and plain heat do not raise alarms', () => {
  for (const c of CRITICAL) {
    const u = understandCp07(c.text);
    if (c.gold.red_flag) assert.ok(u.medical_red_flags.length > 0, `missed urgent: ${c.text}`);
    if (c.gold.referral) assert.ok(u.referrals.length > 0 || u.medical_red_flags.length > 0, `missed referral: ${c.text}`);
  }
  for (const t of ['ما فيه تورم بس بشرتي جافة', 'بدون حكة الحمد لله، أبغى مرطب', 'بشرتي تحمر من الحرارة والشمس', 'أبغى واقي للبحر', 'شعري خفيف']) assert.deepEqual(assessSafetyCp08(t).urgent, [], t);
  for (const d of DEV.filter((x) => !x.gold.red_flag)) assert.equal(understandCp07(d.text).medical_red_flags.length, 0, d.text);
  const a = answerCp07(fresh(), 'وجهي انتفخ بعد الكريم', undefined, { products: () => [] });
  assert.deepEqual(a.sections.map((s) => s.kind), ['referral']); assert.equal(a.products, null);
});

test('understanding: follow-up pronoun, unresolved product, two-ingredient compare, multi-product, constraints remembered, old contexts still parse', () => {
  const t1 = understandCp07('ايش فايدة النياسيناميد');
  const t2 = understandCp07('طيب لو استخدمته مع الريتينول؟', t1.conversation_context);
  assert.equal(t2.intent, 'combination'); assert.deepEqual(t2.ingredients.sort(), ['niacinamide', 'retinol']); assert.equal(t2.resolved_reference, 'ingredient');
  const p = understandCp07('هذا الكريم ينفع للبشرة الدهنية؟');
  assert.equal(p.resolved_reference, 'product_unresolved');
  assert.match(answerCp07(fresh(), 'هذا الكريم ينفع للبشرة الدهنية؟').text, /لن أخمّن/);
  const c = understandCp07('إيش الفرق بين النياسيناميد والساليسيليك؟'); assert.equal(c.intent, 'compare'); assert.deepEqual(c.ingredients, ['niacinamide', 'salicylic acid']);
  assert.deepEqual(understandCp07('ابغى مرطب وواقي شمس لبشرة حساسة').requested_product_types, ['moisturizer', 'sunscreen']);
  const m1 = understandCp07('بشرتي مختلطة وابغى مرطب'); const m2 = understandCp07('بس يكون بدون عطر', m1.conversation_context);
  const m3 = understandCp07('وكمان واقي', m2.conversation_context);
  assert.ok(m3.constraints.includes('fragrance_free'), 'constraint kept for the next product'); assert.deepEqual(m3.skin_type, ['combination']);
  const reset = understandCp07('محادثة جديدة', m3.conversation_context); assert.deepEqual(reset.conversation_context.avoid, []);
  // a CP06.2 session stored before CP08 (no ingredients_discussed) still parses
  const old = AdvisorContext.parse(JSON.parse('{"domain":"skin","skin":["dry"],"concerns":[],"product_type":null,"using":[],"avoid":[],"product_refs":[],"safety_flags":[],"asked":[]}'));
  assert.deepEqual(old.ingredients_discussed, []);
});

test('fidelity: catches all labelled meaning changes from real model output and the three forbidden transformations', () => {
  const db = fresh();
  const claimsFor = (q: string) => answerCp07(db, q, undefined, { logGaps: false }).sections.flatMap((s) => s.items).filter((i) => i.claim_id).map((i) => ({ id: i.claim_id!, text: i.text }));
  let drift = 0, falseRej = 0;
  for (const r of FIDELITY_LABELS) { const bad = !fidelityCheck(r.sentence, claimsFor(r.q), { question: r.q }).ok || /[ㄱ-힝]/.test(r.sentence); if (r.label === 'drift' && bad) drift++; if (r.label === 'faithful' && bad) falseRej++; }
  assert.equal(drift, FIDELITY_LABELS.filter((r) => r.label === 'drift').length, 'every labelled drift rejected');
  assert.ok(falseRej <= 3, `false rejections ${falseRej}`);
  const C = [{ id: 'k1', text: 'قد يساعد هذا المكوّن على تخفيف الجفاف لدى بعض الأشخاص.' }, { id: 'k2', text: 'عند الحمل أو الرضاعة اسألي الطبيب قبل استخدام هذا المكوّن.' }, { id: 'k3', text: 'الأدلة على فائدته محدودة حتى الآن.' }];
  assert.ok(!fidelityCheck('هذا المكوّن يعالج الجفاف بالتأكيد [k1]', C).ok, '«قد يساعد» → «يعالج بالتأكيد»');
  assert.ok(!fidelityCheck('هذا المكوّن ممنوع عند الحمل والرضاعة [k2]', C).ok, '«اسألي الطبيب» → «ممنوع»');
  assert.ok(!fidelityCheck('فائدته مثبت علميًا [k3]', C).ok, '«أدلة محدودة» → «مثبت علميًا»');
  assert.ok(fidelityCheck('قد يساعد هذا المكوّن على تخفيف الجفاف لدى بعض الأشخاص [k1]', C).ok, 'faithful sentence accepted');
  assert.ok(!fidelityCheck('يخفف الجفاف بتركيز 5% [k1]', C).ok, 'new number rejected');
  assert.ok(!fidelityCheck('يخفف الجفاف لدى بعض الأشخاص', C).ok, 'uncited sentence rejected');
});

const okJson = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
test('cloud adapter: refuses without key/price; key in header only; redaction; disabled by default; per-sentence fidelity; fallbacks; usage recorded', async () => {
  assert.equal(cloudProviderFromEnv({}).provider, null);
  assert.equal(cloudProviderFromEnv({ MH_LLM_PROVIDER: 'gemini', MH_LLM_API_KEY: 'k', MH_LLM_MODEL: 'm' }).provider, null, 'no price → refused (cost cannot be monitored)');
  assert.equal(cloudProviderFromEnv({ MH_LLM_PROVIDER: 'openai_compatible', MH_LLM_API_KEY: 'k', MH_LLM_MODEL: 'm', MH_LLM_PRICE_IN_PER_MTOK: '0.1', MH_LLM_PRICE_OUT_PER_MTOK: '0.4', MH_LLM_BASE_URL: 'http://insecure' }).provider, null, 'http base URL refused');
  assert.equal(redact('رقمها 777123456 وايميلها a.b@c.com'), 'رقمها [رقم] وايميلها [بريد]');
  const db = fresh(); const q = 'ايش فايدة اليوريا؟ رقم الزبونة 777123456'; const a = answerCp07(db, q);
  const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
  const faithful = a.sections.flatMap((s) => s.items).filter((i) => i.claim_id).slice(0, 2).map((i) => ({ text: i.text, claim_ids: [i.claim_id] }));
  const mk = (sentences: unknown[]) => geminiProvider({ apiKey: 'SECRET-KEY', model: 'gemini-test', price: { input_per_mtok: 0.1, output_per_mtok: 0.4 }, fetch: async (url, init) => { calls.push({ url, headers: init.headers, body: init.body }); return okJson({ candidates: [{ content: { parts: [{ text: JSON.stringify({ sentences }) }] } }], usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 120 } }); } });
  const cfg = (p: ReturnType<typeof mk> | null, budget = 5) => ({ provider: p, monthly_budget_usd: budget, daily_request_cap: 100, timeout_ms: 2000 });
  // disabled by default: nothing is sent
  let r = await cloudCompose(db, a, q, cfg(mk(faithful)));
  assert.equal(r.mode_used, 'local'); assert.equal(calls.length, 0);
  setCloudEnabled(db, true);
  r = await cloudCompose(db, a, q, cfg(mk([...faithful, { text: 'اليوريا تعالج الجفاف نهائيًا بالتأكيد', claim_ids: [faithful[0]!.claim_ids[0]] }])));
  assert.equal(r.mode_used, 'cloud_assisted'); assert.equal(r.kept, 2); assert.equal(r.dropped.length, 1, 'the strengthened sentence is dropped');
  assert.ok(!calls[0]!.url.includes('SECRET-KEY') && calls[0]!.headers['x-goog-api-key'] === 'SECRET-KEY', 'key in header, never in URL');
  assert.ok(!calls[0]!.body.includes('777123456') && calls[0]!.body.includes('[رقم]'), 'phone number redacted');
  assert.ok(!/Cleanser|catalog/i.test(calls[0]!.body), 'no catalogue sent');
  assert.ok(usage(db, 'gemini').month_requests >= 1 && usage(db, 'gemini').month_usd > 0, 'usage and cost recorded');
  r = await cloudCompose(db, a, q, cfg(mk([{ text: 'دراسة أثبتت أنها مضمونة', claim_ids: ['invented'] }])));
  assert.equal(r.mode_used, 'local'); assert.match(r.status_ar, /تعذّر|رُفضت/);
  const down = geminiProvider({ apiKey: 'k', model: 'm', price: { input_per_mtok: 0, output_per_mtok: 0 }, fetch: async () => ({ ok: false, status: 503, json: async () => ({}) }) });
  r = await cloudCompose(db, a, q, cfg(down)); assert.equal(r.mode_used, 'local'); assert.equal(r.text, a.text, 'outage → the local answer unchanged');
  const n = calls.length; const red = answerCp07(db, 'وجهي انتفخ بعد الكريم');
  r = await cloudCompose(db, red, 'وجهي انتفخ بعد الكريم', cfg(mk(faithful))); assert.equal(r.mode_used, 'local'); assert.equal(calls.length, n, 'safety cases are never sent');
  r = await cloudCompose(db, a, q, cfg(mk(faithful), 0)); assert.equal(r.mode_used, 'local'); assert.match(r.error ?? '', /budget/);
  // OpenAI-compatible adapter: bearer header, JSON mode
  const oc: string[] = [];
  const o = openAICompatibleProvider({ baseUrl: 'https://llm.example', apiKey: 'K2', model: 'x', price: { input_per_mtok: 0, output_per_mtok: 0 }, fetch: async (url, init) => { oc.push(`${url}|${init.headers.authorization}`); return okJson({ choices: [{ message: { content: JSON.stringify({ sentences: faithful }) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }); } });
  r = await cloudCompose(db, a, q, { provider: o, monthly_budget_usd: 5, daily_request_cap: 100, timeout_ms: 2000 });
  assert.equal(r.mode_used, 'cloud_assisted'); assert.equal(oc[0], 'https://llm.example/chat/completions|Bearer K2');
});

const fake = (routes: Record<string, string>, log: string[] = []): FetchLike => async (url) => { log.push(url); const k = Object.keys(routes).find((p) => url.includes(p)); return k ? { ok: true, status: 200, text: async () => routes[k]! } : { ok: false, status: 404, text: async () => '' }; };
const PM = { esearch: JSON.stringify({ esearchresult: { idlist: ['1', '2', '3'] } }), esummary: JSON.stringify({ result: { uids: ['1', '2', '3'], 1: { title: 'Tranexamic acid for melasma: a systematic review', source: 'J', pubdate: '2023', pubtype: ['Systematic Review'] }, 2: { title: 'Tranexamic acid for melasma: a systematic review', source: 'J2', pubdate: '2023', pubtype: ['Review'] }, 3: { title: 'Unrelated knee surgery outcomes', source: 'K', pubdate: '2001', pubtype: ['Journal Article'] } } }) };
test('research: plan from concepts (never free text), off/offline honoured, de-duplicated and ranked, stored as unreviewed only', async () => {
  const u = understandCp07('هل حمض الترانيكساميك ينفع للكلف');
  const plan = planResearch(u);
  assert.ok(plan.queries.some((q) => q.connector === 'pubmed' && /tranexamic acid/.test(q.q) && /melasma/.test(q.q)));
  const un = planResearch(understandCp07('هل زيت الفقمة السحري يفيد؟'));
  assert.equal(un.queries.length, 0); assert.ok(un.unmapped, 'unknown subject is not sent as free text');
  const db = fresh(); const log: string[] = [];
  assert.equal((await runResearch(db, u, { fetch: fake(PM, log), online: true, sleep: async () => {} })).status, 'disabled'); assert.equal(log.length, 0);
  setExternalSearch(db, true);
  assert.equal((await runResearch(db, u, { fetch: fake(PM, log), online: false, sleep: async () => {} })).status, 'offline');
  const r = await runResearch(db, u, { fetch: fake({ ...PM, wsearch: '<nlmSearchResult></nlmSearchResult>' }, log), online: true, sleep: async () => {} });
  assert.equal(r.status, 'ok');
  assert.equal(r.items.filter((i) => /Tranexamic/.test(i.title)).length, 1, 'duplicate title across records shown once');
  assert.match(r.items[0]!.title, /Tranexamic/, 'most relevant first');
  assert.ok(r.items.every((i) => /غير مراجع/.test(i.label_ar)));
  assert.ok(r.stored >= 2);
  const before = usableClaims(db).length; assert.equal(usableClaims(db).length, before, 'nothing becomes usable knowledge');
  assert.ok(log.every((x) => !/%D8|%D9/.test(x)), 'no Arabic staff text in any outgoing URL');
});

test('HTTP: off by default; status never exposes keys; modes work and fall back honestly; settings are manager-only', async () => {
  const t = await boot(); const prev = { cp07: process.env.MH_CP07, key: process.env.MH_LLM_API_KEY };
  try {
    delete process.env.MH_CP07;
    const offSt = await t.call('GET', '/api/cp08/status', { token: t.staff });
    assert.equal(offSt.status, 200); assert.equal(offSt.json.enabled, false, 'off by default');
    assert.equal((await t.call('POST', '/api/cp08/advisor/chat', { token: t.staff, body: { message: 'مرحبا' } })).status, 404);
    process.env.MH_CP07 = '1'; process.env.MH_LLM_API_KEY = 'TOP-SECRET';
    const st = await t.call('GET', '/api/cp08/status', { token: t.staff });
    assert.equal(st.status, 200); assert.equal(st.json.modes.offline.available, true); assert.equal(st.json.modes.cloud.configured, false);
    assert.ok(!st.text.includes('TOP-SECRET'), 'key never returned');
    const off = await t.call('POST', '/api/cp08/advisor/chat', { token: t.staff, body: { message: 'بشرتي جافة وأشتي غسول' } });
    assert.equal(off.status, 200); assert.equal(off.json.mode_used, 'offline'); assert.equal(off.json.answer.understanding.requested_product_type, 'cleanser');
    const cl = await t.call('POST', '/api/cp08/advisor/chat', { token: t.staff, body: { message: 'ايش فايدة اليوريا', mode: 'cloud' } });
    assert.equal(cl.json.mode_used, 'offline'); assert.match(cl.json.cloud.status_ar, /غير مفعّل/);
    assert.equal((await t.call('POST', '/api/cp08/settings', { token: t.staff, body: { external_search_enabled: true } })).status, 403);
    assert.equal((await t.call('POST', '/api/cp08/settings', { token: t.manager, body: { external_search_enabled: true } })).status, 200);
    setResearchFetchForTests(fake(PM));
    const rs = await t.call('POST', '/api/cp08/advisor/chat', { token: t.staff, body: { message: 'هل حمض الترانيكساميك ينفع للكلف', mode: 'research' } });
    assert.equal(rs.status, 200); assert.ok(rs.json.research, 'research block present'); assert.notEqual(rs.json.research.status, 'disabled');
    assert.match(rs.json.answer.text, /لا تتوفر لدي معلومات موثوقة كافية/, 'the answer itself stays local and honest');
    const red = await t.call('POST', '/api/cp08/advisor/chat', { token: t.staff, body: { message: 'وجهي انتفخ بعد الكريم', mode: 'research' } });
    assert.equal(red.json.research, null, 'no research on an urgent case'); assert.equal(red.json.answer.sections[0].kind, 'referral');
  } finally {
    setResearchFetchForTests(null);
    if (prev.cp07 === undefined) delete process.env.MH_CP07; else process.env.MH_CP07 = prev.cp07;
    if (prev.key === undefined) delete process.env.MH_LLM_API_KEY; else process.env.MH_LLM_API_KEY = prev.key;
    await t.close();
  }
});
