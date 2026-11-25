// CP08 — staff screens for the unified advisor (shown only when the server answers /api/cp08/status, i.e. MH_CP07=1).
//   intel     : consultation with an explicit operating mode (local / scientific research / cloud), context, sources,
//               an UNREVIEWED research panel, and a clear badge saying how each answer was produced.
//   knowledge : manager-only knowledge review — gaps, pending claims (approve / reject / record a qualified review),
//               discovered evidence, research and cloud switches. Administrative approval is labelled as such.
// No prices, no stock quantities, no customer data. Arabic RTL, mobile-first (360 px).
import { api, getToken } from './api.js';
import { h, fill, toast, busy, skeleton, errorBox, emptyState } from './util.js';

const MODE_AR = { offline: 'محلي (دون إنترنت)', research: 'بحث علمي على الإنترنت', cloud: 'نموذج سحابي' };
const USED_BADGE = { offline: ['إجابة محلية', 'ok'], research: ['محلية + أدلة مكتشفة غير مراجعة', 'warn'], cloud: ['صياغة بمساعدة نموذج سحابي', 'warn'] };
const SKIN = { dry: 'جافة', oily: 'دهنية', combination: 'مختلطة', sensitive: 'حساسة', normal: 'عادية' };
const HAIR = { dry: 'جاف', oily: 'دهني', colored: 'مصبوغ', curly: 'مجعد', damaged: 'متقصف' };
const TYPE = { cleanser: 'غسول', moisturizer: 'مرطب', sunscreen: 'واقي شمس', serum: 'سيروم', toner: 'تونر', shampoo: 'شامبو', conditioner: 'بلسم', hair_oil: 'زيت شعر', mask: 'ماسك', exfoliant: 'مقشر' };
const ING = { glycerin: 'الجليسرين', urea: 'اليوريا', petrolatum: 'الفازلين', 'ceramide np': 'السيراميدات', 'sodium hyaluronate': 'الهيالورونيك', niacinamide: 'النياسيناميد', 'salicylic acid': 'الساليسيليك', retinol: 'الريتينول', adapalene: 'الأدابالين', 'benzoyl peroxide': 'البنزويل بيروكسايد', dimethicone: 'الدايميثيكون', panthenol: 'البانثينول', 'vitamin c': 'فيتامين C' };
const CONS = { lightweight: 'خفيف', non_comedogenic: 'لا يسد المسام', fragrance_free: 'بدون عطر', for_sensitive: 'لطيف', oil_free: 'بدون زيوت', alcohol_free: 'بدون كحول', sulfate_free: 'بدون سلفات' };
const SECTION_CLASS = { referral: 'notice err', warnings: 'notice warn', insufficient: 'notice info', scope: 'notice info' };

