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
export const CATEGORIES = ['العناية بالبشرة', 'العناية بالشعر', 'واقيات الشمس', 'المكياج والجمال', 'العطور والعناية', 'أخرى'];
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
