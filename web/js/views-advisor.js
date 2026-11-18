import { api } from './api.js';
import { h, fill, toast, AV, VER, avBadge, verBadge, fmtDate, field, select } from './util.js';
import { go } from './views-core.js';

/* ---------- WhatsApp recommendation card: no prices, no personal data ---------- */
export async function recommendationCard(productId) {
  const { product: p } = await api('GET', '/api/products/' + productId);
  const lines = [`✦ MAKEUP HOUSE — توصية`, '', `المنتج: ${p.name}${p.brand ? ' (' + p.brand + ')' : ''}${p.size ? ' — ' + p.size : ''}`];
  lines.push(p.benefits ? `سبب التوصية: ${p.benefits}` : 'سبب التوصية: مناسب لطلبك حسب المعلومات المسجلة (راجع العبوة للتفاصيل).');
  lines.push('طريقة الاستخدام: اتبع التعليمات المكتوبة على العبوة.');
  lines.push(p.warnings ? `احتياطات: ${p.warnings}` : 'احتياطات: اقرأ التحذيرات على العبوة، وجرّب على منطقة صغيرة عند الحساسية.');
  lines.push(`التوفر عند آخر تحقق (${fmtDate(p.availability_updated_at)}): ${AV[p.availability_effective]}${p.availability_stale ? ' — التأكيد قديم، سنتأكد من الرف' : ''}`);
  if (p.verification !== 'verified') lines.push('ملاحظة: معلومات المنتج قيد المراجعة.');
  return lines.join('\n');
}
function showCard(text) {
  const ta = h('textarea', { style: 'min-height:200px' }); ta.value = text;
  const sheet = h('div', { class: 'sheet', onclick: (e) => { if (e.target === sheet) sheet.remove(); } }, h('div', {},
    h('h3', { class: 't' }, 'بطاقة التوصية'), ta, h('p', { class: 'tiny muted' }, 'يمكنك تعديل النص قبل الإرسال. لا تحتوي على أسعار أو بيانات شخصية.'),
    h('div', { class: 'row' },
      h('a', { class: 'btn', target: '_blank', rel: 'noopener', href: 'https://wa.me/?text=' + encodeURIComponent(text), onclick: (e) => { e.currentTarget.href = 'https://wa.me/?text=' + encodeURIComponent(ta.value); } }, 'مشاركة عبر واتساب'),
      h('button', { class: 'btn out', onclick: async () => { try { await navigator.clipboard.writeText(ta.value); toast('تم النسخ'); } catch { ta.select(); toast('حدّد النص وانسخه'); } } }, 'نسخ'),
      h('button', { class: 'btn out', onclick: () => sheet.remove() }, 'إغلاق'))));
  document.body.append(sheet);
}

