import { api } from './api.js';
import { h, fill, toast, AV, VER, avBadge, verBadge, fmtDate, field, select, skeleton, errorBox, debounce } from './util.js';
import { go } from './views-core.js';
import { thumb } from './images.js';
import { loadTaxonomy, typeLabel } from './taxonomy.js';

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

/* ---------- advisor: chat box is the primary element; chips appear ONLY as contextual follow-ups from the engine ---------- */
const LEVEL = { documented: ['موثقة', 'ok'], partial: ['جزئية', 'warn'], unknown: ['غير معروفة', 'no'] };
const VERDICT = { suitable: 'ok', conditional: 'warn', insufficient: 'info', excluded: 'no' };
const FRAG = { contains: 'no', fragrance_free: 'ok', unscented_claim: 'warn', unknown: 'info' };
const ul = (items) => (items && items.length ? h('ul', { style: 'margin:4px 0 0;padding-inline-start:18px' }, items.map((r) => h('li', {}, r))) : null);
/** Explanation block: what was used, what is missing, precautions, limits — every recommendation must be explainable. */
const why = (sv) => h('details', { class: 'why' }, h('summary', {}, 'لماذا هذا الحكم؟ (المعلومات المستخدمة والناقصة)'),
  sv.used_info?.length ? h('div', { class: 'tiny' }, h('b', {}, 'المعلومات المستخدمة'), ul(sv.used_info)) : null,
  sv.missing?.length ? h('div', { class: 'tiny' }, h('b', {}, 'معلومات ناقصة'), ul(sv.missing)) : null,
  sv.precautions?.length ? h('div', { class: 'tiny' }, h('b', {}, 'احتياطات'), ul(sv.precautions)) : null,
  sv.limitations?.length ? h('div', { class: 'tiny muted' }, h('b', {}, 'حدود المعلومة'), ul(sv.limitations)) : null);
