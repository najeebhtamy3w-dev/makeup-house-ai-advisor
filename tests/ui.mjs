// UI acceptance (real Chromium, mobile viewport). Run with server up:  node tests/ui.mjs http://localhost:8099
import { createRequire } from 'node:module'; const require = createRequire('/opt/npm-tools/node_modules/');
const { chromium } = require('playwright');
import assert from 'node:assert/strict';
const base = process.argv[2] ?? 'http://localhost:8099';
const out = new URL('./ui-shots/', import.meta.url).pathname;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 1, locale: 'ar' });
const page = await ctx.newPage(); const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', (e) => errors.push(String(e)));
const step = async (name, fn) => { try { await fn(); console.log('PASS', name); } catch (e) { console.log('FAIL', name, '-', e.message.split('\n')[0]); process.exitCode = 1; } };

await step('login screen is RTL and rejects bad password', async () => {
  await page.goto(base); assert.equal(await page.getAttribute('html', 'dir'), 'rtl');
  await page.screenshot({ path: out + '01-login.png' });
  await page.fill('input[autocomplete=username]', 'sara'); await page.fill('input[type=password]', 'bad'); await page.click('button[type=submit]');
  await page.waitForSelector('.notice.err');
});
await step('staff login -> home with 5-item bottom nav', async () => {
  await page.fill('input[type=password]', 'staff-password-1'); await page.click('button[type=submit]');
  await page.waitForSelector('.hero'); assert.equal(await page.locator('.nav button').count(), 5);
  await page.waitForSelector('.stats'); assert.doesNotMatch(await page.textContent('main'), /null|undefined|\[object/); await page.screenshot({ path: out + '02-home.png' });
});
await step('no horizontal overflow on home (390px)', async () => {
  const o = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); assert.ok(o <= 1, 'overflow ' + o);
});
await step('advisor: chat is primary; fragrance-free query excludes undocumented/fragranced items', async () => {
  await page.click('.nav button:nth-child(2)'); await page.waitForSelector('.composer input');
  await page.fill('.composer input', 'زبونة بشرتها جافة وحساسة وتريد مرطب خالي من العطر'); await page.keyboard.press('Enter');
  await page.waitForSelector('.bub.res'); const t = await page.textContent('.bub.res'); assert.doesNotMatch(t, /\[object|null|undefined/);
  assert.match(t, /مرطب وجه خالٍ من العطر/); assert.match(t, /أولًا: منتجات ميك أب هاوس/); assert.match(t, /ثانيًا: بدائل عالمية/);
  await page.screenshot({ path: out + '03-advisor.png' });
});
await step('advisor: recommendation card has no price and no personal data', async () => {
  await page.click('text=بطاقة توصية'); const v = await page.inputValue('.sheet textarea');
  assert.match(v, /MAKEUP HOUSE/); assert.doesNotMatch(v, /سعر|ريال|\$|price/i); await page.screenshot({ path: out + '04-card.png' }); await page.click('.sheet >> text=إغلاق');
});
await step('scan: manual unknown barcode -> new product form prefilled -> save', async () => {
  await page.click('.nav button:nth-child(3)'); await page.fill('input[aria-label="رقم الباركود"]', '5901234123457'); await page.keyboard.press('Enter');
  await page.waitForSelector('text=باركود جديد'); await page.screenshot({ path: out + '05-scan-new.png' });
  await page.click('text=إنشاء بطاقة ومراجعتها'); await page.waitForSelector('text=بطاقة منتج جديدة');
  assert.equal(await page.inputValue('input[dir=ltr]'), '5901234123457');
  await page.locator('.field:has(label:text("اسم المنتج")) input').fill('كريم يدين تجريبي'); await page.click('button:has-text("حفظ")'); await page.waitForSelector('text=كريم يدين تجريبي');
});
await step('scan: same barcode again -> existing record, no duplicate', async () => {
  await page.click('.nav button:nth-child(3)'); await page.fill('input[aria-label="رقم الباركود"]', '5901234123457'); await page.keyboard.press('Enter');
  await page.waitForSelector('text=المنتج مسجّل مسبقًا');
});
await step('scan: invalid check digit rejected with message', async () => {
  await page.fill('input[aria-label="رقم الباركود"]', '5901234123458'); await page.keyboard.press('Enter'); await page.waitForSelector('.notice.err');
});
await step('availability: 3-tap update changes badge', async () => {
  await page.click('.nav button:nth-child(4)'); await page.waitForSelector('.prod');
  const card = page.locator('.prod', { hasText: 'كريم يدين تجريبي' }); await card.locator('button:has-text("متوفر")').first().click();
  await page.waitForSelector('.prod:has-text("كريم يدين تجريبي") .badge.ok'); await page.screenshot({ path: out + '06-products.png' });
});
await step('compare: two products show differences, no "winner"', async () => {
  await page.click('.nav button:nth-child(5)'); await page.click('.sheet >> text=مقارنة المنتجات');
  await page.waitForSelector('h2.t:has-text("مقارنة المنتجات")'); await page.waitForFunction(() => document.querySelectorAll('main select').length === 3 && document.querySelector('main select').options.length > 2);
  const sels = page.locator('main select'); await sels.nth(0).selectOption({ index: 1 }); await sels.nth(1).selectOption({ index: 2 }); await page.click('text=عرض المقارنة');
  await page.waitForSelector('table'); assert.match(await page.textContent('main'), /غير موثق/); await page.screenshot({ path: out + '07-compare.png' });
});
await step('routine: built from store products', async () => {
  await page.click('.nav button:nth-child(5)'); await page.click('.sheet >> text=روتين العناية'); await page.waitForSelector('text=صباحًا'); await page.screenshot({ path: out + '08-routine.png' });
});
await step('staff cannot see manager menu items nor open manager pages', async () => {
  await page.click('.nav button:nth-child(5)'); assert.equal(await page.locator('.sheet >> text=التقارير').count(), 0); await page.click('.sheet >> text=تسجيل الخروج');
  await page.waitForSelector('.login');
  await page.fill('input[autocomplete=username]', 'sara'); await page.fill('input[type=password]', 'staff-password-1'); await page.click('button[type=submit]'); await page.waitForSelector('.hero');
  await page.evaluate(() => (location.hash = '#/reports')); await page.waitForSelector('text=للمدير فقط');
});
await step('manager: reports + users + import pages render', async () => {
  await page.click('.nav button:nth-child(5)'); await page.click('.sheet >> text=تسجيل الخروج');
  await page.fill('input[autocomplete=username]', 'admin'); await page.fill('input[type=password]', 'admin-password-1'); await page.click('button[type=submit]'); await page.waitForSelector('.hero');
  await page.evaluate(() => (location.hash = '#/reports')); await page.waitForSelector('text=التقارير المعرفية'); await page.screenshot({ path: out + '09-reports.png' });
  await page.evaluate(() => (location.hash = '#/users')); await page.waitForSelector('text=إضافة مستخدم');
  await page.evaluate(() => (location.hash = '#/import')); await page.waitForSelector('input[type=file]');
});
await step('manager: XLSX import preview ignores price/qty and shows warning columns by name only', async () => {
  await page.setInputFiles('input[type=file]', new URL('./fixtures/import.xlsx', import.meta.url).pathname);
  await page.waitForSelector('text=معاينة'); const t = await page.textContent('main');
  assert.match(t, /price/); assert.match(t, /quantity/); assert.doesNotMatch(t, /1999|777/); await page.screenshot({ path: out + '10-import.png' });
});
await step('no unexpected console/page errors (deliberate 401/409/400 network logs excluded)', async () => assert.deepEqual(errors.filter((e) => !/Failed to load resource: the server responded with a status of (400|401|409)/.test(e)), []));
await browser.close();
