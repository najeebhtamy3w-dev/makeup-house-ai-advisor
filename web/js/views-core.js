import { api, getToken } from './api.js';
import { h, fill, toast, CATEGORIES, AV, VER, avBadge, verBadge, fmtDate, field, select, debounce, skeleton, errorBox, emptyState, busy, haptic, ENRICH_LABEL, FIELD_LABEL } from './util.js';
import { startCamera } from './scanner.js';

export const go = (hash) => { location.hash = hash; };

/* ---------- shared: availability buttons (no prompt(): 3 clear taps) ---------- */
export function availButtons(p, after) {
  const mk = (st, label) => h('button', { class: 'btn sm ' + ((p.availability === st && !p.availability_stale) ? '' : 'out'), 'aria-pressed': String(p.availability === st), onclick: async () => {
    try { await api('POST', `/api/products/${p.id}/availability`, { status: st }); toast('تم تحديث التوفر'); after?.(); } catch (e) { toast(e.message); }
  } }, label);
  return h('div', { class: 'row' }, mk('yes', 'متوفر'), mk('no', 'غير متوفر'), mk('unknown', 'غير مؤكد'));
}

export function productCard(p, reload) {
  const sum = p.benefits ? p.benefits.slice(0, 90) + (p.benefits.length > 90 ? '…' : '') : '';
  return h('div', { class: 'card' }, h('div', { class: 'prod' }, h('div', { class: 'th', 'aria-hidden': 'true' }, (p.name || '؟').trim()[0]),
    h('div', { class: 'bd' },
      h('div', { class: 'row sb' }, h('h4', {}, p.name), avBadge(p)),
      h('p', {}, [p.brand || 'علامة غير محددة', p.size, p.category].filter(Boolean).join(' · ')),
      h('div', { class: 'row' }, verBadge(p.verification), p.barcode ? h('span', { class: 'tiny muted', dir: 'ltr' }, p.barcode) : null),
      sum ? h('p', { class: 'sum' }, sum) : h('p', { class: 'tiny' }, 'لا توجد فائدة موثقة بعد.'),
      p.availability_stale ? h('div', { class: 'notice' }, 'آخر تأكيد للتوفر قديم. تأكد من الرف قبل أن تعد العميل.') : null,
      h('p', { class: 'tiny' }, 'آخر تحديث للتوفر: ', fmtDate(p.availability_updated_at)),
      availButtons(p, reload),
      h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'btn sm light', onclick: () => go('#/product/' + p.id) }, 'التفاصيل / تعديل')))));
}

/* ---------- enrichment status (cached) ---------- */
let enrichStatus = null;
export async function getEnrich(force = false) { if (!enrichStatus || force) { try { enrichStatus = await api('GET', '/api/enrichment/status'); } catch { enrichStatus = { mode: 'off', pending_candidates: 0, connectors: [] }; } } return enrichStatus; }

/* ---------- home: the daily work hub — actions first, only actionable numbers ---------- */
export async function home(root, me) {
  const pend = h('span', { class: 'cnt hide' });
  root.append(
    h('div', { class: 'hero' }, h('h2', {}, 'كيف أقدر أساعدك اليوم؟'), h('p', {}, 'اكتب احتياج العميل وسأبحث لك في منتجات المحل.'), h('button', { class: 'btn', onclick: () => go('#/advisor') }, 'ابدأ استشارة ←')),
    h('div', { class: 'quick' },
      h('button', { onclick: () => go('#/scan') }, h('b', {}, '▥'), 'مسح باركود'),
      h('button', { onclick: () => go('#/products') }, h('b', {}, '⌕'), 'بحث منتج'),
      h('button', { onclick: () => go('#/product-new') }, h('b', {}, '＋'), 'إضافة منتج')));
  const box = h('div', {}, skeleton(2)); root.append(box);
  try {
    const [{ products }, st] = await Promise.all([api('GET', '/api/products?limit=500'), getEnrich(true)]);
    const stale = products.filter((p) => p.availability_stale || (p.availability === 'unknown'));
    const toReview = products.filter((p) => p.verification === 'review').length;
    const items = [];
    if (me.role === 'manager' && st.pending_candidates) items.push(h('button', { class: 'card', style: 'width:100%;text-align:start;display:flex;justify-content:space-between;align-items:center', onclick: () => go('#/review') }, h('span', {}, h('b', {}, `${st.pending_candidates} منتج بانتظار مراجعة المعلومات`), h('div', { class: 'tiny muted' }, 'اقتراحات من المصادر العالمية')), h('span', { class: 'btn sm' }, 'راجع')));
    if (toReview) items.push(h('button', { class: 'card', style: 'width:100%;text-align:start;display:flex;justify-content:space-between;align-items:center', onclick: () => go('#/products?verification=review') }, h('span', {}, h('b', {}, `${toReview} منتج يحتاج مراجعة معلومات`), h('div', { class: 'tiny muted' }, 'لن تُعرض كتوصية حاسمة قبل اعتمادها')), h('span', { class: 'btn sm light' }, 'عرض')));
    fill(box,
      products.length === 0 ? emptyState('▥', 'المكتبة فارغة', 'ابدأ بمسح باركود منتج، أو اطلب من المدير استيراد ملف الأصناف.', h('button', { class: 'btn sm', onclick: () => go('#/scan') }, 'مسح أول منتج')) : null,
      items.length || stale.length ? h('h2', { class: 't' }, 'يحتاج إجراءً') : null, items,
      stale.slice(0, 3).map((p) => productCard(p, () => go('#/home'))),
      stale.length > 3 ? h('button', { class: 'btn out', style: 'width:100%', onclick: () => go('#/products?availability=unknown') }, `عرض كل المنتجات غير المؤكدة (${stale.length})`) : null,
      products.length && !items.length && !stale.length ? h('div', { class: 'notice ok' }, 'كل شيء محدّث. لا توجد إجراءات معلقة.') : null);
  } catch (e) { fill(box, errorBox(e.message, () => go('#/home'))); }
}

