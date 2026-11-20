// CP09 — unified feature switch (both runtimes), multi-turn safety carry-over, privacy of stored turns, device-runtime behaviour.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setRuntime } from '../server/src/cp08/features.ts';
import { setResearchFetchForTests } from '../server/src/cp08/routes.ts';
import type { FetchLike } from '../server/src/cp07/connectors.ts';
import { boot } from './helpers.ts';

const withEnv = async (k: string, v: string | undefined, fn: () => Promise<void>) => { const prev = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; try { await fn(); } finally { if (prev === undefined) delete process.env[k]; else process.env[k] = prev; } };

test('switch: off by default; only a manager turns it on (stored setting, audited); MH_CP07=1 still forces it on and cannot be switched off from the app', async () => {
  await withEnv('MH_CP07', undefined, async () => {
    const t = await boot();
    try {
      let st = await t.call('GET', '/api/cp08/status', { token: t.staff });
      assert.equal(st.json.enabled, false); assert.equal(st.json.can_enable, false, 'staff cannot');
      assert.equal((await t.call('GET', '/api/cp08/status', { token: t.manager })).json.can_enable, true);
      assert.equal((await t.call('POST', '/api/cp08/advisor/chat', { token: t.staff, body: { message: 'مرحبا' } })).status, 404);
      assert.equal((await t.call('POST', '/api/features/scientific-advisor', { token: t.staff, body: { enabled: true } })).status, 403, 'the route enforces the role');
      assert.equal((await t.call('POST', '/api/features/scientific-advisor', { token: t.manager, body: { enabled: true } })).status, 200);
      st = await t.call('GET', '/api/cp08/status', { token: t.staff }); assert.equal(st.json.enabled, true); assert.equal(st.json.source, 'setting');
      assert.equal((await t.call('POST', '/api/cp08/advisor/chat', { token: t.staff, body: { message: 'بشرتي جافة وأشتي غسول' } })).json.answer.understanding.requested_product_type, 'cleanser');
      assert.equal((await t.call('POST', '/api/cp07/advisor/chat', { token: t.staff, body: { message: 'ايش فايدة اليوريا' } })).status, 200, 'CP07 routes follow the same switch');
      const audit = t.db.prepare("SELECT detail FROM audit_log WHERE action = 'feature'").all() as { detail: string }[];
      assert.deepEqual(audit.map((a) => a.detail), ['enabled']);
      assert.equal((await t.call('POST', '/api/features/scientific-advisor', { token: t.manager, body: { enabled: false } })).status, 200);
      assert.equal((await t.call('GET', '/api/cp08/status', { token: t.staff })).json.enabled, false);
      assert.equal((await t.call('POST', '/api/advisor/chat', { token: t.staff, body: { message: 'بشرتي جافة وأريد غسول' } })).status, 200, 'the CP06.2 advisor works whatever the switch');
    } finally { await t.close(); }
  });
  await withEnv('MH_CP07', '1', async () => {
    const t = await boot();
    try {
      const st = await t.call('GET', '/api/cp08/status', { token: t.staff }); assert.equal(st.json.enabled, true); assert.equal(st.json.source, 'env');
      assert.equal((await t.call('POST', '/api/features/scientific-advisor', { token: t.manager, body: { enabled: false } })).status, 409);
    } finally { await t.close(); }
  });
});

test('multi-turn safety: after an urgent sign, later turns keep the referral first and recommend no products until a new conversation; stored turns are redacted', async () => {
  await withEnv('MH_CP07', '1', async () => {
    const t = await boot();
    try {
      await t.call('POST', '/api/products', { token: t.manager, body: { name: 'غسول لطيف', brand: 'B', size: '50 ml', product_type: 'cleanser', category: 'العناية بالبشرة' } });
      const r1 = await t.call('POST', '/api/cp08/advisor/chat', { token: t.staff, body: { message: 'وجهي انتفخ بعد الكريم، رقمها 777123456' } });
      assert.equal(r1.json.answer.sections[0].kind, 'referral');
      const sid = r1.json.session_id;
      const r2 = await t.call('POST', '/api/cp08/advisor/chat', { token: t.staff, body: { message: 'طيب أشتي غسول للبشرة الجافة', session_id: sid } });
      assert.equal(r2.json.answer.sections[0].kind, 'referral'); assert.match(r2.json.answer.sections[0].title, /تذكير/);
      assert.equal(r2.json.answer.products, null); assert.ok(!r2.json.answer.sections.some((x: { kind: string }) => x.kind === 'products'));
      const r3 = await t.call('POST', '/api/cp08/advisor/chat', { token: t.staff, body: { message: 'محادثة جديدة', session_id: sid } });
      const r4 = await t.call('POST', '/api/cp08/advisor/chat', { token: t.staff, body: { message: 'أشتي غسول للبشرة الجافة', session_id: r3.json.session_id } });
      assert.notEqual(r4.json.answer.sections[0].kind, 'referral', 'a new conversation starts clean');
      const turns = await t.call('GET', `/api/advisor/session/${sid}`, { token: t.staff });
      assert.ok(!JSON.stringify(turns.json).includes('777123456'), 'phone number not stored'); assert.ok(JSON.stringify(turns.json).includes('[رقم]'));
    } finally { await t.close(); }
  });
});

