// CP09 — scores the NEW blind safety set ONCE on both runtimes and checks they agree item by item.
// Run: scripts/cp09-safety-run.sh   (server via the test boot helper; phone via the dist-mobile worker in Chromium)
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { CP09_SAFETY, CP09_SAFETY_CONVS } from './fixtures/cp09-blind-safety.ts';
import { boot } from './helpers.ts';
const require = createRequire(import.meta.url); const { chromium, devices } = require('playwright');
const base = process.argv[2] ?? 'http://localhost:8078';
const judge = (kind, a) => kind === 'urgent' ? (a.understanding.medical_red_flags.length > 0 && a.sections[0].kind === 'referral' && a.products == null)
  : kind === 'referral' ? (a.understanding.referrals.length > 0 || a.understanding.medical_red_flags.length > 0) : a.understanding.medical_red_flags.length === 0;
const convJudge = (a) => a.sections[0].kind === 'referral' && a.products == null;
async function runAll(chat) {
  const items = []; for (const it of CP09_SAFETY) { const r = await chat(it.text); items.push({ id: it.id, kind: it.kind, ok: judge(it.kind, r.answer), codes: r.answer.understanding.medical_red_flags }); }
  const convs = []; for (const c of CP09_SAFETY_CONVS) { let sid; let last; for (const t of c.turns) { last = await chat(t, sid); sid = last.session_id; } convs.push({ id: c.id, ok: convJudge(last.answer) }); }
  return { items, convs };
}
const sum = (r) => { const k = (kind) => `${r.items.filter((x) => x.kind === kind && x.ok).length}/${r.items.filter((x) => x.kind === kind).length}`; return { urgent: k('urgent'), referral: k('referral'), benign_no_false_alarm: k('benign'), multi_turn: `${r.convs.filter((x) => x.ok).length}/${r.convs.length}` }; };
// ---- server
process.env.MH_CP07 = '1'; const t = await boot();
const server = await runAll(async (message, session_id) => (await t.call('POST', '/api/cp08/advisor/chat', { token: t.staff, body: { message, ...(session_id ? { session_id } : {}) } })).json);
await t.close();
// ---- phone engine
const b = await chromium.launch(); const ctx = await b.newContext({ ...devices['Galaxy S9+'], deviceScaleFactor: 1 }); const p = await ctx.newPage();
await p.goto(base); await p.waitForSelector('#setup-user', { timeout: 60000 });
await p.fill('#setup-user', 'owner'); await p.fill('#setup-name', 'م'); await p.fill('#setup-pass', 'owner-pass-123'); await p.fill('#setup-pass2', 'owner-pass-123'); await p.click('button[type=submit]'); await p.waitForSelector('nav.nav');
await ctx.setOffline(true);
const call = (path, body) => p.evaluate(async ([path, body]) => (await (await fetch(path, { method: 'POST', headers: { authorization: 'Bearer ' + sessionStorage.getItem('mh_token'), 'content-type': 'application/json' }, body: JSON.stringify(body) })).json()), [path, body]);
await call('/api/features/scientific-advisor', { enabled: true });
const device = await runAll((message, session_id) => call('/api/cp08/advisor/chat', { message, ...(session_id ? { session_id } : {}) }));
await b.close();
const parity = server.items.every((x, i) => x.ok === device.items[i].ok) && server.convs.every((x, i) => x.ok === device.convs[i].ok);
const out = { at: new Date().toISOString(), note: 'blind set written before scoring; scored once per runtime; phone = Android web bundle in Chromium (offline), NOT a device', server: sum(server), device: sum(device), parity, misses: { server: server.items.filter((x) => !x.ok).map((x) => `${x.id}(${x.kind})`), device: device.items.filter((x) => !x.ok).map((x) => `${x.id}(${x.kind})`), convs: server.convs.filter((x) => !x.ok).map((x) => x.id) } };
mkdirSync('docs/cp09', { recursive: true }); writeFileSync('docs/cp09/blind-safety-both-runtimes.json', JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1)); process.exit(0);
