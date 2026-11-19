// CP05 shared discovery UI: one component for (a) a NEW product form and (b) completing an EXISTING / imported product.
// It only ever proposes. New form: identity fields can be copied INTO THE FORM (still a draft). Ingredients and images remain
// source drafts that a manager approves after the card exists (existing review rules). Existing product: drafts are attached
// to the SAME record (by its barcode) — never a new product.
import { api } from './api.js';
import { h, fill, toast, busy, skeleton, errorBox, FIELD_LABEL, ENRICH_LABEL, haptic } from './util.js';
import { authImg, thumb } from './images.js';
import { startCamera } from './scanner.js';

const MATCH = { exact: ['✓', 'ok'], partial: ['≈', 'warn'], conflict: ['✗', 'no'], missing: ['?', 'info'] };
const RFIELD = { barcode: 'الباركود', name: 'الاسم', brand: 'العلامة', size: 'الحجم' };
export const NOT_FROM_SOURCE = 'لا يوفر المصدر: التصنيف، الاستخدام والفوائد، التحذيرات — أدخلها من العبوة نفسها.';

const reasonChips = (reasons) => h('div', { class: 'reasons' }, reasons.map((r) => h('span', { class: 'badge ' + MATCH[r.match][1], title: r.note }, MATCH[r.match][0], ' ', RFIELD[r.field], r.match !== 'exact' && r.note ? ' — ' + r.note : '')));

/** Bottom-sheet barcode scanner (rear camera). Calls onCode(code) once. Falls back with a clear message. */
export function scanSheet(onCode) {
  const video = h('video', { playsinline: true, muted: true }); const frame = h('div', { class: 'frame' }); const msg = h('div', { class: 'vfmsg' }, 'جارٍ طلب إذن الكاميرا…');
  let stop = null; const close = () => { stop?.(); sheet.remove(); };
  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-label': 'مسح الباركود' }, h('div', {},
    h('h3', { class: 't' }, 'مسح الباركود'), h('div', { class: 'viewfinder' }, video, frame, msg), h('button', { class: 'btn out', style: 'width:100%;margin-top:8px', onclick: close }, 'إغلاق')));
  document.body.append(sheet);
  startCamera(video, { onState: (s) => { if (s === 'scanning') msg.textContent = 'ضع الباركود داخل الإطار'; if (s === 'success') { frame.classList.add('ok'); haptic(60); } }, onCode: (v) => { close(); onCode(v); } })
    .then((s) => { stop = s; }).catch((e) => { msg.textContent = e.message; });
}

/**
 * @param {object} o
 *  mode: 'new' | 'product'; me; product (product mode)
 *  query(): { barcode, name, brand, size }   — read from the form
 *  apply(field, value)                       — new mode: copy an identity value into the form
 *  setBarcode(code)                          — new mode: put a chosen hit's barcode into the form
 *  onChanged()                               — product mode: reload the product after a decision
 */