export async function intel(root) {
  let sessionId; let mode = 'offline'; let status = null;
  let sending = false;
  let epoch = 0;
  const statusEl = h('div', { class: 'card', id: 'intel-status' }, skeleton(1));
  const ctxEl = h('div', { class: 'tiny', id: 'intel-context', 'aria-live': 'polite' });
  const log = h('div', { class: 'chat', id: 'intel-log' });
  const input = h('input', { placeholder: 'اكتب سؤال العميلة… مثل: بشرتي جافة وأشتي غسول', 'aria-label': 'السؤال', maxlength: 1000 });
  const send = async (text) => {
    const q = (text ?? input.value).trim(); if (!q || sending) return; input.value = ''; sending = true;
    const turnEpoch = epoch;
    log.append(h('div', { class: 'bub me' }, q)); const wait = h('div', { class: 'bub res ibub' }, skeleton(2)); log.append(wait); wait.scrollIntoView({ block: 'end' });
    const showScientific = e => { if (turnEpoch === epoch && wait.isConnected) { sessionId = e.detail.session_id; fill(wait, renderAnswer(e.detail, send)); drawContext(e.detail.answer.understanding); } };
    window.addEventListener('mh-ai-scientific-result', showScientific);
    try {
      const r = await api('POST', '/api/cp08/advisor/chat', { message: q, session_id: sessionId, mode });
      if (turnEpoch !== epoch) return;
      sessionId = r.session_id; fill(wait, renderAnswer(r, send)); drawContext(r.answer.understanding);
    } catch (e) { fill(wait, errorBox(e.message)); }
    finally { window.removeEventListener('mh-ai-scientific-result', showScientific); sending = false; }
  };
  const drawContext = (u) => {
    const c = u.conversation_context ?? {}; const chips = [];
    if (c.skin?.length) chips.push(`البشرة: ${c.skin.map((s) => SKIN[s] ?? s).join('، ')}`);
    if (c.hair?.length) chips.push(`الشعر: ${c.hair.map((s) => HAIR[s] ?? s).join('، ')}`);
    if (c.product_type) chips.push(`المطلوب: ${TYPE[c.product_type] ?? c.product_type}`);
    if (c.ingredients_discussed?.length) chips.push(`المكوّن: ${c.ingredients_discussed.map((x) => ING[x] ?? x).join('، ')}`);
    if (c.avoid?.length) chips.push(`الشروط: ${c.avoid.map((x) => CONS[x] ?? x).join('، ')}`);
    fill(ctxEl, chips.length ? [h('b', {}, 'سياق المحادثة: '), chips.map((x) => h('span', { class: 'badge', style: 'margin:2px' }, x))] : null);
  };
  const drawStatus = () => {
    const m = status.modes;
    const opt = (id, ok, why) => h('label', { class: 'item', style: `display:flex;gap:6px;align-items:center;opacity:${ok ? 1 : 0.55}` },
      h('input', { type: 'radio', name: 'mode', id: 'mode-' + id, value: id, checked: mode === id, disabled: !ok, onchange: () => { mode = id; } }), MODE_AR[id], why ? h('span', { class: 'tiny muted' }, ` — ${why}`) : null);
    fill(statusEl, h('h3', { class: 'fsec-t' }, 'وضع التشغيل'),
      opt('offline', true, 'يعمل دائمًا'),
      opt('research', m.research.available, !m.research.enabled ? 'معطّل من المدير' : !m.research.online ? 'لا اتصال' : 'النتائج غير مراجعة'),
      opt('cloud', m.cloud.enabled, m.cloud.enabled ? `${m.cloud.provider}` : m.cloud.reason),
      (m.research.sources ?? []).filter((x) => !x.available).map((x) => h('p', { class: 'tiny muted', id: 'research-source-note' }, x.reason_ar)),
      h('p', { class: 'tiny muted' }, status.note_ar));
  };
  root.append(h('h2', { class: 't' }, 'المستشار العلمي (تجريبي)'),
    h('p', { class: 'tiny muted' }, 'كل جملة مرتبطة بمصدر. المعرفة لم يراجعها مختص مؤهل بعد، والإجابة تقول ذلك. ليس تشخيصًا.'),
    statusEl, ctxEl, log,
    h('form', { class: 'composer', onsubmit: (e) => { e.preventDefault(); send(); } }, input, h('button', { class: 'btn', type: 'submit' }, 'إرسال')),
    window.MHLocalAI?.available ? h('button', { class: 'btn sm out', onclick: async () => { const { getToken } = await import('./api.js'); await window.MHLocalAI.call('cancel', getToken()).catch(() => {}); } }, 'إلغاء التوليد') : null,
    h('button', { class: 'btn sm out', type: 'button', id: 'intel-reset', onclick: () => { epoch++; window.MHLocalAI?.call('cancel', getToken()).catch(() => {}); sessionId = undefined; fill(log); fill(ctxEl); log.append(h('div', { class: 'notice info' }, 'محادثة جديدة: لا يُستخدم أي سياق سابق.')); } }, 'محادثة جديدة'));
  try {
    status = await api('GET', '/api/cp08/status'); drawStatus();
    if (window.MHLocalAI?.available) {
      try { const s = await window.MHLocalAI.call('status', getToken()); statusEl.append(h('p', { class: 'tiny' }, s.active && s.installed && !s.error ? 'الذكاء التوليدي المحلي متاح؛ كل صياغة تمر بالتحقق العلمي.' : 'الذكاء التوليدي المحلي غير متاح؛ المستشار العلمي بالقواعد يعمل.')); }
      catch { statusEl.append(h('p', { class: 'tiny' }, 'تعذر التحقق من النموذج المحلي؛ المستشار العلمي بالقواعد يعمل.')); }
    }
  } catch (e) { fill(statusEl, errorBox(e.message)); }
}

