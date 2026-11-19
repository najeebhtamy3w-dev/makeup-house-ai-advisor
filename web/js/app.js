import { api, setToken, getToken, setUnauthorizedHandler } from './api.js';
import { h, $, toast, field } from './util.js';
import { home, products, productEdit, scan, go } from './views-core.js';
import { advisor, compare, routine, requestForm } from './views-advisor.js';
import { importView, reports, users, academy } from './views-admin.js';
import { review } from './views-review.js';
import { getEnrich } from './views-core.js';
import { feedback, checklist } from './views-feedback.js';
import { loadTaxonomy } from './taxonomy.js';
import { icon } from './icons.js';
import { productHelp } from './views-core.js';

const app = $('#app');
let me = null;
// Public, data-free metadata: version + whether this is the protected cloud STAGING copy (shows a permanent warning banner).
let meta = null;
const metaReady = fetch('/api/meta').then((r) => r.json()).then((m) => (meta = m)).catch(() => null);
const stagingBanner = () => (meta?.staging ? h('div', { class: 'notice warn staging-banner', role: 'note' }, meta.notice, getToken() ? h('div', { style: 'margin-top:6px' }, h('a', { href: '#/checklist' }, '☑ قائمة اختبار Samsung')) : null) : null);
const MAIN = [['home', '⌂', 'الرئيسية'], ['advisor', '✦', 'المستشار'], ['scan', '▥', 'مسح'], ['products', '◈', 'المنتجات']];
const MORE = [['compare', '⚖', 'مقارنة المنتجات'], ['routine', '☼', 'روتين العناية'], ['request', '⌕', 'طلب غير ملبّى'], ['academy', '♧', 'الأكاديمية'], ['checklist', '☑', 'قائمة اختبار Samsung'], ['feedback', '✎', 'ملاحظات التجربة'],
  ['review', '✔', 'مراجعة المعلومات', true], ['import', '⇧', 'استيراد Excel / CSV', true], ['reports', '▤', 'التقارير', true], ['users', '⚙', 'الموظفون والصلاحيات', true]];
const TITLES = { home: 'الرئيسية', advisor: 'المستشار', scan: 'مسح منتج', products: 'المنتجات', product: 'المنتج', 'product-new': 'منتج جديد', compare: 'المقارنة', routine: 'روتين العناية', request: 'طلب غير ملبّى', academy: 'الأكاديمية', feedback: 'ملاحظات التجربة', checklist: 'اختبار Samsung', review: 'مراجعة المعلومات', import: 'الاستيراد', reports: 'التقارير', users: 'الموظفون' };

setUnauthorizedHandler(() => { me = null; render(); });

function loginView() {
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

async function render() {
  await metaReady;
  if (!getToken()) { loginView(); return; }
  if (!me) { try { me = (await api('GET', '/api/auth/me')).user; } catch { loginView(); return; } }
  await loadTaxonomy().catch(() => {});
  const [, route = 'home', arg] = (location.hash.split('?')[0] || '#/home').split('/');
  const params = new URLSearchParams(location.hash.split('?')[1] ?? '');
  const main = h('main', { id: 'main' });
  const nav = h('nav', { class: 'nav', 'aria-label': 'التنقل' }, MAIN.map(([id, ico, label]) => h('button', { class: route === id ? 'on' : '', onclick: () => go('#/' + id) }, h('b', {}, ico), label)),
    h('button', { class: MORE.some((m) => m[0] === route) ? 'on' : '', onclick: openMore }, h('b', {}, '☰'), 'المزيد'));
  if (me.role === 'manager') getEnrich().then((st) => { if (st.pending_candidates && nav.isConnected) nav.lastChild.append(h('i', { class: 'dot', title: 'مراجعة معلقة' })); });
  // CP05.3: product entry is a focused task screen — brand header with back + help, no bottom nav (the save bar takes its place)
  const focus = route === 'product-new';
  document.body.classList.toggle('focusmode', focus);
  const header = focus
    ? h('header', { class: 'top accent' }, h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'مساعدة', onclick: productHelp }, icon('help', 26)), h('h1', {}, 'منتج جديد'),
        h('button', { class: 'iconbtn backbtn', type: 'button', 'aria-label': 'رجوع إلى المنتجات', onclick: () => go('#/products') }, h('span', {}, 'منتجات'), icon('back', 24)))
    : h('header', { class: 'top' }, h('h1', {}, TITLES[route] ?? 'MAKEUP HOUSE'), h('div', { class: 'who' }, me.display_name, h('span', { class: 'badge' }, me.role === 'manager' ? 'مدير' : 'موظف')));
  app.replaceChildren(...(focus ? [header, main] : [header, main, nav]));
  if (meta?.staging) main.append(focus ? h('div', { class: 'stagingline staging-banner', role: 'note', title: meta.notice }, 'ⓘ نسخة تجريبية — البيانات وهمية وقد تُحذف') : stagingBanner());
  const managerOnly = ['import', 'reports', 'users', 'review'];
  if (managerOnly.includes(route) && me.role !== 'manager') { main.append(h('div', { class: 'notice err' }, 'هذه الصفحة للمدير فقط.')); return; }
  switch (route) {
    case 'home': return home(main, me);
    case 'advisor': return advisor(main);
    case 'scan': return scan(main, me);
    case 'products': return products(main, params);
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
    case 'review': return review(main);
    default: main.append(h('div', { class: 'notice' }, 'الصفحة غير موجودة.'));
  }
}
window.addEventListener('hashchange', render);
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('/sw.js').catch(() => {});
render();
