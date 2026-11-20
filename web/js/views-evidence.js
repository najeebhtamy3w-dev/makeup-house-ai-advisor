// CP06.2 Phase 5 — evidence review (manager): EXTERNAL SOURCES PROPOSE — AUTHORISED PEOPLE APPROVE.
// One product at a time: the store value next to each proposed value, its source, date and licence; accept / reject / skip
// per field; "save and next". An ambiguous identity (different size / variant / name) needs an explicit confirmation.
import { api } from './api.js';
import { h, fill, toast, busy, fmtDate, skeleton, errorBox, emptyState, FIELD_LABEL } from './util.js';
import { thumb } from './images.js';

const LABEL = { ...FIELD_LABEL, manufacturer: 'الشركة المصنعة', variant: 'الإصدار/اللون' };
const STORE_COL = { name: 'name_en', brand: 'brand', size: 'size', ingredients: 'ingredients', manufacturer: 'manufacturer', variant: 'variant' };
const BASIS = { exact_gtin: ['الباركود نفسه', 'ok'], strong: ['مطابقة قوية', 'ok'], ambiguous: ['مطابقة ملتبسة', 'warn'] };
const LIC = { known: 'ترخيص معروف', unknown: 'ترخيص غير معروف', restricted: 'استخدام مقيد' };

export async function evidenceReview(root) {
  const status = h('div', { class: 'card' }); const body = h('div', {}, skeleton(2));
  root.append(h('h2', { class: 't' }, 'مراجعة الأدلة من المصادر'),
    h('p', { class: 'tiny muted' }, 'المصادر الخارجية تقترح فقط. لا يتغير شيء في بيانات المحل إلا بقبولك لكل حقل. الاسم من المصدر يملأ «الاسم الإنجليزي» ولا يغيّر اسم العرض.'), status, body);
  const drawStatus = async () => {
    try {
      const s = await api('GET', '/api/queue/status'); const js = s.job_state ?? {}; const paused = s.paused.includes('all');
      fill(status, h('h3', { class: 'fsec-t' }, 'طابور البحث'), h('div', { class: 'tiny', id: 'queue-counts' }, `بالانتظار ${(js.queued ?? 0) + (js.waiting_retry ?? 0) + (js.waiting_network ?? 0)} · قيد التنفيذ ${js.leased ?? 0} · منجز ${js.done ?? 0} · متعذر ${js.dead ?? 0} · ملغى ${js.cancelled ?? 0} · منتجات تنتظر مراجعتك ${s.pending_evidence}`),
        h('button', { class: 'btn sm out', type: 'button', id: 'queue-toggle', onclick: (e) => busy(e.currentTarget, async () => { await api('POST', '/api/queue/pause', { scope: 'all', paused: !paused }); drawStatus(); }) }, paused ? '▶ استئناف الطابور' : '⏸ إيقاف الطابور مؤقتًا'),
        paused ? h('span', { class: 'badge warn', style: 'margin-inline-start:8px' }, 'الطابور موقوف') : null);
    } catch (e) { fill(status, errorBox(e.message)); }
  };
  let after = 0;
  const load = async () => {
    fill(body, skeleton(2));
    let r; try { r = await api('GET', '/api/evidence/next?after=' + after); } catch (e) { fill(body, errorBox(e.status ? e.message : 'تعذر الاتصال.', load)); return; }
    if (!r.product) { fill(body, emptyState('✔', 'لا توجد أدلة بانتظار المراجعة', 'ستظهر هنا اقتراحات المصادر بعد معالجة الطابور.')); return; }
    const p = r.product; const choice = new Map(r.evidence.map((e) => [e.id, 'skip']));
    const confirm = h('input', { type: 'checkbox', id: 'confirm-identity' });
    const rows = r.evidence.map((e) => {
      const col = STORE_COL[e.field]; const cur = col ? String(p[col] ?? '') : '';
      const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'قرار ' + (LABEL[e.field] ?? e.field) },
        [['accept', 'قبول'], ['reject', 'رفض'], ['skip', 'تخطي']].map(([v, l]) => h('button', { type: 'button', class: 'chip' + (v === 'skip' ? ' on' : ''), 'data-ev': e.id, 'data-act': v, 'aria-pressed': String(v === 'skip'),
          onclick: (ev) => { choice.set(e.id, v); ev.currentTarget.parentElement.querySelectorAll('button').forEach((b) => { const on = b.dataset.act === v; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }); } }, l)));
      const basis = BASIS[e.match_basis] ?? [e.match_basis, 'info'];
      return h('div', { class: 'evrow', 'data-field': e.field },
        h('div', { class: 'row sb' }, h('b', {}, LABEL[e.field] ?? e.field), h('span', { class: 'badge ' + basis[1] }, basis[0])),
        h('div', { class: 'evcmp' },
          h('div', {}, h('div', { class: 'tiny muted' }, col ? 'في المحل' : 'في المحل (مرجع فقط)'), h('div', { class: 'evval' }, cur || '—')),
          h('div', {}, h('div', { class: 'tiny muted' }, 'المقترح'), e.field === 'image_url' ? h('a', { href: e.value, target: '_blank', rel: 'noopener noreferrer' }, 'فتح الصورة في المصدر') : h('div', { class: 'evval', dir: /[a-z]/i.test(e.value) ? 'ltr' : 'rtl' }, e.value))),
        h('div', { class: 'tiny muted' }, `${e.provider} · ${fmtDate(e.retrieved_at)} · ${LIC[e.license_status] ?? ''}`, e.source_url ? [' · ', h('a', { href: e.source_url, target: '_blank', rel: 'noopener noreferrer' }, 'المصدر')] : null),
        seg);
    });
    const msg = h('div', { 'aria-live': 'polite' });
    const save = h('button', { class: 'btn primary', type: 'button', id: 'evidence-save', onclick: (ev) => busy(ev.currentTarget, async () => {
      const decisions = [...choice].filter(([, a]) => a !== 'skip').map(([evidence_id, action]) => ({ evidence_id, action }));
      if (!decisions.length) { after = p.id; load(); return; }
      try { await api('POST', '/api/evidence/review', { product_id: p.id, version: p.version, confirm_identity: confirm.checked, decisions }); toast('حُفظ القرار'); after = p.id; load(); drawStatus(); }   // move on even if some fields were skipped (they stay pending; the list wraps around)
      catch (x) { fill(msg, h('div', { class: 'notice err' }, x.message)); }
    }) }, 'حفظ والتالي');
    fill(body, h('div', { class: 'card' },
      h('div', { class: 'prod' }, thumb(p, 'sm'), h('div', { class: 'bd' }, h('b', {}, p.name), h('div', { class: 'tiny muted' }, [p.brand, p.size, p.variant].filter(Boolean).join(' · ') || '—', p.barcode ? h('span', { dir: 'ltr' }, ' · ' + p.barcode) : null))),
      r.identity_conflict ? h('div', { class: 'notice' }, h('b', {}, 'تنبيه هوية: '), 'المطابقة ملتبسة (قد يختلف الحجم أو الإصدار أو الاسم). قارن العبوة قبل القبول.', h('label', { class: 'row', for: 'confirm-identity', style: 'margin-top:6px' }, confirm, ' أؤكد أنه المنتج نفسه')) : null,
      rows, msg,
      h('div', { class: 'row', style: 'margin-top:10px' }, save, h('button', { class: 'btn out', type: 'button', id: 'evidence-skip', onclick: () => { after = p.id; load(); } }, 'تخطي المنتج'),
        h('span', { class: 'tiny muted' }, `متبقٍ ${r.remaining} منتج`))));
  };
  drawStatus(); load();
}
