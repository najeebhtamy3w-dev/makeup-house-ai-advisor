import { registerPlugin, Capacitor, type PluginListenerHandle } from '@capacitor/core';
interface NativeAI {
  addListener(event: string, callback: (data: any) => void): Promise<PluginListenerHandle>;
  status(o: { token: string; diagnostics?: boolean }): Promise<any>;
  install(o: { token: string }): Promise<any>;
  activate(o: { token: string }): Promise<any>;
  deactivate(o: { token: string }): Promise<any>;
  remove(o: { token: string }): Promise<any>;
  reset(o: { token: string }): Promise<any>;
  test(o: { token: string }): Promise<any>;
  cancel(o: { token: string }): Promise<void>;
  generate(o: { token: string; prompt: string; task?: string; max_tokens?: number; allowed_product_ids?: number[]; allowed_claim_ids?: string[] }): Promise<{ text: string; ms: number }>;
}
const native = registerPlugin<NativeAI>('LocalAI');
let composing = false;
let cancellationEpoch = 0;
const phase = (state:string,detail:string) => window.dispatchEvent(new CustomEvent('mh-ai-progress',{detail}));
export const localAI = {
  available: Capacitor.isNativePlatform(),
  async diagnostics(token: string) {
    if (!Capacitor.isNativePlatform()) throw new Error('يتطلب تطبيق Android');
    return native.status({ token, diagnostics: true });
  },
  async call(action: keyof NativeAI, token: string) {
    if (!Capacitor.isNativePlatform()) throw new Error('يتطلب تطبيق Android');
    if (!['status', 'install', 'activate', 'deactivate', 'remove', 'reset', 'cancel', 'test'].includes(action)) throw new Error('عملية غير مسموحة');
    if(action==='cancel')cancellationEpoch++;
    const out = await (native[action] as (o: { token: string }) => Promise<any>)({ token });
    if (['activate', 'deactivate', 'remove', 'install'].includes(action)) {
      const r = await fetch('/api/local-ai/config', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ model_id: 'qwen35-2b-q4km', desired_active: Boolean(out?.active) }) });
      if (!r.ok) throw new Error('تعذر حفظ إعداد النموذج؛ راجعي حالة التشغيل');
    }
    return out;
  },
  async diagnose(token:string,prompt:string){if(!Capacitor.isNativePlatform())throw new Error('يتطلب تطبيق Android');return (native as any).diagnose({token,prompt,max_tokens:256});},
  async consult(body: any, token: string, fetchLocal: typeof fetch) {
    const headers = { authorization: 'Bearer ' + token, 'content-type': 'application/json' };
    const post = async (path: string, data: any) => {
      const response = await fetchLocal(path, { method: 'POST', headers, body: JSON.stringify(data) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'تعذرت الاستشارة');
      return result;
    };
    let current = await post('/api/intelligence/start', { message: body.message, ...(body.session_id ? { session_id: body.session_id } : {}) });
    const epoch=cancellationEpoch;const deadline=Date.now()+150_000;
    const cancel = () => { cancellationEpoch++; native.cancel({ token }).catch(() => {}); };
    if (composing) {
      if (current.kind === 'request_model') current = await post('/api/intelligence/advance', { ticket: current.ticket, raw: '', failure: 'runtime_busy' });
      return current;
    }
    composing = true;
    window.addEventListener('hashchange', cancel);
    const timer = setTimeout(cancel, 150_000);
    try {
      for (let i = 0; current.kind === 'request_model' && i < 4; i++) {
        let raw = '', failure: string | undefined, model_started=false;
        try {
          if(epoch!==cancellationEpoch||Date.now()>deadline)throw new Error('consultation_cancelled');
          const status = await native.status({ token });
          phase(status.loaded?'understanding':'loading',status.loaded?'جار فهم السؤال والتخطيط':'جار تحميل النموذج المحلي');
          if (!status.active || !status.installed || status.error) throw new Error('model_unavailable');
          phase(current.task,current.task==='plan'?'جار فهم السؤال والتخطيط':'جار تحليل الأدلة وتوليد الإجابة');
          model_started=true;
          const output = await native.generate({ token, prompt: current.prompt, task: current.task, max_tokens: current.max_tokens, allowed_product_ids: current.allowed_product_ids ?? [], allowed_claim_ids: current.allowed_claim_ids ?? [] });
          if(epoch!==cancellationEpoch||Date.now()>deadline)throw new Error('consultation_cancelled');
          raw = output.text;phase('validating','جار التحقق من الادعاءات واسترجاع الأدوات');
        } catch(e) { failure = epoch!==cancellationEpoch?'cancelled':Date.now()>deadline?'deadline':e instanceof Error?e.message.slice(0,80):'local_runtime_unavailable_or_interrupted'; }
        current = await post('/api/intelligence/advance', { ticket: current.ticket, raw, model_started, ...(failure ? { failure } : {}) });
      }
      if (current.kind !== 'final') throw new Error('انتهت ميزانية الاستشارة');
      phase('completed','اكتملت الإجابة');return current;
    } finally { composing = false; clearTimeout(timer); window.removeEventListener('hashchange', cancel); }
  },
  async compose(result: any, token: string, fetchLocal: typeof fetch) {
    let ctx = result.local_ai_context; delete result.local_ai_context;
    if (!ctx || !Capacitor.isNativePlatform()) return result;
    if (composing) { result.local_ai = { ok: false, note: 'توجد استشارة قيد الصياغة؛ الإجابة من المحرك العلمي بالقواعد.' }; return result; }
    composing = true;
    window.dispatchEvent(new CustomEvent('mh-ai-scientific-result', { detail: { ...result, local_ai: { ok: false, note: 'الإجابة العلمية جاهزة؛ جارٍ إعداد الصياغة المحلية والتحقق منها.' } } }));
    const onLeave = () => { native.cancel({ token }).catch(() => {}); };
    window.addEventListener('hashchange', onLeave, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const status = await native.status({ token });
      if (!status.active || !status.installed || status.error) { result.local_ai = { ok: false, note: 'المستشار العلمي يعمل بالقواعد؛ النموذج المحلي غير مفعّل.' }; return result; }
      timer = setTimeout(() => { native.cancel({ token }).catch(() => {}); }, 90_000);
      const deadline = Date.now() + 90_000;
      for (let attempt = 0; attempt < 2; attempt++) {
        if (Date.now() >= deadline) throw new Error('انتهى الوقت');
        const output = await native.generate({ token, prompt: ctx.prompt });
        const response = await fetchLocal('/api/local-ai/validate', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ ticket: ctx.ticket, raw: output.text }) });
        const checked = await response.json();
        if (response.ok && checked.ok) { result.local_ai = { ok: true, text: checked.text, ms: output.ms, note: attempt ? 'اختار النموذج اقتباسًا من الأدلة بعد رفض الصياغة الأولى. ليست مراجعة علمية بشرية.' : 'صياغة محلية مولّدة، اجتازت قواعد مطابقة المصادر. ليست مراجعة علمية بشرية.' }; break; }
        if (attempt === 0 && checked.retry) { ctx = checked.retry; continue; }
        throw new Error('فشلت مطابقة الصياغة مع المصادر');
      }
    } catch { result.local_ai = { ok: false, note: 'تعذرت الصياغة المحلية أو رفضها التحقق العلمي؛ الإجابة من المحرك العلمي بالقواعد.' }; }
    finally { composing = false; window.removeEventListener('hashchange', onLeave); if (timer) clearTimeout(timer); }
    return result;
  },
};
declare global { interface Window { MHLocalAI?: typeof localAI } }
window.MHLocalAI = localAI;
if (Capacitor.isNativePlatform()) {
  native.addListener('downloadProgress', d => window.dispatchEvent(new CustomEvent('mh-ai-progress', { detail: `تم تنزيل ${(d.bytes / 1e6).toFixed(0)} من ${(d.total / 1e6).toFixed(0)} MB` }))).catch(() => {});
  // No raw token is sent to the screen: output is buffered until the worker validates it.
  native.addListener('generationProgress', d => window.dispatchEvent(new CustomEvent('mh-ai-progress', { detail: `جارٍ التوليد والتحقق — ${d.tokens} رمز` }))).catch(() => {});
}