function renderAnswer(r, send) {
  const a = r.answer; const [label, cls] = USED_BADGE[r.mode_used] ?? USED_BADGE.offline;
  const out = [h('div', {}, h('span', { class: `badge ${cls}`, id: 'answer-mode' }, label), r.mode_requested !== r.mode_used ? h('span', { class: 'tiny muted' }, ` (طُلب: ${MODE_AR[r.mode_requested]})`) : null)];
  if (r.local_ai) out.push(h('div', { class: 'notice info' }, r.local_ai.note), r.local_ai.ok ? h('div', { class: 'card', id: 'local-ai-answer' }, r.local_ai.text.split('\n').map(t => h('p', {}, t))) : null);
  if (r.cloud?.mode_used === 'cloud_assisted') out.push(h('div', { class: 'card cloud-text' }, r.cloud.text.split('\n').slice(1).filter((l) => !l.startsWith('【') && !l.startsWith('- ') && !l.startsWith('حالة')).map((l) => h('p', {}, l))));
  for (const s of a.sections) {
    const box = h('div', { class: SECTION_CLASS[s.kind] ?? 'isec', role: s.kind === 'referral' ? 'alert' : null }, h('b', {}, s.title));
    for (const i of s.items) box.append(h('p', {}, i.text, i.source_ids.length ? h('span', { class: 'tiny muted' }, ` [${i.source_ids.join('، ')}]`) : null));
    out.push(box);
  }
  if (a.follow_up) out.push(h('div', { class: 'sugg' }, a.follow_up.choices.map((c) => h('button', { type: 'button', onclick: () => send(c) }, c))));
  if (a.sources.length) out.push(h('details', { class: 'srcs' }, h('summary', {}, `المصادر (${a.sources.length})`),
    a.sources.map((s) => h('div', { class: 'tiny' }, h('a', { href: s.url, target: '_blank', rel: 'noopener' }, s.title), ` — ${s.publisher}`, s.industry_affiliation ? h('span', { class: 'badge warn' }, 'ارتباط بشركة') : null))));
  if (a.evidence_status !== 'none') out.push(h('div', { class: 'tiny muted' }, { unreviewed: 'حالة المعلومة: مرجع منظم لم يراجعه مختص مؤهل بعد.', administrative: 'حالة المعلومة: معتمدة إداريًا، لم يراجعها مختص مؤهل.', scientific: 'حالة المعلومة: راجعها مختص مؤهل.' }[a.evidence_status]));
  if (r.research) {
    const res = r.research;
    out.push(h('details', { class: 'research', open: res.items.length > 0 }, h('summary', {}, `أدلة مكتشفة من الإنترنت — غير مراجعة (${res.items.length})`),
      res.notes_ar.map((n) => h('div', { class: 'tiny muted' }, n)),
      res.items.map((i) => h('div', { class: 'tiny', style: 'margin:4px 0' }, h('span', { class: 'badge warn' }, 'غير مراجع'), ' ', h('a', { href: i.url, target: '_blank', rel: 'noopener' }, i.title), ` — ${i.publisher}${i.year ? ' · ' + i.year : ''} · صلة ${Math.round(i.relevance * 100)}%`)),
      h('div', { class: 'tiny muted' }, 'هذه الأدلة لا تُعتمد كحقائق ولم تُستخدم في الإجابة أعلاه؛ تُراجع من المدير في «مراجعة المعرفة العلمية».')));
  }
  if (r.cloud && r.cloud.mode_used !== 'cloud_assisted') out.push(h('div', { class: 'tiny muted', id: 'cloud-status' }, r.cloud.status_ar));
  return out;
}

