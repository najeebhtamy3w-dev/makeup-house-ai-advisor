import { api } from './api.js';
import { h, toast, AV, field, select, fmtDate } from './util.js';

/* ---------- import (manager): preview -> commit; price/qty columns reported by NAME only ---------- */
export function importView(root) {
  const file = h('input', { type: 'file', accept: '.csv,.xlsx' }); const out = h('div', {});
  let buf = null, name = '';
  const send = async (commit) => {
    if (!buf) { toast('اختر ملفًا أولًا'); return; }
    try {
      const r = await api('POST', `/api/imports/${commit ? 'commit' : 'preview'}?filename=${encodeURIComponent(name)}`, buf, { raw: true });
      out.replaceChildren(h('div', { class: 'card' }, h('h3', {}, commit ? 'تم الاستيراد' : 'معاينة (لم يُحفظ شيء بعد)'),
        h('p', {}, `إجمالي الصفوف: ${r.total} · جديد: ${r.new} · مكرر في المكتبة: ${r.duplicates_existing} · مكرر داخل الملف: ${r.duplicates_in_file} · غير صالح: ${r.invalid}`),
        r.ignored_columns.length ? h('div', { class: 'notice' }, 'أعمدة تم تجاهلها كليًا (لم تُقرأ قيمها): ', r.ignored_columns.join('، ')) : null,
        r.warnings.map((w) => h('div', { class: 'notice' }, w)),
        r.invalid_rows.length ? h('div', { class: 'tw' }, h('table', {}, h('tr', {}, h('th', {}, 'السطر'), h('th', {}, 'السبب')), r.invalid_rows.map((x) => h('tr', {}, h('td', {}, x.line), h('td', {}, x.reason))))) : null,
        r.sample.length ? h('div', { class: 'tw' }, h('table', {}, h('tr', {}, h('th', {}, 'باركود'), h('th', {}, 'الاسم'), h('th', {}, 'العلامة')), r.sample.map((x) => h('tr', {}, h('td', {}, x.barcode || '—'), h('td', {}, x.name), h('td', {}, x.brand))))) : null,
        !commit && r.new > 0 ? h('button', { class: 'btn', onclick: () => send(true) }, `اعتماد استيراد ${r.new} منتج`) : null,
        commit ? h('div', { class: 'notice ok' }, 'كل الأصناف الجديدة بحالة «تحتاج مراجعة» وتوفر «غير مؤكد».') : null));
    } catch (e) { out.replaceChildren(h('div', { class: 'notice err' }, e.message)); }
  };
  file.addEventListener('change', async () => { const f = file.files[0]; if (!f) return; name = f.name; buf = await f.arrayBuffer(); send(false); });
  root.append(h('h2', { class: 't' }, 'استيراد الأصناف (XLSX / CSV)'), h('div', { class: 'card' },
    h('p', {}, 'الأعمدة المقبولة: barcode, name, brand, category, size, availability. أي عمود آخر (أسعار، كميات…) يُهمل ولا تُقرأ قيمه.'),
    h('div', { class: 'notice' }, 'نسّق عمود الباركود كنص في Excel لتبقى الأصفار البادئة. إعادة رفع الملف لا تكرّر المنتجات.'), field('الملف', file)), out);
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
