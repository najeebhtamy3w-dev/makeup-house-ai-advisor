// Final completion — extra product codes (product card), manager dashboard (real counts), bulk classification (manager).
import { api } from './api.js';
import { h, fill, toast, CATEGORIES, skeleton, errorBox, busy, fmtDate } from './util.js';
import { loadTaxonomy, tx } from './taxonomy.js';

const KIND = { gtin: 'باركود GTIN', internal: 'رمز داخلي', unverified: 'رمز غير موثّق' };

/** Section in an existing product's card: list the codes, add one (staff), verify/remove (manager). */
export function codesSection(id, me) {
  const list = h('div', { class: 'codes-list', id: 'codes-list' }, skeleton(1));
  const code = h('input', { id: 'code-new', dir: 'ltr', inputmode: 'numeric', placeholder: 'رمز إضافي', 'aria-label': 'رمز إضافي', autocomplete: 'off' });
  const kind = h('select', { id: 'code-kind', 'aria-label': 'نوع الرمز' }, Object.entries(KIND).map(([v, l]) => h('option', { value: v }, l)));
  const msg = h('div', { role: 'status' });
  const load = async () => {
    try {
      const r = await api('GET', `/api/products/${id}/codes`);
      fill(list, r.codes.length ? r.codes.map((c) => h('div', { class: 'row sb coderow' },
        h('span', { dir: 'ltr' }, c.code), h('span', { class: 'tiny muted' }, c.is_primary ? 'الأساسي' : KIND[c.kind] ?? c.kind, c.verified ? ' · موثّق' : ' · غير موثّق'),
        !c.is_primary && me.role === 'manager' ? h('span', {},
          h('button', { class: 'btn sm out', type: 'button', onclick: (e) => busy(e.currentTarget, async () => { await api('PATCH', `/api/products/${id}/codes/${c.id}`, { verified: !c.verified }); load(); }) }, c.verified ? 'إلغاء التوثيق' : 'توثيق'), ' ',
          h('button', { class: 'btn sm danger', type: 'button', onclick: (e) => { if (confirm('إزالة هذا الرمز؟')) busy(e.currentTarget, async () => { await api('DELETE', `/api/products/${id}/codes/${c.id}`); load(); }); } }, 'إزالة')) : null))
        : h('div', { class: 'tiny muted' }, 'لا توجد رموز بعد.'));
    } catch (e) { fill(list, errorBox(e.message || 'تعذر التحميل', load)); }
  };
  const add = async (e) => {
    fill(msg);
    if (!code.value.trim()) return;
    await busy(e.currentTarget, async () => {
      try { await api('POST', `/api/products/${id}/codes`, { code: code.value.trim(), kind: kind.value }); code.value = ''; toast('أُضيف الرمز (غير موثّق حتى يوثّقه المدير)'); load(); }
      catch (err) { fill(msg, h('div', { class: 'notice err' }, err.message)); }
    });
  };
  load();
  // saved on its own (separate endpoint): typing here is not an unsaved edit of the product form → no leave-guard prompt
  const stop = (e) => e.stopPropagation();
  return h('div', { class: 'card fsec', id: 'codes-section', oninput: stop, onchange: stop }, h('h3', { class: 'fsec-t' }, 'رموز إضافية'),
    h('p', { class: 'tiny muted' }, 'باركود آخر للعبوة نفسها (حجم مختلف = منتج مختلف) أو رمز داخلي. الرمز الواحد لا يُربط بمنتجين.'),
    list, h('div', { class: 'row' }, code, kind, h('button', { class: 'btn sm', type: 'button', id: 'code-add', onclick: add }, 'إضافة')), msg);
}