export function advisor(root) {
  const msgs = h('div', { class: 'msgs', 'aria-live': 'polite' }, h('div', { class: 'bub' }, 'صِفي البشرة أو الشعر والمشكلة أو المنتج المطلوب بكلماتك (فصحى أو لهجة). أشرح وأرشد من معرفة منظمة بمصادرها، ثم أبحث في منتجات المحل المسجلة. لا تشخيص طبي.'));
  const input = h('input', { placeholder: 'مثال: زبونة بشرتها جافة وحساسة وتريد مرطب ما يهيج', enterkeyhint: 'send', 'aria-label': 'نص الاستشارة' });
  const chips = h('div', { class: 'sugg' }); let last = '';
  const setChips = (list, append) => fill(chips, list.map((t) => h('button', { onclick: () => { input.value = append ? last + ' ' + t : t; send(); } }, t)));
  const productLine = (e) => h('div', { class: 'pl' },
    h('div', { class: 'prod' }, thumb(e, 'sm'), h('div', { class: 'bd' },
      h('div', { class: 'row sb' }, h('b', {}, e.name), verBadge(e.verification)),
      h('div', { class: 'tiny muted' }, [e.brand, e.product_type_label, e.size].filter(Boolean).join(' · ')))),
    e.suitability ? h('div', { class: 'blk' }, h('b', {}, 'الملاءمة: '), h('span', { class: 'badge ' + (VERDICT[e.suitability.verdict] || 'info') }, e.suitability.verdict_label || LEVEL[e.suitability.level][0]),
      e.formulation && e.formulation.status !== 'verified' ? h('span', { class: 'badge warn', style: 'margin-inline-start:6px', title: e.formulation.label }, 'FORMULATION NOT VERIFIED') : null,
      ul(e.suitability.reasons), e.reason ? h('div', {}, 'ℹ ', e.reason) : null, e.suitability.used_info ? why(e.suitability) : null) : null,
    e.fragrance ? h('div', { class: 'blk' }, h('b', {}, 'العطر: '), h('span', { class: 'badge ' + FRAG[e.fragrance.status] }, e.fragrance.label)) : null,
    h('div', { class: 'blk' }, h('b', {}, 'التوفر: '), avBadge({ availability_effective: e.availability }), ' ', h('span', { class: 'tiny' }, e.availability_note)),
    e.alternatives?.length ? h('div', { class: 'blk tiny' }, h('b', {}, 'بدائل متوفرة: '), e.alternatives.map((a) => h('button', { class: 'btn sm light', style: 'margin-inline-end:4px', onclick: () => go('#/product/' + a.id) }, a.name))) : null,
    e.conflict ? h('div', { class: 'notice' }, 'معلومات متعارضة بين المصادر قيد مراجعة المدير.') : null,
    e.warnings ? h('div', { class: 'tiny' }, '⚠ ', e.warnings) : null,
    e.source_url ? h('div', { class: 'tiny' }, 'المصدر: ', h('a', { href: e.source_url, target: '_blank', rel: 'noopener noreferrer' }, 'فتح الرابط')) : h('div', { class: 'tiny muted' }, 'لا يوجد رابط مصدر مسجل.'),
    h('div', { class: 'row', style: 'margin-top:6px' }, h('button', { class: 'btn sm light', onclick: () => go('#/product/' + e.id) }, 'التفاصيل'),
      h('button', { class: 'btn sm light', onclick: async () => { try { showCard(await recommendationCard(e.id)); } catch (er) { toast(er.message); } } }, 'بطاقة توصية'),
      h('button', { class: 'btn sm out', onclick: () => go('#/compare') }, 'قارن')));
  // CP06.2 Phase 5A: multi-turn consultation (POST /api/advisor/chat). Knowledge and guidance never depend on products.
  let sessionId = null;
  const modeLine = h('div', { class: 'tiny muted', id: 'advisor-mode' }, 'جارٍ التحقق من وضع التشغيل…');
  api('GET', '/api/advisor/status').then((st) => fill(modeLine, st.ai ? `وضع حواري: نموذج ${st.ai.model} مفعّل ضمن حد إنفاق ${st.ai.monthly_budget_usd}$ شهريًا. المعرفة والمنتجات من مصادرها لا من النموذج.` : 'وضع معرفي محدود: لا يوجد نموذج لغوي مفعّل — الإجابات من معرفة منظمة بمصادر ومن بيانات المحل. لا تشخيص طبي.')).catch(() => fill(modeLine, 'وضع معرفي محدود. لا تشخيص طبي.'));
  const KIND_ORDER = ['safety_warnings', 'understanding', 'clarifying_questions', 'condition_education', 'practical_advice', 'ingredient_guidance', 'suggested_routine', 'local_recommendations', 'global_alternatives', 'confidence_limitations', 'sources', 'evidence_status'];
  const COLLAPSED = new Set(['condition_education', 'ingredient_guidance', 'suggested_routine']);
  const items = (sec) => sec.items.length ? h('ul', { class: 'advlist' }, sec.items.map((i) => h('li', {}, i.text))) : null;
  const render = (r) => {
    const box = h('div', { class: 'bub res' });
    const res = r.response; const secs = [...res.sections].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
    // the safety stop always comes first and is never folded
    for (const sec of secs) {
      if (sec.kind === 'safety_warnings') { box.append(h('div', { class: res.safety_stop && sec.title === 'تنبيه مهم' ? 'notice err' : 'notice', role: res.safety_stop ? 'alert' : null }, h('b', {}, sec.title), items(sec))); continue; }
      if (sec.kind === 'understanding') { box.append(h('div', { class: 'advunder' }, sec.items.map((i) => h('p', {}, i.text)))); continue; }
      if (sec.kind === 'clarifying_questions') { box.append(h('div', { class: 'notice info' }, h('b', {}, sec.title), items(sec))); continue; }
      if (sec.kind === 'local_recommendations') {
        const d = sec.data ?? {};
        if (d.answer?.type === 'fragrance_status') { const a = d.answer; box.append(h('h3', { class: 't' }, a.product.name), h('div', { class: 'blk' }, h('b', {}, 'العطر: '), h('span', { class: 'badge ' + FRAG[a.fragrance.status] }, a.fragrance.label), ul(a.fragrance.why)), h('div', { class: 'blk' }, h('span', { class: 'badge ' + (a.formulation.status === 'verified' ? 'ok' : 'warn') }, a.formulation.label)), h('button', { class: 'btn sm light', onclick: () => go('#/product/' + a.product.id) }, 'فتح المنتج'), ...sec.items.map((i) => h('div', { class: 'notice' }, i.text))); continue; }
        box.append(h('h3', { class: 't' }, sec.title));
        const store = d.store_matches ?? [], un = d.cannot_assess ?? [];
        if (!store.length && !un.length) box.append(...sec.items.map((i) => h('p', { class: 'muted' }, i.text)));
        box.append(...store.map(productLine));
        if (un.length) box.append(h('h4', {}, 'لا يمكن تقييمها (بيانات ناقصة)'), ...un.map(productLine));
        if (d.excluded?.length) box.append(h('h4', {}, 'مستبعد لأسباب موثقة'), ...d.excluded.map((x) => h('div', { class: 'pl' }, h('b', {}, x.name), ' ', h('span', { class: 'badge no' }, 'توجد أسباب موثقة'))));
        if (d.note) box.append(h('p', { class: 'tiny muted' }, d.note));
        continue;
      }
      if (sec.kind === 'global_alternatives') {
        const hits = sec.data?.items ?? [];
        box.append(h('h3', { class: 't', style: 'margin-top:12px' }, sec.title), hits.length ? h('div', {}, hits.map((x) => h('div', { class: 'pl' }, h('b', {}, x.name || '—'), x.brand ? h('span', { class: 'tiny muted' }, ' — ' + x.brand) : null,
          h('div', { class: 'tiny' }, h('span', { class: 'badge warn' }, 'التوفر في المحل غير مؤكد'), ' ', h('span', { class: 'badge info' }, 'لم تُقيَّم ملاءمته'), ' ', x.provider, x.source_url ? [' · ', h('a', { href: x.source_url, target: '_blank', rel: 'noopener noreferrer' }, 'المصدر')] : null)))) : h('p', { class: 'muted tiny' }, sec.items.map((i) => i.text).join(' ')));
        continue;
      }
      if (sec.kind === 'sources') {
        box.append(h('details', { class: 'why srcs' }, h('summary', {}, `المصادر (${res.sources.length})`), h('ul', { class: 'advlist tiny' }, res.sources.map((x) => h('li', {}, h('a', { href: x.url, target: '_blank', rel: 'noopener noreferrer' }, x.title), ' — ', x.publisher)))));
        continue;
      }
      if (sec.kind === 'evidence_status' || sec.kind === 'confidence_limitations') { box.append(h('p', { class: 'tiny muted' }, h('b', {}, sec.title + ': '), sec.items.map((i) => i.text).join(' '))); continue; }
      const body = h('div', {}, items(sec));
      box.append(COLLAPSED.has(sec.kind) ? h('details', { class: 'advsec' }, h('summary', {}, sec.title), body) : h('div', { class: 'advsec' }, h('h3', { class: 't' }, sec.title), body));
    }
    if (!res.safety_stop && res.sections.some((x) => x.kind === 'local_recommendations' && !(x.data?.store_matches?.length))) box.append(h('button', { class: 'btn sm light', onclick: () => go('#/request?text=' + encodeURIComponent(last)) }, 'سجّل كطلب غير ملبّى'));
    return box;
  };
  async function send() {
    const q = input.value.trim(); if (!q) return; last = q; input.value = ''; fill(chips);
    msgs.append(h('div', { class: 'bub me' }, q)); const wait = h('div', { class: 'bub res' }, skeleton(1)); msgs.append(wait); msgs.scrollTop = msgs.scrollHeight;
    try {
      const r = await api('POST', '/api/advisor/chat', { message: q, ...(sessionId ? { session_id: sessionId } : {}) });
      sessionId = r.session_id; wait.replaceWith(render(r));
      if (r.response.follow_up) setChips(r.response.follow_up.choices, true);
    } catch (e) { wait.replaceWith(errorBox(e.status ? e.message : 'تعذر الاتصال. أعد المحاولة.', () => { input.value = q; send(); })); }
    msgs.scrollTop = msgs.scrollHeight;
  }
  const resetBtn = h('button', { class: 'btn sm out', type: 'button', id: 'advisor-reset', onclick: async () => {
    if (sessionId) { try { await api('DELETE', '/api/advisor/session/' + sessionId); } catch { /* already gone */ } }
    sessionId = null; last = ''; fill(chips); fill(msgs, h('div', { class: 'bub' }, 'محادثة جديدة: لا تُستخدم أي معلومة من المحادثة السابقة.')); } }, 'محادثة جديدة');
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
  root.append(h('div', { class: 'adv' }, h('div', { class: 'row sb' }, modeLine, resetBtn), msgs, chips, h('div', { class: 'composer' }, input, h('button', { class: 'btn', onclick: send }, 'إرسال'))));
}

