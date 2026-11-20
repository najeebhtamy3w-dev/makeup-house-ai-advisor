// CP09 — performance of the Android web bundle in Chromium (Galaxy S9+ profile, offline). NOT a phone measurement.
// Startup, local answer latency (scientific advisor), catalogue search at 1,000 products, JS heap (main thread, Chromium
// performance.memory) and the worker's WASM heap. Run: scripts/local-perf-run.sh
import { createRequire } from 'node:module'; import { writeFileSync, mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url); const { chromium, devices } = require('playwright');
const base = process.argv[2] ?? 'http://localhost:8079';
const b = await chromium.launch({ args: ['--enable-precise-memory-info'] }); const ctx = await b.newContext({ ...devices['Galaxy S9+'], deviceScaleFactor: 1 }); const p = await ctx.newPage();
const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.min(s.length - 1, Math.floor(q * s.length))] * 10) / 10; };
const t0 = Date.now(); await p.goto(base); await p.waitForFunction(() => window.MH_READY); await p.evaluate(() => window.MH_READY); const cold = Date.now() - t0;
await p.waitForSelector('#setup-user', { timeout: 60000 }); await p.fill('#setup-user', 'owner'); await p.fill('#setup-name', 'م'); await p.fill('#setup-pass', 'owner-pass-123'); await p.fill('#setup-pass2', 'owner-pass-123'); await p.click('button[type=submit]'); await p.waitForSelector('nav.nav');
await ctx.setOffline(true);
const r = await p.evaluate(async () => {
  const H = { authorization: 'Bearer ' + sessionStorage.getItem('mh_token'), 'content-type': 'application/json' };
  const post = (u, b) => fetch(u, { method: 'POST', headers: H, body: JSON.stringify(b) }).then((x) => x.json());
  await post('/api/features/scientific-advisor', { enabled: true });
  for (let i = 0; i < 1000; i++) await post('/api/products', { name: `منتج اختبار ${i} ${['غسول', 'مرطب', 'واقي', 'شامبو'][i % 4]}`, brand: 'Perf', size: '50 ml', ingredients: 'aqua, glycerin, niacinamide', product_type: ['cleanser', 'cream', 'sunscreen', 'shampoo'][i % 4], category: i % 4 === 3 ? 'العناية بالشعر' : 'العناية بالبشرة' });
  const qs = ['بشرتي جافة وحساسة وأشتي غسول', 'ايش فايدة اليوريا', 'أقدر أستخدم الريتينول مع المقشر؟', 'شعري ناشف ويتكسر', 'معي بشرة دهنية وأشتي واقي شمس', 'وجهي انتفخ بعد الكريم', 'إيش الفرق بين النياسيناميد والساليسيليك؟', 'ما فائدة الكولاجين للبشرة؟'];
  const ans = []; for (let k = 0; k < 3; k++) for (const q of qs) { const t = performance.now(); await post('/api/cp08/advisor/chat', { message: q }); ans.push(performance.now() - t); }
  const srch = []; for (const q of ['غسول', 'مرطب 5', 'Perf', 'اختبار 99']) { const t = performance.now(); await fetch('/api/products?q=' + encodeURIComponent(q) + '&limit=30', { headers: H }); srch.push(performance.now() - t); }
  const mem = await fetch('/api/local/backup/mem', { headers: H }).then((x) => x.json());
  return { ans, srch, js_heap_used_mb: Math.round(performance.memory.usedJSHeapSize / 1e5) / 10, wasm_heap_mb: Math.round(mem.wasm_heap_bytes / 1e5) / 10, db_mb: Math.round(mem.db_bytes / 1e5) / 10 };
});
const t1 = Date.now(); await ctx.setOffline(false); await p.reload(); await p.evaluate(() => window.MH_READY); const warm = Date.now() - t1;
const out = { at: new Date().toISOString(), environment: 'Chromium on a 4-core x64 cloud VM, Galaxy S9+ viewport — NOT a phone', cold_start_to_worker_ready_ms: cold, warm_restart_to_worker_ready_ms: warm, products: 1000,
  advisor_answer_ms: { n: r.ans.length, p50: pct(r.ans, 0.5), p95: pct(r.ans, 0.95) }, catalogue_search_ms: { n: r.srch.length, p50: pct(r.srch, 0.5), max: Math.round(Math.max(...r.srch)) },
  js_heap_main_thread_mb: r.js_heap_used_mb, worker_wasm_heap_mb: r.wasm_heap_mb, db_mb: r.db_mb,
  not_measured: ['worker JS heap (no API in a dedicated worker)', 'native process memory', 'any Samsung number'] };
mkdirSync('docs/cp09', { recursive: true }); writeFileSync('docs/cp09/local-perf.json', JSON.stringify(out, null, 1)); console.log(JSON.stringify(out, null, 1));
await b.close();
