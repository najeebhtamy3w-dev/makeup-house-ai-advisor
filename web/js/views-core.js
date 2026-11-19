import { api, getToken } from './api.js';
import { h, fill, toast, CATEGORIES, AV, VER, avBadge, verBadge, fmtDate, field, select, debounce, skeleton, errorBox, emptyState, busy, haptic, ENRICH_LABEL, FIELD_LABEL } from './util.js';
import { startCamera } from './scanner.js';
import { thumb, imageManager, authImg } from './images.js';
import { discoveryPanel, scanSheet, completeness } from './discovery.js';

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
  const f = { availability: params.get('availability') ?? '', verification: params.get('verification') ?? '', category: params.get('category') ?? '', missing: params.get('missing') ?? '' };
  const list = h('div', { class: 'grid c2' }); const bars = h('div', {});
  const chips = (key, label, opts) => h('div', { class: 'chipbar', role: 'group', 'aria-label': label }, opts.map(([v, l]) => h('button', { class: 'chip' + (f[key] === v ? ' on' : ''), 'aria-pressed': String(f[key] === v), onclick: () => { f[key] = v; drawBars(); load(); } }, l)));
  const drawBars = () => fill(bars,
    chips('category', 'التصنيف', [['', 'كل الأنواع'], ...CATEGORIES.map((c) => [c, c])]),
    chips('availability', 'التوفر', [['', 'كل التوفر'], ['yes', 'متوفر'], ['no', 'غير متوفر'], ['unknown', 'غير مؤكد']]),
    chips('verification', 'التوثيق', [['', 'كل التوثيق'], ['verified', VER.verified], ['partial', VER.partial], ['review', VER.review]]),
    chips('missing', 'الاكتمال', [['', 'كل المنتجات'], ['image', 'بدون صورة'], ['info', 'معلومات ناقصة'], ['pending', 'اقتراحات بانتظار المراجعة']]));
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
    h('label', { for: id }, label, ' ', h('span', { class: 'req ' + (req ? 'must' : 'opt') }, req ? 'مطلوب' : 'اختياري')),
    input, hint ? h('div', { class: 'fhint', id: id + '-hint' }, hint) : null, err);
  wrap.setError = (m) => { err.textContent = m || ''; wrap.classList.toggle('bad', !!m); if (m) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid'); };
  return wrap;
}
const section = (title, sub, ...kids) => h('section', { class: 'card fsec' }, h('h3', { class: 'fsec-t' }, title), sub ? h('p', { class: 'tiny muted' }, sub) : null, ...kids);