/* ---------- compare 2–3 products ---------- */
export async function compare(root) {
  await loadTaxonomy().catch(() => {});
  // CP06: products are picked by searching the WHOLE catalog (the old dropdown listed at most 500)
  const chosen = [];
  const q = h('input', { type: 'search', placeholder: 'ابحث بالاسم أو العلامة أو الباركود لإضافة منتج', 'aria-label': 'بحث منتج للمقارنة', id: 'cmp-q' });
  const hits = h('div', { class: 'cmp-hits' }); const picked = h('div', { class: 'row', id: 'cmp-picked' });
  const drawPicked = () => fill(picked, chosen.length ? chosen.map((p, i) => h('button', { class: 'chip on sm', type: 'button', 'aria-label': 'إزالة ' + p.name, onclick: () => { chosen.splice(i, 1); drawPicked(); } }, p.name, ' ✕')) : h('span', { class: 'tiny muted' }, 'اختر منتجين أو ثلاثة.'));
  q.addEventListener('input', debounce(async () => {
    const t = q.value.trim(); if (!t) { fill(hits); return; }
    try { const r = await api('GET', '/api/products?view=compact&limit=8&q=' + encodeURIComponent(t));
      fill(hits, r.products.length ? r.products.map((p) => h('button', { class: 'cmp-hit', type: 'button', disabled: chosen.length >= 3 || chosen.some((c) => c.id === p.id) ? true : null, onclick: () => { chosen.push(p); drawPicked(); fill(hits); q.value = ''; } }, p.name, h('small', {}, [p.brand, p.size].filter(Boolean).join(' · ')))) : h('div', { class: 'tiny muted' }, 'لا نتائج.'), r.total > 8 ? h('div', { class: 'tiny muted' }, `${r.total} نتيجة — اكتب أكثر لتضييقها`) : null);
    } catch (e) { fill(hits, h('div', { class: 'notice err' }, e.message)); }
  }));
  const sels = { values: () => chosen.map((p) => String(p.id)) };
  const out = h('div', {});
  const ROWS = [['العلامة', 'brand'], ['التصنيف', 'category'], ['نوع المنتج', 'product_type'], ['حجم العبوة', 'size'], ['المكونات', 'ingredients'], ['الفوائد/الاستخدام', 'benefits'], ['التحذيرات', 'warnings'], ['التوفر', 'availability_effective'], ['التوثيق', 'verification']];
  const val = (p, k) => (k === 'product_type' ? typeLabel(p[k]) || 'غير مصنف' : k === 'availability_effective' ? AV[p[k]] + (p.availability_stale ? ' (قديم)' : '') : k === 'verification' ? VER[p[k]] : p[k] || 'غير موثق');
  const run = async () => {
    const ids = [...new Set(sels.values())];
    if (ids.length < 2) { out.replaceChildren(h('div', { class: 'notice' }, 'اختر منتجين مختلفين على الأقل.')); return; }
    const ps = (await Promise.all(ids.map((i) => api('GET', '/api/products/' + i)))).map((r) => r.product);
    const diff = ROWS.filter(([, k]) => new Set(ps.map((p) => val(p, k))).size > 1).map(([l]) => l);
    out.replaceChildren(
      h('div', { class: 'tw' }, h('table', {}, h('tr', {}, h('th', {}, 'المعيار'), ps.map((p) => h('th', {}, p.name))),
        ROWS.map(([l, k]) => h('tr', { style: diff.includes(l) ? 'background:#fffaf0' : '' }, h('td', {}, h('b', {}, l)), ps.map((p) => h('td', {}, val(p, k))))))),
      h('div', { class: 'notice ok' }, diff.length ? 'أبرز الفروق (مظللة): ' + diff.join('، ') + '.' : 'لا فروق في البيانات المسجلة.'),
      h('div', { class: 'notice' }, 'لا يوجد «فائز مطلق». اختر حسب احتياج العميل المحدد، وحيث تظهر «غير موثق» فالمعلومة غير مسجلة ولا يجوز افتراضها.'));
  };
  root.append(h('h2', { class: 't' }, 'مقارنة المنتجات'), h('div', { class: 'card' }, field('ابحث عن منتج', q), hits, picked, h('button', { class: 'btn', id: 'cmp-run', onclick: () => run().catch((e) => toast(e.message)) }, 'عرض المقارنة')), out);
  drawPicked();
}