export async function knowledge(root) {
  const body = h('div', {}, skeleton(3));
  root.append(h('h2', { class: 't' }, 'مراجعة المعرفة العلمية'),
    h('p', { class: 'tiny muted' }, 'اعتماد المدير «إداري» وليس مراجعة علمية. سجّل مراجعة علمية فقط باسم مختص مؤهل ومؤهله. لا شيء يُعتمد آليًا.'), body);
  const load = async () => {
    fill(body, skeleton(3));
    let d, st; try { [d, st] = await Promise.all([api('GET', '/api/cp07/knowledge/dashboard'), api('GET', '/api/cp08/status')]); } catch (e) { fill(body, errorBox(e.message, load)); return; }
    const toggle = (id, label, on, key, note) => h('label', { class: 'item', style: 'display:flex;gap:8px;align-items:center' },
      h('input', { type: 'checkbox', id, checked: on, onchange: async (e) => { try { await api('POST', '/api/cp08/settings', { [key]: e.target.checked }); toast('تم الحفظ'); load(); } catch (x) { toast(x.message); e.target.checked = !e.target.checked; } } }), label, note ? h('span', { class: 'tiny muted' }, ` — ${note}`) : null);
    const s = d.stats;
    fill(body,
      h('div', { class: 'card', id: 'k-settings' }, h('h3', { class: 'fsec-t' }, 'الإعدادات'),
        st.source === 'env' ? h('div', { class: 'tiny muted' }, 'المستشار العلمي مفعّل من إعدادات الخادم.')
          : h('label', { class: 'item', style: 'display:flex;gap:8px;align-items:center' }, h('input', { type: 'checkbox', id: 'k-feature', checked: true, onchange: async (e) => { if (!confirm('إيقاف المستشار العلمي لكل الموظفين على هذا الجهاز/الخادم؟')) { e.target.checked = true; return; } try { await api('POST', '/api/features/scientific-advisor', { enabled: false }); window.MH_refreshFeatures?.(); location.hash = '#/home'; } catch (x) { toast(x.message); e.target.checked = true; } } }), 'المستشار العلمي مفعّل'),
        toggle('k-research', 'البحث العلمي عبر الإنترنت (MedlinePlus، PubMed)', d.external_search_enabled, 'external_search_enabled', 'استعلامات مفاهيم عامة فقط'),
        st.modes.cloud.configured ? toggle('k-cloud', `النموذج السحابي (${st.modes.cloud.provider})`, st.modes.cloud.enabled, 'cloud_llm_enabled', `إنفاق هذا الشهر $${(st.modes.cloud.month_usd ?? 0).toFixed(2)} من $${st.modes.cloud.monthly_budget_usd}`)
          : h('div', { class: 'tiny muted', id: 'k-cloud-off' }, `النموذج السحابي: غير مضبوط — ${st.modes.cloud.reason}. المفتاح يُضبط في بيئة الخادم فقط، لا في التطبيق.`)),
      h('div', { class: 'card' }, h('h3', { class: 'fsec-t' }, 'الحالة'),
        h('div', { class: 'tiny' }, `ادعاءات: ${Object.entries(s.claims_by_state).map(([k, v]) => `${k} ${v}`).join(' · ')} — مراجعة: ${Object.entries(s.claims_by_review).map(([k, v]) => `${k} ${v}`).join(' · ')} — مصادر مرتبطة بشركات: ${s.industry_affiliated_sources}`),
        d.conflicts.length ? h('div', { class: 'notice warn' }, `تعارضات بين ادعاءات: ${d.conflicts.length}`) : null),
      h('div', { class: 'card', id: 'k-gaps' }, h('h3', { class: 'fsec-t' }, `فجوات معرفية (${d.gaps.length})`),
        d.gaps.length ? d.gaps.map((g) => h('div', { class: 'row', style: 'justify-content:space-between;align-items:center' }, h('span', { class: 'tiny' }, `${g.label_ar} · ${g.hits}× · ${g.status}`),
          h('button', { class: 'btn sm out', type: 'button', onclick: (e) => busy(e.currentTarget, async () => { try { const r = await api('POST', `/api/cp07/knowledge/gaps/${g.id}/search`); toast(`أُضيف للبحث: ${r.query}`); load(); } catch (x) { toast(x.message); } }) }, 'ابحث')))
          : emptyState('✔', 'لا فجوات مسجلة', 'تظهر هنا الأسئلة التي لم تتوفر لها معرفة كافية.')),
      h('div', { class: 'card', id: 'k-pending' }, h('h3', { class: 'fsec-t' }, `ادعاءات بانتظار المراجعة (${d.pending_claims.length})`),
        d.pending_claims.slice(0, 40).map((c) => h('div', { class: 'kclaim', style: 'border-top:1px solid #eee;padding:6px 0' },
          h('div', { class: 'tiny muted' }, `${c.id} · ${c.topic_id} · ${c.origin === 'curated_seed' ? 'بذرة منسقة' : 'من دليل مكتشف'}`), h('p', {}, c.text_ar),
          h('div', { class: 'row' },
            h('button', { class: 'btn sm', type: 'button', onclick: (e) => busy(e.currentTarget, async () => { try { await api('POST', `/api/cp07/knowledge/claims/${encodeURIComponent(c.id)}/transition`, { to: 'approved' }); toast('اعتُمد إداريًا'); load(); } catch (x) { toast(x.message); } }) }, 'اعتماد إداري'),
            h('button', { class: 'btn sm out', type: 'button', onclick: async () => { const reason = prompt('سبب الرفض؟'); if (!reason) return; try { await api('POST', `/api/cp07/knowledge/claims/${encodeURIComponent(c.id)}/transition`, { to: 'rejected', reason }); load(); } catch (x) { toast(x.message); } } }, 'رفض'),
            h('button', { class: 'btn sm out', type: 'button', onclick: async () => { const reviewer = prompt('اسم المراجع العلمي المؤهل؟'); if (!reviewer) return; const qualification = prompt('المؤهل (مثال: صيدلانية مرخصة / طبيب جلدية)؟'); if (!qualification) return; try { await api('POST', `/api/cp07/knowledge/claims/${encodeURIComponent(c.id)}/scientific-review`, { reviewer, qualification }); toast('سُجّلت المراجعة'); load(); } catch (x) { toast(x.message); } } }, 'تسجيل مراجعة علمية'))))),
      h('div', { class: 'card', id: 'k-evidence' }, h('h3', { class: 'fsec-t' }, `أدلة مكتشفة (${d.evidence.length})`),
        d.evidence.length ? d.evidence.slice(0, 30).map((e) => h('div', { class: 'tiny', style: 'margin:4px 0' }, h('span', { class: `badge ${e.evidence_state === 'rejected' ? 'no' : 'warn'}` }, e.evidence_state === 'rejected' ? 'مرفوض' : 'غير مراجع'), ' ',
          h('a', { href: e.url, target: '_blank', rel: 'noopener' }, e.title), ` — ${e.publisher}${e.published_at ? ' · ' + e.published_at : ''} · ${e.evidence_level}`))
          : emptyState('⌕', 'لا أدلة مكتشفة بعد', 'فعّل البحث العلمي ثم ابحث في فجوة.')));
  };
  load();
}

