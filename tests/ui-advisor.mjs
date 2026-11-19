// CP06.2 Phase 5A — conversational advisor screen in Chromium (360 / 390 px). Run: scripts/ui-advisor-run.sh
import { createRequire } from 'node:module'; const require = createRequire('/opt/npm-tools/node_modules/');
const { chromium } = require('playwright');
import assert from 'node:assert/strict';
const base = process.argv[2] ?? 'http://localhost:8091';
const browser = await chromium.launch(); let failed = 0;
const step = async (name, fn) => { try { await fn(); console.log('PASS', name); } catch (e) { failed++; console.log('FAIL', name, '-', e.message.split('\n')[0]); } };
for (const width of [360, 390]) {
  const ctx = await browser.newContext({ viewport: { width, height: 760 }, deviceScaleFactor: 1, locale: 'ar' });
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  const lastRes = () => page.locator('.bub.res').last();
  const ask = async (q) => { const n = await page.locator('.bub.res').count(); await page.fill('.composer input', q); await page.keyboard.press('Enter'); await page.waitForFunction((k) => document.querySelectorAll('.bub.res').length > k && !document.querySelector('.bub.res .skel'), n); return lastRes().textContent(); };
  const noOverflow = async () => { const o = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); assert.ok(o <= 1, 'overflow ' + o); };

  await step(`[${width}] case A: understanding, cleanser guidance, follow-up, sources, honest mode line`, async () => {
    await page.goto(base); await page.fill('input[autocomplete=username]', 'sara'); await page.fill('input[type=password]', 'staff-password-1'); await page.click('button[type=submit]'); await page.waitForSelector('nav.nav');
    await page.evaluate(() => (location.hash = '#/advisor')); await page.waitForSelector('.composer input');
    await page.waitForFunction(() => /وضع معرفي محدود/.test(document.querySelector('#advisor-mode')?.textContent ?? ''));
    const t = await ask('بشرتي جافه وحساسه أريد غسول');
    assert.match(t, /فهمت: بشرة جافة وحساسة — والمطلوب: غسول/); assert.match(t, /كيف تختارين غسول/); assert.match(t, /خالٍ من العطور/);
    assert.match(t, /لم يراجعه مختص مؤهل بعد/); assert.doesNotMatch(t, /null|undefined|\[object/);
    await lastRes().locator('details.srcs summary').click(); assert.ok(await lastRes().locator('details.srcs a[href^="https://www.aad.org/"]').count() >= 1, 'source links');
    assert.ok(await page.locator('.sugg button').count() >= 2, 'follow-up chips'); await noOverflow();
  });
  await step(`[${width}] multi-turn: follow-up chip and a retinol turn keep the same conversation context`, async () => {
    const n = await page.locator('.bub.res').count(); await page.click('.sugg button >> nth=0');
    await page.waitForFunction((k) => document.querySelectorAll('.bub.res').length > k && !document.querySelector('.bub.res .skel'), n);
    const t = await ask('وأستخدم الريتينول مرتين في الأسبوع'); assert.match(t, /بشرة جافة وحساسة/); assert.match(t, /ريتين/);
  });
  await step(`[${width}] new conversation clears the context; a red flag is an alert with no product`, async () => {
    await page.click('#advisor-reset'); await page.waitForSelector('text=محادثة جديدة: لا تُستخدم');
    const t = await ask('وجهي فيه تورم وصعوبة في التنفس بعد كريم'); assert.match(t, /طبيب أو مختص صحي/); assert.doesNotMatch(t, /بشرة جافة/);
    assert.equal(await lastRes().locator('[role=alert]').count(), 1); assert.equal(await lastRes().locator('.pl').count(), 0);
  });
  await step(`[${width}] case B (long, multi-part) renders readably: routine and questions, nothing cut, no overflow, no errors`, async () => {
    const t = await ask('بشرتي مختلطة وحساسة، عندي حبوب صغيرة وجفاف حول الأنف، وأستخدم سيروم نياسيناميد. ما المشكلة المحتملة وكيف أرتب روتيني؟');
    assert.match(t, /روتين مقترح/); assert.match(t, /هل الحبوب مؤلمة/); await noOverflow(); assert.deepEqual(errors, []);
  });
  await ctx.close();
}
await browser.close(); console.log(failed ? `${failed} FAILED` : 'ALL PASSED'); process.exit(failed ? 1 : 0);
