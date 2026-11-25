import { api } from './api.js';
import { h, fill, field, errorBox, skeleton } from './util.js';
import { setLeaveGuard, confirmLeave } from './leave-guard.js';

/** Manager inventory editing; every write is authorized again in the shared local/server API. */
export async function inventoryView(root, me) {
  const user = me ?? (await api('GET', '/api/auth/me')).user;
  if (user.role !== 'manager') { root.append(errorBox('هذه الصفحة للمدير فقط.')); return; }
  let edit = null, offset = 0, filter = null, pending = null;
  const search = h('input', { type: 'search', placeholder: 'اسم المنتج أو الباركود', 'aria-label': 'بحث منتج للدفعة' });
  const product = h('select', { required: true, 'aria-label': 'منتج الدفعة', id: 'batch-product' }, h('option', { value: '' }, 'اختر منتجًا'));
  const code = h('input', { maxlength: 120, required: true, 'aria-label': 'رمز الدفعة', id: 'batch-code' });
  const quantity = h('input', { type: 'number', min: 0, max: 1000000000, step: 1, required: true, 'aria-label': 'الكمية', id: 'batch-quantity' });
  const expiry = h('input', { type: 'date', required: true, 'aria-label': 'تاريخ انتهاء الدفعة', id: 'batch-expiry' });
  const heading = h('h3', { class: 't' }, 'إضافة دفعة'), notice = h('div', { role: 'status', 'aria-live': 'polite' });
  const listing = h('div', {}, skeleton(2)), saveButton = h('button', { class: 'btn', type: 'submit', id: 'batch-save' }, 'حفظ الدفعة');
  const value = () => JSON.stringify([product.value, code.value, quantity.value, expiry.value]);
  let clean = value();
  const reset = () => { edit = null; product.disabled = false; code.value = ''; quantity.value = ''; expiry.value = ''; fill(heading, 'إضافة دفعة'); clean = value(); };
  const registerGuard = () => setLeaveGuard({ isDirty: () => value() !== clean, save: () => save(), discard: reset, pending: () => pending });
  const load = async () => {
    fill(listing, skeleton(2));
    try {
      const r = await api('GET', `/api/inventory/batches?limit=50&offset=${offset}${filter ? '&product_id=' + filter : ''}`);
      const editRow = async b => {
        if (!(await confirmLeave())) return;
        if (![...product.options].some(o => o.value === String(b.product_id))) product.append(h('option', { value: b.product_id }, b.product_name));
        product.value = String(b.product_id); product.disabled = true; code.value = b.batch_code; quantity.value = String(b.quantity); expiry.value = b.expires_on;
        edit = b; clean = value(); fill(heading, 'تعديل دفعة — ' + b.product_name); registerGuard(); code.focus();
      };
      const availability = r.availability;
      fill(listing,
        h('p', { class: 'tiny muted' }, `عدد الدفعات: ${r.total} · تاريخ التحقق المحلي: ${r.as_of}`),
        availability ? h('div', { class: 'notice ' + (availability.availability === 'yes' ? 'ok' : 'warn') }, availability.availability === 'yes' ? `دفعات صالحة مؤكدة: ${availability.valid_quantity} وحدة` : availability.availability === 'no' ? 'لا توجد كمية موجبة في دفعات غير منتهية.' : 'التوفر غير مؤكد؛ يلزم منتج نشط ومعتمد ودفعة صالحة.') : null,
        r.batches.length ? h('div', { class: 'tw' }, h('table', {},
          h('thead', {}, h('tr', {}, ['المنتج', 'الدفعة', 'الكمية', 'الانتهاء', 'الإجراء'].map(t => h('th', {}, t)))),
          h('tbody', {}, r.batches.map(b => h('tr', {}, h('td', {}, b.product_name), h('td', {}, b.batch_code), h('td', {}, b.quantity), h('td', { dir: 'ltr' }, b.expires_on), h('td', {}, h('button', { type: 'button', class: 'btn sm out', onclick: () => editRow(b) }, 'تعديل'))))))) : h('p', { class: 'muted' }, 'لا توجد دفعات مسجلة. لا تُنشأ كميات من علامة التوفر القديمة.'),
        h('div', { class: 'row' }, h('button', { class: 'btn sm out', disabled: offset === 0, onclick: () => { offset = Math.max(0, offset - 50); load(); } }, 'السابق'), h('button', { class: 'btn sm out', disabled: offset + 50 >= r.total, onclick: () => { offset += 50; load(); } }, 'التالي')));
    } catch (e) { fill(listing, errorBox(e.message, load)); }
  };
  const form = h('form', { class: 'card', onsubmit: e => { e.preventDefault(); save(); } }, heading,
    h('div', { class: 'row' }, search, h('button', { type: 'button', class: 'btn out', onclick: async () => {
      try {
        const r = await api('GET', '/api/products?limit=30&q=' + encodeURIComponent(search.value.trim()));
        const selected = product.value;
        const previous = [...product.options].find(o => o.value === selected);
        fill(product, h('option', { value: '' }, 'اختر منتجًا'), r.products.map(p => h('option', { value: p.id }, p.name)));
        if (selected && ![...product.options].some(o => o.value === selected) && previous) product.append(previous);
        product.value = selected;
      } catch (e) { fill(notice, errorBox(e.message)); }
    } }, 'بحث')),
    field('المنتج', product), field('رمز الدفعة', code), field('الكمية الفعلية', quantity), field('تاريخ الانتهاء', expiry),
    h('div', { class: 'row' }, saveButton, h('button', { class: 'btn out', type: 'button', onclick: async () => { if (await confirmLeave()) { reset(); registerGuard(); } } }, 'إضافة جديدة')));
  async function save() {
    if (pending) return pending;
    if (!form.reportValidity()) return false;
    saveButton.disabled = true; fill(notice);
    pending = (async () => {
      try {
        const data = { batch_code: code.value.trim(), quantity: Number(quantity.value), expires_on: expiry.value };
        if (edit) await api('PATCH', '/api/inventory/batches/' + edit.id, { ...data, version: edit.version });
        else await api('POST', '/api/inventory/batches', { ...data, product_id: Number(product.value) });
        reset(); fill(notice, h('p', { class: 'notice ok' }, 'حُفظت الدفعة.')); await load(); return true;
      } catch (e) { fill(notice, errorBox(e.message)); return false; }
      finally { pending = null; saveButton.disabled = false; }
    })();
    return pending;
  }
  root.append(h('h2', { class: 't' }, 'الدفعات والصلاحية'), h('p', { class: 'notice info' }, 'سجّل الكمية والدفعة وتاريخ الانتهاء الفعليين. التوفر والمراجعة العلمية والملاءمة أمور مستقلة. اجعل الكمية صفرًا عند نفاد الدفعة؛ يبقى سجلها للتدقيق.'), form, notice,
    h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn out', onclick: () => { filter = product.value ? Number(product.value) : null; offset = 0; load(); } }, 'عرض دفعات المنتج المختار'), h('button', { type: 'button', class: 'btn out', onclick: () => { filter = null; offset = 0; load(); } }, 'جميع الدفعات')), listing);
  registerGuard(); await load();
}