// CP09: switching the scientific advisor on (manager). The runtime (server or the phone's local worker) checks the role.
export function enableIntel(root) {
  const out = h('div', { 'aria-live': 'polite' });
  root.append(h('h2', { class: 't' }, 'تفعيل المستشار العلمي'),
    h('div', { class: 'card' },
      h('p', {}, 'المستشار العلمي يفهم أسئلة العربية واللهجة اليمنية، ويجيب من معرفة منظمة بمصادرها، ويطبّق فحص سلامة مستقلًا، ويعمل دون إنترنت.'),
      h('ul', { class: 'tiny' }, h('li', {}, 'المعرفة لم يراجعها مختص مؤهل بعد، وكل إجابة تقول ذلك.'), h('li', {}, 'البحث العلمي عبر الإنترنت والنموذج السحابي يبقيان معطّلين حتى تفعّلهما بشكل منفصل.'), h('li', {}, 'ليس تشخيصًا طبيًا.')),
      h('button', { class: 'btn', type: 'button', id: 'intel-enable-go', onclick: (e) => busy(e.currentTarget, async () => {
        try { await api('POST', '/api/features/scientific-advisor', { enabled: true }); fill(out, h('div', { class: 'notice ok', id: 'intel-enabled' }, 'تم التفعيل.')); window.MH_refreshFeatures?.(); location.hash = '#/intel'; }
        catch (x) { fill(out, errorBox(x.message)); }
      }) }, 'تفعيل'), out));
}