/* ---------- advisor: chat box is the primary element; suggestions only as small contextual chips ---------- */
export function advisor(root) {
  const msgs = h('div', { class: 'msgs', 'aria-live': 'polite' }, h('div', { class: 'bub' }, 'اكتب احتياج العميل بكلماتك. سأبحث في منتجات المحل المسجلة فقط، ولن أختلق مكونات أو توفرًا.'));
  const input = h('input', { placeholder: 'مثال: عندي زبونة بشرتها جافة وحساسة وتريد مرطب ما يهيج', enterkeyhint: 'send', 'aria-label': 'نص الاستشارة' });
  const chips = h('div', { class: 'sugg' });
  const setChips = (list) => chips.replaceChildren(...list.map((t) => h('button', { onclick: () => { input.value = t; send(); } }, t)));
  setChips(['مرطب للبشرة الجافة', 'واقي شمس', 'روتين للشعر']);
  const productLine = (e) => h('div', { style: 'border-top:1px solid var(--line);padding:8px 0' },
    h('div', { class: 'row sb' }, h('b', {}, e.name), avBadge({ availability_effective: e.availability })),
    h('div', { class: 'tiny muted' }, [e.brand, e.size].filter(Boolean).join(' · ')),
    h('div', { class: 'tiny' }, e.availability_note), e.warnings ? h('div', { class: 'tiny' }, '⚠ ', e.warnings) : null, e.reason ? h('div', { class: 'tiny' }, 'ℹ ', e.reason) : null,
    h('div', { class: 'row', style: 'margin-top:6px' }, verBadge(e.verification), h('button', { class: 'btn sm light', onclick: () => go('#/product/' + e.id) }, 'التفاصيل'),
      h('button', { class: 'btn sm light', onclick: async () => { try { showCard(await recommendationCard(e.id)); } catch (er) { toast(er.message); } } }, 'بطاقة توصية')));
  const render = (r) => {
    const box = h('div', { class: 'bub res' });
    if (r.safety_note) box.append(h('div', { class: 'notice err' }, r.safety_note));
    if (!r.safety_note) {
      box.append(h('h3', { class: 't' }, 'أولًا: منتجات ميك أب هاوس'));
      box.append(...(r.store_matches.length ? r.store_matches.map(productLine) : [h('p', { class: 'muted' }, 'لا يوجد منتج مسجّل مطابق بمعلومات كافية.')]));
      if (r.cannot_assess.length) box.append(h('h3', { class: 't', style: 'margin-top:12px' }, 'لا يمكن تقييمها (بيانات ناقصة)'), ...r.cannot_assess.map(productLine));
      box.append(h('h3', { class: 't', style: 'margin-top:12px' }, 'ثانيًا: بدائل عالمية غير مسجلة'), h('p', { class: 'muted tiny' }, r.global_alternatives.status === 'not_configured' ? 'البحث العالمي غير مفعّل بعد، لذلك لا تُعرض بدائل.' : ''));
    }
    r.notes.forEach((n) => box.append(h('div', { class: 'notice' }, n)));
    if (!r.safety_note && r.store_matches.length === 0) box.append(h('button', { class: 'btn sm light', onclick: () => go('#/request?text=' + encodeURIComponent(last)) }, 'سجّل كطلب غير ملبّى'));
    return box;
  };
  let last = '';
  async function send() {
    const q = input.value.trim(); if (!q) return; last = q; input.value = ''; chips.replaceChildren();
    msgs.append(h('div', { class: 'bub me' }, q)); msgs.scrollTop = msgs.scrollHeight;
    try { const r = await api('POST', '/api/advisor/search', { query: q }); msgs.append(render(r)); if (r.notes.length) setChips(['مرطب خالٍ من العطر', 'واقي شمس', 'شامبو']); }
    catch (e) { msgs.append(h('div', { class: 'notice err' }, e.message)); }
    msgs.scrollTop = msgs.scrollHeight;
  }
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
  root.append(h('div', { class: 'adv' }, msgs, chips, h('div', { class: 'tiny muted' }, 'استرجاع من بيانات المحل (بدون نموذج لغوي بعد). لا تشخيص طبي.'), h('div', { class: 'composer' }, input, h('button', { class: 'btn', onclick: send }, 'إرسال'))));
}

/* ---------- compare 2–3 products ---------- */
export async function compare(root) {
  let list = [];
  try { list = (await api('GET', '/api/products?limit=500')).products; } catch (e) { root.append(h('div', { class: 'notice err' }, e.message)); return; }
  const opts = [['', 'اختر منتجًا'], ...list.map((p) => [String(p.id), p.name])];
  const sels = [select(opts, ''), select(opts, ''), select([['', 'منتج ثالث (اختياري)'], ...opts.slice(1)], '')];
  const out = h('div', {});
  const ROWS = [['العلامة', 'brand'], ['التصنيف', 'category'], ['حجم العبوة', 'size'], ['المكونات', 'ingredients'], ['الفوائد/الاستخدام', 'benefits'], ['التحذيرات', 'warnings'], ['التوفر', 'availability_effective'], ['التوثيق', 'verification']];
  const val = (p, k) => (k === 'availability_effective' ? AV[p[k]] + (p.availability_stale ? ' (قديم)' : '') : k === 'verification' ? VER[p[k]] : p[k] || 'غير موثق');
  const run = async () => {
    const ids = [...new Set(sels.map((s) => s.value).filter(Boolean))];
    if (ids.length < 2) { out.replaceChildren(h('div', { class: 'notice' }, 'اختر منتجين مختلفين على الأقل.')); return; }
    const ps = (await Promise.all(ids.map((i) => api('GET', '/api/products/' + i)))).map((r) => r.product);
    const diff = ROWS.filter(([, k]) => new Set(ps.map((p) => val(p, k))).size > 1).map(([l]) => l);
    out.replaceChildren(
      h('div', { class: 'tw' }, h('table', {}, h('tr', {}, h('th', {}, 'المعيار'), ps.map((p) => h('th', {}, p.name))),
        ROWS.map(([l, k]) => h('tr', { style: diff.includes(l) ? 'background:#fffaf0' : '' }, h('td', {}, h('b', {}, l)), ps.map((p) => h('td', {}, val(p, k))))))),
      h('div', { class: 'notice ok' }, diff.length ? 'أبرز الفروق (مظللة): ' + diff.join('، ') + '.' : 'لا فروق في البيانات المسجلة.'),
      h('div', { class: 'notice' }, 'لا يوجد «فائز مطلق». اختر حسب احتياج العميل المحدد، وحيث تظهر «غير موثق» فالمعلومة غير مسجلة ولا يجوز افتراضها.'));
  };
  root.append(h('h2', { class: 't' }, 'مقارنة المنتجات'), h('div', { class: 'card' }, sels.map((s, i) => field(['المنتج الأول', 'المنتج الثاني', 'المنتج الثالث'][i], s)), h('button', { class: 'btn', onclick: () => run().catch((e) => toast(e.message)) }, 'عرض المقارنة')), out);
}

