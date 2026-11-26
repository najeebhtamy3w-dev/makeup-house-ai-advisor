import { api, getToken } from './api.js';
import { h, fill } from './util.js';
const messages = { INSUFFICIENT_STORAGE: 'مساحة الهاتف غير كافية.', MODEL_HASH_MISMATCH: 'لم تطابق البصمة؛ أزيلي التنزيل ثم أعيدي المحاولة.', MODEL_SIZE_MISMATCH: 'التنزيل غير مكتمل؛ أعيدي التنزيل للاستئناف.', CANCELLED: 'توقفت العملية؛ يمكن استئناف التنزيل.', BUSY: 'توجد عملية قيد التنفيذ.', FORBIDDEN: 'هذه العملية للمدير فقط.', MODEL_MISSING: 'لم يُثبت النموذج بعد.', CONTEXT_LIMIT: 'السياق أطول من الحد الآمن.', RUNTIME_UNAVAILABLE: 'محرك الذكاء غير متاح على هذا الجهاز.' };
export async function localAISettings(root) {
  const me = await api('GET', '/api/auth/me');
  if (me.user.role !== 'manager') { root.append(h('p', {}, 'هذه الصفحة للمدير فقط.')); return; }
  if (!window.MHLocalAI?.available) { root.append(h('p', {}, 'إدارة النموذج متاحة داخل تطبيق Android.')); return; }
  const content = h('div', { class: 'card' }), note = h('p', { role: 'status' }), progress = h('p', { class: 'tiny', 'aria-live': 'polite' });
  let running = false;
  const invoke = async action => {
    if (running && action !== 'cancel') return;
    if (action === 'install' && !confirm('سيتم تنزيل نحو 1.28 GB إلى الهاتف. قد تترتب تكلفة بيانات من شركة الاتصال. متابعة؟')) return;
    if (action === 'remove' && !confirm('إزالة النموذج من الهاتف؟ ستبقى المنتجات والمعرفة كما هي.')) return;
    running = action !== 'cancel'; fill(note, 'جارٍ التنفيذ…');
    try { const r = await window.MHLocalAI.call(action, getToken()); fill(note, action === 'test' ? `اختبار استدلال فعلي: ${r.generated_bytes} بايت مولّدة خلال ${r.ms} ms. لا يُعرض نص الاختبار كاستشارة.` : 'تمت العملية.'); }
    catch (e) { fill(note, messages[e.message] || 'تعذرت العملية: ' + e.message); }
    finally { running = false; await draw(); }
  };
  const draw = async () => {
    try {
      const s = await window.MHLocalAI.diagnostics(getToken()); const m = s.manifest;
      fill(content, h('h3', {}, 'النموذج المحلي — إصدار تجريبي'),
        h('p', {}, m?.id || 'غير معروف'), h('p', { class: 'tiny' }, `الإصدار: ${m?.version || '—'} · ${m?.format || '—'} · ${m?.quantization || '—'}`),
        h('p', {}, `الحجم: ${((m?.size || 0) / 1e9).toFixed(2)} GB · المساحة المتاحة: ${(s.free_bytes / 1e9).toFixed(2)} GB`),
        h('p', {}, s.installed ? s.active ? s.loaded ? 'مثبّت ومفعّل ومحمّل في الذاكرة' : 'مثبّت ومفعّل — غير محمّل في الذاكرة حاليًا' : 'مثبّت وغير مفعّل' : `غير مثبّت — تم تنزيل ${(s.downloaded / 1e6).toFixed(0)} MB`),
        s.last_operation_error ? h('p', {class:'notice warn'}, 'فشلت آخر عملية: ' + s.last_operation_error + '؛ راجع التشخيص وأعد المحاولة.') : null,
        h('p', { class: 'tiny' }, `الرخصة: ${m?.license || '—'} · الجهاز: ${s.device} · المحرك: ${s.runtime}`),
        h('p', { class: 'notice warn' }, 'لم يكتمل قبول Samsung وجودة العربية بعد. عند تعذر النموذج أو رفض مخرجاته يستمر المستشار العلمي بالقواعد. أوزان النموذج لا تدخل النسخ الاحتياطية.'),
        h('div', { class: 'row' }, [['install', 'تنزيل / استئناف'], ['activate', 'تحقق وتفعيل'], ['test', 'اختبار النموذج'], ['deactivate', 'إيقاف'], ['remove', 'إزالة'], ['cancel', 'إلغاء العملية'], ['reset', 'تصفير سياق المحرك']].map(([id, label]) => h('button', { class: 'btn sm out', onclick: () => invoke(id) }, label))),
        h('button', { class: 'btn sm out', onclick: () => navigator.clipboard.writeText(JSON.stringify(s, null, 2)).then(() => fill(note, 'نُسخ التشخيص.')).catch(() => fill(note, 'تعذر النسخ؛ يمكن قراءة التشخيص أدناه.')) }, 'نسخ التشخيص'),
        h('details', {}, h('summary', {}, 'التشخيص'), h('pre', { dir: 'ltr', style: 'white-space:pre-wrap;overflow-wrap:anywhere' }, JSON.stringify(s, null, 2))));
    } catch (e) { fill(content, messages[e.message] || e.message); }
  };
  root.append(h('h2', { class: 't' }, 'الذكاء المحلي'), content, progress, note);
  const onProgress = e => { if (root.isConnected) fill(progress, e.detail); else window.removeEventListener('mh-ai-progress', onProgress); };
  window.addEventListener('mh-ai-progress', onProgress);
  await draw();
}