test('device runtime: online from the probe, MedlinePlus excluded (CORS), cloud unavailable with a reason, research still honest offline', async () => {
  const log: string[] = [];
  const fake: FetchLike = async (url) => { log.push(url); const body = url.includes('esearch') ? JSON.stringify({ esearchresult: { idlist: ['1'] } }) : JSON.stringify({ result: { uids: ['1'], 1: { title: 'Tranexamic acid for melasma: a review', source: 'J', pubdate: '2023', pubtype: ['Review'] } } }); return { ok: true, status: 200, text: async () => body }; };
  let online = false;
  setRuntime('device', () => online); setResearchFetchForTests(fake);
  try {
    await withEnv('MH_CP07', undefined, async () => {
      const t = await boot();
      try {
        await t.call('POST', '/api/features/scientific-advisor', { token: t.manager, body: { enabled: true } });
        await t.call('POST', '/api/cp08/settings', { token: t.manager, body: { external_search_enabled: true } });
        let st = await t.call('GET', '/api/cp08/status', { token: t.staff });
        assert.equal(st.json.runtime, 'device'); assert.equal(st.json.modes.research.online, false); assert.equal(st.json.modes.research.available, false);
        assert.equal(st.json.modes.cloud.enabled, false); assert.match(st.json.modes.cloud.reason, /الهاتف/);
        assert.equal(st.json.modes.research.sources.find((x: { id: string }) => x.id === 'medlineplus').available, false);
        let r = await t.call('POST', '/api/cp08/advisor/chat', { token: t.staff, body: { message: 'هل حمض الترانيكساميك ينفع للكلف', mode: 'research' } });
        assert.equal(r.json.research.status, 'offline'); assert.equal(log.length, 0, 'offline: no request');
        online = true; st = await t.call('GET', '/api/cp08/status', { token: t.staff }); assert.equal(st.json.modes.research.available, true);
        r = await t.call('POST', '/api/cp08/advisor/chat', { token: t.staff, body: { message: 'هل حمض الترانيكساميك ينفع للكلف', mode: 'research' } });
        assert.equal(r.json.research.status, 'ok'); assert.ok(log.length > 0 && log.every((u) => u.includes('eutils.ncbi')), 'only PubMed is called on the phone');
        assert.ok(r.json.research.notes_ar.some((n: string) => /MedlinePlus/.test(n)), 'the person is told why MedlinePlus is absent');
        const c = await t.call('POST', '/api/cp08/advisor/chat', { token: t.staff, body: { message: 'ايش فايدة اليوريا', mode: 'cloud' } });
        assert.equal(c.json.mode_used, 'offline'); assert.match(c.json.answer.text, /اليوريا/);
      } finally { await t.close(); }
    });
  } finally { setRuntime('server', () => true); setResearchFetchForTests(null); }
});

test('CP09 blind safety set as regression (after its one blind scoring): every urgent and referral case is caught', async () => {
  const { CP09_SAFETY } = await import('./fixtures/cp09-blind-safety.ts');
  const { understandCp07 } = await import('../server/src/cp07/nlu.ts');
  for (const it of CP09_SAFETY) {
    const u = understandCp07(it.text);
    if (it.kind === 'urgent') assert.ok(u.medical_red_flags.length > 0, `urgent missed: ${it.text}`);
    if (it.kind === 'referral') assert.ok(u.referrals.length > 0 || u.medical_red_flags.length > 0, `referral missed: ${it.text}`);
  }
});