/* ---------- routine: built from REAL store products; gaps become unmet-request prompts ---------- */
export async function routine(root) {
  const type = select([['skin', 'العناية بالبشرة'], ['hair', 'العناية بالشعر']], 'skin');
  const out = h('div', {});
  const run = async () => {
    // CP06: computed by the server/on-device engine over the WHOLE catalog (was limited to 500 downloaded products)
    const def = await api('GET', '/api/routine?area=' + type.value);
    const block = (title, steps) => steps.length ? h('div', { class: 'card' }, h('h3', {}, title), steps.map((st) => {
      const ok = st.products.filter((p) => p.availability_effective === 'yes'), rest = st.products.filter((p) => p.availability_effective !== 'yes');
      return h('div', { style: 'border-top:1px solid var(--line);padding:8px 0', 'data-step': st.label }, h('b', {}, st.label), st.total > st.products.length ? h('span', { class: 'tiny muted' }, ` (يُعرض ${st.products.length} من ${st.total})`) : null,
        ok.length ? ok.map((p) => h('div', {}, '✔ ', p.name, ' ', verBadge(p.verification), p.warnings ? h('div', { class: 'tiny' }, '⚠ ', p.warnings) : null)) : h('div', { class: 'muted tiny' }, 'لا يوجد منتج متوفر مؤكد لهذه الخطوة.'),
        rest.length ? h('div', { class: 'tiny muted' }, 'غير متوفر/غير مؤكد: ', rest.map((p) => p.name).join('، ')) : null,
        !ok.length ? h('button', { class: 'btn sm light', onclick: () => go('#/request?text=' + encodeURIComponent(st.label)) }, 'سجّل كطلب غير ملبّى') : null);
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