export function discoveryPanel(o) {
  const out = h('div', { class: 'disc', 'aria-live': 'polite' });
  const isMgr = o.me.role === 'manager';

  const candidateRow = (c) => {
    const isIdentity = ['name', 'brand', 'size'].includes(c.field);
    let actions = null;
    if (o.mode === 'new') actions = isIdentity ? h('button', { class: 'btn sm light', type: 'button', onclick: () => { o.apply(c.field, c.value); toast('نُسخت إلى النموذج كمسودة — قارنها بالعبوة'); } }, 'استخدام في النموذج')
      : h('div', { class: 'tiny muted' }, 'تُحفظ كمسودة وتظهر في بطاقة المنتج بعد الحفظ لاعتماد المدير.');
    else if (isMgr) actions = h('div', { class: 'row' },
      h('button', { class: 'btn sm', type: 'button', onclick: (e) => decide(c, 'approve', e.currentTarget) }, c.field === 'image_url' ? 'اعتماد الصورة' : 'اعتماد'),
      h('button', { class: 'btn sm danger', type: 'button', onclick: (e) => decide(c, 'reject', e.currentTarget) }, 'رفض'));
    else actions = h('span', { class: 'badge warn' }, 'بانتظار اعتماد المدير');
    return h('div', { class: 'cand' + (c.conflict_note ? ' conf' : '') },
      h('div', { class: 'row sb' }, h('b', {}, FIELD_LABEL[c.field] ?? c.field), h('span', { class: 'tiny muted' }, c.source_name, c.license ? ' · ' + c.license : '')),
      c.field === 'image_url' ? authImg(`/api/enrichment/candidates/${c.id}/image`, 'صورة مقترحة من المصدر', 'candimg') : h('div', { class: 'cval', dir: 'auto' }, c.value),
      c.quality_note ? h('div', { class: 'notice' }, '⚠ ', c.quality_note) : null,
      c.conflict_note ? h('div', { class: 'notice' }, c.conflict_note) : null,
      c.field === 'image_url' ? h('div', { class: 'tiny muted' }, 'اعتمدها فقط إن طابقت العبوة في يدك (الاسم والحجم والإصدار).') : null,
      c.source_url ? h('div', { class: 'tiny' }, h('a', { href: c.source_url, target: '_blank', rel: 'noopener noreferrer' }, 'صفحة المصدر')) : null,
      actions);
  };
  const decide = (c, action, btn) => busy(btn, async () => {
    try { await api('POST', `/api/enrichment/candidates/${c.id}/review`, { action }); toast(action === 'approve' ? 'تم الاعتماد' : 'تم الرفض'); o.onChanged?.(); }
    catch (e) { toast(e.message); }
  });

  const localBlock = (local) => local.length ? h('div', { class: 'card inset' }, h('h4', {}, 'في مكتبة المحل'),
    local.map((p) => h('div', { class: 'hit' }, h('div', { class: 'prod' }, thumb(p, 'sm'), h('div', { class: 'bd' },
      h('div', { class: 'row sb' }, h('b', {}, p.name), h('span', { class: 'badge ' + (p.status === 'same_barcode' ? 'no' : 'warn') }, p.label)),
      h('div', { class: 'tiny muted', dir: 'auto' }, [p.brand, p.size, p.barcode].filter(Boolean).join(' · ')), reasonChips(p.reasons),
      h('a', { class: 'btn sm light', href: '#/product/' + p.id }, 'فتح السجل الموجود')))))) : null;

  const hitRow = (hit) => h('div', { class: 'hit' },
    h('div', { class: 'row sb' }, h('b', { dir: 'auto' }, hit.name || '(بلا اسم في المصدر)'), h('span', { class: 'badge warn' }, hit.status)),
    h('div', { class: 'tiny muted', dir: 'auto' }, [hit.brand, hit.size || 'الحجم غير مذكور', hit.code].filter(Boolean).join(' · '), hit.has_image ? ' · 🖼' : ''),
    reasonChips(hit.reasons),
    hit.in_store_id ? h('a', { class: 'btn sm light', href: '#/product/' + hit.in_store_id }, 'هذا الباركود مسجل في المحل — فتحه')
      : h('div', { class: 'row' }, h('button', { class: 'btn sm', type: 'button', onclick: () => choose(hit) }, 'هذا هو المنتج (تأكدت من العبوة)'),
        h('a', { class: 'btn sm out', href: hit.source_url, target: '_blank', rel: 'noopener noreferrer' }, 'صفحة المصدر')));

  async function choose(hit) {
    if (o.mode === 'new') { o.setBarcode(hit.code); run(); return; }
    // existing product without a barcode: linking a barcode is an identity claim -> explicit confirmation, record goes to review
    if (!confirm(`ربط الباركود ${hit.code} بهذا المنتج؟\nتأكد أنه مطبوع على العبوة نفسها. سيُعاد المنتج إلى «تحتاج مراجعة».`)) return;
    try { await api('PATCH', '/api/products/' + o.product.id, { barcode: hit.code }); toast('رُبط الباركود. جارٍ جلب المعلومات…'); o.product.barcode = hit.code; await run(); o.onChanged?.(); }
    catch (e) { toast(e.message); }
  }

  const render = (r) => {
    const g = r.global; const blocks = [localBlock(r.local)];
    if (o.mode === 'new' && r.type_suggestion && o.applyType) blocks.push(h('div', { class: 'notice info row' }, `نوع مقترح من الاسم: ${r.type_suggestion.label} (مقترح، غير مؤكد)`, h('button', { class: 'btn sm light', type: 'button', onclick: () => { o.applyType(r.type_suggestion.id); toast('اختير النوع — يمكنك تغييره'); } }, 'استخدام')));
    if (g.mode === 'disabled' || g.outcome === 'unsupported') blocks.push(h('div', { class: 'notice' }, g.note));
    else if (g.mode === 'barcode') {
      const out = g.outcome === 'found' && g.conflict ? 'conflict' : g.outcome;
      blocks.push(h('div', { class: 'card inset' }, h('div', { class: 'row sb' }, h('h4', {}, 'من المصادر (بالباركود)'), h('span', { class: 'badge ' + (out === 'unreachable' ? 'no' : 'warn') }, g.status ?? ENRICH_LABEL[out] ?? out)),
        out === 'unreachable' ? errorBox('تعذر الاتصال بالمصدر. لم يُفقد شيء — أكمل يدويًا أو أعد المحاولة.', run) : null,
        out === 'rate_limited' ? h('div', { class: 'notice' }, 'بلغنا حد الطلبات للمصدر. أعد المحاولة بعد دقيقة.') : null,
        out === 'not_found' ? h('div', { class: 'notice info' }, 'المنتج غير موجود في المصدر المفعّل. أدخل بياناته من العبوة، وصوّرها.') : null,
        g.candidates?.length ? [h('div', { class: 'notice info' }, 'كل ما يلي مسودات غير معتمدة. الباركود وحده لا يثبت تطابق التركيبة — قارن بالعبوة.'), g.candidates.map(candidateRow), h('div', { class: 'tiny muted' }, NOT_FROM_SOURCE)] : null));
    } else if (g.mode === 'name') {
      blocks.push(h('div', { class: 'card inset' }, h('div', { class: 'row sb' }, h('h4', {}, 'مرشحون من المصادر (بالاسم)'), h('span', { class: 'badge warn' }, g.hits?.length ? `${g.hits.length} مرشح` : ENRICH_LABEL[g.outcome] ?? g.outcome)),
        g.outcome === 'unreachable' ? errorBox('تعذر الاتصال بالمصدر. أكمل يدويًا أو أعد المحاولة.', run) : null,
        g.outcome === 'rate_limited' ? h('div', { class: 'notice' }, 'بلغنا حد البحث للمصدر. أعد المحاولة بعد دقيقة.') : null,
        g.outcome === 'not_found' ? h('div', { class: 'notice info' }, 'لا مرشحين في المصدر. امسح الباركود إن وجد، أو أدخل البيانات يدويًا.') : null,
        g.hits?.length ? [h('div', { class: 'notice info' }, 'تشابه الاسم ليس إثباتًا: الحجم والإصدار والسوق قد تختلف. اختر فقط ما يطابق الباركود والحجم المطبوعين على العبوة.'), g.hits.map(hitRow)] : null));
    }
    blocks.push(h('p', { class: 'tiny muted' }, r.coverage_note));
    fill(out, blocks);
  };

  async function run(btn) {
    const q = o.mode === 'product' ? { barcode: o.product.barcode ?? '', name: o.product.name, brand: o.product.brand, size: o.product.size } : o.query();
    if (!q.barcode && (q.name ?? '').trim().length < 2) { fill(out, h('div', { class: 'notice err' }, 'أدخل الباركود (أو امسحه) أو اسم المنتج أولًا.')); return; }
    fill(out, h('div', { class: 'tiny muted', role: 'status' }, q.barcode ? 'أبحث في المحل ثم في المصادر بالباركود…' : 'أبحث في المحل ثم في المصادر بالاسم…'), skeleton(2));
    const go = async () => {
      try { render(await api('POST', '/api/discovery/identify', { ...(q.barcode ? { barcode: q.barcode } : {}), name: q.name ?? '', brand: q.brand ?? '', size: q.size ?? '', ...(o.product ? { product_id: o.product.id } : {}) })); if (o.mode === 'product') o.onChanged?.({ soft: true }); }
      catch (e) { fill(out, errorBox(e.status ? e.message : 'تعذر الاتصال بالخادم. لم يُفقد شيء — أعد المحاولة.', () => run())); }
    };
    return btn ? busy(btn, go) : go();
  }

  /** Product mode: pending drafts already attached to this record. */
  async function loadPending() {
    if (!o.product?.barcode) return;
    try {
      const s = await api('GET', `/api/products/${o.product.id}/suggestions`);
      if (s.candidates.length) fill(out, h('div', { class: 'card inset' }, h('div', { class: 'row sb' }, h('h4', {}, 'اقتراحات بانتظار المراجعة'), h('span', { class: 'badge warn' }, s.candidates.length)),
        h('div', { class: 'notice info' }, 'مسودات من المصادر لهذا الباركود. لا يُكتب شيء في البطاقة قبل اعتماد المدير، والبيانات المعتمدة لا تُستبدل تلقائيًا.'), s.candidates.map(candidateRow), h('div', { class: 'tiny muted' }, NOT_FROM_SOURCE)));
    } catch { /* non-blocking */ }
  }
  return { el: out, run, loadPending };
}

/** Descriptive completeness chips. Complete ≠ correct: verification is shown separately. */
export function completeness(p) {
  const items = [['صورة', !!p.primary_image_id], ['باركود', !!p.barcode], ['العلامة', !!p.brand], ['الحجم', !!p.size], ['المكونات', !!p.ingredients], ['التحذيرات', !!p.warnings], ['المصدر', !!p.source_url]];
  const n = items.filter((x) => x[1]).length;
  return { n, total: items.length, el: h('div', { class: 'compl', title: 'اكتمال البيانات لا يعني صحتها' }, items.map(([l, ok]) => h('span', { class: ok ? 'y' : 'n' }, ok ? '✓ ' : '○ ', l))) };
}