/* ---------- products: search + filters + skeleton + empty state ---------- */
export async function products(root, params = new URLSearchParams()) {
  const q = h('input', { type: 'search', placeholder: 'ابحث بالاسم أو العلامة أو الباركود', 'aria-label': 'بحث' });
  const f = { availability: params.get('availability') ?? '', verification: params.get('verification') ?? '', category: params.get('category') ?? '' };
  const list = h('div', { class: 'grid c2' }); const bars = h('div', {});
  const chips = (key, label, opts) => h('div', { class: 'chipbar', role: 'group', 'aria-label': label }, opts.map(([v, l]) => h('button', { class: 'chip' + (f[key] === v ? ' on' : ''), 'aria-pressed': String(f[key] === v), onclick: () => { f[key] = v; drawBars(); load(); } }, l)));
  const drawBars = () => fill(bars,
    chips('category', 'التصنيف', [['', 'كل الأنواع'], ...CATEGORIES.map((c) => [c, c])]),
    chips('availability', 'التوفر', [['', 'كل التوفر'], ['yes', 'متوفر'], ['no', 'غير متوفر'], ['unknown', 'غير مؤكد']]),
    chips('verification', 'التوثيق', [['', 'كل التوثيق'], ['verified', VER.verified], ['partial', VER.partial], ['review', VER.review]]));
  let seq = 0;
  const load = async () => {
    const my = ++seq; fill(list, skeleton(2));
    const qs = new URLSearchParams({ limit: '100' }); if (q.value.trim()) qs.set('q', q.value.trim()); for (const [k, v] of Object.entries(f)) if (v) qs.set(k, v);
    try {
      const { products: ps } = await api('GET', '/api/products?' + qs); if (my !== seq) return;
      fill(list, ps.length ? ps.map((p) => productCard(p, load)) : emptyState('⌕', 'لا توجد نتائج', 'جرّب تغيير البحث أو الفلاتر.', h('button', { class: 'btn sm light', onclick: () => go('#/request?text=' + encodeURIComponent(q.value)) }, 'سجّل كطلب غير ملبّى')));
    } catch (e) { if (my === seq) fill(list, errorBox(e.message, load)); }
  };
  q.addEventListener('input', debounce(load));
  root.append(h('div', { class: 'row sb' }, h('h2', { class: 't' }, 'منتجات المكتبة'), h('button', { class: 'btn sm', onclick: () => go('#/product-new') }, '＋ جديد')), q, h('div', { style: 'height:8px' }), bars, list);
  drawBars(); load();
}

/* ---------- product detail / edit ---------- */
export async function productEdit(root, id, me, prefill = {}) {
  let draft = {}; try { draft = JSON.parse(sessionStorage.getItem('mh_prefill') || '{}'); sessionStorage.removeItem('mh_prefill'); } catch { /* ignore */ }
  if (draft.barcode && draft.barcode !== prefill.barcode) draft = {};
  let p = { name: draft.name ?? '', brand: draft.brand ?? '', category: 'العناية بالبشرة', size: draft.size ?? '', barcode: prefill.barcode ?? '', ingredients: '', benefits: '', warnings: '', source_url: '', verification: 'review', availability: 'unknown' };
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
      draft.name || draft.brand || draft.size ? h('div', { class: 'notice info' }, 'الاسم/العلامة/الحجم هنا مسودة من مصدر عالمي لم يعتمدها المدير. راجعها على العبوة قبل الحفظ. المكونات لا تُنسخ قبل اعتماد المدير.') : null, h('div', { class: 'notice' }, 'لا أسعار ولا كميات في هذا النظام. اعتماد «معتمد» للمدير فقط ويتطلب رابط مصدر. أي تعديل لاحق على بيانات معتمدة يعيدها إلى «تحتاج مراجعة».'), msg,
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: save }, 'حفظ'), h('button', { class: 'btn out', onclick: () => history.back() }, 'إلغاء'),
        id && me.role === 'manager' ? h('button', { class: 'btn danger', onclick: async () => { if (!confirm('حذف هذا المنتج نهائيًا؟')) return; try { await api('DELETE', '/api/products/' + id); toast('تم الحذف'); go('#/products'); } catch (e) { toast(e.message); } } }, 'حذف') : null)));
}