/** Manager dashboard — counts read from the database; no financial figure exists anywhere. */
export async function dashboard(root) {
  const box = h('div', { id: 'dashboard' }, skeleton(3)); root.append(h('h2', { class: 't' }, 'لوحة المدير'), box);
  const tile = (label, n, href) => h(href ? 'a' : 'div', { class: 'card dtile', href }, h('div', { class: 'dnum' }, String(n ?? 0)), h('div', { class: 'tiny' }, label));
  try {
    const d = await api('GET', '/api/dashboard');
    const c = d.completeness, k = d.knowledge;
    fill(box,
      h('h3', { class: 'fsec-t' }, 'الكتالوج'), h('div', { class: 'grid2' }, tile('منتجات نشطة', d.catalog.products, '#/products'), tile('مسودات استيراد', d.catalog.drafts), tile('مؤرشفة', d.catalog.archived), tile('معتمدة من المدير', c.verified, '#/products?verification=verified')),
      h('h3', { class: 'fsec-t' }, 'الاكتمال'), h('div', { class: 'grid2' }, tile('غير معتمدة', c.unverified, '#/products?verification=review'), tile('بلا تصنيف', c.unclassified, '#/bulk-classify'), tile('تصنيف مقترح', c.suggested_classification, '#/products?classification=review'),
        tile('بلا مكونات', c.without_ingredients, '#/products?missing=info'), tile('بلا صورة', c.without_image, '#/products?missing=image'), tile('بلا باركود', c.without_barcode), tile('رموز إضافية', c.additional_codes)),
      h('h3', { class: 'fsec-t' }, 'المراجعة والاستكمال'), h('div', { class: 'grid2' }, tile('أدلة بانتظار المراجعة', d.review.evidence_pending, '#/evidence'), tile('اقتراحات قديمة', d.review.legacy_candidates_pending, '#/review'),
        ...Object.entries(d.enrichment).map(([s, n]) => tile('طابور الاستكمال: ' + s, n))),
      k ? [h('h3', { class: 'fsec-t' }, 'المعرفة العلمية'), h('div', { class: 'grid2' }, tile('بانتظار المراجعة', k.pending_review, '#/knowledge'), tile('معتمدة', k.approved), tile('مراجعة علمية مؤهلة', k.scientifically_reviewed), tile('فجوات مفتوحة', k.gaps_open))] : null,
      h('h3', { class: 'fsec-t' }, 'أخرى'), h('div', { class: 'grid2' }, tile('طلبات غير ملبّاة', d.unmet_requests), tile('دفعات استيراد', d.imports.batches, '#/import'), tile('مدراء', d.users.manager), tile('موظفون', d.users.staff)),
      h('p', { class: 'tiny muted' }, 'آخر نسخة احتياطية: ', d.backup.last ? fmtDate(d.backup.last) : 'لا يوجد سجل نسخة احتياطية'));
  } catch (e) { fill(box, errorBox(e.message || 'تعذر التحميل', () => { root.replaceChildren(); dashboard(root); })); }
}

/** Bulk classification: pick products without a confirmed form, choose the form (and optionally the category), apply. */
export async function bulkClassify(root) {
  await loadTaxonomy().catch(() => {});
  const list = h('div', { class: 'plist', id: 'bulk-list' }, skeleton(3)); const msg = h('div', { role: 'status' });
  const type = h('select', { id: 'bulk-type', 'aria-label': 'نوع المنتج' }, h('option', { value: '' }, '— اختر النوع —'), tx().product_types.map((t) => h('option', { value: t.id }, t.ar)));
  const cat = h('select', { id: 'bulk-cat', 'aria-label': 'الفئة' }, h('option', { value: '' }, '— الفئة دون تغيير —'), CATEGORIES.map((c) => h('option', { value: c }, c)));
  let rows = [];
  const load = async () => {
    try {
      const r = await api('GET', '/api/products?view=compact&limit=200&type=none');
      const r2 = await api('GET', '/api/products?view=compact&limit=200&classification=review');
      const seen = new Set(); rows = [...r.products, ...r2.products].filter((p) => !seen.has(p.id) && seen.add(p.id));
      fill(list, rows.length ? rows.map((p) => h('label', { class: 'row bulkrow' }, h('input', { type: 'checkbox', value: String(p.id), 'data-version': String(p.version ?? '') }), h('span', {}, p.name, h('span', { class: 'tiny muted' }, ' · ', p.brand || '—', ' · ', p.category))))
        : h('div', { class: 'notice ok' }, 'لا توجد منتجات تحتاج تصنيفًا.'));
    } catch (e) { fill(list, errorBox(e.message || 'تعذر التحميل', load)); }
  };
  const apply = (e) => busy(e.currentTarget, async () => {
    fill(msg);
    const items = [...list.querySelectorAll('input[type=checkbox]:checked')].map((x) => ({ id: Number(x.value), version: Number(x.dataset.version) }));
    if (!items.length || !type.value) { fill(msg, h('div', { class: 'notice warn' }, 'اختر منتجًا واحدًا على الأقل ونوع المنتج.')); return; }
    try {
      const r = await api('POST', '/api/products/bulk-classify', { items, product_type: type.value, ...(cat.value ? { category: cat.value } : {}) });
      fill(msg, h('div', { class: 'notice ok', id: 'bulk-result' }, `صُنّف ${r.updated} منتج.`, r.skipped_changed_meanwhile.length ? ` تُرك ${r.skipped_changed_meanwhile.length} لأنه عُدّل في الأثناء — راجعه.` : ''));
      load();
    } catch (err) { fill(msg, h('div', { class: 'notice err' }, err.message)); }
  });
  root.append(h('h2', { class: 't' }, 'تصنيف جماعي'), h('p', { class: 'tiny muted' }, 'يغيّر نوع المنتج (والفئة إن اخترتها) فقط — لا يمسّ المكونات أو التحذيرات أو الاعتماد.'),
    h('div', { class: 'row' }, h('button', { class: 'btn sm out', type: 'button', onclick: () => list.querySelectorAll('input[type=checkbox]').forEach((x) => (x.checked = true)) }, 'تحديد الكل'), type, cat),
    list, msg, h('div', { class: 'savebar' }, h('button', { class: 'btn primary', type: 'button', id: 'bulk-apply', onclick: apply }, 'تطبيق التصنيف')));
  load();
}
