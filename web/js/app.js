import { api, setToken, getToken, setUnauthorizedHandler } from './api.js';
import { h, $, toast, field } from './util.js';
import { home, products, productEdit, scan, go } from './views-core.js';
import { advisor, compare, routine, requestForm } from './views-advisor.js';
import { importView, reports, users, academy } from './views-admin.js';
import { review } from './views-review.js';
import { getEnrich } from './views-core.js';
import { feedback, checklist } from './views-feedback.js';
import { loadTaxonomy } from './taxonomy.js';
// CP06.2: Android-only (local-first) screens load on demand, so the Render build can ship without them
const localViews = () => import('./views-backup.js');
import { icon } from './icons.js';
import { productHelp, goBack, RETURN_KEY, LIST_POS_KEY } from './views-core.js';
import { confirmLeave, clearLeaveGuard, hasUnsavedChanges } from './leave-guard.js';

const app = $('#app');
let me = null;
// Public, data-free metadata: version + whether this is the protected cloud STAGING copy (shows a permanent warning banner).
let meta = null;
// CP06: on the Android build the local database worker must be ready before the first request
const metaReady = Promise.resolve(window.MH_READY).then(() => fetch('/api/meta')).then((r) => r.json()).then((m) => (meta = m)).catch(() => null);
const stagingBanner = () => (meta?.staging ? h('div', { class: 'notice warn staging-banner', role: 'note' }, meta.notice, getToken() ? h('div', { style: 'margin-top:6px' }, h('a', { href: '#/checklist' }, '☑ قائمة اختبار Samsung')) : null) : null);
const MAIN = [['home', '⌂', 'الرئيسية'], ['advisor', '✦', 'المستشار'], ['scan', '▥', 'مسح'], ['products', '◈', 'المنتجات']];
const MORE = [['compare', '⚖', 'مقارنة المنتجات'], ['routine', '☼', 'روتين العناية'], ['request', '⌕', 'طلب غير ملبّى'], ['academy', '♧', 'الأكاديمية'], ['checklist', '☑', 'قائمة اختبار Samsung'], ['feedback', '✎', 'ملاحظات التجربة'],
  ['dashboard', '▦', 'لوحة المدير', true], ['bulk-classify', '☰', 'تصنيف جماعي', true], ['review', '✔', 'مراجعة المعلومات', true], ['evidence', '⧉', 'مراجعة أدلة المصادر', true], ['import', '⇧', 'استيراد Excel / CSV', true], ['reports', '▤', 'التقارير', true], ['users', '⚙', 'الموظفون والصلاحيات', true]];
// CP06: backup / restore exists only where the data lives on the device
MORE.push(['global-products', '◎', 'الكتالوج العالمي', true]);
MORE.push(['inventory', '▦', 'الدفعات والمخزون', true]);
if (window.MH_LOCAL) MORE.push(['backup', '⛁', 'النسخ الاحتياطي والاستعادة', true], ['local-ai', '✧', 'إدارة الذكاء المحلي', true], ['ai-lab', '⚗', 'مختبر النموذج الخام', true]);
const TITLES = { 'ai-lab': 'مختبر النموذج الخام', dashboard: 'لوحة المدير', 'bulk-classify': 'تصنيف جماعي', 'intel-enable': 'المستشار العلمي', intel: 'المستشار', knowledge: 'مراجعة المعرفة', backup: 'النسخ الاحتياطي', home: 'الرئيسية', advisor: 'المستشار', scan: 'مسح منتج', products: 'المنتجات', product: 'المنتج', 'product-new': 'منتج جديد', compare: 'المقارنة', routine: 'روتين العناية', request: 'طلب غير ملبّى', academy: 'الأكاديمية', feedback: 'ملاحظات التجربة', checklist: 'اختبار Samsung', review: 'مراجعة المعلومات', evidence: 'أدلة المصادر', import: 'الاستيراد', reports: 'التقارير', users: 'الموظفون' };

setUnauthorizedHandler(() => { me = null; render(); });

