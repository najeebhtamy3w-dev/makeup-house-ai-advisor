import { api, getToken } from './api.js';
import { h, fill, toast, CATEGORIES, AV, VER, avBadge, verBadge, fmtDate, field, select, debounce, skeleton, errorBox, emptyState, busy, haptic, ENRICH_LABEL, FIELD_LABEL } from './util.js';
import { startCamera } from './scanner.js';
import { thumb, imageManager, authImg } from './images.js';
import { discoveryPanel, scanSheet, completeness } from './discovery.js';
import { loadTaxonomy, tx, typeLabel, typicalTypes } from './taxonomy.js';
import { icon } from './icons.js';
import { pickerSheet } from './picker.js';

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
  return h('div', { class: 'card' }, h('div', { class: 'prod' }, thumb(p),
    h('div', { class: 'bd' },
      h('div', { class: 'row sb' }, h('h4', {}, p.name), avBadge(p)),
      h('p', {}, [p.brand || 'علامة غير محددة', p.size, p.category].filter(Boolean).join(' · ')),
      h('div', { class: 'row' }, verBadge(p.verification), p.pending_suggestions ? h('span', { class: 'badge warn' }, `${p.pending_suggestions} اقتراح بانتظار المراجعة`) : null, p.barcode ? h('span', { class: 'tiny muted', dir: 'ltr' }, p.barcode) : null),
      completeness(p).el,
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
    // CP06: counts over the WHOLE catalog from the server (no client-side cap); only 3 items are downloaded to show
    const [all, unk, old, rev, st] = await Promise.all([api('GET', '/api/products?view=compact&limit=1'), api('GET', '/api/products?limit=3&availability=unknown'), api('GET', '/api/products?limit=3&availability=stale'), api('GET', '/api/products?view=compact&limit=1&verification=review'), getEnrich(true)]);
    const products = { length: all.total };
    const stale = [...old.products, ...unk.products].slice(0, 3); stale.total = old.total + unk.total;
    const toReview = rev.total;
    const items = [];
    if (me.role === 'manager' && st.pending_candidates) items.push(h('button', { class: 'card', style: 'width:100%;text-align:start;display:flex;justify-content:space-between;align-items:center', onclick: () => go('#/review') }, h('span', {}, h('b', {}, `${st.pending_candidates} منتج بانتظار مراجعة المعلومات`), h('div', { class: 'tiny muted' }, 'اقتراحات من المصادر العالمية')), h('span', { class: 'btn sm' }, 'راجع')));
    if (toReview) items.push(h('button', { class: 'card', style: 'width:100%;text-align:start;display:flex;justify-content:space-between;align-items:center', onclick: () => go('#/products?verification=review') }, h('span', {}, h('b', {}, `${toReview} منتج يحتاج مراجعة معلومات`), h('div', { class: 'tiny muted' }, 'لن تُعرض كتوصية حاسمة قبل اعتمادها')), h('span', { class: 'btn sm light' }, 'عرض')));
    fill(box,
      products.length === 0 ? emptyState('▥', 'المكتبة فارغة', 'ابدأ بمسح باركود منتج، أو اطلب من المدير استيراد ملف الأصناف.', h('button', { class: 'btn sm', onclick: () => go('#/scan') }, 'مسح أول منتج')) : null,
      items.length || stale.total ? h('h2', { class: 't' }, 'يحتاج إجراءً') : null, items,
      stale.map((p) => productCard(p, () => go('#/home'))),
      stale.total > 3 ? h('button', { class: 'btn out', style: 'width:100%', onclick: () => go('#/products?availability=unknown') }, `عرض كل المنتجات غير المؤكدة (${stale.total})`) : null,
      products.length && !items.length && !stale.total ? h('div', { class: 'notice ok' }, 'كل شيء محدّث. لا توجد إجراءات معلقة.') : null);
  } catch (e) { fill(box, errorBox(e.message, () => go('#/home'))); }
}

/* ---------- products: search + filters + skeleton + empty state ---------- */
/* ---------- products: compact catalog — search + category + product form + other filters, paged (CP05) ---------- */
const CKEY = 'mh_catalog_filters';
const PAGE = 30;
/** One compact, tappable row. Full details / actions live on the product screen. */
export function productRow(p) {
  const missing = [!p.primary_image_id && 'بلا صورة', p.has && !p.has.ingredients && 'بلا مكونات'].filter(Boolean);
  return h('button', { class: 'prow', type: 'button', onclick: () => go('#/product/' + p.id) }, thumb(p, 'sm'),
    h('div', { class: 'pr-bd' },
      h('div', { class: 'pr-name' }, p.name),
      h('div', { class: 'pr-sub' }, [p.brand, typeLabel(p.product_type), p.size].filter(Boolean).join(' · ') || '—'),
      h('div', { class: 'pr-tags' }, h('span', { class: 'dotv ' + (p.verification === 'verified' ? 'ok' : p.verification === 'partial' ? 'warn' : 'rev') }, VER[p.verification]),
        p.classification_status === 'suggested' || p.classification_status === 'needs_review' ? h('span', { class: 'mini warn' }, 'تصنيف للمراجعة') : null,
        p.pending_suggestions ? h('span', { class: 'mini warn' }, `${p.pending_suggestions} اقتراح`) : null,
        missing.map((m) => h('span', { class: 'mini' }, m)))),
    avBadge(p));
}

export async function products(root, params = new URLSearchParams(), me = null) {
  await loadTaxonomy().catch(() => {});
  const KEYS = ['category', 'type', 'availability', 'verification', 'missing', 'classification'];
  let saved = {}; try { saved = JSON.parse(sessionStorage.getItem(CKEY) || '{}'); } catch { /* ignore */ }
  const fromUrl = KEYS.some((k) => params.get(k));
  const f = Object.fromEntries(KEYS.map((k) => [k, (fromUrl ? params.get(k) : saved[k]) ?? '']));
  const q = h('input', { type: 'search', placeholder: 'ابحث بالاسم أو العلامة أو الباركود', 'aria-label': 'بحث', value: fromUrl ? '' : saved.q ?? '' });
  const catBar = h('div', { class: 'chipbar', role: 'group', 'aria-label': 'الفئة' });
  const typeBar = h('div', { class: 'chipbar', role: 'group', 'aria-label': 'نوع المنتج' });
  const more = h('div', { class: 'morefilters hide' }); const active = h('div', { class: 'activef' });
  const list = h('div', { class: 'plist', 'aria-live': 'polite' }); const foot = h('div', {});
  const LABELS = { availability: { yes: 'متوفر', no: 'غير متوفر', unknown: 'غير مؤكد' }, verification: VER, missing: { image: 'بدون صورة', info: 'معلومات ناقصة', pending: 'اقتراحات بانتظار المراجعة' }, classification: { review: 'تصنيف يحتاج مراجعة' } };
  const persist = () => { try { sessionStorage.setItem(CKEY, JSON.stringify({ ...f, q: q.value })); } catch { /* ignore */ } };
  const qs = () => { const x = new URLSearchParams(); if (q.value.trim()) x.set('q', q.value.trim()); for (const [k, v] of Object.entries(f)) if (v) x.set(k, v); return x; };
  const set = (k, v) => { f[k] = f[k] === v && v ? '' : v; persist(); refresh(); };
  const chip = (on, label, n, onclick) => h('button', { class: 'chip' + (on ? ' on' : ''), 'aria-pressed': String(on), type: 'button', onclick }, label, n != null ? h('span', { class: 'cnt' }, n) : null);

  const drawBars = (facets) => {
    const ct = facets?.categories ?? {}; const tt = facets?.types ?? {};
    const totalCats = Object.values(ct).reduce((a, b) => a + b, 0); const totalTypes = Object.values(tt).reduce((a, b) => a + b, 0);
    fill(catBar, chip(!f.category, 'كل الفئات', facets ? totalCats : null, () => set('category', '')),
      CATEGORIES.filter((c) => ct[c] || f.category === c).map((c) => chip(f.category === c, c, ct[c] ?? 0, () => set('category', c))));
    // only forms that actually have products under the other active filters (no crowded bar of empty buttons)
    const types = tx().product_types.filter((t) => tt[t.id] || f.type === t.id).sort((a, b) => (tt[b.id] ?? 0) - (tt[a.id] ?? 0));
    fill(typeBar, chip(!f.type, 'كل الأنواع', facets ? totalTypes : null, () => set('type', '')), types.map((t) => chip(f.type === t.id, t.ar, tt[t.id] ?? 0, () => set('type', t.id))),
      tt.none || f.type === 'none' ? chip(f.type === 'none', 'غير مصنف', tt.none ?? 0, () => set('type', 'none')) : null);
    const group = (k, title, opts) => h('div', {}, h('div', { class: 'tiny muted' }, title), h('div', { class: 'chipbar wrap' }, opts.map(([v, l]) => chip(f[k] === v, l, null, () => set(k, v)))));
    fill(more, group('availability', 'التوفر', Object.entries(LABELS.availability)), group('verification', 'التوثيق', Object.entries(VER)),
      group('missing', 'الاكتمال', Object.entries(LABELS.missing)), group('classification', 'التصنيف', Object.entries(LABELS.classification)));
    const on = KEYS.filter((k) => f[k]);
    fill(active, on.length || q.value.trim() ? [on.map((k) => h('button', { class: 'chip on sm', type: 'button', 'aria-label': 'إزالة المرشح', onclick: () => set(k, '') },
      k === 'type' ? (f.type === 'none' ? 'غير مصنف' : typeLabel(f.type)) : k === 'category' ? f.category : LABELS[k]?.[f[k]] ?? f[k], ' ✕')),
      h('button', { class: 'linkbtn', type: 'button', onclick: () => { KEYS.forEach((k) => (f[k] = '')); q.value = ''; persist(); refresh(); } }, 'إزالة كل المرشحات')] : null);
  };
  let seq = 0, offset = 0, total = 0;
  const load = async (append = false) => {
    const my = ++seq; if (!append) { offset = 0; fill(list, skeleton(3)); fill(foot); }
    const x = qs(); x.set('view', 'compact'); x.set('limit', String(PAGE)); x.set('offset', String(offset));
    try {
      const [r, facets] = await Promise.all([api('GET', '/api/products?' + x), append ? null : api('GET', '/api/products/facets?' + qs()).catch(() => null)]);
      if (my !== seq) return;
      if (!append) drawBars(facets);
      total = r.total; offset += r.products.length;
      if (!append) fill(list);
      list.append(...r.products.map(productRow));
      const filtersOn = !!q.value.trim() || KEYS.some((k) => f[k]);
      // CP05: a genuinely empty catalog (no search, no filter) gets its own start screen — no bars, no counts, no demo cards
      const emptyCatalog = !total && !filtersOn;
      [catBar, typeBar, active, moreWrap].forEach((el) => el.classList.toggle('hide', emptyCatalog)); if (emptyCatalog) more.classList.add('hide');
      if (emptyCatalog) {
        fill(list, h('div', { class: 'emptycat', role: 'status' }, icon('image', 44), h('h3', {}, 'لا توجد منتجات بعد'),
          h('p', {}, 'ابدأ بإضافة أول منتج إلى قاعدة بيانات ميك أب هاوس، أو استورد قائمة منتجاتك من Excel.'),
          h('div', { class: 'emptycat-actions' },
            h('button', { class: 'btn primary', type: 'button', onclick: () => go('#/product-new') }, icon('plus', 20), ' إضافة أول منتج'),
            me?.role === 'manager' ? h('button', { class: 'btn out', type: 'button', onclick: () => go('#/import') }, icon('doc', 20), ' استيراد منتجات')
              : h('div', { class: 'tiny muted' }, 'استيراد ملف Excel متاح للمدير.'))));
        fill(foot); return;
      }
      if (!total) {
        const why = [q.value.trim() && `البحث «${q.value.trim()}»`, ...KEYS.filter((k) => f[k]).map((k) => k === 'type' ? `النوع: ${f.type === 'none' ? 'غير مصنف' : typeLabel(f.type)}` : k === 'category' ? `الفئة: ${f.category}` : LABELS[k]?.[f[k]])].filter(Boolean);
        fill(list, emptyState('⌕', 'لا توجد منتجات مطابقة', why.length ? 'المرشحات النشطة: ' + why.join(' · ') : 'المكتبة فارغة.',
          why.length ? h('button', { class: 'btn sm', type: 'button', onclick: () => { KEYS.forEach((k) => (f[k] = '')); q.value = ''; persist(); refresh(); } }, 'إزالة المرشحات') : null,
          q.value.trim() ? h('button', { class: 'btn sm light', type: 'button', onclick: () => go('#/request?text=' + encodeURIComponent(q.value)) }, 'سجّل كطلب غير ملبّى') : null));
      }
      fill(foot, total ? h('div', { class: 'tiny muted', style: 'text-align:center;margin:8px 0' }, `عرض ${offset} من ${total}`) : null,
        offset < total ? h('button', { class: 'btn out', type: 'button', style: 'width:100%', onclick: (e) => busy(e.currentTarget, () => load(true)) }, 'عرض المزيد') : null);
    } catch (e) { if (my === seq) fill(list, errorBox(e.status ? e.message : 'تعذر الاتصال بالخادم.', () => load())); }
  };
  const refresh = () => load();
  q.addEventListener('input', debounce(() => { persist(); refresh(); }));
  const moreBtn = h('button', { class: 'btn sm out', type: 'button', 'aria-expanded': 'false', onclick: (e) => { const open = more.classList.toggle('hide') === false; e.currentTarget.setAttribute('aria-expanded', String(open)); } }, '⚙ مرشحات أخرى');
  const moreWrap = h('div', { class: 'searchrow' }, q, moreBtn);
  root.append(h('div', { class: 'row sb' }, h('h2', { class: 't' }, 'المنتجات'), h('button', { class: 'btn sm', type: 'button', onclick: () => go('#/product-new') }, '＋ جديد')),
    moreWrap, catBar, typeBar, more, active, list, foot);
  load();
}

/* ---------- product detail / edit (CP04: sections, inline validation, images; never renders "null") ---------- */
const digits = (v) => String(v ?? '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/\D/g, '');
export function gtinOk(code) {
  if (![8, 12, 13, 14].includes(code.length)) return false;
  const d = code.split('').map(Number); const ck = d.pop(); let sum = 0;
  d.reverse().forEach((x, i) => { sum += x * (i % 2 === 0 ? 3 : 1); });
  return (10 - (sum % 10)) % 10 === ck;
}
const FIELD_AR = { name: 'اسم المنتج', brand: 'العلامة التجارية', barcode: 'الباركود', category: 'التصنيف', size: 'الحجم / الإصدار', ingredients: 'المكونات', benefits: 'الاستخدام والفوائد', warnings: 'التحذيرات', source_url: 'رابط المصدر', verification: 'حالة التوثيق' };
function fieldX(key, label, input, { req = false, hint = '' } = {}) {
  const id = 'f-' + key; input.id = id;
  const err = h('div', { class: 'ferr', id: id + '-err', role: 'alert' });
  if (hint) input.setAttribute('aria-describedby', id + '-hint');
  const wrap = h('div', { class: 'field', 'data-field': key },
    h('label', { for: id }, label, req ? [' ', h('span', { class: 'req must', 'aria-hidden': 'true' }, '*'), h('span', { class: 'sr' }, ' (مطلوب)')] : null),
    input, hint ? h('div', { class: 'fhint', id: id + '-hint' }, hint) : null, err);
  wrap.setError = (m) => { err.textContent = m || ''; wrap.classList.toggle('bad', !!m); if (m) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid'); };
  input.addEventListener('input', () => { if (wrap.classList.contains('bad')) wrap.setError(''); });
  return wrap;
}
const section = (title, sub, ...kids) => h('section', { class: 'card fsec' }, h('h3', { class: 'fsec-t' }, title), sub ? h('p', { class: 'tiny muted' }, sub) : null, ...kids);

export async function productEdit(root, id, me, prefill = {}) {
  const host = h('div', { class: 'pedit' }); root.append(host);
  await loadTaxonomy().catch(() => {});
  let draft = {}; try { draft = JSON.parse(sessionStorage.getItem('mh_prefill') || '{}'); sessionStorage.removeItem('mh_prefill'); } catch { /* ignore */ }
  const preBarcode = digits(prefill.barcode);
  if (draft.barcode && draft.barcode !== preBarcode) draft = {};
  const str = (v) => (v == null ? '' : String(v));   // API nulls never reach the inputs as the text "null"
  let p = { name: str(draft.name), brand: str(draft.brand), category: 'العناية بالبشرة', size: str(draft.size), barcode: preBarcode, ingredients: '', benefits: '', warnings: '', source_url: '', verification: 'review', availability: 'unknown', product_type: '', application_area: '', functions: '' };
  if (id) { try { p = (await api('GET', '/api/products/' + id)).product; } catch (e) { fill(host, errorBox(e.status === 404 ? 'المنتج غير موجود (ربما حُذف أو أُعيد تشغيل نسخة التجربة).' : e.message, e.status ? null : () => { host.remove(); productEdit(root, id, me, prefill); })); return; } }
  const inp = (k, props = {}) => h('input', { value: str(p[k]), ...props });
  const area = (k, props = {}) => { const t = h('textarea', props); t.value = str(p[k]); return t; };
  const f = {
    name: inp('name', { maxlength: 200, autocomplete: 'off', required: true }),
    brand: inp('brand', { maxlength: 120, autocomplete: 'off' }),
    barcode: inp('barcode', { inputmode: 'numeric', dir: 'ltr', autocomplete: 'off', maxlength: 14, placeholder: 'امسح أو اكتب الرقم' }),
    category: select(CATEGORIES.map((c) => [c, c]), p.category),
    size: inp('size', { maxlength: 60, placeholder: 'مثال: 50 مل، أو 200 غ – إصدار 2024' }),
    ingredients: area('ingredients', { rows: 4, maxlength: 5000, dir: 'auto', placeholder: 'انسخها كما هي من العبوة (INCI)، أو اتركها فارغة.' }),
    benefits: area('benefits', { rows: 3, maxlength: 3000, placeholder: 'مثال: مرطب يومي للوجه — كما يذكره المصنع' }),
    warnings: area('warnings', { rows: 3, maxlength: 3000, placeholder: 'مثال: للاستخدام الخارجي فقط، تجنب ملامسة العينين' }),
    source_url: inp('source_url', { type: 'url', dir: 'ltr', maxlength: 500, placeholder: 'https://…' }),
    verification: select(me.role === 'manager' ? [['review', VER.review], ['partial', VER.partial], ['verified', VER.verified]] : [['review', VER.review], ['partial', VER.partial]], p.verification === 'verified' && me.role !== 'manager' ? 'review' : p.verification),
    product_type: h('input', { type: 'hidden', value: str(p.product_type) }),
    application_area: select([['', 'غير محددة'], ...tx().areas.map((a) => [a.id, a.ar])], str(p.application_area)),
  };
  const fnSet = new Set(str(p.functions).split(',').filter(Boolean));
  const W = {
    name: fieldX('name', FIELD_AR.name, f.name, { req: true }),
    brand: fieldX('brand', FIELD_AR.brand, f.brand, {}),
    barcode: fieldX('barcode', FIELD_AR.barcode, f.barcode, {}),
    category: fieldX('category', 'الفئة الرئيسية', f.category, { req: true }),
    size: fieldX('size', FIELD_AR.size, f.size, {}),
    ingredients: fieldX('ingredients', 'المكونات (من العبوة فقط)', f.ingredients, { hint: 'كما هي على العبوة فقط — لا تخمّن.' }),
    benefits: fieldX('benefits', 'الاستخدام والفوائد كما يذكرها المصنع', f.benefits, { hint: 'بلا وعود علاجية.' }),
    warnings: fieldX('warnings', 'التحذيرات والاحتياطات المكتوبة على العبوة', f.warnings, {}),
    source_url: fieldX('source_url', FIELD_AR.source_url, f.source_url, { hint: 'مطلوب لاعتماد «معتمد من المدير».' }),
    verification: fieldX('verification', FIELD_AR.verification, f.verification, { req: true }),
    product_type: fieldX('product_type', 'نوع المنتج (شكله)', f.product_type, {}),
    application_area: fieldX('application_area', 'منطقة الاستخدام', f.application_area, {}),
  };
  /* --- classification (CP05.3 reference design): typical FORMS as a compact grid + "المزيد…" searchable sheet; area + functions --- */
  let typeTouched = false;
  const PRIORITY = ['cream', 'cleanser', 'serum', 'oil', 'gel', 'lotion', 'toner', 'mask', 'scrub', 'sunscreen', 'shampoo', 'conditioner', 'makeup_remover', 'soap', 'spray', 'powder', 'foundation', 'lipstick', 'eye_makeup', 'lip_balm', 'deodorant', 'perfume', 'nail_polish', 'tool', 'other'];
  const rank = (t) => { const i = PRIORITY.indexOf(t.id); return i < 0 ? 999 : i; };
  const typeBox = h('div', { class: 'typegrid', role: 'radiogroup', 'aria-label': 'نوع المنتج' });
  const sugBox = h('div', { class: 'typesug' });
  const setType = (v) => { f.product_type.value = v; typeTouched = true; dirty = true; saveDraft(); drawTypes(); fill(sugBox); updateUi(); };
  const typeItems = (list) => list.map((t) => ({ id: t.id, label: t.ar, hint: `${t.en}${t.cats.length ? ' · ' + t.cats.join('، ') : ''}` }));
  const openTypes = () => pickerSheet({ title: 'نوع المنتج (شكله)', selected: f.product_type.value, noneLabel: 'غير محدد',
    groups: [{ title: `مقترحة لفئة «${f.category.value}»`, items: typeItems([...typicalTypes(f.category.value)].sort((a, b) => rank(a) - rank(b))) }, { title: 'كل الأنواع', items: typeItems([...tx().product_types].sort((a, b) => a.ar.localeCompare(b.ar, 'ar'))) }],
    onDone: (v) => setType(v) });
  const drawTypes = () => {
    const cur = f.product_type.value;
    let shown = [...typicalTypes(f.category.value)].sort((a, b) => rank(a) - rank(b)).slice(0, 9);
    if (cur && !shown.some((t) => t.id === cur)) shown = [...tx().product_types.filter((t) => t.id === cur), ...shown.slice(0, 8)];
    fill(typeBox, shown.map((t) => h('button', { class: 'tchip' + (cur === t.id ? ' on' : ''), type: 'button', role: 'radio', 'aria-checked': String(cur === t.id), 'data-type': t.id, onclick: () => setType(cur === t.id ? '' : t.id) }, t.ar)),
      h('button', { class: 'tchip more', type: 'button', 'aria-haspopup': 'dialog', onclick: openTypes }, 'المزيد…'));
  };
  f.category.addEventListener('change', drawTypes);
  const offerType = (sug) => { if (!sug?.type || f.product_type.value) { fill(sugBox); return; } fill(sugBox, h('span', {}, `مقترح من الاسم: ${sug.label}`), h('button', { class: 'btn sm light', type: 'button', onclick: () => setType(sug.type) }, 'استخدام')); };
  f.name.addEventListener('input', debounce(async () => { if (f.product_type.value || f.name.value.trim().length < 3) { fill(sugBox); return; } try { offerType(await api('GET', '/api/taxonomy/suggest?name=' + encodeURIComponent(f.name.value.trim()))); } catch { /* optional */ } }, 400));
  W.product_type.querySelector('input').after(typeBox, sugBox);
  // cosmetic FUNCTION: a select-looking button opening a multi-choice sheet (a function is never evidence of suitability)
  const fnBtn = h('button', { class: 'selectbtn', type: 'button', id: 'f-functions', 'aria-haspopup': 'dialog' });
  const drawFn = () => { const l = tx().functions.filter((x) => fnSet.has(x.id)).map((x) => x.ar); fill(fnBtn, h('span', {}, l.length ? l.join('، ') : 'غير محددة'), icon('chevron', 18)); };
  fnBtn.addEventListener('click', () => pickerSheet({ title: 'الوظيفة التجميلية', multi: true, selected: [...fnSet], groups: [{ items: tx().functions.map((x) => ({ id: x.id, label: x.ar, hint: x.en })) }],
    onDone: (v) => { fnSet.clear(); v.forEach((x) => fnSet.add(x)); dirty = true; saveDraft(); drawFn(); } }));
  const fnField = h('div', { class: 'field', 'data-field': 'functions' }, h('label', { for: 'f-functions' }, 'الوظيفة التجميلية'), fnBtn);
  W.application_area.querySelector('.req')?.remove();
  W.product_type.querySelector('.req')?.remove();
  // a person choosing a form confirms it; an imported / suggested one is labelled until then
  const clsNote = id && (p.classification_status === 'suggested' || p.classification_status === 'needs_review')
    ? h('div', { class: 'notice' }, p.classification_status === 'suggested' ? 'النوع الحالي مقترح من الاسم — اختره أو غيّره لتأكيده.' : `القيمة الواردة في ملف الاستيراد «${p.classification_raw}» لا تطابق نوعًا معروفًا — اختر النوع الصحيح.`) : null;
  const msg = h('div', { 'aria-live': 'polite' });
  const images = imageManager(id, me, api, { layout: 'hero' });
  let dirty = false; host.addEventListener('input', () => { dirty = true; });

  const validate = () => {
    Object.values(W).forEach((w) => w.setError(''));
    const errs = [];
    const bad = (k, m) => { W[k].setError(m); errs.push(k); };
    if (!f.name.value.trim()) bad('name', 'اكتب اسم المنتج كما على العبوة.');
    const bc = digits(f.barcode.value); f.barcode.value = bc;
    if (bc && !gtinOk(bc)) bad('barcode', 'الباركود غير صالح (الطول أو رقم التحقق). أعد مسحه أو اتركه فارغًا.');
    const url = f.source_url.value.trim();
    if (url) { try { const u = new URL(url); if (!/^https?:$/.test(u.protocol)) throw 0; } catch { bad('source_url', 'الرابط غير صالح. يجب أن يبدأ بـ https://'); } }
    if (f.verification.value === 'verified' && !url) bad('source_url', 'لا يمكن اختيار «معتمد من المدير» دون رابط مصدر.');
    if (errs.length) { const first = W[errs[0]]; first.closest('details')?.setAttribute('open', ''); first.scrollIntoView({ block: 'center', behavior: 'smooth' }); first.querySelector('input,textarea,select')?.focus({ preventScroll: true }); }
    updateUi();
    return !errs.length;
  };
  const saveBtn = h('button', { class: 'btn primary', type: 'submit' }, id ? 'حفظ التعديلات' : [icon('plus', 20), ' حفظ وإضافة منتج آخر']);
  let saveMode = 'next';   // new product: 'next' = rapid entry (fresh form), 'open' = open the saved card to complete it
  let clientRef = (crypto.randomUUID?.() ?? String(Date.now()) + '-' + Math.random().toString(16).slice(2)).replace(/[^A-Za-z0-9-]/g, '');
  const saveForm = {};
  const save = async (e) => {
    e?.preventDefault(); fill(msg);
    if (!validate()) { fill(msg, h('div', { class: 'notice err' }, 'راجع الحقول المظللة قبل الحفظ.')); return; }
    const body = Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value.trim()]));
    body.barcode = body.barcode || null;
    if (id && me.role !== 'manager' && p.verification === 'verified') delete body.verification;
    if (!id) { body.availability = 'unknown'; body.client_ref = clientRef; }
    body.functions = [...fnSet];
    if (id && p.classification_status !== 'confirmed' && body.product_type === str(p.product_type) && !typeTouched) delete body.product_type; // untouched suggestion stays a suggestion
    const btns = [...host.querySelectorAll('.savebar button')]; btns.forEach((b) => { b.disabled = true; });
    setStep(3);
    await busy(saveMode === 'open' ? openBtn : saveBtn, async () => {
      try {
        const r = id ? await api('PATCH', '/api/products/' + id, body) : await api('POST', '/api/products', body);
        dirty = false; saveForm.clearDraft?.();
        let imgFail = [];
        if (!id && images.count()) imgFail = await images.flush(r.id);
        if (!id && saveMode === 'open') { toast(imgFail.length ? `حُفظ المنتج، لكن تعذر رفع ${imgFail.length} صورة` : 'تم الحفظ'); go('#/product/' + r.id); return; }
        if (!id) {
          // RAPID ENTRY: saved for sure (server answered) -> fresh empty form, focus on the barcode, link to the product just saved
          host.remove(); window.scrollTo(0, 0);
          productEdit(root, null, me, { saved: { id: r.id, name: body.name, duplicate: !!r.duplicate_request, imgFail } });
          return;
        }
        toast(r.verification === 'review' && p.verification === 'verified' ? 'تم الحفظ. أُعيدت حالة التوثيق إلى «تحتاج مراجعة» بسبب التعديل.' : 'تم الحفظ');
        host.remove(); productEdit(root, id, me);   // stay on the same record
      } catch (x) {
        setStep(2);
        const fields = x.data?.fields ?? [];
        fields.forEach((k) => W[k]?.setError('القيمة غير مقبولة.'));
        if (x.status === 409) W.barcode.setError(x.message);
        fill(msg, h('div', { class: 'notice err', role: 'alert' }, x.status ? x.message : 'تعذر الاتصال بالخادم. لم يُحفظ شيء — بياناتك ما زالت في النموذج، أعد المحاولة.',
          fields.length ? h('div', { class: 'tiny' }, 'الحقول: ' + fields.map((k) => FIELD_AR[k] ?? k).join('، ')) : null,
          x.data?.existingId ? h('button', { class: 'btn sm light', type: 'button', style: 'margin-inline-start:8px', onclick: () => go('#/product/' + x.data.existingId) }, 'فتح السجل الموجود') : null));
      } finally { btns.forEach((b) => { b.disabled = false; }); saveMode = 'next'; }
    });
  };
  const openBtn = h('button', { class: 'btn out', type: 'button', onclick: () => { saveMode = 'open'; form.requestSubmit(saveBtn); } }, icon('doc', 20), ' حفظ وفتح البطاقة');
  const hasContent = !!(p.ingredients || p.benefits || p.warnings);
  const head = id ? h('div', { class: 'phead' }, h('div', { class: 'prod' }, thumb(p, 'lg'), h('div', { class: 'bd' }, h('h2', { class: 't' }, p.name || 'منتج'),
    h('div', { class: 'row' }, avBadge(p), verBadge(p.verification), p.product_type ? h('span', { class: 'badge' }, typeLabel(p.product_type)) : null, p.barcode ? h('span', { class: 'tiny muted', dir: 'ltr' }, p.barcode) : null))),
    (() => { const c = completeness(p); return h('div', { class: 'tiny' }, h('b', {}, `اكتمال البيانات ${c.n}/${c.total}`), ' (الاكتمال لا يعني الصحة)', c.el); })()) : null;
  // CP05: one shared discovery component for new / imported / existing products
  const disc = discoveryPanel(id
    ? { mode: 'product', me, product: p, onChanged: (x) => { if (!x?.soft) { host.remove(); productEdit(root, id, me); } } }
    : { mode: 'new', me, query: () => ({ barcode: digits(f.barcode.value), name: f.name.value.trim(), brand: f.brand.value.trim(), size: f.size.value.trim() }),
        apply: (k, v) => { f[k].value = v; W[k].classList.add('fromsrc'); dirty = true; saveDraft(); updateUi(); }, setBarcode: (code) => { f.barcode.value = code; W.barcode.setError(''); saveDraft(); }, applyType: (t) => setType(t) });
  const scan = () => scanSheet((code) => { f.barcode.value = digits(code); saveDraft(); disc.run(); });
  if (id) { W.barcode.querySelector('input').after(h('button', { class: 'btn sm out', type: 'button', 'aria-label': 'مسح الباركود بالكاميرا', onclick: scan }, '▥ مسح')); W.barcode.classList.add('withbtn'); }
  const idBtn = h('button', { class: 'btn primary wide', type: 'button', onclick: (e) => disc.run(e.currentTarget) }, icon('sparkle', 20), id ? ' استكمال معلومات المنتج من الإنترنت' : ' التعرف وجلب المعلومات');
  // unsaved NEW-product work survives navigation / reload (sessionStorage only, cleared on save)
  const DKEY = 'mh_new_product_draft';
  const saveDraft = () => { if (id) return; try { sessionStorage.setItem(DKEY, JSON.stringify({ ...Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value])), _fn: [...fnSet], _ref: clientRef })); } catch { /* ignore */ } };
  if (!id) {
    host.addEventListener('input', saveDraft);
    try {
      const d = JSON.parse(sessionStorage.getItem(DKEY) || 'null');
      if (d && !preBarcode && !draft.name && !prefill.saved) {
        for (const [k, v] of Object.entries(d)) if (f[k] && v) f[k].value = v;
        (d._fn ?? []).forEach((x) => fnSet.add(x)); if (d._ref) clientRef = d._ref;   // same ref on retry => the server will not create a duplicate
        if (['name', 'brand', 'barcode', 'size', 'ingredients', 'benefits', 'warnings', 'source_url'].some((k) => d[k])) setTimeout(() => { if (host.isConnected) toast('استُعيدت بيانات لم تُحفظ من المرة السابقة'); }, 300);
      }
    } catch { /* ignore */ }
    saveForm.clearDraft = () => { try { sessionStorage.removeItem(DKEY); } catch { /* ignore */ } };
  }
  /* --- collapsible sections: closed while empty; a badge shows how many fields hold data, or that one needs attention --- */
  const folds = [];
  const fold = (ico, title, keys, kids, open) => {
    const badge = h('span', { class: 'fbadge' });
    const d = h('details', { class: 'card fold', open: open ? true : null }, h('summary', {}, icon(ico, 22), h('span', { class: 'ft' }, title), badge, icon('chevron', 20)), h('div', { class: 'fbody' }, kids));
    folds.push(() => { const n = keys.filter((k) => f[k].value.trim() && !(k === 'verification')).length; const bad = keys.some((k) => W[k].classList.contains('bad')); badge.textContent = bad ? '!' : n ? String(n) : ''; badge.className = 'fbadge' + (bad ? ' bad' : n ? ' has' : ''); badge.title = bad ? 'حقل يحتاج تصحيحًا' : n ? `${n} حقل مُدخل` : ''; });
    return d;
  };
  const classCard = fold('tag', 'تصنيف المنتج', [], [clsNote, W.category, W.product_type, h('div', { class: 'grid2' }, W.application_area, fnField), h('div', { class: 'fhint' }, 'النوع شكل المنتج، والوظيفة ما صُمم له — ولا يعني أي منهما الملاءمة لنوع بشرة أو شعر.')], true);
  const pkgCard = fold('flask', 'محتوى العبوة والمكونات (INCI)', ['size', 'ingredients'], [W.size, W.ingredients], id ? hasContent || !!p.size : false);
  const useCard = fold('doc', 'الاستخدام والفوائد والتحذيرات', ['benefits', 'warnings'], [h('p', { class: 'tiny muted' }, 'ادعاءات المصنع وتحذيرات العبوة كما هي.'), W.benefits, W.warnings], id ? !!(p.benefits || p.warnings) : false);
  const srcCard = fold('link', 'المصادر والتوثيق', ['source_url'], [W.source_url, W.verification, h('div', { class: 'fhint' }, '«معتمد من المدير» للمدير فقط ويتطلب رابط مصدر؛ أي تعديل لاحق يعيده إلى «تحتاج مراجعة».')], id ? !!p.source_url : false);
  /* --- stepper: where the person is (identify -> review -> save); tapping jumps to that part --- */
  const steps = ['التعرف على المنتج', 'مراجعة المعلومات', 'الحفظ'];
  const stepper = id ? null : h('ol', { class: 'stepper', 'aria-label': 'مراحل الإدخال' }, steps.map((t, i) => h('li', {}, h('button', { type: 'button', onclick: () => [identCard, classCard, saveBtn][i]?.scrollIntoView({ block: 'start', behavior: 'smooth' }) }, h('b', {}, String(i + 1)), h('span', {}, t)))));
  let forcedStep = 0;
  const setStep = (n) => { forcedStep = n; updateUi(); };
  function updateUi() {
    folds.forEach((x) => x());
    if (!stepper) return;
    const n = forcedStep || (f.name.value.trim() ? 2 : 1);
    [...stepper.children].forEach((li, i) => { li.classList.toggle('on', i + 1 === n); li.classList.toggle('done', i + 1 < n); li.querySelector('button').setAttribute('aria-current', i + 1 === n ? 'step' : 'false'); });
  }
  host.addEventListener('input', () => { forcedStep = 0; updateUi(); });
  const tile = (ico, label, onclick) => h('button', { class: 'tile', type: 'button', onclick }, icon(ico, 28), h('span', {}, label));
  const identCard = id ? null : h('section', { class: 'card ident' },
    h('div', { class: 'ident-top' },
      h('div', { class: 'ident-txt' }, h('h3', { class: 'ident-t' }, icon('sparkle', 22), 'التعرف على المنتج'), h('p', {}, 'أضف صورة أو امسح الباركود أو أدخل الاسم للتعرف على المنتج وجلب بياناته.')),
      images.el,
      h('div', { class: 'tiles' }, tile('camera', 'تصوير', () => images.pick('camera')), tile('gallery', 'الاستوديو', () => images.pick('upload')), tile('barcode', 'مسح الباركود', scan))),
    W.barcode, h('div', { class: 'grid2' }, W.name, W.brand), idBtn, disc.el);
  const editIdentity = id ? section('الهوية', null, W.name, W.brand, W.barcode) : null;
  const form = h('form', { class: 'pform' + (id ? '' : ' entry'), novalidate: true, onsubmit: save },
    draft.name || draft.brand || draft.size ? h('div', { class: 'notice info' }, 'الاسم/العلامة/الحجم مسودة من مصدر عالمي لم يعتمدها المدير. قارنها بالعبوة قبل الحفظ. المكونات لا تُنسخ قبل اعتماد المدير.') : null,
    id ? [section('استكمال المعلومات', null, idBtn, disc.el), section('الصور', null, images.el), editIdentity] : identCard,
    classCard, pkgCard, useCard, srcCard,
    msg,
    h('div', { class: 'savebar' }, id ? [saveBtn, h('button', { class: 'btn out', type: 'button', onclick: () => { if (!dirty || confirm('توجد تعديلات غير محفوظة. الخروج دون حفظ؟')) history.back(); } }, 'إلغاء'),
      me.role === 'manager' ? h('button', { class: 'btn danger', type: 'button', onclick: async () => { if (!confirm('حذف هذا المنتج وصوره نهائيًا؟')) return; try { await api('DELETE', '/api/products/' + id); toast('تم الحذف'); go('#/products'); } catch (e) { toast(e.message); } } }, 'حذف') : null]
      : [saveBtn, openBtn]));
  // keyboard on phones: keep the focused field above the fixed save bar
  form.addEventListener('focusin', (e) => { if (e.target.matches('input,textarea')) setTimeout(() => e.target.scrollIntoView({ block: 'center', behavior: 'smooth' }), 250); });
  const savedBanner = prefill.saved ? h('div', { class: 'notice ok savedbar', role: 'status' }, prefill.saved.duplicate ? '✓ هذا المنتج حُفظ سابقًا (لم يُكرَّر): ' : '✓ حُفظ: ', h('b', {}, prefill.saved.name), ' ',
    h('a', { href: '#/product/' + prefill.saved.id }, 'فتح المنتج'), prefill.saved.imgFail?.length ? h('div', { class: 'tiny' }, `تعذر رفع ${prefill.saved.imgFail.length} صورة — افتح المنتج وأعد إضافتها.`) : null) : null;
  fill(host, savedBanner, stepper, head,
    id ? h('div', { class: 'card' }, h('h3', { class: 'fsec-t' }, 'التوفر الآن'), h('p', { class: 'tiny' }, 'آخر تحديث للتوفر: ', fmtDate(p.availability_updated_at)), availButtons(p, () => { host.remove(); productEdit(root, id, me); })) : null,
    form);
  drawTypes(); drawFn(); updateUi();
  if (id) disc.loadPending();
  else if (prefill.saved) { haptic(40); f.barcode.focus(); }
}

