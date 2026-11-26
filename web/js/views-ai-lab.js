// Manager-only native diagnostic. Raw text is deliberately separate from approved consultations.
import { api, getToken } from './api.js';
import { h, fill } from './util.js';

export async function aiLab(root) {
  const me = await api('GET', '/api/auth/me');
  if (me?.user?.role !== 'manager') { root.append(h('div', { class: 'notice err', role: 'alert' }, 'هذه الصفحة للمدير فقط.')); return; }
  root.append(h('h2', { class: 't' }, 'مختبر النموذج الخام'), h('div', { class: 'notice warn', role: 'alert' }, 'اختبار تقني للمدير فقط. النص الخام أدناه غير معتمد علميًا، ولا يمر باسترجاع المعرفة أو أدوات المستشار أو مدقق توصياته. لا تستخدمه كنصيحة لموظف أو عميل. لا تكتب بيانات شخصية.'));
  if (!window.MHLocalAI?.available || typeof window.MHLocalAI.diagnose !== 'function') { root.append(h('p', { id: 'ai-lab-unavailable' }, 'التوليد الخام متاح فقط عبر محرك Android المحلي. لم يُستدعَ نموذج هنا.')); return; }
  const statusEl = h('p', { class: 'tiny', id: 'ai-lab-state' }), question = h('textarea', { id: 'ai-lab-prompt', maxlength: 1500, rows: 4, placeholder: 'اكتب سؤال اختبار جديدًا لقياس النموذج مباشرة…', 'aria-label': 'سؤال الاختبار التقني' });
  const raw = h('pre', { id: 'ai-lab-raw', style: 'white-space:pre-wrap;overflow-wrap:anywhere', dir: 'auto' }), metrics = h('pre', { id: 'ai-lab-metrics', style: 'white-space:pre-wrap;overflow-wrap:anywhere', dir: 'ltr' }), note = h('p', { role: 'status', 'aria-live': 'polite' });
  let report, running = false;
  const refresh = async () => {
    try { const s = await window.MHLocalAI.diagnostics(getToken()); fill(statusEl, !s.installed ? 'ملف النموذج غير مثبت.' : s.error ? 'خطأ المحرك: ' + s.error : !s.active ? 'ملف النموذج مثبت وغير مفعّل.' : s.loaded ? 'مثبت ومفعّل ومحمّل في الذاكرة.' : 'مثبت ومفعّل؛ غير محمّل في الذاكرة الآن. سيحاول الاختبار تحميله.'); return s; }
    catch (e) { fill(statusEl, 'تعذر فحص المحرك: ' + e.message); return null; }
  };
  const run = async () => {
    const prompt = question.value.trim(); if (!prompt || running) return;
    running = true; runButton.disabled = true; report = undefined; fill(raw); fill(metrics); fill(note, 'جارٍ استدعاء النموذج الحقيقي مباشرة؛ لا توجد إجابة احتياطية في هذا الاختبار.');
    const started = performance.now();
    try {
      const before = await refresh();
      const result = await window.MHLocalAI.diagnose(getToken(), prompt);
      if (typeof result?.text !== 'string' || !result.text.trim()) throw new Error('لم يُنتج النموذج نصًا.');
      const after = await refresh();
      report = { type: 'UNVALIDATED_NATIVE_DIAGNOSTIC', at: new Date().toISOString(), prompt, raw_text: result.text, native: result, elapsed_ms: Math.round(performance.now() - started), before, after, warning: 'Raw model output; NOT a scientifically approved consultation. User chose this manager-only diagnostic.' };
      fill(raw, result.text); fill(metrics, JSON.stringify({ elapsed_ms: report.elapsed_ms, native_ms: result.ms ?? null, model: after?.manifest?.id ?? before?.manifest?.id ?? null, loaded: after?.loaded ?? null, diagnostics: after?.diagnostics ?? null }, null, 2)); fill(note, 'اكتمل توليد نص خام من النموذج. هذا يثبت التشغيل فقط، ولا يثبت صحة النص أو جودة المستشار.');
    } catch (e) {
      report = { type: 'FAILED_NATIVE_DIAGNOSTIC', at: new Date().toISOString(), prompt, error: e.message, elapsed_ms: Math.round(performance.now() - started), warning: 'No fallback response was substituted.' }; fill(note, 'فشل اختبار النموذج: ' + e.message + ' — لم تُعرض إجابة محفوظة بدلًا منه.'); await refresh();
    } finally { running = false; runButton.disabled = false; }
  };
  const runButton = h('button', { class: 'btn', type: 'button', id: 'ai-lab-run', onclick: run }, 'اختبار توليد حقيقي');
  const copy = async () => { if (!report) { fill(note, 'شغّل اختبارًا أولًا.'); return; } try { await navigator.clipboard.writeText(JSON.stringify(report, null, 2)); fill(note, 'نُسخ سجل الاختبار، بما فيه السؤال والنص الخام.'); } catch { fill(note, 'تعذر النسخ؛ يمكن تصدير السجل.'); } };
  const save = async () => {
    if (!report) { fill(note, 'شغّل اختبارًا أولًا.'); return; }
    const name = 'MAKEUP_HOUSE_NATIVE_DIAGNOSTIC_' + Date.now() + '.json', blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    try { if (window.MHNative?.saveFile) await window.MHNative.saveFile(name, blob); else { const url = URL.createObjectURL(blob), link = h('a', { href: url, download: name }); document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); } fill(note, 'تم تصدير سجل يتضمن السؤال والنص الخام؛ راجعه قبل مشاركته.'); } catch (e) { fill(note, 'تعذر التصدير: ' + e.message); }
  };
  root.append(statusEl, question, h('div', { class: 'row' }, runButton, h('button', { class: 'btn out', type: 'button', onclick: async () => { try { await window.MHLocalAI.call('cancel', getToken()); fill(note, 'أُرسل طلب إلغاء التوليد.'); } catch (e) { fill(note, e.message); } } }, 'إلغاء'), h('button', { class: 'btn out', type: 'button', onclick: refresh }, 'تحديث الحالة')),
    note, h('h3', {}, 'نص خام غير معتمد'), raw, h('details', {}, h('summary', {}, 'القياسات والتشخيص'), metrics), h('div', { class: 'row' }, h('button', { class: 'btn sm out', type: 'button', onclick: copy }, 'نسخ سجل الاختبار'), h('button', { class: 'btn sm out', type: 'button', onclick: save }, 'تصدير JSON')),
    h('p', { class: 'tiny muted' }, 'النتيجة تبقى في ذاكرة هذه الصفحة، ولا تُضاف إلى المعرفة أو الاستشارات. التصدير والنسخ إجراء صريح منك.'));
  window.addEventListener('hashchange', () => { if (running) window.MHLocalAI.call('cancel', getToken()).catch(() => {}); }, { once: true });
  await refresh();
}