/** CP06 first run on a new phone: no account exists yet -> the person creates the manager account (or restores a backup). */
function setupView() {
  const u = h('input', { autocomplete: 'username', dir: 'ltr', autocapitalize: 'none', id: 'setup-user' }), n = h('input', { id: 'setup-name', placeholder: 'مثال: مدير المحل' });
  const p = h('input', { type: 'password', autocomplete: 'new-password', id: 'setup-pass' }), p2 = h('input', { type: 'password', autocomplete: 'new-password', id: 'setup-pass2' }); const err = h('div', {});
  const submit = async (e) => {
    e.preventDefault(); err.replaceChildren();
    if (p.value !== p2.value) { err.replaceChildren(h('div', { class: 'notice err' }, 'كلمتا المرور غير متطابقتين.')); return; }
    try {
      await api('POST', '/api/local/setup', { username: u.value.trim(), display_name: n.value.trim(), password: p.value });
      const r = await api('POST', '/api/auth/login', { username: u.value.trim(), password: p.value }); setToken(r.token); me = r.user; meta.setup_required = false; location.hash = '#/products'; render();
    } catch (x) { err.replaceChildren(h('div', { class: 'notice err' }, x.message)); }
  };
  app.replaceChildren(h('form', { class: 'login', onsubmit: submit }, h('div', { class: 'logo' }, h('b', {}, '✦'), h('strong', {}, 'MAKEUP HOUSE'), h('div', { class: 'tiny muted' }, 'إعداد التطبيق على هذا الهاتف')),
    h('div', { class: 'notice info' }, 'كل البيانات تُحفظ على هذا الهاتف فقط. أنشئ حساب المدير، ثم أضف حسابات الموظفين من «الموظفون والصلاحيات». خذ نسخة احتياطية بانتظام.'),
    h('div', { class: 'card' }, field('اسم المستخدم للمدير', u), field('الاسم الظاهر', n), field('كلمة المرور (10 أحرف على الأقل)', p), field('تأكيد كلمة المرور', p2), err,
      h('button', { class: 'btn', style: 'width:100%', type: 'submit' }, 'إنشاء حساب المدير')),
    h('p', { class: 'tiny', style: 'text-align:center' }, h('a', { href: '#/restore' }, 'لديّ نسخة احتياطية — استعادتها'))));
}

function loginView() {
  if (meta?.setup_required) { if (location.hash.startsWith('#/restore')) { app.replaceChildren(h('main', { id: 'main' })); localViews().then((m) => m.restoreOnly(app.firstChild)); return; } setupView(); return; }
  const u = h('input', { autocomplete: 'username', dir: 'ltr', autocapitalize: 'none' }), p = h('input', { type: 'password', autocomplete: 'current-password' }); const err = h('div', {});
  const submit = async (e) => {
    e.preventDefault(); err.replaceChildren();
    try { const r = await api('POST', '/api/auth/login', { username: u.value.trim(), password: p.value }); setToken(r.token); me = r.user; location.hash = '#/home'; render(); }
    catch (x) { err.replaceChildren(h('div', { class: 'notice err' }, x.message)); }
  };
  app.replaceChildren(h('form', { class: 'login', onsubmit: submit }, h('div', { class: 'logo' }, h('b', {}, '✦'), h('strong', {}, 'MAKEUP HOUSE'), h('div', { class: 'tiny muted' }, 'مستشار الجمال — للموظفين فقط')),
    stagingBanner(),
    h('div', { class: 'card' }, field('اسم المستخدم', u), field('كلمة المرور', p), err, h('button', { class: 'btn', style: 'width:100%', type: 'submit' }, 'دخول')),
    h('p', { class: 'tiny', style: 'text-align:center' }, h('a', { href: '/device-test.html' }, 'اختبار الكاميرا وقارئ الباركود (لا يحتاج دخولًا)'))));
}

function openMore() {
  const sheet = h('div', { class: 'sheet', onclick: (e) => { if (e.target === sheet) sheet.remove(); } }, h('div', {},
    MORE.filter((m) => !m[3] || me.role === 'manager').map(([id, ico, label]) => h('button', { class: 'item', onclick: () => { sheet.remove(); go('#/' + id); } }, h('b', {}, ico), label)),
    h('button', { class: 'item', onclick: async () => { sheet.remove(); setToken(null); me = null; render(); } }, h('b', {}, '⏻'), 'تسجيل الخروج')));
  document.body.append(sheet);
}

