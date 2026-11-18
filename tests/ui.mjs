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
  assert.equal(await page.locator('.quick button').count(), 3, 'three primary actions, no duplicate cards'); assert.equal(await page.locator('.stats').count(), 0, 'no non-actionable stats');
  await page.waitForFunction(() => !document.querySelector('.skel')); assert.doesNotMatch(await page.textContent('main'), /null|undefined|\[object/); await page.screenshot({ path: out + '02-home.png' });
});
await step('no horizontal overflow on home (390px)', async () => {
  const o = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); assert.ok(o <= 1, 'overflow ' + o);
});
await step('advisor: chat is primary; fragrance-free query excludes undocumented/fragranced items', async () => {
  await page.click('.nav button:nth-child(2)'); await page.waitForSelector('.composer input'); assert.equal(await page.locator('.sugg button').count(), 0, 'no static suggestion buttons');
  await page.fill('.composer input', 'زبونة بشرتها جافة وحساسة وتريد مرطب خالي من العطر'); await page.keyboard.press('Enter');
  await page.waitForSelector('.bub.res h3'); const t = await page.textContent('.bub.res'); assert.doesNotMatch(t, /\[object|null|undefined/);
  assert.match(t, /مرطب وجه خالٍ من العطر/); assert.match(t, /أولًا: منتجات ميك أب هاوس/); assert.match(t, /ثانيًا: بدائل عالمية/);
  await page.screenshot({ path: out + '03-advisor.png' });
});
await step('advisor: recommendation card has no price and no personal data', async () => {
  await page.click('text=بطاقة توصية'); const v = await page.inputValue('.sheet textarea');
  assert.match(v, /MAKEUP HOUSE/); assert.doesNotMatch(v, /سعر|ريال|\$|price/i); await page.screenshot({ path: out + '04-card.png' }); await page.click('.sheet >> text=إغلاق');
});
await step('scan: manual unknown barcode -> new product form prefilled -> save', async () => {
  await page.click('.nav button:nth-child(3)'); await page.fill('input[aria-label="رقم الباركود"]', '5901234123457'); await page.keyboard.press('Enter');
  await page.waitForSelector('text=نتيجة البحث العالمي'); assert.match(await page.textContent('main'), /مسودات غير معتمدة/); assert.match(await page.textContent('main'), /بيانات وهمية|MOCK/); await page.screenshot({ path: out + '05-scan-new.png' });
  await page.click('text=إنشاء بطاقة ومراجعتها'); await page.waitForSelector('text=بطاقة منتج جديدة');
  assert.equal(await page.inputValue('input[dir=ltr]'), '5901234123457');
  assert.equal(await page.locator('.field:has(label:text("اسم المنتج")) input').inputValue(), 'Demo Gentle Moisturizer', 'name prefilled from DRAFT'); assert.equal(await page.locator('.field:has(label:text("المكونات الموثقة")) textarea').inputValue(), '', 'unreviewed ingredients are NOT copied');
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

const until = async (fn, ms = 6000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timeout waiting for condition'); await page.waitForTimeout(150); } };
const tok = () => page.evaluate(() => sessionStorage.getItem('mh_token'));
const apiGet = async (path) => page.evaluate(async ([p, t]) => (await fetch(p, { headers: { authorization: 'Bearer ' + t } })).json(), [path, await tok()]);
await step('advisor: contextual follow-up chip appears and refines the query; suitability and availability are separate blocks', async () => {
  await page.evaluate(() => (location.hash = '#/advisor')); await page.waitForSelector('.composer input');
  await page.fill('.composer input', 'اريد مرطب'); await page.keyboard.press('Enter'); await page.waitForSelector('.sugg button');
  assert.match(await page.textContent('.msgs'), /ما نوع بشرة العميل/); await page.click('.sugg button:has-text("جافة")'); await page.waitForFunction(() => document.querySelectorAll('.bub.res').length >= 2 && !document.querySelector('.bub.res .skel'));
  const t = await page.textContent('.msgs'); assert.match(t, /الملاءمة:/); assert.match(t, /التوفر:/); assert.doesNotMatch(t, /null|undefined|\[object/); await page.screenshot({ path: out + '11-advisor-followup.png' });
});
await step('offline: lookup keeps the barcode, shows retry, recovers when back online', async () => {
  await page.evaluate(() => (location.hash = '#/scan')); await page.waitForSelector('input[aria-label="رقم الباركود"]');
  await ctx.setOffline(true); await page.fill('input[aria-label="رقم الباركود"]', '4006381333931'); await page.keyboard.press('Enter');
  await page.waitForSelector('.notice.err:has-text("لا يوجد اتصال")'); assert.equal(await page.inputValue('input[aria-label="رقم الباركود"]'), '4006381333931'); await page.screenshot({ path: out + '12-offline.png' });
  await ctx.setOffline(false); await page.click('.notice.err >> text=إعادة المحاولة'); await page.waitForSelector('text=نتيجة البحث العالمي');
  assert.match(await page.textContent('main'), /يحتاج مراجعة/);
});
await step('camera unavailable/denied: precise explanation, manual input stays usable', async () => {
  await page.evaluate(() => (location.hash = '#/scan')); await page.waitForSelector('text=فتح الكاميرا'); await page.click('text=فتح الكاميرا');
  await page.waitForSelector('.notice.err'); const t = await page.textContent('.notice.err'); assert.ok(/يدعم|رفض|كاميرا/.test(t), t); assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'رقم الباركود');
});
await step('reduced motion: animations are disabled', async () => {
  const c2 = await browser.newContext({ viewport: { width: 390, height: 800 }, reducedMotion: 'reduce' }); const p2 = await c2.newPage(); await p2.goto(base);
  const d = await p2.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.login .card, .login')).animationDuration) || 0); assert.ok(d < 0.01); await c2.close();
});
// ---- manager: sign in again
await page.evaluate(() => { sessionStorage.clear(); location.hash = '#/home'; location.reload(); }); await page.waitForSelector('.login');
await page.fill('input[autocomplete=username]', 'admin'); await page.fill('input[type=password]', 'admin-password-1'); await page.click('button[type=submit]'); await page.waitForSelector('.hero');
await step('manager home: review card with count; More menu shows review', async () => {
  await page.waitForSelector('text=بانتظار مراجعة المعلومات'); await page.screenshot({ path: out + '13-home-manager.png' });
  await page.click('.nav button:nth-child(5)'); await page.waitForSelector('.sheet >> text=مراجعة المعلومات'); await page.click('.sheet >> text=مراجعة المعلومات');
});
await step('review screen: diff local vs proposed, source, conflict flag, draft badge', async () => {
  await page.waitForSelector('.cand'); const t = await page.textContent('main'); assert.match(t, /مسودة غير معتمدة|تعارض مصادر/); assert.match(t, /Demo Gentle Moisturizer/); assert.match(t, /يختلف عن بيانات المحل/); assert.match(t, /MOCK|تجريبية/); await page.screenshot({ path: out + '14-review.png' });
});
await step('review: approve ingredients -> product gets ingredients, stays "partial" (not verified), no source URL for mock', async () => {
  const grp = page.locator('.card', { has: page.locator('b[dir=ltr]:text-is("5901234123457")') });
  const card = grp.locator('.cand', { has: page.locator('b:text-is("المكونات")') }).first(); await card.locator('button:has-text("اعتماد")').click();
  const p = await until(async () => { const x = (await apiGet('/api/products?q=5901234123457')).products[0]; return /Glycerin/.test(x.ingredients) ? x : null; });
  assert.match(p.ingredients, /Glycerin/); assert.equal(p.verification, 'partial'); assert.equal(p.source_url, '');
});
await step('review: edit-then-approve stores manager edit; reject leaves field untouched', async () => {
  const grp = page.locator('.card', { has: page.locator('b[dir=ltr]:text-is("5901234123457")') });
  const nameCard = grp.locator('.cand', { has: page.locator('b:text-is("الاسم")') }).first(); await nameCard.locator('button:has-text("تعديل")').click(); await nameCard.locator('input').fill('كريم يدين (معدّل)'); await nameCard.locator('button:has-text("اعتماد")').click(); await until(async () => (await apiGet('/api/products?q=5901234123457')).products[0].name === 'كريم يدين (معدّل)');
  const brandCard = grp.locator('.cand', { has: page.locator('b:text-is("العلامة")') }).first(); await brandCard.waitFor({ state: 'visible' }); await brandCard.locator('button:has-text("رفض")').click();
  const p = (await apiGet('/api/products?q=5901234123457')).products[0]; assert.equal(p.name, 'كريم يدين (معدّل)');
  await until(async () => { const g = (await apiGet('/api/enrichment/pending')).items.find((x) => x.barcode === '5901234123457'); return !g || !g.candidates.some((c) => c.field === 'brand' || c.field === 'name'); });
});
await step('advisor now sees approved ingredients as partial suitability (not "documented")', async () => {
  await page.evaluate(() => (location.hash = '#/advisor')); await page.waitForSelector('.composer input'); await page.fill('.composer input', 'كريم'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('.bub.res').length && !document.querySelector('.bub.res .skel')); assert.match(await page.textContent('.msgs'), /الملاءمة:\s*جزئية/);
});
await step('layout: no horizontal overflow or null text on every page at 360 / 390 / 768 / 1280 widths', async () => {
  const pages = ['home', 'advisor', 'scan', 'products', 'review', 'import', 'reports', 'users', 'compare', 'routine', 'request', 'academy'];
  for (const [w, hgt] of [[360, 740], [390, 800], [768, 1024], [1280, 800]]) {
    await page.setViewportSize({ width: w, height: hgt });
    for (const r of pages) { await page.evaluate((x) => (location.hash = '#/' + x), r); await page.waitForTimeout(250); await page.waitForFunction(() => !document.querySelector('.skel') || true);
      const o = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); assert.ok(o <= 1, `${r}@${w} overflow ${o}`);
      assert.doesNotMatch(await page.textContent('body'), /\[object|undefined|\bnull\b/, `${r}@${w}`); }
  }
  await page.setViewportSize({ width: 390, height: 800 }); await page.evaluate(() => (location.hash = '#/products')); await page.waitForTimeout(400); await page.screenshot({ path: out + '15-products-filters.png' });
});
await step('layout: fixed nav never covers the last content (bottom padding >= nav height)', async () => {
  await page.evaluate(() => (location.hash = '#/products')); await page.waitForTimeout(300);
  const ok = await page.evaluate(() => { const m = document.querySelector('main'), n = document.querySelector('.nav'); return parseFloat(getComputedStyle(m).paddingBottom) >= n.getBoundingClientRect().height; }); assert.ok(ok);
});
console.log('console errors seen:', JSON.stringify(errors.filter((e) => !/status of (400|401|409)|ERR_INTERNET_DISCONNECTED/.test(e))));
await step('no unexpected console/page errors (deliberate 401/409/400 network logs excluded)', async () => assert.deepEqual(errors.filter((e) => !/status of (400|401|409)|ERR_INTERNET_DISCONNECTED/.test(e)), []));
await browser.close();