/* ---------- scan: SCAN → LOCAL → GLOBAL → MATCH → ENRICH(draft) → REVIEW ---------- */
const PENDING_KEY = 'mh_pending_barcode';
export async function scan(root, me) {
  let stop = null;
  const code = h('input', { inputmode: 'numeric', autocomplete: 'off', dir: 'ltr', placeholder: 'امسح بالقارئ أو اكتب الرقم', 'aria-label': 'رقم الباركود' });
  const video = h('video', { playsinline: true, muted: true }); const frame = h('div', { class: 'frame' }); const vfmsg = h('div', { class: 'vfmsg' }, '');
  const vf = h('div', { class: 'viewfinder hide' }, video, frame, vfmsg);
  const status = h('div', { class: 'notice info' }, 'قارئ USB/Bluetooth: اضغط على الحقل ثم امسح — يُرسل الرقم وزر Enter تلقائيًا.');
  const result = h('div', {});
  const steps = h('div', { class: 'steps' }, h('span', { class: 'on' }, '1 · المسح'), h('span', {}, '2 · المطابقة'), h('span', {}, '3 · المراجعة'));
  const setStep = (n) => [...steps.children].forEach((x, i) => x.classList.toggle('on', i < n));
  const halt = () => { stop?.(); stop = null; vf.classList.add('hide'); frame.classList.remove('ok'); };
  const say = (cls, msg) => { status.className = 'notice ' + cls; status.textContent = msg; };

  const lookup = async () => {
    halt(); fill(result); const b = code.value.trim(); if (!b) return;
    try { sessionStorage.setItem(PENDING_KEY, b); } catch { /* ignore */ }
    fill(result, skeleton(1));
    try {
      const r = await api('GET', '/api/products/by-barcode/' + encodeURIComponent(b)); setStep(2); code.value = r.barcode ?? b;
      try { sessionStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
      if (r.found) { fill(result, h('div', { class: 'card' }, h('p', {}, '✔ المنتج مسجّل مسبقًا. لن يُنشأ سجل مكرر.')), productCard(r.product, lookup), me.role && r.product.verification !== 'verified' ? globalPanel(r.barcode, r.product) : null); return; }
      fill(result, h('div', { class: 'card' }, h('h3', {}, 'باركود جديد'), h('p', {}, 'غير موجود في مكتبة المحل.')), globalPanel(r.barcode, null));
    } catch (e) {
      // offline / server down: keep the barcode, offer retry (never lose a scan)
      fill(result, errorBox(e.status ? e.message : 'لا يوجد اتصال. حُفظ الباركود ' + b + ' ويمكنك إعادة المحاولة.', e.status ? null : lookup));
    }
  };

  /* global search panel — results are DRAFTS; nothing is approved here */
  function globalPanel(barcode, local) {
    const panel = h('div', { class: 'card' }, skeleton(1));
    (async () => {
      const st = await getEnrich();
      if (st.mode === 'off') { fill(panel, h('h3', {}, 'البحث العالمي'), h('div', { class: 'notice' }, 'غير مفعّل على هذا الخادم. أدخل البيانات يدويًا وستُحفظ بحالة «تحتاج مراجعة».'), local ? null : newCardBtn(barcode, {})); return; }
      const run = async (force) => {
        fill(panel, h('h3', {}, 'البحث في المصادر العالمية…'), skeleton(2));
        try { render(await api('POST', '/api/enrichment/lookup', { barcode, ...(force ? { force: true } : {}) })); }
        catch (e) { fill(panel, h('h3', {}, 'البحث العالمي'), errorBox(e.status ? e.message : 'تعذر الاتصال بالخادم.', () => run(false)), local ? null : newCardBtn(barcode, {})); }
      };
      const render = (r) => {
        const out = r.outcome === 'found' && r.conflict ? 'conflict' : r.outcome;
        const byField = new Map(); for (const c of r.candidates) byField.set(c.field, [...(byField.get(c.field) ?? []), c]);
        const nm = r.candidates.find((c) => c.field === 'name'), br = r.candidates.find((c) => c.field === 'brand'), sz = r.candidates.find((c) => c.field === 'size');
        fill(panel, h('div', { class: 'row sb' }, h('h3', {}, 'نتيجة البحث العالمي'), h('span', { class: 'badge ' + ({ found: 'warn', conflict: 'warn', not_found: 'info', unreachable: 'no', rate_limited: 'warn', error: 'no' }[out] ?? '') }, ENRICH_LABEL[out])),
          st.mode === 'mock' ? h('div', { class: 'notice' }, '⚠ وضع تجريبي: بيانات وهمية للاختبار.') : null,
          out === 'unreachable' ? errorBox('تعذر الاتصال بالمصدر. الباركود محفوظ ويمكنك إنشاء البطاقة يدويًا أو إعادة المحاولة.', () => run(false)) : null,
          out === 'rate_limited' ? h('div', { class: 'notice' }, 'بلغنا حد الطلبات للمصدر. أعد المحاولة بعد دقيقة.') : null,
          out === 'not_found' ? h('div', { class: 'notice info' }, 'المنتج غير معروف في المصادر المفعّلة. أدخل بياناته يدويًا من العبوة.') : null,
          r.candidates.length ? h('div', { class: 'notice info' }, 'هذه مسودات غير معتمدة. لا تُعرض كمعلومات علمية مؤكدة قبل مراجعة المدير.') : null,
          [...byField].map(([f, cs]) => cs.map((c) => h('div', { class: 'cand' + (c.conflict_note ? ' conf' : '') }, h('div', { class: 'row sb' }, h('b', {}, FIELD_LABEL[f]), h('span', { class: 'tiny muted' }, c.source_name)), h('div', {}, c.value), c.conflict_note ? h('div', { class: 'tiny', style: 'color:var(--warn)' }, '⚠ ' + c.conflict_note) : null))),
          r.candidates.some((c) => c.field === 'ingredients') ? h('div', { class: 'tiny muted' }, 'المكونات تظهر للمراجعة فقط، ولا تُنسخ إلى البطاقة قبل اعتماد المدير.') : null,
          local ? null : newCardBtn(barcode, { name: nm?.value ?? '', brand: br?.value ?? '', size: sz?.value ?? '' }),
          me.role === 'manager' && r.candidates.length ? h('button', { class: 'btn sm light', style: 'margin-inline-start:8px', onclick: () => go('#/review') }, 'فتح شاشة المراجعة') : null,
          me.role === 'manager' ? h('button', { class: 'btn sm out', style: 'margin-inline-start:8px', onclick: () => run(true) }, 'تحديث من المصدر') : null);
        setStep(3);
      };
      run(false);
    })();
    return panel;
  }
  const newCardBtn = (barcode, d) => h('button', { class: 'btn', onclick: () => { try { sessionStorage.setItem('mh_prefill', JSON.stringify({ barcode, ...d })); } catch { /* ignore */ } go('#/product-new?barcode=' + barcode); } }, 'إنشاء بطاقة ومراجعتها');

  code.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); lookup(); } });
  const openCam = async () => {
    halt(); vf.classList.remove('hide'); vfmsg.textContent = 'جارٍ طلب إذن الكاميرا…';
    try {
      stop = await startCamera(video, { onState: (s) => { if (s === 'scanning') vfmsg.textContent = 'ضع الباركود داخل الإطار'; if (s === 'success') { frame.classList.add('ok'); vfmsg.textContent = '✔ تمت القراءة'; haptic(60); } }, onCode: (v) => { code.value = v; lookup(); } });
      say('info', 'وجّه الكاميرا إلى الباركود. تُقبل القراءة بعد تطابقين متتاليين.');
    } catch (e) { vf.classList.add('hide'); say('err', e.message); code.focus(); }
  };
  root.append(h('h2', { class: 't' }, 'إضافة منتج بالباركود'), steps,
    h('div', { class: 'card' }, h('div', { class: 'scanbox' }, h('div', { class: 'row', style: 'justify-content:center' }, h('button', { class: 'btn', onclick: openCam }, '📷 فتح الكاميرا'), h('button', { class: 'btn out', onclick: halt }, 'إغلاق')), vf),
      status, field('رقم الباركود', code), h('div', { class: 'row' }, h('button', { class: 'btn', onclick: lookup }, 'تحقق'), h('button', { class: 'btn out', onclick: () => go('#/product-new') }, 'منتج بلا باركود'))), result);
  window.addEventListener('hashchange', halt, { once: true });
  try { const pend = sessionStorage.getItem(PENDING_KEY); if (pend) { code.value = pend; result.append(h('div', { class: 'notice info' }, 'استُعيد باركود غير مكتمل: ', pend, ' ', h('button', { class: 'btn sm light', onclick: lookup }, 'متابعة'))); } } catch { /* ignore */ }
  setTimeout(() => code.focus(), 50);
}