/** Short help for the entry screen (long explanations live here instead of under every field). */
export function productHelp() {
  const close = () => sheet.remove();
  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-label': 'مساعدة', onclick: (e) => { if (e.target === sheet) close(); } }, h('div', {},
    h('h3', { class: 't' }, 'إدخال منتج جديد'),
    h('ul', { class: 'help' },
      h('li', {}, 'المطلوب للحفظ: اسم المنتج والفئة فقط. الصورة وباقي البيانات اختيارية ويمكن إكمالها لاحقًا من بطاقة المنتج.'),
      h('li', {}, '«التعرف وجلب المعلومات» يبحث في مكتبة المحل أولًا ثم في Open Beauty Facts بالباركود أو بالاسم. النتائج مسودات تُقارن بالعبوة، ولا يوجد تعرف على الصورة نفسها.'),
      h('li', {}, 'المكونات تُنقل من العبوة كما هي. لا تخمّن ولا تكمل قائمة ناقصة.'),
      h('li', {}, '«حفظ وإضافة منتج آخر» يحفظ ثم يفتح نموذجًا فارغًا فورًا. «حفظ وفتح البطاقة» يحفظ ثم يفتح المنتج لإكماله.'),
      h('li', {}, 'كل منتج جديد يُحفظ بحالة «تحتاج مراجعة» حتى يعتمده المدير. ما تكتبه ولم تحفظه يبقى على هذا الهاتف ويُستعاد عند العودة.'),
      h('li', {}, 'لا أسعار ولا كميات في هذا النظام.')),
    h('button', { class: 'btn out', type: 'button', style: 'width:100%', onclick: close }, 'إغلاق')));
  document.body.append(sheet);
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
    fill(result, h('div', { class: 'tiny muted', role: 'status' }, 'جارٍ البحث في كتالوج المحل…'), skeleton(1));
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
        fill(panel, h('h3', {}, 'جارٍ الاتصال بالمصدر العالمي…'), h('div', { class: 'tiny muted', role: 'status' }, 'المنتج غير مكتمل التوثيق محليًا، أبحث عن معلومات للمراجعة'), skeleton(2));
        try { render(await api('POST', '/api/enrichment/lookup', { barcode, ...(force ? { force: true } : {}) })); }
        catch (e) { fill(panel, h('h3', {}, 'البحث العالمي'), errorBox(e.status ? e.message : 'تعذر الاتصال بالخادم.', () => run(false)), local ? null : newCardBtn(barcode, {})); }
      };
      const render = (r) => {
        const out = r.outcome === 'found' && r.conflict ? 'conflict' : r.outcome;
        const byField = new Map(); for (const c of r.candidates) byField.set(c.field, [...(byField.get(c.field) ?? []), c]);
        const nm = r.candidates.find((c) => c.field === 'name'), br = r.candidates.find((c) => c.field === 'brand'), sz = r.candidates.find((c) => c.field === 'size');
        fill(panel, h('div', { class: 'row sb' }, h('h3', {}, 'نتيجة البحث العالمي'), h('span', { class: 'badge ' + ({ found: 'warn', conflict: 'warn', not_found: 'info', unreachable: 'no', rate_limited: 'warn', error: 'no' }[out] ?? '') }, ENRICH_LABEL[out])),
          out === 'found' || out === 'conflict' ? h('div', { class: 'tiny', role: 'status' }, (out === 'conflict' ? 'توجد معلومات تحتاج مراجعة' : 'تم العثور على منتج محتمل') + ' · تم حفظ المسودة · بانتظار اعتماد المدير') : null,
          st.mode === 'mock' ? h('div', { class: 'notice' }, '⚠ وضع تجريبي: بيانات وهمية للاختبار.') : null,
          out === 'unreachable' ? errorBox('تعذر الاتصال بالمصدر. الباركود محفوظ ويمكنك إنشاء البطاقة يدويًا أو إعادة المحاولة.', () => run(false)) : null,
          out === 'rate_limited' ? h('div', { class: 'notice' }, 'بلغنا حد الطلبات للمصدر. أعد المحاولة بعد دقيقة.') : null,
          out === 'not_found' ? h('div', { class: 'notice info' }, 'المنتج غير معروف في المصادر المفعّلة. أدخل بياناته يدويًا من العبوة.') : null,
          r.candidates.length ? h('div', { class: 'notice info' }, 'هذه مسودات غير معتمدة. لا تُعرض كمعلومات علمية مؤكدة قبل مراجعة المدير.') : null,
          [...byField].map(([f, cs]) => cs.map((c) => h('div', { class: 'cand' + (c.conflict_note ? ' conf' : '') }, h('div', { class: 'row sb' }, h('b', {}, FIELD_LABEL[f]), h('span', { class: 'tiny muted' }, c.source_name)), f === 'image_url' ? authImg(`/api/enrichment/candidates/${c.id}/image`, 'صورة مقترحة من المصدر — تحتاج مراجعة', 'candimg') : h('div', {}, c.value), c.conflict_note ? h('div', { class: 'tiny', style: 'color:var(--warn)' }, '⚠ ' + c.conflict_note) : null))),
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
