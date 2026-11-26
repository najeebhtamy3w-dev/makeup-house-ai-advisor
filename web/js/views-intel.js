// Unified primary advisor plus manager knowledge administration; no separate experimental consultation path.
//   intel     : consultation with an explicit operating mode (local / scientific research / cloud), context, sources,
//               an UNREVIEWED research panel, and a clear badge saying how each answer was produced.
//   knowledge : manager-only knowledge review — gaps, pending claims (approve / reject / record a qualified review),
//               discovered evidence, research and cloud switches. Administrative approval is labelled as such.
// No prices, no stock quantities, no customer data. Arabic RTL, mobile-first (360 px).
import { api, getToken } from './api.js';
import { h, fill, toast, busy, skeleton, errorBox, emptyState } from './util.js';
import { thumb } from './images.js';
import { openChatProductAttachment } from './chat-product-attachment.js';

const MODE_AR = { offline: 'محلي (دون إنترنت)', research: 'بحث علمي على الإنترنت', cloud: 'نموذج سحابي' };
const SKIN = { dry: 'جافة', oily: 'دهنية', combination: 'مختلطة', sensitive: 'حساسة', normal: 'عادية' };
const HAIR = { dry: 'جاف', oily: 'دهني', colored: 'مصبوغ', curly: 'مجعد', damaged: 'متقصف' };
const CONCERN = { oil: 'دهون', dryness: 'جفاف', sensitivity: 'حساسية', acne: 'حبوب', pigmentation: 'تصبغات', dandruff: 'قشرة', hair_loss: 'تساقط الشعر', breakage: 'تكسر', sun: 'حماية من الشمس', hydration: 'ترطيب', irritation: 'تهيج', unknown: 'حاجة للتوضيح' };