export async function productEdit(root, id, me, prefill = {}) {
  const host = h('div', { class: 'pedit' }); root.append(host);
  let draft = {}; try { draft = JSON.parse(sessionStorage.getItem('mh_prefill') || '{}'); sessionStorage.removeItem('mh_prefill'); } catch { /* ignore */ }
  const preBarcode = digits(prefill.barcode);
  if (draft.barcode && draft.barcode !== preBarcode) draft = {};
  const str = (v) => (v == null ? '' : String(v));   // API nulls never reach the inputs as the text "null"
  let p = { name: str(draft.name), brand: str(draft.brand), category: 'العناية بالبشرة', size: str(draft.size), barcode: preBarcode, ingredients: '', benefits: '', warnings: '', source_url: '', verification: 'review', availability: 'unknown' };
  if (id) { try { p = (await api('GET', '/api/products/' + id)).product; } catch (e) { fill(host, errorBox(e.status === 404 ? 'المنتج غير موجود (ربما حُذف أو أُعيد تشغيل نسخة التجربة).' : e.message, e.status ? null : () => { host.remove(); productEdit(root, id, me, prefill); })); return; } }
  const inp = (k, props = {}) => h('input', { value: str(p[k]), ...props });
  const area = (k, props = {}) => { const t = h('textarea', props); t.value = str(p[k]); return t; };
  const f = {
    name: inp('name', { maxlength: 200, autocomplete: 'off', required: true }),
    brand: inp('brand', { maxlength: 120, autocomplete: 'off' }),
    barcode: inp('barcode', { inputmode: 'numeric', dir: 'ltr', autocomplete: 'off', maxlength: 14, placeholder: '8 أو 12 أو 13 أو 14 رقمًا' }),
    category: select(CATEGORIES.map((c) => [c, c]), p.category),
    size: inp('size', { maxlength: 60, placeholder: 'مثال: 50 مل، أو 200 غ – إصدار 2024' }),
    ingredients: area('ingredients', { rows: 4, maxlength: 5000, dir: 'auto', placeholder: 'انسخها كما هي من العبوة (INCI)، أو اتركها فارغة.' }),
    benefits: area('benefits', { rows: 3, maxlength: 3000, placeholder: 'مثال: مرطب يومي للوجه — كما يذكره المصنع' }),
    warnings: area('warnings', { rows: 3, maxlength: 3000, placeholder: 'مثال: للاستخدام الخارجي فقط، تجنب ملامسة العينين' }),
    source_url: inp('source_url', { type: 'url', dir: 'ltr', maxlength: 500, placeholder: 'https://…' }),
    verification: select(me.role === 'manager' ? [['review', VER.review], ['partial', VER.partial], ['verified', VER.verified]] : [['review', VER.review], ['partial', VER.partial]], p.verification === 'verified' && me.role !== 'manager' ? 'review' : p.verification),
  };
  const W = {
    name: fieldX('name', FIELD_AR.name, f.name, { req: true, hint: 'الاسم كما يظهر على العبوة.' }),
    brand: fieldX('brand', FIELD_AR.brand, f.brand, { hint: 'مهم لمطابقة المنتج مع المصادر العالمية.' }),
    barcode: fieldX('barcode', FIELD_AR.barcode, f.barcode, { hint: 'يُتحقق من رقم التحقق تلقائيًا. اتركه فارغًا للمنتجات بلا باركود.' }),
    category: fieldX('category', FIELD_AR.category, f.category, { req: true }),
    size: fieldX('size', FIELD_AR.size, f.size, { hint: 'اختلاف الحجم أو الإصدار يعني منتجًا مختلفًا عند المطابقة.' }),
    ingredients: fieldX('ingredients', 'المكونات (من العبوة فقط)', f.ingredients, { hint: 'لا تخمّن ولا تكمل قائمة ناقصة — المستشار يعتمد عليها في أحكام العطر والملاءمة.' }),
    benefits: fieldX('benefits', 'الاستخدام والفوائد كما يذكرها المصنع', f.benefits, { hint: 'تظهر كسبب للتوصية. لا تكتب وعودًا علاجية أو نتائج مضمونة.' }),
    warnings: fieldX('warnings', 'التحذيرات والاحتياطات المكتوبة على العبوة', f.warnings, { hint: 'تظهر للموظف بعلامة ⚠ مع كل توصية بهذا المنتج.' }),
    source_url: fieldX('source_url', FIELD_AR.source_url, f.source_url, { hint: 'موقع المصنع أو صفحة المنتج الرسمية. مطلوب لاعتماد «معتمد من المدير».' }),
    verification: fieldX('verification', FIELD_AR.verification, f.verification, { req: true }),
  };
  const msg = h('div', { 'aria-live': 'polite' });
  const images = imageManager(id, me, api);
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
    return !errs.length;
  };
  const saveBtn = h('button', { class: 'btn', type: 'submit' }, id ? 'حفظ التعديلات' : 'حفظ البطاقة');
  const saveForm = {};
  const save = async (e) => {
    e?.preventDefault(); fill(msg);
    if (!validate()) { fill(msg, h('div', { class: 'notice err' }, 'راجع الحقول المظللة قبل الحفظ.')); return; }
    const body = Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value.trim()]));
    body.barcode = body.barcode || null;
    if (id && me.role !== 'manager' && p.verification === 'verified') delete body.verification;
    if (!id) body.availability = 'unknown';
    await busy(saveBtn, async () => {
      try {
        const r = id ? await api('PATCH', '/api/products/' + id, body) : await api('POST', '/api/products', body);
        dirty = false; saveForm.clearDraft?.();
        if (!id && images.count()) { const failed = await images.flush(r.id); if (failed.length) toast('حُفظت البطاقة، لكن تعذر رفع ' + failed.length + ' صورة: ' + failed[0], 5000); }
        toast(id && r.verification === 'review' && p.verification === 'verified' ? 'تم الحفظ. أُعيدت حالة التوثيق إلى «تحتاج مراجعة» بسبب التعديل.' : 'تم الحفظ');
        go('#/product/' + (id ?? r.id));
      } catch (x) {
        const fields = x.data?.fields ?? [];
        fields.forEach((k) => W[k]?.setError('القيمة غير مقبولة.'));
        if (x.status === 409) W.barcode.setError(x.message);
        fill(msg, h('div', { class: 'notice err', role: 'alert' }, x.status ? x.message : 'تعذر الاتصال بالخادم. لم يُحفظ شيء — بياناتك ما زالت في النموذج، أعد المحاولة.',
          fields.length ? h('div', { class: 'tiny' }, 'الحقول: ' + fields.map((k) => FIELD_AR[k] ?? k).join('، ')) : null,
          x.data?.existingId ? h('button', { class: 'btn sm light', type: 'button', style: 'margin-inline-start:8px', onclick: () => go('#/product/' + x.data.existingId) }, 'فتح السجل الموجود') : null));
      }
    });
  };
  const hasContent = !!(p.ingredients || p.benefits || p.warnings);
  const head = h('div', { class: 'phead' }, h('div', { class: 'prod' }, thumb(p, 'lg'), h('div', { class: 'bd' }, h('h2', { class: 't' }, id ? (p.name || 'منتج') : 'منتج جديد'),
    id ? h('div', { class: 'row' }, avBadge(p), verBadge(p.verification), p.barcode ? h('span', { class: 'tiny muted', dir: 'ltr' }, p.barcode) : null) : h('p', { class: 'tiny muted' }, 'المطلوب للحفظ: الاسم والتصنيف فقط. الصورة وباقي المعلومات اختيارية ويمكن إكمالها لاحقًا.'))),
    id ? (() => { const c = completeness(p); return h('div', { class: 'tiny' }, h('b', {}, `اكتمال البيانات ${c.n}/${c.total}`), ' (الاكتمال لا يعني الصحة)', c.el); })() : null);
  // CP05: one shared discovery component for new / imported / existing products
  const disc = discoveryPanel(id
    ? { mode: 'product', me, product: p, onChanged: (x) => { if (!x?.soft) { host.remove(); productEdit(root, id, me); } } }
    : { mode: 'new', me, query: () => ({ barcode: digits(f.barcode.value), name: f.name.value.trim(), brand: f.brand.value.trim(), size: f.size.value.trim() }),
        apply: (k, v) => { f[k].value = v; W[k].classList.add('fromsrc'); dirty = true; saveDraft(); }, setBarcode: (code) => { f.barcode.value = code; W.barcode.setError(''); saveDraft(); } });
  const scanBtn = h('button', { class: 'btn sm out', type: 'button', 'aria-label': 'مسح الباركود بالكاميرا', onclick: () => scanSheet((code) => { f.barcode.value = digits(code); saveDraft(); disc.run(); }) }, '▥ مسح');
  W.barcode.querySelector('input').after(scanBtn); W.barcode.classList.add('withbtn');
  const idBtn = h('button', { class: 'btn', type: 'button', style: 'width:100%', onclick: (e) => disc.run(e.currentTarget) }, id ? '⟳ استكمال معلومات المنتج من الإنترنت' : '⌕ التعرف وجلب المعلومات');
  // unsaved NEW-product work survives navigation / reload (sessionStorage only, cleared on save)
  const DKEY = 'mh_new_product_draft';
  const saveDraft = () => { if (id) return; try { sessionStorage.setItem(DKEY, JSON.stringify(Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value])))); } catch { /* ignore */ } };
  if (!id) {
    host.addEventListener('input', saveDraft);
    try { const d = JSON.parse(sessionStorage.getItem(DKEY) || 'null'); if (d && !preBarcode && !draft.name) { for (const [k, v] of Object.entries(d)) if (f[k] && v) f[k].value = v; if (Object.values(d).some(Boolean)) setTimeout(() => toast('استُعيدت بيانات لم تُحفظ من المرة السابقة'), 300); } } catch { /* ignore */ }
    saveForm.clearDraft = () => { try { sessionStorage.removeItem(DKEY); } catch { /* ignore */ } };
  }
  const usage = [W.benefits, W.warnings];
  const sourcesSec = h('details', { class: 'card fsec', open: true }, h('summary', { class: 'fsec-t' }, (id ? '٥' : '٥') + ' · المصادر والتوثيق'), W.source_url, W.verification,
    h('div', { class: 'notice' }, 'لا أسعار ولا كميات في هذا النظام. «معتمد من المدير» للمدير فقط ويتطلب رابط مصدر، وأي تعديل لاحق يعيده إلى «تحتاج مراجعة».'));
  const sections = id ? [
    section('استكمال المعلومات والصور', 'يعمل على هذا السجل نفسه — لا يُنشأ منتج جديد. الاقتراحات مسودات حتى يعتمدها المدير.', idBtn, disc.el),
    section('الصور', 'التقط صورة للعبوة أو اخترها من المعرض. الصورة الرئيسية تظهر في البطاقات والبحث والمستشار.', images.el),
    section('١ · الهوية والتصنيف', 'ما يميز هذا المنتج عن غيره (الحجم والإصدار مهمان).', W.name, W.brand, W.barcode, h('div', { class: 'grid2' }, W.category, W.size)),
  ] : [
    section('١ · التعرف على المنتج', 'صوّر المنتج، امسح الباركود أو اكتب الاسم، ثم اضغط «التعرف وجلب المعلومات» قبل الكتابة يدويًا.', images.el, W.barcode, W.name, W.brand, idBtn, disc.el),
    section('٢ · الهوية والتصنيف', 'الحجم والإصدار يميزان المنتجات المتشابهة.', h('div', { class: 'grid2' }, W.category, W.size)),
  ];
  const form = h('form', { class: 'pform', novalidate: true, onsubmit: save },
    draft.name || draft.brand || draft.size ? h('div', { class: 'notice info' }, 'الاسم/العلامة/الحجم مسودة من مصدر عالمي لم يعتمدها المدير. قارنها بالعبوة قبل الحفظ. المكونات لا تُنسخ قبل اعتماد المدير.') : null,
    sections,
    h('details', { class: 'card fsec', open: hasContent || !id ? true : null }, h('summary', { class: 'fsec-t' }, (id ? '٢' : '٣') + ' · المكونات ومحتوى العبوة'), h('p', { class: 'tiny muted' }, 'بيانات العبوة كما هي — ليست معرفة علمية ولا تقييمًا.'), W.ingredients),
    h('details', { class: 'card fsec', open: hasContent || !id ? true : null }, h('summary', { class: 'fsec-t' }, (id ? '٣' : '٤') + ' · الاستخدام والفوائد والتحذيرات'), h('p', { class: 'tiny muted' }, 'ادعاءات الشركة المصنعة وتحذيرات العبوة — تُعرض كما هي ولا تُعامل كحقائق علمية.'), ...usage),
    sourcesSec,
    msg,
    h('div', { class: 'savebar' }, saveBtn, h('button', { class: 'btn out', type: 'button', onclick: () => { if (!dirty || confirm('توجد تعديلات غير محفوظة. الخروج دون حفظ؟')) history.back(); } }, 'إلغاء'),
      id && me.role === 'manager' ? h('button', { class: 'btn danger', type: 'button', onclick: async () => { if (!confirm('حذف هذا المنتج وصوره نهائيًا؟')) return; try { await api('DELETE', '/api/products/' + id); toast('تم الحذف'); go('#/products'); } catch (e) { toast(e.message); } } }, 'حذف') : null));
  fill(host, head,
    id ? h('div', { class: 'card' }, h('h3', { class: 'fsec-t' }, 'التوفر الآن'), h('p', { class: 'tiny' }, 'آخر تحديث للتوفر: ', fmtDate(p.availability_updated_at)), availButtons(p, () => { host.remove(); productEdit(root, id, me); })) : null,
    form);
  if (id) disc.loadPending();
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
