import { api, setToken, getToken, setUnauthorizedHandler } from './api.js';
import { h, $, toast, field } from './util.js';
import { home, products, productEdit, scan, go } from './views-core.js';
import { advisor, compare, routine, requestForm } from './views-advisor.js';
import { importView, reports, users, academy } from './views-admin.js';

const app = $('#app');
let me = null;
const MAIN = [['home', '⌂', 'الرئيسية'], ['advisor', '✦', 'المستشار'], ['scan', '▥', 'مسح'], ['products', '◈', 'المنتجات']];
const MORE = [['compare', '⚖', 'مقارنة المنتجات'], ['routine', '☼', 'روتين العناية'], ['request', '⌕', 'طلب غير ملبّى'], ['academy', '♧', 'الأكاديمية'],
  ['import', '⇧', 'استيراد Excel / CSV', true], ['reports', '▤', 'التقارير', true], ['users', '⚙', 'الموظفون والصلاحيات', true]];
const TITLES = { home: 'الرئيسية', advisor: 'المستشار', scan: 'مسح منتج', products: 'المنتجات', product: 'المنتج', 'product-new': 'منتج جديد', compare: 'المقارنة', routine: 'روتين العناية', request: 'طلب غير ملبّى', academy: 'الأكاديمية', import: 'الاستيراد', reports: 'التقارير', users: 'الموظفون' };

setUnauthorizedHandler(() => { me = null; render(); });

function loginView() {
  const u = h('input', { autocomplete: 'username', dir: 'ltr', autocapitalize: 'none' }), p = h('input', { type: 'password', autocomplete: 'current-password' }); const err = h('div', {});
  const submit = async (e) => {
    e.preventDefault(); err.replaceChildren();
    try { const r = await api('POST', '/api/auth/login', { username: u.value.trim(), password: p.value }); setToken(r.token); me = r.user; location.hash = '#/home'; render(); }
    catch (x) { err.replaceChildren(h('div', { class: 'notice err' }, x.message)); }
  };
  app.replaceChildren(h('form', { class: 'login', onsubmit: submit }, h('div', { class: 'logo' }, h('b', {}, '✦'), h('strong', {}, 'MAKEUP HOUSE'), h('div', { class: 'tiny muted' }, 'مستشار الجمال — للموظفين فقط')),
    h('div', { class: 'card' }, field('اسم المستخدم', u), field('كلمة المرور', p), err, h('button', { class: 'btn', style: 'width:100%', type: 'submit' }, 'دخول'))));
}

function openMore() {
  const sheet = h('div', { class: 'sheet', onclick: (e) => { if (e.target === sheet) sheet.remove(); } }, h('div', {},
    MORE.filter((m) => !m[3] || me.role === 'manager').map(([id, ico, label]) => h('button', { class: 'item', onclick: () => { sheet.remove(); go('#/' + id); } }, h('b', {}, ico), label)),
    h('button', { class: 'item', onclick: async () => { sheet.remove(); setToken(null); me = null; render(); } }, h('b', {}, '⏻'), 'تسجيل الخروج')));
  document.body.append(sheet);
}

async function render() {
  if (!getToken()) { loginView(); return; }
  if (!me) { try { me = (await api('GET', '/api/auth/me')).user; } catch { loginView(); return; } }
  const [, route = 'home', arg] = (location.hash.split('?')[0] || '#/home').split('/');
  const params = new URLSearchParams(location.hash.split('?')[1] ?? '');
  const main = h('main', { id: 'main' });
  const nav = h('nav', { class: 'nav', 'aria-label': 'التنقل' }, MAIN.map(([id, ico, label]) => h('button', { class: route === id ? 'on' : '', onclick: () => go('#/' + id) }, h('b', {}, ico), label)),
    h('button', { class: MORE.some((m) => m[0] === route) ? 'on' : '', onclick: openMore }, h('b', {}, '☰'), 'المزيد'));
  app.replaceChildren(h('header', { class: 'top' }, h('h1', {}, TITLES[route] ?? 'MAKEUP HOUSE'), h('div', { class: 'who' }, me.display_name, h('span', { class: 'badge' }, me.role === 'manager' ? 'مدير' : 'موظف'))), main, nav);
  const managerOnly = ['import', 'reports', 'users'];
  if (managerOnly.includes(route) && me.role !== 'manager') { main.append(h('div', { class: 'notice err' }, 'هذه الصفحة للمدير فقط.')); return; }
  switch (route) {
    case 'home': return home(main);
    case 'advisor': return advisor(main);
    case 'scan': return scan(main, me);
    case 'products': return products(main);
    case 'product': return productEdit(main, Number(arg), me);
    case 'product-new': return productEdit(main, null, me, { barcode: params.get('barcode') ?? '' });
    case 'compare': return compare(main);
    case 'routine': return routine(main);
    case 'request': return requestForm(main, params);
    case 'academy': return academy(main);
    case 'import': return importView(main);
    case 'reports': return reports(main);
    case 'users': return users(main);
    default: main.append(h('div', { class: 'notice' }, 'الصفحة غير موجودة.'));
  }
}
window.addEventListener('hashchange', render);
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('/sw.js').catch(() => {});
render();
