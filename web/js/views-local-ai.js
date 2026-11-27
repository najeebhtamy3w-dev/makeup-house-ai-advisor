import { api, getToken } from './api.js';
import { h, fill } from './util.js';
const messages = {
  DOWNLOAD_CANCELLED: 'توقف التنزيل مع الاحتفاظ بالجزء المحفوظ وبيانات الاستئناف.',
  DOWNLOAD_UNEXPECTED_EOF: 'انقطع الملف قبل اكتماله. احتُفظ بالجزء المنزّل؛ اضغط استئناف عند عودة الاتصال.',
  DOWNLOAD_SIZE_MISMATCH: 'الحجم النهائي غير مطابق للمصدر الموثوق. احتُفظ بالملف للمراجعة ولم يُفعّل.',
  DOWNLOAD_METADATA_MISMATCH: 'الملف الجزئي لا يطابق هوية التنزيل. احتُفظ به دون دمجه مع مصدر مختلف.',
  DOWNLOAD_ETAG_CHANGED: 'تغيرت هوية المصدر أثناء الاستئناف. احتُفظ بالجزء السابق دون تفعيله.',
  DOWNLOAD_RANGE: 'المصدر أعاد نطاقًا غير مطابق. لم يُدمج الرد مع الملف الجزئي.',
  DOWNLOAD_RANGE_UNSATISFIED_REFRESH: 'تعذر قبول نطاق الاستئناف. احتُفظ بالملف وجرى رفض الرد غير المطابق.',
  DOWNLOAD_GGUF_HEADER: 'البيانات ليست ملف GGUF صالحًا؛ لم تُثبّت كنموذج.',
  PERSISTENT_RUNTIME_STORAGE: 'المساحة الداخلية لا تكفي لإنشاء نسخة التشغيل؛ الأصل في المجلد محفوظ.',
  PERSISTENT_FOLDER_MISSING: 'تعذر الوصول إلى مجلد الحفظ. أعد ربط موقعه دون افتراض حذف الملفات.',
  PERSISTENT_HASH_MISMATCH: 'بصمة الملف المحلي لا تطابق النموذج المعتمد؛ لم يُفعّل ولم يُحذف الأصل.',
  PERSISTENT_SIZE_MISMATCH: 'حجم الملف المحلي لا يطابق النموذج المعتمد؛ راجع التشخيص أو اختر ملفًا صحيحًا.',
  PERSISTENT_NOT_GGUF: 'الملف المختار ليس GGUF صالحًا؛ الأصل لم يُحذف.',
  ASSET_NOT_FOUND: 'لم يُعثر على أصل مطابق في المجلد المصرح به. اختر مجلدًا آخر أو استورد الملف من الهاتف.',
  'Socket is closed': 'انقطع اتصال التنزيل. احتُفظ بالجزء القابل للاستئناف؛ أعد المحاولة عند استقرار الاتصال.',
  INSUFFICIENT_STORAGE: 'المساحة المتاحة لا تكفي للملف ونسخة التشغيل المحلية.',
  MODEL_HASH_MISMATCH: 'البصمة غير مطابقة. احتُفظ بالملف؛ تحقق من مصدره أو استورد نسخة صحيحة.',
  MODEL_SIZE_MISMATCH: 'حجم الملف غير مطابق. راجع الحجم الفعلي في التشخيص؛ لا تعني هذه الرسالة أن النموذج تالف.',
  CANCELLED: 'توقفت العملية مع الاحتفاظ بالملف الجزئي القابل للاستئناف.',
  BUSY: 'توجد عملية قيد التنفيذ.', FORBIDDEN: 'هذه العملية للمدير فقط.',
  MODEL_MISSING: 'نسخة التشغيل غير موجودة. اربط مجلد النماذج المحفوظة أو استورد الملف محليًا.',
  MODEL_NOT_ACTIVE: 'الملف مثبت لكن النموذج غير مفعّل. اختر تحقق وتفعيل.',
  MODEL_DISABLED: 'النموذج غير مفعّل. تحقق من الملف ثم فعّله؛ راجع سبب فشل آخر عملية أدناه.',
  CONTEXT_LIMIT: 'السياق أطول من الحد الآمن.', RUNTIME_UNAVAILABLE: 'محرك الذكاء غير متاح على هذا الجهاز.',
  STORAGE_FOLDER_REQUIRED: 'اختر مجلد الحفظ قبل بدء التنزيل.', FOLDER_REQUIRED: 'اختر مجلد الحفظ قبل بدء التنزيل.',
  STORAGE_RECONNECT_REQUIRED: 'يلزم ربط مجلد النماذج مجددًا. فقدان الصلاحية لا يعني حذف الملفات.',
  STORAGE_PERMISSION_REQUIRED: 'تعذر الوصول إلى المجلد. اختر المجلد نفسه مجددًا لاستعادة الصلاحية.',
  PROVIDER_NOT_SEEKABLE: 'مزود المجلد لا يدعم استئناف هذا الملف. اختر مجلدًا محليًا آخر مع الاحتفاظ بالملف الموجود.',
  RANGE_NOT_SUPPORTED_WITH_PARTIAL: 'المصدر لم يقبل الاستئناف. احتُفظ بالجزء السابق؛ لا يُستبدل تلقائيًا.',
  MODEL_SELECTION_CANCELLED: 'أُلغي اختيار الموقع؛ لم يبدأ تنزيل جديد.',
};
const storageFor = (state, asset) => state?.storage?.[asset] || state?.['storage_' + asset] || {};
const treeOf = storage => storage.tree_uri || storage.selected_tree_uri || storage.folder_uri || '';
const hasAccess = storage => ['read_write', 'granted', true].includes(storage.permission);
const folderLabel = storage => storage.folder_name || storage.display_name || treeOf(storage) || 'لم يُحدد مجلد بعد';
const permissionLabels = {not_selected:'لم يُختر مجلد',read_write:'قراءة وكتابة',read_only:'قراءة فقط',lost:'صلاحية مفقودة؛ أعد ربط المجلد',granted:'قراءة وكتابة'};
const storageLabels = {folder_not_bound:'لم يُربط مجلد',permission_lost:'تعذر الوصول؛ أعد ربط المجلد',folder_missing:'المجلد غير متاح',folder_unavailable:'تعذر فحص المجلد',folder_connected_discovery_required:'المجلد مرتبط؛ يلزم اكتشاف الملفات والتحقق منها',original_present_verification_required:'الملف المسجل موجود؛ يلزم التحقق قبل الاستخدام',recorded_original_missing_discovery_required:'الملف المسجل غير متاح؛ أعد اكتشاف الملفات'};
const mb = bytes => Number.isFinite(Number(bytes)) ? (Number(bytes) / 1e6).toFixed(0) + ' MB' : 'غير مقاسة';
export async function localAISettings(root) {
  const me = await api('GET', '/api/auth/me');
  if (me.user.role !== 'manager') { root.append(h('p', {}, 'هذه الصفحة للمدير فقط.')); return; }
  if (!window.MHLocalAI?.available) { root.append(h('p', {}, 'إدارة النموذج متاحة داخل تطبيق Android.')); return; }
  const content = h('div', { class: 'card' }), note = h('p', { role: 'status' }), progress = h('p', { class: 'tiny', 'aria-live': 'polite' });
  let running = false;
  const call = (action, asset) => window.MHLocalAI.call(action, getToken(), asset ? { asset } : {});
  const invoke = async (action, asset = 'model') => {
    if (running && action !== 'cancel') return;
    running = action !== 'cancel'; fill(note, 'جارٍ التنفيذ…');
    try {
      if (action === 'install' || action === 'installVision') {
        asset = action === 'installVision' ? 'vision' : 'model';
        let state = await window.MHLocalAI.diagnostics(getToken());
        let storage = storageFor(state, asset);
        let selection;
        const useSaved = treeOf(storage) && hasAccess(storage) && confirm('استخدام مجلد الحفظ السابق؟\n' + folderLabel(storage) + '\nاختر إلغاء لتحديد مجلد آخر.');
        if (!useSaved) {
          selection = await call('selectStorage', asset);
          state = await window.MHLocalAI.diagnostics(getToken()); storage = storageFor(state, asset);
        }
        if (!treeOf(storage) || !hasAccess(storage)) throw Error('STORAGE_FOLDER_REQUIRED');
        // Folder selection/reconnection may already restore a matching complete file without networking.
        const item = asset === 'vision' ? state.vision_projector : state;
        const originalVerified = storage.permanent_verified === true || selection?.reused_asset === asset || selection?.reused_existing === true;
        if (item?.installed && item?.verified && originalVerified) { fill(note, 'تم العثور على النموذج محفوظًا مسبقًا. يمكنك تفعيله دون إعادة التنزيل.'); return; }
        const bytes = asset === 'vision' ? state.vision_projector?.size : state.manifest?.size;
        if (!confirm('مجلد الحفظ: ' + folderLabel(storage) + '\nحجم الملف: ' + mb(bytes) + '\nستُحفظ الأوزان في المجلد المختار. قد تلزم نسخة تشغيل داخلية ومساحة إضافية مساوية لحجم الملف.\nقد تترتب تكلفة بيانات على التنزيل. متابعة؟')) { fill(note, 'لم يبدأ التنزيل.'); return; }
      }
      if (['importAsset','exportAsset'].includes(action)) {
        const state = await window.MHLocalAI.diagnostics(getToken()), storage = storageFor(state, asset);
        if (!treeOf(storage) || !hasAccess(storage)) await call('selectStorage', asset);
      }
      if (action === 'remove' && !confirm('إزالة نسخة التشغيل الداخلية فقط؟ تبقى النسخة الدائمة في المجلد الذي اخترته. تأكد أولًا من حفظ نسخة دائمة إذا كان الملف القديم داخل التطبيق فقط.')) { fill(note, 'أُلغيت إزالة نسخة التشغيل؛ لم تُحذف الملفات.'); return; }
      if (action === 'removeVision' && !confirm('إزالة نسخة تشغيل ملحق الرؤية الداخلية فقط؟ لا تُحذف النسخة الدائمة من المجلد المختار.')) { fill(note, 'أُلغيت إزالة نسخة التشغيل؛ لم تُحذف الملفات.'); return; }
      const result = await call(action, ['selectStorage','reconnectStorage','importAsset','exportAsset','recoverAsset'].includes(action) ? asset : undefined);
      fill(note, action === 'test' ? `اختبار استدلال فعلي: ${result.generated_bytes} بايت مولّدة خلال ${result.ms} ms. لا يُعرض نص الاختبار كاستشارة.` : result?.reused_existing ? 'تم العثور على النموذج محفوظًا مسبقًا. يمكنك تفعيله دون إعادة التنزيل.' : action === 'cancel' ? 'أُرسل طلب إيقاف العملية مع الاحتفاظ بالأجزاء القابلة للاستعادة.' : 'تمت العملية.');
    } catch (e) { fill(note, messages[e.message] || 'تعذرت العملية: ' + e.message); }
    finally { running = false; await draw(); }
  };
  const storageCard = (state, asset, title) => {
    const storage = storageFor(state, asset), item = asset === 'vision' ? state.vision_projector : state;
    return h('section', { class: 'card', 'data-asset': asset }, h('h4', {}, title),
      h('p', { class: 'tiny' }, 'مكان الحفظ الدائم: ', h('bdi', { dir: 'auto' }, folderLabel(storage))),
      h('p', { class: 'tiny' }, 'صلاحية المجلد: ' + (permissionLabels[storage.permission] || storage.permission || (treeOf(storage) ? 'تحتاج تحققًا من النظام' : 'لم يُربط'))),
      h('p', { class: 'tiny' }, 'النسخة الدائمة: ' + (storage.permanent_verified ? 'تحققت سابقًا؛ يُعاد التحقق عند الاستخدام' : storageLabels[storage.permanent_status || storage.state] || storage.permanent_status || storage.state || 'لم يُثبت التحقق بعد')),
      h('p', { class: 'tiny' }, 'نسخة التشغيل الداخلية: ' + (item?.installed ? 'موجودة — ' + mb(storage.runtime_bytes || (asset === 'vision' ? item.size : state.manifest?.size)) : 'غير موجودة')),
      h('p', { class: 'tiny' }, 'طريقة التشغيل: نسخة داخلية مشتقة محليًا من الملف الدائم؛ لا تعني قراءة مباشرة من SAF. قد تتطلب مساحة إضافية بحجم الملف.'),
      h('div', { class: 'row' }, [
        ['selectStorage', 'اختيار / تغيير مجلد الحفظ'], ['reconnectStorage', 'ربط مجلد النماذج المحفوظة سابقًا'],
        ['importAsset', asset === 'vision' ? 'استيراد ملحق الرؤية من الهاتف' : 'استيراد GGUF من الهاتف'],
        ['exportAsset', 'حفظ نسخة دائمة من الملف الموجود'], ['recoverAsset', 'استعادة من المجلد دون تنزيل'],
      ].map(([action, label]) => h('button', { class: 'btn sm out', 'data-action': action, 'data-asset': asset, onclick: () => invoke(action, asset) }, label))));
  };
  const draw = async () => {
    try {
      const state = await window.MHLocalAI.diagnostics(getToken()), model = state.manifest;
      fill(content, h('h3', {}, 'النموذج المحلي — إصدار تجريبي'),
        h('p', { dir: 'ltr' }, model?.id || 'غير معروف'),
        h('p', { class: 'tiny' }, `الإصدار: ${model?.version || '—'} · ${model?.format || '—'} · ${model?.quantization || '—'}`),
        h('p', {}, 'حجم النموذج: ' + mb(model?.size) + ' · المساحة الداخلية المتاحة: ' + mb(state.free_bytes)),
        h('p', {}, state.installed ? state.active ? state.loaded ? 'مثبّت ومفعّل ومحمّل في الذاكرة' : 'مثبّت ومفعّل — غير محمّل في الذاكرة حاليًا' : 'مثبّت وغير مفعّل' : 'نسخة التشغيل غير مثبّتة — تم تنزيل ' + mb(state.downloaded || 0)),
        state.last_operation_error ? h('p', { class: 'notice warn' }, 'فشلت آخر عملية: ' + (messages[state.last_operation_error] || state.last_operation_error)) : null,
        h('p', { class: 'tiny' }, `الرخصة: ${model?.license || '—'} · الجهاز: ${state.device || '—'} · المحرك: ${state.runtime || '—'}`),
        storageCard(state, 'model', 'حفظ واستعادة النموذج النصي'),
        h('div', { class: 'row' }, [['install', 'تنزيل / استئناف'], ['activate', 'تحقق وتفعيل'], ['test', 'اختبار النموذج'], ['deactivate', 'إيقاف وتفريغ RAM'], ['remove', 'إزالة نسخة التشغيل فقط'], ['cancel', 'إيقاف مؤقت مع الاحتفاظ بالجزء'], ['reset', 'تصفير سياق المحرك']].map(([action, label]) => h('button', { class: 'btn sm out', 'data-action': action, onclick: () => invoke(action) }, label))),
        storageCard(state, 'vision', 'حفظ واستعادة ملحق الرؤية'),
        h('p', { class: 'tiny' }, 'ملحق الرؤية: ' + (state.vision_projector?.installed ? state.vision_loaded ? 'محمّل؛ المخرجات غير متحققة وتحتاج مراجعة.' : 'مثبّت وغير محمّل؛ التثبيت وحده لا يثبت الرؤية.' : 'غير مثبّت؛ النص وOCR لا يحتاجان تنزيله.')),
        h('div', { class: 'row' }, [['installVision', 'تنزيل / استئناف ملحق الرؤية'], ['removeVision', 'إزالة نسخة تشغيل ملحق الرؤية فقط']].map(([action, label]) => h('button', { class: 'btn sm out', 'data-action': action, onclick: () => invoke(action, 'vision') }, label))),
        h('p', { class: 'notice warn' }, 'الأوزان في المجلد المشترك مستقلة عن بيانات التطبيق. بعد إعادة التثبيت اختر المجلد نفسه مجددًا. نسخ بيانات المنتجات والمحادثات احتياطيًا وظيفة مستقلة. لم يكتمل قبول Samsung وجودة الذكاء بعد.'),
        h('button', { class: 'btn sm out', onclick: () => navigator.clipboard.writeText(JSON.stringify(state, null, 2)).then(() => fill(note, 'نُسخ التشخيص.')).catch(() => fill(note, 'تعذر النسخ؛ يمكن قراءة التشخيص أدناه.')) }, 'نسخ التشخيص'),
        h('details', {}, h('summary', {}, 'التشخيص'), h('pre', { dir: 'ltr', style: 'white-space:pre-wrap;overflow-wrap:anywhere' }, JSON.stringify(state, null, 2))));
    } catch (e) { fill(content, messages[e.message] || e.message); }
  };
  root.append(h('h2', { class: 't' }, 'الذكاء المحلي'), content, progress, note);
  const onProgress = event => { if (content.isConnected) fill(progress, event.detail); else window.removeEventListener('mh-ai-progress', onProgress); };
  window.addEventListener('mh-ai-progress', onProgress);
  await draw();
}
