// CP06.2 Phase 5 — import batch actions + evidence review in Chromium (360 / 390 px). Uses the DEV mock provider only
// (MH_ENRICH=mock: clearly fake data, no network). Run: scripts/ui-evidence-run.sh
import { createRequire } from 'node:module'; const require = createRequire('/opt/npm-tools/node_modules/');
const { chromium } = require('playwright');
import assert from 'node:assert/strict';
const base = process.argv[2] ?? 'http://localhost:8092';
const browser = await chromium.launch(); let failed = 0;
const step = async (name, fn) => { try { await fn(); console.log('PASS', name); } catch (e) { failed++; console.log('FAIL', name, '-', e.message.split('\n')[0]); } };

for (const width of [360, 390]) {
  const ctx = await browser.newContext({ viewport: { width, height: 760 }, deviceScaleFactor: 1, locale: 'ar', acceptDownloads: true });
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  const api = async (method, path, body) => page.evaluate(async ([m, p, b]) => { const r = await fetch(p, { method: m, headers: { authorization: 'Bearer ' + sessionStorage.getItem('mh_token'), ...(b ? { 'content-type': 'application/json' } : {}) }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, json: await r.json().catch(() => null) }; }, [method, path, body]);
  const noOverflow = async () => { const o = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); assert.ok(o <= 1, 'horizontal overflow ' + o); };

  await step(`[${width}] import with enrichment: batch shown, drafts explained, error report downloads`, async () => {
    await page.goto(base); await page.fill('input[autocomplete=username]', 'admin'); await page.fill('input[type=password]', 'admin-password-1'); await page.click('button[type=submit]'); await page.waitForSelector('nav.nav');
    await page.evaluate(() => (location.hash = '#/import')); await page.waitForSelector('input[type=file]');
    // the two barcodes the DEV mock knows + a barcode-only row (draft) + an invalid row
    const csv = `barcode,name,brand,size\n5901234123457,EV مرطب ${width},DemoBrand,\n4006381333931,EV كريم ${width},,75 ml\n4006381333931${width === 360 ? '' : ''},,,\n6291041500214,تالف,,\n`.replace('4006381333931,,,', width === 360 ? '96385074,,,' : '12345670,,,');
    await page.setInputFiles('input[type=file]', { name: `ev${width}.csv`, mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await page.waitForSelector('text=معاينة'); await page.check('#imp-enrich'); await page.click('button:has-text("اعتماد:")');
    await page.waitForSelector('#batch-actions'); assert.match(await page.textContent('main'), /بانتظار التعرف/);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#batch-report')]);
    assert.match(dl.suggestedFilename(), /errors\.csv$/); await noOverflow();
  });

  await step(`[${width}] queue runs (mock), evidence screen compares store vs proposed with source and licence`, async () => {
    for (let i = 0; i < 4; i++) await api('POST', '/api/queue/run-one');
    await page.evaluate(() => (location.hash = '#/evidence')); await page.waitForSelector('.evrow');
    assert.match(await page.textContent('#queue-counts'), /تنتظر مراجعتك/);
    const t = await page.textContent('main'); assert.match(t, /في المحل/); assert.match(t, /المقترح/); assert.match(t, /ترخيص/); await noOverflow();
  });

  await step(`[${width}] accept one field, reject another, skip the rest -> saved, display name unchanged, next product loads`, async () => {
    const pid = await page.evaluate(() => document.querySelector('.prod b').textContent);
    await page.click('.evrow[data-field=brand] button[data-act=accept]').catch(async () => { await page.click('.evrow[data-field=ingredients] button[data-act=accept]'); });
    await page.click('.evrow[data-field=size] button[data-act=reject]').catch(() => {});
    const ambiguous = await page.locator('#confirm-identity').count();
    if (ambiguous) {   // the server refuses acceptance across an identity doubt until the reviewer confirms it explicitly
      await page.click('#evidence-save'); await page.waitForSelector('.notice.err'); assert.match(await page.textContent('.notice.err'), /ملتبسة/);
      await page.check('#confirm-identity');
    }
    await page.click('#evidence-save');
    await page.waitForFunction((n) => document.querySelector('.empty') || (document.querySelector('.prod b') && document.querySelector('.prod b').textContent !== n) || (document.querySelector('.notice.err') && !/ملتبسة/.test(document.querySelector('.notice.err').textContent)), pid);
    const err = await page.$('.notice.err'); if (err && !/ملتبسة/.test(await err.textContent())) throw new Error('save failed: ' + await err.textContent());
    const list = (await api('GET', '/api/products?q=' + encodeURIComponent('EV ') + '&limit=50')).json.products;
    assert.ok(list.some((p) => p.name === pid), 'display name kept');
  });

  await step(`[${width}] pause / resume the queue from the review screen; staff cannot open it`, async () => {
    await page.evaluate(() => { location.hash = '#/home'; location.hash = '#/evidence'; }); await page.waitForSelector('#queue-toggle');
    await page.click('#queue-toggle'); await page.waitForSelector('text=الطابور موقوف');
    assert.ok((await api('GET', '/api/queue/status')).json.paused.includes('all'));
    await page.click('#queue-toggle'); await page.waitForFunction(() => !document.body.textContent.includes('الطابور موقوف'));
    const p2 = await ctx.newPage(); await p2.goto(base); await p2.evaluate(() => sessionStorage.clear()); await p2.goto(base);
    await p2.fill('input[autocomplete=username]', 'sara'); await p2.fill('input[type=password]', 'staff-password-1'); await p2.click('button[type=submit]'); await p2.waitForSelector('nav.nav');
    await p2.evaluate(() => (location.hash = '#/evidence')); await p2.waitForSelector('text=هذه الصفحة للمدير فقط'); await p2.close();
    assert.deepEqual(errors, []);
  });
  await ctx.close();
}
await browser.close(); console.log(failed ? `${failed} FAILED` : 'ALL PASSED'); process.exit(failed ? 1 : 0);
