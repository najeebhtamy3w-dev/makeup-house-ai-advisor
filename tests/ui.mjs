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
  await page.waitForSelector('text=نتيجة البحث العالمي'); assert.match(await page.textContent('main'), /مسودات غير معتمدة/); assert.match(await page.textContent('main'), /تم العثور على منتج محتمل · تم حفظ المسودة · بانتظار اعتماد المدير/); assert.match(await page.textContent('main'), /بيانات وهمية|MOCK/); await page.screenshot({ path: out + '05-scan-new.png' });
  await page.click('text=إنشاء بطاقة ومراجعتها'); await page.waitForSelector('h2:has-text("منتج جديد")');
  assert.equal(await page.inputValue('#f-barcode'), '5901234123457');
  assert.equal(await page.locator('#f-name').inputValue(), 'Demo Gentle Moisturizer', 'name prefilled from DRAFT'); assert.equal(await page.locator('#f-ingredients').inputValue(), '', 'unreviewed ingredients are NOT copied');
  await page.locator('#f-name').fill('كريم يدين تجريبي'); await page.click('button:has-text("حفظ البطاقة")'); await page.waitForSelector('h2:has-text("كريم يدين تجريبي")');
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
  await page.waitForFunction(() => document.querySelectorAll('.bub.res').length && !document.querySelector('.bub.res .skel')); const t = await page.textContent('.msgs'); assert.match(t, /الملاءمة:\s*قد يكون مناسبًا مع احتياطات/); assert.match(t, /FORMULATION NOT VERIFIED/); assert.ok(!/مناسب وفق المعلومات المتاحة/.test(t), 'a partial formulation is never rated suitable');
});
await step('advisor: "does it contain fragrance?" on an unverified list answers UNKNOWN, never "fragrance-free"; details explain used/missing info', async () => {
  await page.fill('.composer input', 'هل كريم يدين (معدّل) فيه عطر؟'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => /حالة العطر غير معروفة/.test([...document.querySelectorAll('.bub.res')].pop().textContent));
  const last = await page.locator('.bub.res').last().textContent(); assert.ok(!/لا يظهر عطر/.test(last), last);
  await page.fill('.composer input', 'مرطب كريم للبشرة الجافة'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('.bub.res h3').length >= 2);
  const d = page.locator('details.why').last(); await d.locator('summary').click(); assert.match(await d.textContent(), /المعلومات المستخدمة/); assert.match(await d.textContent(), /حدود المعلومة/);
  await d.scrollIntoViewIfNeeded(); await page.screenshot({ path: out + '16-advisor-explained.png' });
});
// ---- CP04: product form + images (manager session) ----
const PNG_B64 = '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';
const pickFile = async (button, file) => { const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click(button)]); await fc.setFiles(file); return fc; };
await step('product form: never shows "null"; sanitises ?barcode=null; sections + required/optional marks', async () => {
  await page.evaluate(() => (location.hash = '#/product-new?barcode=null')); await page.waitForSelector('#f-name');
  assert.equal(await page.inputValue('#f-barcode'), ''); assert.doesNotMatch(await page.textContent('main'), /\bnull\b|undefined|\[object/);
  for (const sec of ['التعرف على المنتج', 'الهوية والتصنيف', 'المكونات ومحتوى العبوة', 'الاستخدام والفوائد والتحذيرات', 'المصادر والتوثيق']) assert.match(await page.textContent('main'), new RegExp(sec));
  assert.match(await page.textContent('.field[data-field=name] label'), /مطلوب/); assert.match(await page.textContent('.field[data-field=brand] label'), /اختياري/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  await page.screenshot({ path: out + '17-product-new.png', fullPage: true });
});
await step('product form: inline validation (empty name, bad check digit) without a server round-trip', async () => {
  let posted = 0; const h = (r) => { if (r.method() === 'POST' && r.url().endsWith('/api/products')) posted++; }; page.on('request', h);
  await page.fill('#f-barcode', '5901234123458'); await page.click('button:has-text("حفظ البطاقة")');
  await page.waitForSelector('.field.bad[data-field=name]'); assert.match(await page.textContent('.field[data-field=name] .ferr'), /اسم المنتج/);
  assert.match(await page.textContent('.field[data-field=barcode] .ferr'), /رقم التحقق/); assert.equal(posted, 0); page.off('request', h);
  await page.screenshot({ path: out + '18-product-validation.png', fullPage: true });
});
await step('images: gallery pick -> preview (size info) -> staged on new product -> uploaded on save -> shown on card, list and advisor', async () => {
  await page.fill('#f-barcode', ''); await page.fill('#f-name', 'مرطب بصورة (تجريبي)'); await page.fill('#f-ingredients', 'Aqua, Glycerin');
  await pickFile('button:has-text("من المعرض")', { name: 'p.png', mimeType: 'image/png', buffer: Buffer.from(PNG_B64, 'base64') });
  await page.waitForSelector('.imgprev img'); assert.match(await page.textContent('.imgprev'), /64×48/);
  await page.screenshot({ path: out + '19-image-preview.png' });
  await page.click('.imgprev >> text=حفظ الصورة'); await page.waitForSelector('.imgitem >> text=تُرفع بعد الحفظ');
  await page.click('button:has-text("حفظ البطاقة")'); await page.waitForSelector('h2:has-text("مرطب بصورة")');
  await page.waitForFunction(() => [...document.querySelectorAll('.imgitem img')].some((i) => i.src.startsWith('blob:') && i.naturalWidth > 0));
  await page.waitForFunction(() => { const i = document.querySelector('.phead .th img'); return i && i.naturalWidth > 0; });
  const id = Number((await page.evaluate(() => location.hash)).split('/')[2]); const imgs = (await apiGet(`/api/products/${id}/images`)).images;
  assert.equal(imgs.length, 1); assert.equal(imgs[0].origin, 'upload'); assert.equal(imgs[0].is_primary, 1); assert.ok(['image/webp', 'image/jpeg'].includes(imgs[0].mime), 're-encoded (metadata stripped)');
  await page.screenshot({ path: out + '20-product-with-image.png', fullPage: true });
  await page.click('.imgopen'); await page.waitForFunction(() => { const i = document.querySelector('.sheet.viewer img'); return i && i.naturalWidth > 0; }); await page.click('.sheet.viewer >> text=إغلاق');
  await page.evaluate(() => (location.hash = '#/products')); await page.fill('input[type=search]', 'مرطب بصورة');
  await page.waitForFunction(() => { const i = document.querySelector('.grid .card .th img'); return i && i.naturalWidth > 0; });
  await page.evaluate(() => (location.hash = '#/advisor')); await page.waitForSelector('.composer input'); await page.fill('.composer input', 'مرطب'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => [...document.querySelectorAll('.bub.res .th img')].some((i) => i.naturalWidth > 0), null, { timeout: 10000 });
});
await step('images: camera button asks for the rear camera; non-image files are refused with a message', async () => {
  await page.evaluate(() => (location.hash = '#/product-new')); await page.waitForSelector('#f-name');
  const fc = await pickFile('button:has-text("تصوير العبوة")', { name: 'x.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  assert.equal(await fc.element().getAttribute('capture'), 'environment');
  await page.waitForSelector('#toast >> text=نوع الملف غير مدعوم'); assert.equal(await page.$('.imgprev'), null);
});
// ---- CP05: smart entry, completion of imported products, filters, import preview (manager, MH_ENRICH=mock) ----
await step('CP05 new product: identify by barcode -> store first, then source drafts; identity copied into the form only on request', async () => {
  await page.evaluate(() => { sessionStorage.removeItem('mh_new_product_draft'); location.hash = '#/product-new'; }); await page.waitForSelector('#f-name');
  const order = await page.evaluate(() => [...document.querySelectorAll('.fsec-t')].map((e) => e.textContent.trim()));
  assert.match(order[0], /التعرف على المنتج/); assert.ok(await page.$('.fsec:first-of-type .imgmgr'), 'photo area is in the first section');
  await page.fill('#f-barcode', '4006381333931'); await page.click('button:has-text("التعرف وجلب المعلومات")');
  await page.waitForSelector('.disc .cand'); const t = await page.textContent('.disc');
  assert.match(t, /مسودات غير معتمدة/); assert.match(t, /Demo Scented Cream/); assert.match(t, /لا يوفر المصدر/);
  assert.equal(await page.inputValue('#f-name'), '', 'nothing copied automatically');
  await page.locator('.disc .cand', { has: page.locator('b:text-is("الاسم")') }).locator('button:has-text("استخدام في النموذج")').click();
  assert.equal(await page.inputValue('#f-name'), 'Demo Scented Cream'); assert.equal(await page.inputValue('#f-ingredients'), '', 'ingredients are never copied into the form');
  await page.screenshot({ path: out + '22-identify-barcode.png', fullPage: true });
  await page.click('button:has-text("حفظ البطاقة")'); await page.waitForSelector('h2:has-text("Demo Scented Cream")');
});
await step('CP05 product card: pending drafts for THIS record; manager approves ingredients there; no new product created', async () => {
  const before = (await apiGet('/api/products?limit=500')).products.length;
  await page.waitForSelector('.disc h4:has-text("اقتراحات بانتظار المراجعة")');
  const ing = page.locator('.disc .cand', { has: page.locator('b:text-is("المكونات")') }); await ing.locator('button:has-text("اعتماد")').click();
  const p = await until(async () => { const x = (await apiGet('/api/products?q=4006381333931')).products[0]; return /Parfum/.test(x.ingredients) ? x : null; });
  assert.equal(p.verification, 'partial'); assert.equal((await apiGet('/api/products?limit=500')).products.length, before);
  await page.waitForSelector('h2:has-text("Demo Scented Cream")'); assert.match(await page.textContent('.phead'), /اكتمال البيانات/);
});
await step('CP05 import preview UI: stats, missing data allowed, commit; imported product can be completed in place', async () => {
  await page.evaluate(() => (location.hash = '#/import')); await page.waitForSelector('input[type=file]');
  const csv = 'barcode,name,brand,category,size,price\n,منتج مستورد بلا صورة,,skincare,,10\n,منتج مستورد بلا صورة,,skincare,,10\n';
  await page.setInputFiles('input[type=file]', { name: 'p.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.waitForSelector('text=معاينة — لم يُحفظ شيء بعد'); assert.match(await page.textContent('main'), /مكرر في الملف/); assert.match(await page.textContent('main'), /price/);
  await page.screenshot({ path: out + '23-import-preview.png', fullPage: true });
  await page.click('button:has-text("اعتماد:")'); await page.waitForSelector('text=تم الاستيراد');
  const p = (await apiGet('/api/products?q=' + encodeURIComponent('منتج مستورد بلا صورة'))).products; assert.equal(p.length, 1); assert.equal(p[0].category, 'العناية بالبشرة');
  await page.evaluate((id) => (location.hash = '#/product/' + id), p[0].id); await page.waitForSelector('button:has-text("استكمال معلومات المنتج من الإنترنت")');
  assert.ok(await page.$('.imgmgr button:has-text("تصوير العبوة")'), 'camera available on an imported product');
  await page.click('button:has-text("استكمال معلومات المنتج من الإنترنت")'); await page.waitForSelector('.disc .notice');
  assert.match(await page.textContent('.disc'), /لا يدعم البحث بالاسم|مرشح|غير مفعّل/);
  assert.equal((await apiGet('/api/products?q=' + encodeURIComponent('منتج مستورد بلا صورة'))).products.length, 1, 'completion never creates a product');
  await page.screenshot({ path: out + '24-imported-complete.png', fullPage: true });
});
await step('CP05 filters: without image / missing info / pending suggestions', async () => {
  await page.evaluate(() => (location.hash = '#/products')); await page.waitForSelector('.chip');
  await page.click('.chip:has-text("بدون صورة")'); await page.waitForFunction(() => document.querySelectorAll('.grid .card').length > 0);
  assert.ok((await page.textContent('.grid')).includes('منتج مستورد بلا صورة'));
  await page.click('.chip:has-text("معلومات ناقصة")'); await page.waitForFunction(() => document.querySelector('.grid .card .compl'));
  await page.screenshot({ path: out + '25-filters.png', fullPage: true });
});
await step('CP05 no lost work: unsaved new-product fields survive navigation', async () => {
  await page.evaluate(() => { sessionStorage.removeItem('mh_new_product_draft'); location.hash = '#/product-new'; }); await page.waitForSelector('#f-name');
  await page.fill('#f-name', 'مسودة لم تُحفظ'); await page.evaluate(() => (location.hash = '#/home')); await page.waitForSelector('.hero');
  await page.evaluate(() => (location.hash = '#/product-new')); await page.waitForSelector('#f-name');
  assert.equal(await page.inputValue('#f-name'), 'مسودة لم تُحفظ'); await page.evaluate(() => sessionStorage.removeItem('mh_new_product_draft'));
});
await step('Samsung checklist: items listed, an answer is stored and also becomes a feedback note', async () => {
  await page.evaluate(() => { localStorage.removeItem('mh_feedback_v1'); localStorage.removeItem('mh_checklist_v1'); location.hash = '#/checklist'; }); await page.waitForSelector('.ck');
  assert.ok((await page.$$('.ck')).length >= 12); assert.match(await page.textContent('main'), /تصوير العبوة/);
  const item = page.locator('.ck[data-item=camera]'); await item.locator('input').fill('فتحت الخلفية'); await item.locator('button:has-text("نجح")').click();
  await page.waitForSelector('.ck[data-item=camera] .badge.ok'); const notes = await page.evaluate(() => JSON.parse(localStorage.getItem('mh_feedback_v1') || '[]'));
  assert.equal(notes.length, 1); assert.match(notes[0].feature, /تصوير العبوة/); assert.equal(notes[0].actual, 'فتحت الخلفية');
  await page.screenshot({ path: out + '21-checklist.png', fullPage: true });
  await page.evaluate(() => { localStorage.removeItem('mh_feedback_v1'); localStorage.removeItem('mh_checklist_v1'); });
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
