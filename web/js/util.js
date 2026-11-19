// Safe DOM builder: text is always set via textContent/createTextNode — never innerHTML (XSS-proof by construction).
export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}
export const $ = (sel, root = document) => root.querySelector(sel);
export function toast(msg, ms = 2800) {
  const t = $('#toast'); t.replaceChildren(h('div', {}, msg)); clearTimeout(toast.t); toast.t = setTimeout(() => t.replaceChildren(), ms);
}
// filled from GET /api/taxonomy after login (server is the single source of truth); this is only a fallback
export const CATEGORIES = ['العناية بالبشرة', 'العناية بالشعر', 'واقيات الشمس', 'المكياج والجمال', 'العطور والعناية', 'العناية بالجسم', 'العناية بالأظافر', 'أدوات التجميل', 'أخرى'];
export const AV = { yes: 'متوفر', no: 'غير متوفر', unknown: 'غير مؤكد' };
export const VER = { verified: 'معتمد من المدير', partial: 'معلومات جزئية', review: 'تحتاج مراجعة' };
export const avBadge = (p) => h('span', { class: 'badge ' + ({ yes: 'ok', no: 'no', unknown: 'warn' }[p.availability_effective ?? p.availability]) }, AV[p.availability_effective ?? p.availability] + (p.availability_stale ? ' (قديم)' : ''));
export const verBadge = (v) => h('span', { class: 'badge ' + (v === 'verified' ? 'ok' : 'warn') }, VER[v] ?? v);
export const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString('ar-YE', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
export function field(label, input) { return h('div', { class: 'field' }, h('label', {}, label), input); }
export function select(options, value, props = {}) { const s = h('select', props, options.map(([v, l]) => h('option', { value: v }, l))); s.value = value ?? options[0][0]; return s; }
export const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

// replaceChildren stringifies null/false -> use this instead when a child may be conditional.
export const fill = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));

/* ---- feedback states ---- */
export const skeleton = (n = 3) => h('div', { 'aria-busy': 'true', 'aria-label': 'جارٍ التحميل' }, Array.from({ length: n }, () => h('div', { class: 'skel lg' })));
export const errorBox = (msg, retry) => h('div', { class: 'notice err', role: 'alert' }, msg, retry ? h('button', { class: 'btn sm light', style: 'margin-inline-start:8px', onclick: retry }, 'إعادة المحاولة') : null);
export const emptyState = (ico, title, sub, ...actions) => h('div', { class: 'empty' }, h('b', {}, ico), h('div', {}, h('strong', {}, title)), sub ? h('div', { class: 'tiny' }, sub) : null, actions.length ? h('div', { class: 'row', style: 'justify-content:center;margin-top:10px' }, actions) : null);
export async function busy(btn, fn) { btn.classList.add('busy'); try { return await fn(); } finally { btn.classList.remove('busy'); } }
// Enrichment lookup outcome -> label the staff understands (spec 9.4). "found" is only ever a DRAFT.
export const ENRICH_LABEL = { found: 'يحتاج مراجعة', conflict: 'تعارض مصادر', not_found: 'غير معروف', unreachable: 'تعذر الاتصال', rate_limited: 'تجاوز حد الطلبات', disabled: 'غير مفعّل', error: 'خطأ في المصدر' };
export const FIELD_LABEL = { name: 'الاسم', brand: 'العلامة', size: 'الحجم', ingredients: 'المكونات', image_url: 'الصورة' };
export const haptic = (ms = 40) => { try { navigator.vibrate?.(ms); } catch { /* unsupported */ } };