// The main advisor is always available. This feature probe exposes manager knowledge/research administration only.
let cp08Probed = false;
// CP09: re-read after the manager switches the feature on/off — no page reload (a reload is not needed and fails offline in a browser)
window.MH_refreshFeatures = () => { for (const id of ['intel', 'knowledge', 'intel-enable']) { const i = MORE.findIndex((m) => m[0] === id); if (i >= 0) MORE.splice(i, 1); } cp08Probed = false; probeCp08(); };
function probeCp08() {
  if (cp08Probed) return; cp08Probed = true;
  api('GET', '/api/cp08/status').then((st) => { if (!st?.enabled) { if (st?.can_enable) MORE.push(['intel-enable', '✧', 'تفعيل المستشار العلمي', true]); return; } MORE.push(['knowledge', '⚗', 'مراجعة المعرفة العلمية', true]); }).catch(() => {});
}
async function render() {
  await metaReady;
  if (!getToken()) { loginView(); return; }
  if (!me) { try { me = (await api('GET', '/api/auth/me')).user; } catch { loginView(); return; } }
  probeCp08();
  await loadTaxonomy().catch(() => {});
  const [, route = 'home', arg] = (location.hash.split('?')[0] || '#/home').split('/');
  const params = new URLSearchParams(location.hash.split('?')[1] ?? '');
  const main = h('main', { id: 'main' });
  const nav = h('nav', { class: 'nav', 'aria-label': 'التنقل' }, MAIN.map(([id, ico, label]) => h('button', { class: route === id ? 'on' : '', onclick: () => go('#/' + id) }, h('b', {}, ico), label)),
    h('button', { class: MORE.some((m) => m[0] === route) ? 'on' : '', onclick: openMore }, h('b', {}, '☰'), 'المزيد'));
  if (me.role === 'manager') getEnrich().then((st) => { if (st.pending_candidates && nav.isConnected) nav.lastChild.append(h('i', { class: 'dot', title: 'مراجعة معلقة' })); });
  // CP05.3: product entry is a focused task screen — brand header with back + help, no bottom nav (the save bar takes its place)
  // CP05.3: new-product entry is a focused task screen (no bottom bar). CP06.2: the product card keeps the bottom bar (approved
  // CP05.3 behaviour) and gets a visible back button in its header; every way out goes through the unsaved-changes guard.
  const focus = route === 'product-new';
  document.body.classList.toggle('focusmode', focus);
  let back = '#/products'; try { back = sessionStorage.getItem(RETURN_KEY) || back; } catch { /* ignore */ }
  const backLabel = back.startsWith('#/products') ? 'منتجات' : 'رجوع';
  const header = focus
    ? h('header', { class: 'top accent' }, h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'مساعدة', onclick: productHelp }, icon('help', 26)), h('h1', {}, 'منتج جديد'),
        h('button', { class: 'iconbtn backbtn', type: 'button', id: 'back-btn', 'aria-label': 'رجوع إلى المنتجات', onclick: () => go('#/products') }, h('span', {}, 'منتجات'), icon('back', 24)))   // CP05.3 reference: entry goes back to Products
    : route === 'product'
    ? h('header', { class: 'top withback' }, h('button', { class: 'backlink', type: 'button', id: 'back-btn', 'aria-label': backLabel === 'منتجات' ? 'رجوع إلى المنتجات' : 'رجوع', onclick: goBack }, icon('back', 22), h('span', {}, backLabel)),
        h('h1', {}, 'تعديل المنتج'), h('div', { class: 'who' }, h('span', { class: 'badge' }, me.role === 'manager' ? 'مدير' : 'موظف')))
    : h('header', { class: 'top' }, h('h1', {}, TITLES[route] ?? 'MAKEUP HOUSE'), h('div', { class: 'who' }, me.display_name, h('span', { class: 'badge' }, me.role === 'manager' ? 'مدير' : 'موظف')));
  app.replaceChildren(...(focus ? [header, main] : [header, main, nav]));
  if (meta?.staging) main.append(focus ? h('div', { class: 'stagingline staging-banner', role: 'note', title: meta.notice }, 'ⓘ نسخة تجريبية — البيانات قد تُحذف عند إعادة التشغيل') : stagingBanner());
  const managerOnly = ['global-products', 'inventory', 'local-ai', 'ai-lab', 'dashboard', 'bulk-classify', 'import', 'reports', 'users', 'review', 'backup', 'evidence', 'knowledge', 'intel-enable'];
  if (managerOnly.includes(route) && me.role !== 'manager') { main.append(h('div', { class: 'notice err' }, 'هذه الصفحة للمدير فقط.')); return; }
  switch (route) {
    case 'home': return home(main, me);
    case 'global-products': return import('./views-global-products.js').then(m => m.globalProductsView(main));
    case 'inventory': return import('./views-inventory.js').then(m => m.inventoryView(main, me));
    case 'local-ai': return import('./views-local-ai.js').then(m => m.localAISettings(main));
    case 'ai-lab': return import('./views-ai-lab.js').then(m => m.aiLab(main));
    case 'advisor': return advisor(main);
    case 'scan': return scan(main, me);
    case 'products': return products(main, params, me);
    case 'product': return productEdit(main, Number(arg), me);
    case 'product-new': { const b = (params.get('barcode') ?? '').replace(/\D/g, ''); return productEdit(main, null, me, { barcode: b }); }
    case 'compare': return compare(main);
    case 'routine': return routine(main);
    case 'request': return requestForm(main, params);
    case 'academy': return academy(main);
    case 'feedback': return feedback(main, meta);
    case 'checklist': return checklist(main, meta);
    case 'import': return importView(main);
    case 'reports': return reports(main);
    case 'users': return users(main);
    case 'backup': return localViews().then((m) => m.backupView(main, me));
    case 'review': return review(main);
    case 'evidence': return import('./views-evidence.js').then((m) => m.evidenceReview(main));
    case 'intel': return advisor(main); // compatibility alias, same unified core
    case 'knowledge': return import('./views-intel.js').then((m) => m.knowledge(main));
    case 'dashboard': return import('./views-final.js').then((m) => m.dashboard(main));
    case 'bulk-classify': return import('./views-final.js').then((m) => m.bulkClassify(main));
    case 'intel-enable': return import('./views-intel.js').then((m) => m.enableIntel(main));
    default: main.append(h('div', { class: 'notice' }, 'الصفحة غير موجودة.'));
  }
}
// CP06.2 router: nothing leaves a screen with unsaved edits without asking (header, cancel, bottom bar, browser Back/Forward, links)
let shown = location.hash;
const routeOf = (hash) => (hash.split('?')[0] || '#/home').split('/')[1] || 'home';
window.addEventListener('hashchange', async () => {
  const target = location.hash;
  if (target === shown) return;
  if (hasUnsavedChanges()) {
    history.pushState(null, '', shown);   // put the address bar back while the person decides (pushState does not fire hashchange)
    if (await confirmLeave()) location.hash = target;   // re-enters this handler with the guard cleared
    return;
  }
  const from = routeOf(shown), to = routeOf(target);
  try {
    // remember where the person came from, and where they were in the list, so "back" returns to the same place
    if (from === 'products') sessionStorage.setItem(LIST_POS_KEY, JSON.stringify({ y: window.scrollY, n: document.querySelectorAll('.plist .prow').length }));
    if ((to === 'product' || to === 'product-new') && from !== 'product' && from !== 'product-new') sessionStorage.setItem(RETURN_KEY, shown || '#/products');
  } catch { /* storage unavailable: back falls back to the product list */ }
  clearLeaveGuard();
  shown = target;
  render();
});
// CP06.3 — ONE deterministic answer to Android's hardware Back (wired in mobile/src/client.ts through @capacitor/app).
// Never a blind history.back(): open dialog → close it (= keep editing); product screen → its remembered list, through the
// same unsaved-changes guard as every other exit; any other screen → home; home / login → 'exit' (the app is minimised).
export async function handleBack() {
  const sheets = document.querySelectorAll('.sheet');
  if (sheets.length) { const top = sheets[sheets.length - 1]; const stay = top.querySelector('#leave-stay'); if (stay) stay.click(); else top.remove(); return 'handled'; }
  if (!me) return 'exit';
  const route = routeOf(location.hash);
  if (route === 'product' || route === 'product-new') { goBack(); return 'handled'; }
  if (route === 'home') return 'exit';
  go('#/home'); return 'handled';
}
window.MH_onBack = handleBack;
if (!window.MH_LOCAL && 'serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('/sw.js').catch(() => {});
render();
