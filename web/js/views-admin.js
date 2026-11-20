import { api, getToken } from './api.js';
import { busy, fill, h, toast, AV, field, select, fmtDate } from './util.js';

/* ---------- import (manager): preview -> commit; price/qty columns reported by NAME only ---------- */
export function importView(root) {
  const file = h('input', { type: 'file', accept: '.csv,.xlsx' }); const out = h('div', {});
  const enrich = h('input', { type: 'checkbox', id: 'imp-enrich' });
  let buf = null, name = '';
  const table = (head, rows) => h('div', { class: 'tw' }, h('table', {}, h('tr', {}, head.map((x) => h('th', {}, x))), rows));
  const send = async (commit, btn) => {
    if (!buf) { toast('اختر ملفًا أولًا'); return; }
    const run = async () => {
      try {
        const r = await api('POST', `/api/imports/${commit ? 'commit' : 'preview'}?filename=${encodeURIComponent(name)}${commit && enrich.checked ? '&enrich=1' : ''}`, buf, { raw: true });
        fill(out, h('div', { class: 'card' }, h('h3', {}, commit ? 'تم الاستيراد' : 'معاينة — لم يُحفظ شيء بعد'),
          h('div', { class: 'stats' }, [['جديد', r.new], ['موجود مسبقًا', r.duplicates_existing], ['يُستكمل (حقول فارغة)', r.completions], ['تعارض', r.conflicts], ['مشابه محتمل', r.possible_duplicates], ['مكرر في الملف', r.duplicates_in_file], ['غير صالح', r.invalid]].map(([l, n]) => h('div', { class: 'stat' }, h('b', {}, n ?? 0), h('small', {}, l)))),
          r.classification ? h('p', { class: 'tiny' }, `نوع المنتج في الجديد: مطابق ${r.classification.confirmed} · مقترح من الاسم ${r.classification.suggested} · قيمة غير معروفة (للمراجعة) ${r.classification.needs_review} · غير مصنف ${r.classification.unknown}`) : null,
          r.new ? h('p', { class: 'tiny' }, `بيانات ناقصة في الجديد (مسموح): بلا باركود ${r.missing.barcode} · بلا علامة ${r.missing.brand} · بلا حجم ${r.missing.size}. الصور والمكونات تُستكمل لاحقًا من بطاقة المنتج.`) : null,
          r.ignored_columns.length ? h('div', { class: 'notice' }, 'أعمدة أُهملت كليًا ولم تُقرأ قيمها: ', r.ignored_columns.join('، ')) : null,
          r.warnings.map((w) => h('div', { class: 'notice' }, w)),
          r.completions ? h('div', { class: 'notice info' }, `${r.completions} منتج موجود ستُملأ حقوله الفارغة فقط (العلامة/الحجم) ويعود إلى «تحتاج مراجعة». المنتجات المعتمدة والقيم الموجودة لا تُستبدل.`) : null,
          r.conflict_rows?.length ? [h('h4', {}, 'تعارضات (لن يُغيَّر شيء)'), table(['السطر', 'السبب', ''], r.conflict_rows.map((x) => h('tr', {}, h('td', {}, x.line), h('td', {}, x.reason), h('td', {}, h('a', { href: '#/product/' + x.existing_id }, 'فتح')))))] : null,
          r.possible_rows?.length ? [h('h4', {}, 'منتجات مشابهة محتملة (لم تُستورد)'), table(['السطر', 'السبب', ''], r.possible_rows.map((x) => h('tr', {}, h('td', {}, x.line), h('td', {}, x.reason), h('td', {}, h('a', { href: '#/product/' + x.existing_id }, 'فتح')))))] : null,
          r.invalid_rows.length ? [h('h4', {}, 'صفوف غير صالحة'), table(['السطر', 'السبب'], r.invalid_rows.map((x) => h('tr', {}, h('td', {}, x.line), h('td', {}, x.reason))))] : null,
          r.sample.length ? [h('h4', {}, 'عينة من الجديد'), table(['باركود', 'الاسم', 'العلامة', 'التصنيف'], r.sample.map((x) => h('tr', {}, h('td', { dir: 'ltr' }, x.barcode || '—'), h('td', {}, x.name), h('td', {}, x.brand || '—'), h('td', {}, x.category))))] : null,
          !commit && (r.new > 0 || r.completions > 0) ? [h('label', { class: 'row', for: 'imp-enrich', style: 'margin:8px 0' }, enrich, ' بعد الاستيراد: أضف المنتجات ذات الباركود إلى طابور البحث في المصادر (مسودات للمراجعة، على دفعات بحد المصدر)'),
            h('button', { class: 'btn', onclick: (e) => send(true, e.currentTarget) }, `اعتماد: إضافة ${r.new} واستكمال ${r.completions}`)] : null,
          commit && r.drafts ? h('div', { class: 'notice' }, `${r.drafts} صف يحمل باركودًا فقط حُفظ كمسودة «بانتظار التعرف»: يظهر في القائمة ولا يُرشَّح في المستشار.`) : null,
          commit && r.batch_id ? h('div', { class: 'row', id: 'batch-actions' }, h('span', { class: 'tiny' }, `الدفعة رقم ${r.batch_id}${r.resumed ? ' (استُكملت من حيث توقفت)' : ''}`),
            h('button', { class: 'btn sm light', type: 'button', id: 'batch-report', onclick: async () => { try { const res = await fetch(`/api/imports/batches/${r.batch_id}/report`, { headers: { authorization: 'Bearer ' + getToken() } }); const a = h('a', { href: URL.createObjectURL(await res.blob()), download: `import-${r.batch_id}-errors.csv` }); document.body.append(a); a.click(); a.remove(); } catch { toast('تعذر التنزيل'); } } }, 'تنزيل تقرير الأخطاء'),
            r.drafts ? h('button', { class: 'btn sm danger', type: 'button', id: 'batch-rollback', onclick: (e) => busy(e.currentTarget, async () => { if (!confirm('حذف مسودات هذه الدفعة التي لم يعدّلها أحد؟ لا يُحذف أي منتج آخر.')) return; try { const x = await api('POST', `/api/imports/batches/${r.batch_id}/rollback`); toast(`حُذفت ${x.removed} مسودة${x.kept_edited_drafts ? ` وبقيت ${x.kept_edited_drafts} عُدّلت` : ''}`); } catch (er) { toast(er.message); } }) }, 'التراجع عن المسودات') : null) : null,
          commit ? h('div', { class: 'notice ok' }, `الجديد بحالة «تحتاج مراجعة» وتوفر «غير مؤكد» ما لم يذكر الملف غير ذلك.${r.enrich_queued ? ` أُضيف ${r.enrich_queued} باركود إلى طابور البحث.` : ''}`) : null));
      } catch (e) { fill(out, h('div', { class: 'notice err' }, e.status ? e.message : 'تعذر الاتصال بالخادم. لم يُحفظ شيء — أعد المحاولة.')); }
    };
    return btn ? busy(btn, run) : run();
  };
  file.addEventListener('change', async () => { const f = file.files[0]; if (!f) return; if (f.size > 8 * 1024 * 1024) { fill(out, h('div', { class: 'notice err' }, 'الملف أكبر من 8 ميغابايت. قسّمه إلى ملفات أصغر.')); return; } name = f.name; buf = await f.arrayBuffer(); send(false); });
  root.append(h('h2', { class: 't' }, 'استيراد المنتجات (XLSX / CSV)'), h('div', { class: 'card' },
    h('p', {}, 'الأعمدة المقبولة: barcode, name, brand, category, product_type (نوع المنتج: كريم، غسول، Serum…), size, availability — أو أسماؤها العربية. المطلوب: الاسم فقط؛ الملفات القديمة بلا product_type تعمل كما هي.'),
    h('div', { class: 'notice' }, 'لا تُقرأ أي أعمدة أخرى (أسعار، كميات…). إعادة رفع الملف لا تكرر المنتجات، ولا تستبدل أي قيمة موجودة.'),
    h('details', {}, h('summary', {}, 'تجهيز عمود الباركود في Excel (مهم)'), h('ol', { class: 'tiny' },
      h('li', {}, 'حدّد عمود الباركود ← تنسيق الخلايا ← «نص»، ثم الصق/اكتب الباركودات.'),
      h('li', {}, 'إذا ظهر الباركود بصيغة مثل 6.29E+12 أو اختفت أصفاره البادئة فقد فقد Excel أرقامه — لا يمكن استعادتها من الملف؛ أعد إدخالها من العبوات أو من النظام الأصلي.'),
      h('li', {}, 'حد الملف: 10,000 صف و8 ميغابايت. للملفات الأكبر قسّمها.')),
      h('a', { class: 'btn sm light', href: '/import-template.csv', download: 'makeup-house-import-template.csv' }, 'تنزيل قالب CSV')),
    field('الملف', file)), out);
}

