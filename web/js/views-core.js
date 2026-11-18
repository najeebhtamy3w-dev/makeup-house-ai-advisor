import { api, getToken } from './api.js';
import { h, fill, toast, CATEGORIES, AV, VER, avBadge, verBadge, fmtDate, field, select, debounce } from './util.js';
import { startCamera, cameraSupported } from './scanner.js';

export const go = (hash) => { location.hash = hash; };

/* ---------- shared: availability buttons (no prompt(): 3 clear taps) ---------- */
export function availButtons(p, after) {
  const mk = (st, label) => h('button', { class: 'btn sm ' + ((p.availability === st && !p.availability_stale) ? '' : 'out'), 'aria-pressed': String(p.availability === st), onclick: async () => {
    try { await api('POST', `/api/products/${p.id}/availability`, { status: st }); toast('تم تحديث التوفر'); after?.(); } catch (e) { toast(e.message); }
  } }, label);
  return h('div', { class: 'row' }, mk('yes', 'متوفر'), mk('no', 'غير متوفر'), mk('unknown', 'غير مؤكد'));
}

export function productCard(p, reload) {
  return h('div', { class: 'card prod' },
    h('div', { class: 'row sb' }, h('h4', {}, p.name), avBadge(p)),
    h('p', {}, [p.brand || 'علامة غير محددة', p.size, p.category].filter(Boolean).join(' · ')),
    h('p', {}, verBadge(p.verification), ' ', p.barcode ? h('span', { class: 'tiny' }, p.barcode) : null),
    p.availability_stale ? h('div', { class: 'notice' }, 'آخر تأكيد للتوفر قديم. تأكد من الرف قبل أن تعد العميل.') : null,
    h('p', { class: 'tiny' }, 'آخر تحديث للتوفر: ', fmtDate(p.availability_updated_at)),
    availButtons(p, reload),
    h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'btn sm light', onclick: () => go('#/product/' + p.id) }, 'التفاصيل / تعديل')));
}

/* ---------- home ---------- */
export async function home(root) {
  root.append(
    h('div', { class: 'hero' }, h('h2', {}, 'كيف أقدر أساعدك اليوم؟'), h('p', {}, 'استشارة سريعة، بحث عن منتج، أو مسح باركود.'),
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => go('#/advisor') }, 'ابدأ استشارة'), h('button', { class: 'btn', onclick: () => go('#/scan') }, '＋ إضافة منتج'))),
    h('div', { class: 'quick' },
      h('button', { onclick: () => go('#/scan') }, h('b', {}, '▥'), 'مسح باركود'),
      h('button', { onclick: () => go('#/products') }, h('b', {}, '⌕'), 'بحث المنتجات'),
      h('button', { onclick: () => go('#/compare') }, h('b', {}, '⚖'), 'مقارنة'),
      h('button', { onclick: () => go('#/routine') }, h('b', {}, '☼'), 'روتين العناية')));
  const box = h('div', {}, h('p', { class: 'muted' }, 'جارٍ التحميل…')); root.append(box);
  try {
    const { products } = await api('GET', '/api/products?limit=500');
    const ok = products.filter((p) => p.availability_effective === 'yes').length;
    const stale = products.filter((p) => p.availability_stale).length;
    fill(box,
      h('div', { class: 'stats' },
        h('div', { class: 'stat' }, h('b', {}, products.length), h('small', {}, 'منتجات')),
        h('div', { class: 'stat' }, h('b', {}, ok), h('small', {}, 'متوفر مؤكد')),
        h('div', { class: 'stat' }, h('b', {}, products.filter((p) => p.verification !== 'verified').length), h('small', {}, 'تحتاج مراجعة'))),
      stale ? h('div', { class: 'notice' }, `${stale} منتج توفره المؤكد قديم. أعد التأكد منها قبل الاعتماد عليها.`) : null,
      products.length === 0 ? h('div', { class: 'notice' }, 'المكتبة فارغة. ابدأ بمسح باركود أو اطلب من المدير استيراد ملف الأصناف.') : null,
      h('h2', { class: 't', style: 'margin-top:14px' }, 'أحدث المنتجات'),
      h('div', { class: 'grid c2' }, products.slice(0, 4).map((p) => productCard(p, () => go('#/home')))));
  } catch (e) { box.replaceChildren(h('div', { class: 'notice err' }, e.message)); }
}

