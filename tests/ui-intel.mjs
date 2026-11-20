// CP08 — unified advisor staff screens in Chromium (360 / 390 px). Run: scripts/ui-intel-run.sh (MH_CP07=1, MH_ENRICH=off, no cloud key)
import { createRequire } from 'node:module'; const require = createRequire('/opt/npm-tools/node_modules/');
const { chromium } = require('playwright');
import assert from 'node:assert/strict';
const base = process.argv[2] ?? 'http://localhost:8093';
const browser = await chromium.launch(); let failed = 0;
const step = async (name, fn) => { try { await fn(); console.log('PASS', name); } catch (e) { failed++; console.log('FAIL', name, '-', e.message.split('\n')[0]); } };
for (const width of [360, 390]) {
  const ctx = await browser.newContext({ viewport: { width, height: 760 }, deviceScaleFactor: 1, locale: 'ar' });
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  const login = async (u, p) => { await page.goto(base); await page.evaluate(() => sessionStorage.clear()); await page.goto(base); await page.fill('input[autocomplete=username]', u); await page.fill('input[type=password]', p); await page.click('button[type=submit]'); await page.waitForSelector('nav.nav'); };
  const noOverflow = async () => { const o = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); assert.ok(o <= 1, 'overflow ' + o); };
  const ask = async (q) => { const n = await page.locator('.ibub').count(); await page.fill('.composer input', q); await page.keyboard.press('Enter'); await page.waitForFunction((k) => document.querySelectorAll('.ibub').length > k && !document.querySelector('.ibub [aria-busy]'), n); return page.locator('.ibub').last(); };

  await step(`[${width}] staff: menu offers the scientific advisor; modes show real availability (research off, cloud not configured)`, async () => {
    await login('sara', 'staff-password-1');
    await page.waitForTimeout(300); await page.evaluate(() => (location.hash = '#/intel')); await page.waitForSelector('#intel-status input#mode-offline');
    assert.equal(await page.locator('#mode-offline').isChecked(), true);
    assert.equal(await page.locator('#mode-research').isDisabled(), true, 'research disabled (switch off / no network)');
    assert.equal(await page.locator('#mode-cloud').isDisabled(), true, 'cloud disabled (no provider configured)');
    assert.match(await page.locator('#intel-status').textContent(), /غير مضبوط|لم يُضبط/);
    await noOverflow();
  });
  await step(`[${width}] mandatory case: cleanser stays the request, sources link out, local badge, honest status`, async () => {
    const b = await ask('بشرتي جافة وحساسة وأشتي غسول');
    const t = await b.textContent();
    assert.match(t, /المطلوب: غسول/); assert.match(t, /كيف تختارين غسول/); assert.match(t, /لم يراجعه مختص مؤهل بعد/);
    assert.equal(await b.locator('#answer-mode').textContent(), 'إجابة محلية');
    await b.locator('details.srcs summary').click(); assert.ok(await b.locator('details.srcs a[href^="https://"]').count() >= 1);
    assert.match(await page.locator('#intel-context').textContent(), /جافة/);
    await noOverflow();
  });
  await step(`[${width}] follow-up pronoun resolves to the previous ingredient; red flag is an alert with no product`, async () => {
    await page.click('#intel-reset');
    await ask('ايش فايدة النياسيناميد');
    const t = await (await ask('طيب لو استخدمته مع الريتينول؟')).textContent();
    assert.match(t, /النياسيناميد/); assert.match(t, /الريتينول/);
    const red = await ask('عيوني منفوخة وحمرا من الكحل الجديد');
    assert.equal(await red.locator('[role=alert]').count(), 1); assert.doesNotMatch(await red.textContent(), /منتجات المحل/);
  });
  await step(`[${width}] staff cannot open the knowledge review screen`, async () => {
    await page.evaluate(() => (location.hash = '#/knowledge')); await page.waitForSelector('text=هذه الصفحة للمدير فقط');
  });
  await step(`[${width}] manager: knowledge review shows gaps, pending claims, settings; cloud explains it is server-side only`, async () => {
    await login('admin', 'admin-password-1');
    await page.evaluate(() => (location.hash = '#/intel')); await page.waitForSelector('.composer input');
    await ask('ما فائدة الكولاجين للبشرة؟');   // creates a knowledge gap
    await page.evaluate(() => (location.hash = '#/knowledge')); await page.waitForSelector('#k-pending');
    assert.match(await page.locator('#k-gaps').textContent(), /كولاجين/);
    assert.ok(await page.locator('#k-pending .kclaim').count() >= 10);
    assert.match(await page.locator('#k-cloud-off').textContent(), /بيئة الخادم فقط/);
    await page.check('#k-research'); await page.waitForTimeout(400);
    assert.equal(await page.locator('#k-research').isChecked(), true);
    await noOverflow(); assert.deepEqual(errors, []);
  });
  await ctx.close();
}
await browser.close(); console.log(failed ? `${failed} FAILED` : 'ALL PASSED'); process.exit(failed ? 1 : 0);