/* ---------- reports (manager) ---------- */
export async function reports(root) {
  try {
    const [r, rq] = await Promise.all([api('GET', '/api/reports/summary'), api('GET', '/api/requests/summary')]);
    root.append(h('h2', { class: 't' }, 'التقارير المعرفية'),
      h('div', { class: 'stats' }, h('div', { class: 'stat' }, h('b', {}, r.products), h('small', {}, 'أصناف')), h('div', { class: 'stat' }, h('b', {}, r.needs_review), h('small', {}, 'تحتاج مراجعة')), h('div', { class: 'stat' }, h('b', {}, r.unmet_requests), h('small', {}, 'طلبات غير ملباة'))),
      h('div', { class: 'card', style: 'margin-top:12px' }, h('h3', {}, 'حالات التوفر'), r.availability.map((a) => h('div', {}, AV[a.status], ': ', h('b', {}, a.count))), r.stale_available ? h('div', { class: 'notice' }, `${r.stale_available} منتج «متوفر» بتأكيد قديم.`) : null),
      h('div', { class: 'card' }, h('h3', {}, 'أكثر الطلبات غير الملباة تكرارًا'), rq.items.length ? h('div', { class: 'tw' }, h('table', {}, h('tr', {}, h('th', {}, 'الطلب'), h('th', {}, 'الفئة'), h('th', {}, 'التكرار'), h('th', {}, 'آخر مرة')), rq.items.map((i) => h('tr', {}, h('td', {}, i.text), h('td', {}, i.category || '—'), h('td', {}, h('b', {}, i.count)), h('td', {}, fmtDate(i.last_at)))))) : h('p', { class: 'muted' }, 'لا طلبات بعد.')));
  } catch (e) { root.append(h('div', { class: 'notice err' }, e.message)); }
}