/* ---------- products list ---------- */
export async function products(root) {
  const q = h('input', { type: 'search', placeholder: 'ابحث بالاسم أو العلامة أو الباركود', 'aria-label': 'بحث' });
  const av = select([['', 'كل حالات التوفر'], ['yes', 'متوفر'], ['no', 'غير متوفر'], ['unknown', 'غير مؤكد']], '');
  const list = h('div', { class: 'grid c2' });
  const load = async () => {
    const qs = new URLSearchParams({ limit: '100' }); if (q.value.trim()) qs.set('q', q.value.trim()); if (av.value) qs.set('availability', av.value);
    try {
      const { products: ps } = await api('GET', '/api/products?' + qs);
      list.replaceChildren(...(ps.length ? ps.map((p) => productCard(p, load)) : [h('div', { class: 'card muted' }, 'لا توجد نتائج. ', h('button', { class: 'btn sm light', onclick: () => go('#/request?text=' + encodeURIComponent(q.value)) }, 'سجّل كطلب غير ملبّى'))]));
    } catch (e) { list.replaceChildren(h('div', { class: 'notice err' }, e.message)); }
  };
  q.addEventListener('input', debounce(load)); av.addEventListener('change', load);
  root.append(h('div', { class: 'row sb' }, h('h2', { class: 't' }, 'منتجات المكتبة'), h('button', { class: 'btn sm', onclick: () => go('#/scan') }, '＋ جديد')), h('div', { class: 'grid c2' }, q, av), h('div', { style: 'height:10px' }), list);
  load();
}

/* ---------- product detail / edit ---------- */
export async function productEdit(root, id, me, prefill = {}) {
  let p = { name: '', brand: '', category: 'العناية بالبشرة', size: '', barcode: prefill.barcode ?? '', ingredients: '', benefits: '', warnings: '', source_url: '', verification: 'review', availability: 'unknown' };
  if (id) { try { p = (await api('GET', '/api/products/' + id)).product; } catch (e) { root.append(h('div', { class: 'notice err' }, e.message)); return; } }
  const f = {
    name: h('input', { value: p.name, maxlength: 200 }), brand: h('input', { value: p.brand }), barcode: h('input', { value: p.barcode ?? '', inputmode: 'numeric', dir: 'ltr' }),
    category: select(CATEGORIES.map((c) => [c, c]), p.category), size: h('input', { value: p.size, placeholder: 'مثال: 50 مل' }),
    ingredients: h('textarea', { placeholder: 'من العبوة أو مصدر رسمي فقط. لا تخمّن.' }), benefits: h('textarea', {}), warnings: h('textarea', {}),
    source_url: h('input', { type: 'url', value: p.source_url, dir: 'ltr', placeholder: 'https://…' }),
    verification: select(me.role === 'manager' ? [['review', VER.review], ['partial', VER.partial], ['verified', VER.verified]] : [['review', VER.review], ['partial', VER.partial]], p.verification === 'verified' && me.role !== 'manager' ? 'review' : p.verification),
  };
  f.ingredients.value = p.ingredients; f.benefits.value = p.benefits; f.warnings.value = p.warnings;
  const msg = h('div', {});
  const save = async () => {
    msg.replaceChildren();
    const body = Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value.trim()]));
    body.barcode = body.barcode || null;
    if (id && me.role !== 'manager' && p.verification === 'verified') delete body.verification;
    if (!id) body.availability = 'unknown';
    try {
      const r = id ? await api('PATCH', '/api/products/' + id, body) : await api('POST', '/api/products', body);
      toast(id && r.verification === 'review' && p.verification === 'verified' ? 'تم الحفظ. أُعيدت حالة التوثيق إلى «تحتاج مراجعة» بسبب التعديل.' : 'تم الحفظ'); go('#/products');
    } catch (e) {
      msg.replaceChildren(h('div', { class: 'notice err' }, e.message, e.data?.existingId ? h('button', { class: 'btn sm light', style: 'margin-inline-start:8px', onclick: () => go('#/product/' + e.data.existingId) }, 'فتح السجل الموجود') : null));
      if (e.data?.fields) msg.append(h('div', { class: 'notice err' }, 'حقول غير مقبولة: ' + e.data.fields.join('، ')));
    }
  };
  root.append(
    h('h2', { class: 't' }, id ? 'تفاصيل المنتج' : 'بطاقة منتج جديدة'),
    id ? h('div', { class: 'card' }, h('div', { class: 'row sb' }, avBadge(p), verBadge(p.verification)), h('p', { class: 'tiny' }, 'آخر تحديث للتوفر: ', fmtDate(p.availability_updated_at)), availButtons(p, () => go('#/product/' + id))) : null,
    h('div', { class: 'card' },
      field('اسم المنتج *', f.name), field('العلامة التجارية', f.brand), field('الباركود', f.barcode), field('التصنيف', f.category), field('الحجم / الإصدار', f.size),
      field('المكونات الموثقة', f.ingredients), field('الفوائد والاستخدام الموثق', f.benefits), field('التحذيرات والاحتياطات', f.warnings), field('رابط المصدر', f.source_url),
      field('حالة التوثيق', f.verification),
      h('div', { class: 'notice' }, 'لا أسعار ولا كميات في هذا النظام. اعتماد «معتمد» للمدير فقط ويتطلب رابط مصدر. أي تعديل لاحق على بيانات معتمدة يعيدها إلى «تحتاج مراجعة».'), msg,
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: save }, 'حفظ'), h('button', { class: 'btn out', onclick: () => history.back() }, 'إلغاء'),
        id && me.role === 'manager' ? h('button', { class: 'btn danger', onclick: async () => { if (!confirm('حذف هذا المنتج نهائيًا؟')) return; try { await api('DELETE', '/api/products/' + id); toast('تم الحذف'); go('#/products'); } catch (e) { toast(e.message); } } }, 'حذف') : null)));
}

