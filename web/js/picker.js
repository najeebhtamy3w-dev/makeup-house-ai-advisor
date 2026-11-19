// Phone-friendly bottom-sheet picker with search (single or multiple choice). Keeps the previous selection; closing never
// changes anything unless a choice is made (single) or "تم" is pressed (multiple).
import { h, fill } from './util.js';
import { icon } from './icons.js';

const fold = (s) => String(s ?? '').normalize('NFKC').toLowerCase().replace(/[ً-ٟـ]/g, '').replace(/[إأآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');

/**
 * @param {{ title: string, groups: { title?: string, items: { id: string, label: string, hint?: string }[] }[], selected: string[] | string,
 *           multi?: boolean, onDone: (value: string | string[]) => void, noneLabel?: string }} o
 */
export function pickerSheet(o) {
  const sel = new Set(Array.isArray(o.selected) ? o.selected : o.selected ? [o.selected] : []);
  const q = h('input', { type: 'search', placeholder: 'ابحث…', 'aria-label': 'بحث في القائمة', autocomplete: 'off', enterkeyhint: 'search' });
  const list = h('div', { class: 'pk-list', role: o.multi ? 'group' : 'listbox', 'aria-label': o.title });
  const prevFocus = document.activeElement;
  const close = () => { sheet.remove(); document.removeEventListener('keydown', onKey); prevFocus?.focus?.({ preventScroll: true }); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const choose = (id) => { if (o.multi) { sel.has(id) ? sel.delete(id) : sel.add(id); draw(); return; } close(); o.onDone(id); };
  const row = (it) => {
    const on = sel.has(it.id);
    return h('button', { class: 'pk-item' + (on ? ' on' : ''), type: 'button', role: o.multi ? 'checkbox' : 'option', 'aria-checked': String(on), 'aria-selected': o.multi ? null : String(on), 'data-id': it.id, onclick: () => choose(it.id) },
      h('span', { class: 'pk-l' }, it.label, it.hint ? h('small', {}, it.hint) : null), on ? icon('check', 18) : null);
  };
  const draw = () => {
    const t = fold(q.value.trim());
    const groups = o.groups.map((g) => ({ ...g, items: g.items.filter((it) => !t || fold(it.label).includes(t) || fold(it.hint).includes(t) || fold(it.id).includes(t)) })).filter((g) => g.items.length);
    const seen = new Set();
    fill(list, !o.multi && o.noneLabel && !t ? row({ id: '', label: o.noneLabel }) : null,
      groups.map((g) => { const items = g.items.filter((it) => !seen.has(it.id) && seen.add(it.id)); return items.length ? [g.title ? h('div', { class: 'pk-g' }, g.title) : null, items.map(row)] : null; }),
      groups.length ? null : h('div', { class: 'pk-empty' }, 'لا توجد نتيجة مطابقة.'));
  };
  q.addEventListener('input', draw);
  const sheet = h('div', { class: 'sheet picker', role: 'dialog', 'aria-modal': 'true', 'aria-label': o.title, onclick: (e) => { if (e.target === sheet) close(); } },
    h('div', {},
      h('div', { class: 'pk-head' }, h('b', {}, o.title), h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'إغلاق', onclick: close }, icon('x', 20))),
      h('div', { class: 'pk-search' }, icon('search', 18), q), list,
      o.multi ? h('button', { class: 'btn', type: 'button', style: 'width:100%;margin-top:10px', onclick: () => { close(); o.onDone([...sel]); } }, 'تم') : null));
  draw(); document.body.append(sheet); document.addEventListener('keydown', onKey);
  setTimeout(() => q.focus({ preventScroll: true }), 50);
  return sheet;
}