/* ---------- users (manager) ---------- */
export async function users(root) {
  const list = h('div', {});
  const load = async () => {
    try {
      const { users: us } = await api('GET', '/api/users');
      list.replaceChildren(...us.map((u) => h('div', { class: 'card' }, h('div', { class: 'row sb' }, h('b', {}, u.display_name, ' ', h('span', { class: 'tiny muted' }, '@' + u.username)), h('span', { class: 'badge ' + (u.active ? 'ok' : 'no') }, u.active ? 'نشط' : 'موقوف')),
        h('div', { class: 'row', style: 'margin-top:6px' }, h('span', { class: 'badge' }, u.role === 'manager' ? 'مدير' : 'موظف'),
          h('button', { class: 'btn sm out', onclick: () => patch(u.id, { role: u.role === 'manager' ? 'staff' : 'manager' }) }, u.role === 'manager' ? 'تحويل لموظف' : 'ترقية لمدير'),
          h('button', { class: 'btn sm out', onclick: () => patch(u.id, { active: !u.active }) }, u.active ? 'إيقاف' : 'تفعيل'),
          h('button', { class: 'btn sm out', onclick: () => { const pw = prompt('كلمة مرور جديدة (10 أحرف على الأقل)'); if (pw) patch(u.id, { password: pw }); } }, 'تغيير كلمة المرور')))));
    } catch (e) { list.replaceChildren(h('div', { class: 'notice err' }, e.message)); }
  };
  const patch = async (id, body) => { try { await api('PATCH', '/api/users/' + id, body); toast('تم'); load(); } catch (e) { toast(e.message); } };
  const un = h('input', { dir: 'ltr', autocapitalize: 'none' }), dn = h('input', {}), pw = h('input', { type: 'password', autocomplete: 'new-password' }), role = select([['staff', 'موظف'], ['manager', 'مدير']], 'staff');
  root.append(h('h2', { class: 't' }, 'الموظفون والصلاحيات'), h('div', { class: 'card' }, h('h3', {}, 'إضافة مستخدم'), field('اسم المستخدم', un), field('الاسم الظاهر', dn), field('كلمة المرور (10+ أحرف)', pw), field('الدور', role),
    h('button', { class: 'btn', onclick: async () => { try { await api('POST', '/api/users', { username: un.value.trim(), display_name: dn.value.trim(), password: pw.value, role: role.value }); un.value = dn.value = pw.value = ''; toast('تمت الإضافة'); load(); } catch (e) { toast(e.message); } } }, 'إضافة')), list);
  load();
}