/** Main consultation UI. Every message enters the same orchestrator; model absence/failure is explicit. */
export async function intel(root) {
  let sessionId, mode = 'offline', status, isManager = false, nativeStatus;
  let sending = false, epoch = 0;
  const statusEl = h('div', { class: 'tiny muted', id: 'advisor-mode', 'aria-live': 'polite' }, 'جارٍ التحقق من محرك الاستشارة…');
  const ctxEl = h('details', { class: 'tiny', id: 'intel-context' });
  const log = h('div', { class: 'chat', id: 'intel-log', 'aria-live': 'polite' });
  const progress = h('div', { class: 'tiny muted', id: 'advisor-progress', role: 'status' });
  const input = h('input', { placeholder: 'تحدث عن البشرة أو الشعر أو المنتج الذي تريد فهمه…', 'aria-label': 'نص الاستشارة', maxlength: 1000, enterkeyhint: 'send' });
  const sendButton = h('button', { class: 'btn', type: 'submit' }, 'إرسال');
  const cancel = async () => { if (window.MHLocalAI?.available) await window.MHLocalAI.call('cancel', getToken()).catch(() => {}); };
  const drawContext = (u) => {
    const c = u?.conversation_context ?? {}, lines = [];
    if (c.skin?.length) lines.push('البشرة: ' + c.skin.map(s => SKIN[s] ?? s).join('، '));
    if (c.hair?.length) lines.push('الشعر: ' + c.hair.map(s => HAIR[s] ?? s).join('، '));
    if (c.concerns?.length) lines.push('احتياجات محفوظة: ' + c.concerns.map(x => CONCERN[x] ?? x).join('، '));
    if (c.product_refs?.length) lines.push('المنتجات المرجعية: ' + c.product_refs.map(p => p.name).join('، '));
    fill(ctxEl, lines.length ? [h('summary', {}, 'سياق الاستشارة — قابل للتصحيح'), lines.map(line => h('p', {}, line))] : null);
  };
  const send = async (text) => {
    const q = String(text ?? input.value).trim(); if (!q || sending) return;
    input.value = ''; sending = true; sendButton.disabled = true;
    const turnEpoch = epoch;
    log.append(h('div', { class: 'bub me' }, q));
    const wait = h('div', { class: 'bub res ibub' }, skeleton(1)); log.append(wait); wait.scrollIntoView({ block: 'end' });
    fill(progress, 'جارٍ فهم السؤال والتحقق من المعرفة…');
    try {
      const r = await api('POST', '/api/intelligence/consult', { message: q, ...(sessionId ? { session_id: sessionId } : {}), mode });
      if (turnEpoch !== epoch || !wait.isConnected) return;
      if (!r?.answer) throw new Error('لم تكتمل الاستشارة. لم تُعرض إجابة بديلة على أنها ذكاء توليدي.');
      sessionId = r.session_id; fill(wait, renderAnswer(r, send)); drawContext(r.answer.understanding);
    } catch (e) { if (turnEpoch === epoch) fill(wait, errorBox('تعذرت الاستشارة: ' + e.message, () => { input.value = q; send(); })); }
    finally { if (turnEpoch === epoch) { sending = false; sendButton.disabled = false; fill(progress); } }
  };
  const reset = async () => {
    epoch++; await cancel(); const previous = sessionId; sessionId = undefined; sending = false; sendButton.disabled = false;
    if (previous) try { await api('DELETE', '/api/intelligence/session/' + previous); } catch { /* new local session will be used */ }
    fill(log); fill(ctxEl); fill(progress); input.value = ''; log.append(h('div', { class: 'tiny muted' }, 'محادثة جديدة؛ لا يُستخدم سياق العميل السابق.'));
  };
  const modeControls = h('details', { class: 'tiny' }, h('summary', {}, 'خيارات الاتصال وحالة المحرك'));
  const drawStatus = () => {
    const research = status?.modes?.research ?? {}, cloud = status?.modes?.cloud ?? {};
    const opt = (id, ok, why) => h('label', { class: 'item' }, h('input', { type: 'radio', name: 'mode', id: 'mode-' + id, value: id, checked: mode === id, disabled: !ok, onchange: () => { mode = id; } }), ' ', MODE_AR[id], why ? h('span', { class: 'tiny muted' }, ' — ' + why) : null);
    const localReady = !!(nativeStatus?.installed && nativeStatus?.active && nativeStatus?.loaded && !nativeStatus?.error);
    let text;
    if (window.MHLocalAI?.available) text = localReady ? 'النموذج المحلي مثبت ومفعّل ومحمّل في الذاكرة؛ يُبيّن كل رد هل استُخدم فعليًا.' : nativeStatus ? (!nativeStatus.installed ? 'النموذج المحلي غير مثبت؛ الاستشارات التوليدية تحتاج تنزيله وتفعيله.' : nativeStatus.error ? 'تعذر تشغيل النموذج المحلي: ' + nativeStatus.error : !nativeStatus.active ? 'النموذج مثبت وغير مفعّل؛ فعّله من إدارة الذكاء المحلي.' : 'النموذج مثبت ومفعّل لكنه غير محمّل في الذاكرة الآن؛ سيُحمّل عند الاستدلال. هذا لا يعني فقد ملف النموذج.') : 'تعذر التحقق من حالة النموذج المحلي؛ لا يُفترض أنه يعمل.';
    else text = status?.host_model?.available ? 'محرك توليدي متصل ببيئة الاختبار؛ ليس تشغيل Samsung.' : 'لا يوجد محرك توليدي متاح في هذه البيئة؛ سيظهر أي مسار معرفي بديل بوضوح.';
    fill(statusEl, text, isManager && window.MHLocalAI?.available && (!nativeStatus?.installed || !nativeStatus?.active || nativeStatus?.error) ? [' ', h('a', { href: '#/local-ai' }, 'إدارة الذكاء المحلي')] : null);
    fill(modeControls, h('summary', {}, 'خيارات الاتصال وحالة المحرك'), opt('offline', true, 'المعرفة والأدوات المحلية'), opt('research', !!research.available, !research.enabled ? 'معطّل من المدير' : !research.online ? 'لا اتصال' : 'نتائج البحث تحتاج مراجعة'), opt('cloud', !!cloud.enabled, cloud.reason ?? 'اختياري'), (research.sources ?? []).filter(x => !x.available).map(x => h('p', { class: 'tiny muted', id: 'research-source-note' }, x.reason_ar)), status?.note_ar ? h('p', { class: 'tiny muted' }, status.note_ar) : null,
      h('button', { type: 'button', class: 'btn sm out', onclick: refreshStatus }, 'تحديث حالة المحرك'));
  };
  async function refreshStatus() {
    try { status = await api('GET', '/api/intelligence/status'); } catch (e) { fill(statusEl, errorBox('تعذر التحقق من المحرك: ' + e.message)); return; }
    if (window.MHLocalAI?.available) { try { nativeStatus = await window.MHLocalAI.call('status', getToken()); } catch { nativeStatus = undefined; } }
    drawStatus();
  }
  root.append(statusEl, modeControls, ctxEl, log, progress,
    h('form', { class: 'composer', onsubmit: e => { e.preventDefault(); send(); } }, input, sendButton),
    h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn sm out', id: 'chat-product-attachment', onclick: async () => { try { await openChatProductAttachment({ onContext: text => { input.value = text; input.focus?.(); }, onStored: product => { if (root.isConnected) log.append(h('div', { class: 'tiny muted' }, `حُفظ سجل المنتج «${product.name}»؛ الحفظ لا يعني اعتمادًا علميًا أو توفرًا.`)); } }); } catch (e) { fill(progress, e.message); } } }, 'صورة منتج / باركود'), window.MHLocalAI?.available ? h('button', { type: 'button', class: 'btn sm out', onclick: cancel }, 'إلغاء التوليد') : null,
      h('button', { type: 'button', class: 'btn sm out', id: 'intel-reset', onclick: reset }, 'محادثة جديدة')));
  const onProgress = e => { if (!root.isConnected) { window.removeEventListener('mh-ai-progress', onProgress); return; } if (sending) fill(progress, String(e.detail ?? 'جارٍ التوليد والتحقق…')); };
  window.addEventListener('mh-ai-progress', onProgress);
  window.addEventListener('hashchange', () => { epoch++; window.removeEventListener('mh-ai-progress', onProgress); cancel(); }, { once: true });
  try { const me = await api('GET', '/api/auth/me'); isManager = me?.user?.role === 'manager'; } catch { /* status still readable for current session */ }
  await refreshStatus();
}