/* ---------- routine: built from REAL store products; gaps become unmet-request prompts ---------- */
const STEPS = {
  skin: { am: [['تنظيف لطيف', /(غسول|منظف|تنظيف|cleanser)/i], ['ترطيب', /(مرطب|ترطيب|moistur)/i], ['حماية من الشمس', null, 'واقيات الشمس']], pm: [['تنظيف لطيف', /(غسول|منظف|تنظيف|cleanser)/i], ['ترطيب', /(مرطب|ترطيب|moistur)/i]] },
  hair: { am: [['غسل الشعر', /(شامبو|shampoo)/i], ['بلسم / ترطيب الأطراف', /(بلسم|ماسك|conditioner)/i]], pm: [] },
};
export async function routine(root) {
  const type = select([['skin', 'العناية بالبشرة'], ['hair', 'العناية بالشعر']], 'skin');
  const out = h('div', {});
  const run = async () => {
    const { products } = await api('GET', '/api/products?limit=500');
    const def = STEPS[type.value];
    const block = (title, steps) => steps.length ? h('div', { class: 'card' }, h('h3', {}, title), steps.map(([label, re, cat]) => {
      const m = products.filter((p) => (cat ? p.category === cat : re.test(p.name)));
      const ok = m.filter((p) => p.availability_effective === 'yes'), rest = m.filter((p) => p.availability_effective !== 'yes');
      return h('div', { style: 'border-top:1px solid var(--line);padding:8px 0' }, h('b', {}, label),
        ok.length ? ok.map((p) => h('div', {}, '✔ ', p.name, ' ', verBadge(p.verification), p.warnings ? h('div', { class: 'tiny' }, '⚠ ', p.warnings) : null)) : h('div', { class: 'muted tiny' }, 'لا يوجد منتج متوفر مؤكد لهذه الخطوة.'),
        rest.length ? h('div', { class: 'tiny muted' }, 'غير متوفر/غير مؤكد: ', rest.map((p) => p.name).join('، ')) : null,
        !ok.length ? h('button', { class: 'btn sm light', onclick: () => go('#/request?text=' + encodeURIComponent(label)) }, 'سجّل كطلب غير ملبّى') : null);
    })) : null;
    fill(out, block('صباحًا', def.am), block('مساءً', def.pm),
      h('div', { class: 'notice' }, 'الترتيب عام. عدد مرات الاستخدام والتداخلات تؤخذ من تعليمات كل عبوة، ولا تُعرض هنا ما لم تكن موثقة. لا يغني عن مختص عند الأعراض أو الحساسية الشديدة.'));
  };
  type.addEventListener('change', () => run().catch((e) => toast(e.message)));
  root.append(h('h2', { class: 't' }, 'روتين العناية'), h('div', { class: 'card' }, field('المجال', type)), out);
  run().catch((e) => out.replaceChildren(h('div', { class: 'notice err' }, e.message)));
}

/* ---------- unmet request (non-personal) ---------- */
export function requestForm(root, params) {
  const text = h('input', { value: params.get('text') ?? '', placeholder: 'مثال: مرطب خالٍ من العطر', maxlength: 200 });
  const brand = h('input', { placeholder: 'العلامة (اختياري)' }), note = h('input', { placeholder: 'تفاصيل الاحتياج (بلا بيانات شخصية)', maxlength: 300 });
  const cat = select([['', 'الفئة (اختياري)'], ...['العناية بالبشرة', 'العناية بالشعر', 'واقيات الشمس', 'المكياج والجمال', 'العطور والعناية', 'أخرى'].map((c) => [c, c])], '');
  root.append(h('h2', { class: 't' }, 'طلب غير ملبّى'), h('div', { class: 'card' }, h('p', { class: 'muted' }, 'سجّل ما طلبه العميل ولم تجده، لمساعدة الإدارة على سد فجوات التشكيلة.'),
    field('المنتج أو الاحتياج *', text), field('الفئة', cat), field('العلامة', brand), field('ملاحظة', note), h('div', { class: 'notice' }, 'لا تكتب اسم العميل أو رقمه. يُرفض النص الذي يبدو كرقم هاتف أو بريد.'),
    h('button', { class: 'btn', onclick: async () => { try { await api('POST', '/api/requests', { text: text.value, category: cat.value, brand: brand.value, note: note.value }); toast('تم تسجيل الطلب'); go('#/home'); } catch (e) { toast(e.message); } } }, 'تسجيل')));
}