/* ---------- scan: camera / HID reader / manual ---------- */
export function scan(root, me) {
  let stop = null;
  const code = h('input', { inputmode: 'numeric', autocomplete: 'off', dir: 'ltr', placeholder: 'امسح بالقارئ أو اكتب الرقم', 'aria-label': 'رقم الباركود', autofocus: true });
  const video = h('video', { playsinline: true, muted: true }); const cam = h('div', { class: 'hide' }, video);
  const status = h('div', { class: 'notice' }, 'قارئ USB/Bluetooth: اضغط على الحقل ثم امسح — يُرسل الرقم وزر Enter تلقائيًا.');
  const result = h('div', {});
  const steps = h('div', { class: 'steps' }, h('span', { class: 'on' }, '1 · المسح'), h('span', {}, '2 · المطابقة'), h('span', {}, '3 · المراجعة'));
  const halt = () => { stop?.(); stop = null; cam.classList.add('hide'); };
  const lookup = async () => {
    halt(); result.replaceChildren();
    const b = code.value.trim(); if (!b) return;
    try {
      const r = await api('GET', '/api/products/by-barcode/' + encodeURIComponent(b));
      steps.children[1].classList.add('on');
      if (r.found) result.replaceChildren(h('div', { class: 'card' }, h('p', {}, '✔ المنتج مسجّل مسبقًا. لن يُنشأ سجل مكرر.'), productCard(r.product, lookup)));
      else {
        code.value = r.barcode;
        result.replaceChildren(h('div', { class: 'card' }, h('h3', {}, 'باركود جديد'), h('p', {}, 'غير موجود في مكتبة المحل.'), h('div', { class: 'notice' }, r.enrichment.message),
          h('button', { class: 'btn', onclick: () => go('#/product-new?barcode=' + r.barcode) }, 'إنشاء بطاقة ومراجعتها')));
      }
    } catch (e) { result.replaceChildren(h('div', { class: 'notice err' }, e.message)); }
  };
  code.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); lookup(); } });
  const openCam = async () => {
    cam.classList.remove('hide');
    try { stop = await startCamera(video, (v) => { code.value = v; lookup(); }); status.textContent = 'وجّه الكاميرا إلى الباركود…'; }
    catch (e) { cam.classList.add('hide'); status.className = 'notice err'; status.textContent = e.message; }
  };
  root.append(h('h2', { class: 't' }, 'إضافة منتج بالباركود'), steps,
    h('div', { class: 'card' }, h('div', { class: 'scanbox' }, h('div', { class: 'row', style: 'justify-content:center' }, h('button', { class: 'btn', onclick: openCam }, '📷 فتح الكاميرا'), h('button', { class: 'btn out', onclick: halt }, 'إغلاق')), cam),
      status, field('رقم الباركود', code), h('div', { class: 'row' }, h('button', { class: 'btn', onclick: lookup }, 'تحقق'), h('button', { class: 'btn out', onclick: () => go('#/product-new') }, 'منتج بلا باركود'))), result);
  window.addEventListener('hashchange', halt, { once: true });
  setTimeout(() => code.focus(), 50);
}