/** Only a validated final response may reach this renderer. No raw native tokens are displayed. */
export function renderUnifiedAnswer(r, send = () => {}) { return renderAnswer(r, send); }
function renderAnswer(r, send) {
  const a = r.answer ?? {}, diag = r.intelligence ?? {}, out = [];
  const invoked = diag.generative_invoked === true || Number(diag.model_invocations ?? 0) > 0;
  const fallback = diag.provenance === 'deterministic_fallback' || !!diag.fallback_reason;
  const emergency = diag.provenance === 'safety_referral';
  let label = emergency ? 'إحالة سلامة مستقلة — دون انتظار النموذج' : fallback ? 'إرشاد معرفي بديل — لم تكتمل الاستشارة التوليدية' : invoked ? 'استُخدم النموذج التوليدي؛ الرد مرّ بالتحقق البرمجي' : 'لم يُثبت تشغيل النموذج في هذا الرد';
  const statusClass = emergency ? 'warn' : fallback || !invoked ? 'info' : 'ok';
  out.push(h('div', { class: 'tiny muted', id: 'answer-mode' }, h('span', { class: 'badge ' + statusClass }, label)));
  if (fallback) out.push(h('div', { class: 'notice warn', id: 'advisor-fallback', role: 'status' }, 'سبب المسار البديل: ' + fallbackReason(diag.fallback_reason ?? diag.provenance), invoked ? ' جُرّب النموذج ولم تُقبل النتيجة؛ النص التالي ليس نجاحًا توليديًا.' : ' لم يُنتج النموذج هذه الإجابة.'));
  const sections = Array.isArray(a.sections) ? a.sections : [];
  const warnings = sections.filter(s => ['referral','warnings','safety_warnings'].includes(s.kind));
  for (const s of warnings) out.push(h('div', { class: s.kind === 'referral' ? 'notice err' : 'notice warn', role: 'alert' }, (s.items ?? []).map(i => h('p', {}, i.text))));
  const conversational = typeof a.conversation_text === 'string' && a.conversation_text.trim();
  if (conversational) out.push(h('div', { class: 'advisor-conversation', id: 'advisor-conversation' }, conversational.split(/\n+/).filter(Boolean).map(t => h('p', {}, t))));
  else {
    const content = sections.filter(s => !['referral','warnings','safety_warnings','understanding'].includes(s.kind));
    out.push(h('div', { class: 'advisor-conversation', id: 'advisor-conversation' }, content.flatMap(s => (s.items ?? []).map(i => h('p', {}, i.text)))));
  }
  if (conversational && sections.some(s => !warnings.includes(s))) out.push(h('details', { class: 'tiny srcs' }, h('summary', {}, 'المعلومات والأدلة المستخدمة'), sections.filter(s => !warnings.includes(s) && s.kind !== 'understanding').map(s => h('div', {}, h('b', {}, s.title), (s.items ?? []).map(i => h('p', {}, i.text, i.source_ids?.length ? ' [' + i.source_ids.join('، ') + ']' : ''))))));
  if (a.products?.items?.length) out.push(h('div', { class: 'advisor-products' }, a.products.items.map(p => h('div', { class: 'prod' }, p.id > 0 && p.primary_image_id ? thumb(p, 'sm') : null, h('div', {}, h('b', {}, p.name), p.brand ? h('p', { class: 'tiny' }, p.brand) : null, h('p', { class: 'tiny muted' }, p.id < 0 ? 'منتج عالمي؛ التوفر المحلي غير مؤكد.' : p.availability_note ?? 'التوفر يحتاج تحققًا مستقلًا.'), p.id > 0 ? h('a', { href: '#/product/' + p.id }, 'تفاصيل المنتج وصوره') : null)))));
  if (a.follow_up?.choices?.length) out.push(h('div', { class: 'sugg' }, a.follow_up.choices.map(c => h('button', { type: 'button', onclick: () => send(c) }, c))));
  if (a.sources?.length) out.push(h('details', { class: 'srcs' }, h('summary', {}, `المصادر (${a.sources.length})`), a.sources.map(s => h('div', { class: 'tiny' }, h('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer' }, s.title), s.publisher ? ' — ' + s.publisher : '', s.industry_affiliation ? h('span', { class: 'badge warn' }, 'ارتباط بشركة') : null))));
  const evidenceLabels = { unreviewed: 'المعرفة المستخدمة لم يراجعها مختص مؤهل بعد.', administrative: 'المعرفة معتمدة إداريًا؛ ليست مراجعة علمية مؤهلة.', scientific: 'المعرفة المشار إليها تحمل مراجعة علمية مسجلة.' };
  if (evidenceLabels[a.evidence_status]) out.push(h('p', { class: 'tiny muted' }, evidenceLabels[a.evidence_status]));
  if (r.research) { const research = r.research; out.push(h('details', { class: 'research', open: false }, h('summary', {}, `نتائج بحث متصل غير مراجعة (${research.items?.length ?? 0})`), (research.notes_ar ?? []).map(n => h('p', { class: 'tiny muted' }, n)), (research.items ?? []).map(i => h('p', {}, h('a', { href: i.url, target: '_blank', rel: 'noopener noreferrer' }, i.title), ' — غير مراجع')), h('p', { class: 'tiny muted' }, 'نتائج اكتشاف؛ لا يُفترض اعتمادها أو استخدامها كدليل في الاستشارة.'))); }
  if (r.cloud?.mode_used === 'cloud_assisted' && r.cloud.text) out.push(h('div', { class: 'cloud-text' }, h('span', { class: 'badge warn' }, 'صياغة بمساعدة نموذج متصل'), r.cloud.text.split('\n').map(t => h('p', {}, t))));
  else if (r.cloud?.status_ar) out.push(h('p', { class: 'tiny muted', id: 'cloud-status' }, r.cloud.status_ar));
  if (diag.tool_calls?.length || invoked) out.push(h('details', { class: 'tiny' }, h('summary', {}, 'كيف أُنتج هذا الرد؟'), h('p', {}, invoked ? 'استدعاءات النموذج الفعلية: ' + Number(diag.model_invocations ?? 0) : 'لم يُستدعَ النموذج.'), h('p', {}, 'الأدوات: ' + (diag.tool_calls ?? []).map(t => typeof t === 'string' ? t : t.name ?? '').filter(Boolean).join('، ')), h('p', {}, diag.validated || diag.decision_validated ? 'النتيجة اجتازت التحقق البرمجي المستقل؛ لا يغني ذلك عن المراجعة العلمية.' : 'لم تُسجل نتيجة توليدية مقبولة.')));
  return out;
}
function fallbackReason(reason) {
  if (/unavailable|disabled|not_installed|model_absent|host_model/i.test(reason ?? '')) return 'النموذج غير متاح أو غير مفعّل في هذه البيئة.';
  if (/cancel|interrupt/i.test(reason ?? '')) return 'أُلغي التوليد أو انقطع تشغيل النموذج.';
  if (/timeout|budget|expired/i.test(reason ?? '')) return 'انتهى الوقت أو حد تنفيذ الاستشارة.';
  if (/unsafe|unsupported|unknown|unobserved|invalid|schema|fidelity/i.test(reason ?? '')) return 'رفض التحقق نتيجة النموذج أو لم يجد لها إسنادًا كافيًا.';
  return String(reason ?? 'سبب غير مسجل');
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
        st.modes.cloud.configured ? toggle('k-cloud', `النموذج السحابي (${st.modes.cloud.provider})`, st.modes.cloud.enabled, 'cloud_llm_enabled', 'اختياري؛ لا يغيّر توفر الاستشارة المحلية')
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