/* ---------- academy: starter lessons; every claim is a general, label-based principle ---------- */
const LESSONS = [
  ['قراءة المكونات', 'قائمة المكونات (INCI) تُقرأ من العبوة أو المصدر الرسمي للإصدار نفسه. لا نفترض وجود مكوّن فعّال اعتمادًا على اسم المنتج، وتركيبة المنتج نفسه قد تختلف بين الأسواق والإصدارات. ما لم يكن موثقًا في بطاقة المنتج فهو «غير موثق».'],
  ['واقيات الشمس', 'يشير SPF إلى الحماية من UVB وفق الاختبار المعتمد، ولا يكفي وحده لتقييم الحماية من UVA. اتبع تعليمات العبوة بخصوص الكمية وإعادة التطبيق.'],
  ['الحساسية والتهيج', 'لا يوجد منتج «آمن لجميع الأشخاص». عند حساسية معروفة اقرأ المكونات والتحذيرات، واقترح التجربة على منطقة صغيرة وفق العبوة.'],
  ['متى نحيل لمختص', 'عند تورم أو حروق أو طفح شديد أو أعراض مرضية، لا تُقدّم توصية منتج ولا تشخيصًا. انصح العميل بمراجعة مختص صحي.'],
  ['أسلوب الاستشارة', 'افهم الاحتياج أولًا (نوع البشرة/الشعر، الحساسية المعروفة)، ثم اعرض خيارات المحل المؤكد توفرها، وصرّح بحدود معلوماتك. التوفر القديم يحتاج تأكيدًا من الرف.'],
];
export function academy(root) {
  const box = h('div', { class: 'card hide' });
  root.append(h('h2', { class: 't' }, 'أكاديمية الموظفين'), h('p', { class: 'muted tiny' }, 'دروس تمهيدية بمبادئ عامة. الربط بالمنتجات الحقيقية والاختبارات القصيرة مخطط للمرحلة التالية.'),
    h('div', { class: 'grid c2' }, LESSONS.map(([t, body]) => h('div', { class: 'card' }, h('h3', {}, t), h('button', { class: 'btn sm light', onclick: () => { box.classList.remove('hide'); box.replaceChildren(h('h3', {}, t), h('p', {}, body)); box.scrollIntoView({ behavior: 'smooth' }); } }, 'افتح الدرس')))), box);
}
