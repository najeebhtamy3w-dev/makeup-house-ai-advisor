// Local image intake and human-confirmed product memory. File validation/barcode decoding is NOT OCR or visual reasoning.
import { api } from './api.js';
import { h, fill, field, select } from './util.js';
import { processImage, uploadImage, authImg } from './images.js';

const PROCESSED_MAX = 2 * 1024 * 1024;
const INPUT_MAX = 25 * 1024 * 1024;
const codePattern = /^[0-9A-Za-z-]{3,40}$/;
export function attachmentConsultationText(draft) {
  const lines = ['معلومات منتج نقلها الموظف؛ ليست نتيجة تعرف بصري أو حقائق علمية معتمدة:'];
  for (const [key, label] of [['name','الاسم'],['brand','العلامة'],['barcode','الكود'],['size','الحجم'],['ingredients','INCI المنقول من العبوة'],['source_url','المصدر الذي أدخله الموظف']]) if (draft[key]) lines.push(label + ': ' + String(draft[key]));
  lines.push('حلّل المعلومات المتاحة وحدد الناقص، ولا تفترض التركيز أو pH أو الأصالة أو التوفر.');
  return lines.join('\n');
}
export async function detectAttachmentBarcodes(blob) {
  if (!('BarcodeDetector' in window) || typeof createImageBitmap !== 'function') return { codes: [], supported: false };
  let bitmap;
  try {
    const available = typeof window.BarcodeDetector.getSupportedFormats === 'function' ? await window.BarcodeDetector.getSupportedFormats() : ['ean_13','ean_8','upc_a','upc_e','code_128'];
    const formats = ['ean_13','ean_8','upc_a','upc_e','code_128'].filter(f => available.includes(f));
    if (!formats.length) return { codes: [], supported: false };
    bitmap = await createImageBitmap(blob);
    const results = await new window.BarcodeDetector({ formats }).detect(bitmap);
    return { codes: [...new Set(results.map(r => String(r.rawValue ?? '').trim()).filter(v => codePattern.test(v)))].slice(0, 5), supported: true };
  } catch { return { codes: [], supported: true, failed: true }; }
  finally { bitmap?.close?.(); }
}
export async function openChatProductAttachment({ onContext = () => {}, onStored = () => {} } = {}) {
  const me = await api('GET', '/api/auth/me');
  const isManager = me?.user?.role === 'manager';
  let selected, origin = 'upload', previewUrl, prepared, requestRef, savedProduct, uploaded = false, running = false, closed = false;
  const note = h('p', { role: 'status', 'aria-live': 'polite' }), photo = h('div', { id: 'chat-attachment-preview' }), matches = h('div', { id: 'chat-attachment-matches' }), draftSummary = h('div', { id: 'chat-attachment-draft' }), stored = h('div', { id: 'chat-attachment-stored' });
  const name = h('input', { maxlength: 200, id: 'chat-product-name' }), brand = h('input', { maxlength: 120, id: 'chat-product-brand' }), barcode = h('input', { maxlength: 40, inputmode: 'text', id: 'chat-product-barcode' }), size = h('input', { maxlength: 60, id: 'chat-product-size' }), ingredients = h('textarea', { maxlength: 5000, rows: 4, id: 'chat-product-inci', placeholder: 'انسخ قائمة INCI كما تظهر على العبوة؛ لا تستنتج بيانات غير مقروءة.' }), sourceUrl = h('input', { type: 'url', maxlength: 500, id: 'chat-product-source', placeholder: 'رابط HTTPS اختياري من الشركة أو مصدر موثق' });
  const dataOrigin = select([['employee_input','إدخال الموظف'],['package_transcription','نقل يدوي من العبوة'],['manufacturer_information','معلومات الشركة']], 'employee_input', { id: 'chat-data-origin' });
  const kind = select([['front','واجهة المنتج'],['ingredients','قائمة المكونات'],['package','العبوة'],['other','أخرى']], 'front', { id: 'chat-image-kind' });
  const confirmed = h('input', { type: 'checkbox', id: 'chat-draft-confirm' });
  const fields = [name,brand,barcode,size,ingredients,sourceUrl];
  const invalidate = () => { prepared = undefined; requestRef = undefined; confirmed.checked = false; fill(draftSummary); };
  for (const f of fields) f.addEventListener('input', invalidate);
  dataOrigin.addEventListener('change', invalidate);
  const readDraft = () => ({ name: name.value.trim(), brand: brand.value.trim(), barcode: barcode.value.trim(), size: size.value.trim(), ingredients: ingredients.value.trim(), source_url: sourceUrl.value.trim(), origin: dataOrigin.value });
  const newRef = () => 'chat-' + (crypto.randomUUID?.() ?? [...crypto.getRandomValues(new Uint8Array(16))].map(x => x.toString(16).padStart(2,'0')).join(''));
  const close = () => { if (running) { fill(note, 'انتظر اكتمال العملية الحالية قبل الإغلاق.'); return; } closed = true; if (previewUrl) URL.revokeObjectURL(previewUrl); sheet.remove(); window.removeEventListener('hashchange', onLeave); };
  const onLeave = () => { closed = true; if (previewUrl) URL.revokeObjectURL(previewUrl); sheet.remove(); };
  const run = async fn => { if (running) return; running = true; try { await fn(); } catch (e) { if (!closed) fill(note, e.message || 'تعذرت العملية.'); } finally { running = false; } };
  const showStored = async id => {
    const result = await api('GET', '/api/intelligence/products/' + id + '/images');
    const actual = (result.images ?? []).filter(i => Number.isSafeInteger(i.id) && i.id > 0).slice(0, 8);
    if (!closed) fill(stored, h('p', {}, actual.length ? 'صور فعلية محفوظة لهذا السجل:' : 'لا توجد صورة محفوظة لهذا السجل.'), h('div', { class: 'imggrid' }, actual.map(i => h('figure', { class: 'imgitem' }, authImg('/api/images/' + i.id + '?size=thumb', 'صورة محفوظة للمنتج ' + (result.name ?? ''), 'sm', { thumb: true }), h('figcaption', { class: 'tiny muted' }, 'الصورة لا تثبت الأصالة أو صحة المكونات.')))));
    return actual;
  };
  const attachExisting = async p => {
    if (!isManager) return;
    if (!selected) { fill(note, 'اختر صورة وافحصها أولًا.'); return; }
    await uploadImage(p.id, { blob: selected.blob, origin, kind: kind.value });
    const images = await showStored(p.id); fill(note, 'حُفظت الصورة على السجل الموجود. لم تُغيّر بيانات المنتج أو حالة المخزون.');
    onStored({ product_id: p.id, name: p.name, images });
  };
  const showMatches = result => {
    fill(matches, h('p', { class: 'tiny muted' }, result.note ?? ''), (result.matches ?? []).map(p => h('div', { class: 'card' }, h('b', {}, p.name), h('p', { class: 'tiny' }, [p.brand,p.size].filter(Boolean).join(' · ')), h('p', { class: 'tiny' }, 'التوفر من الدفعات: ' + ({yes:'متوفر',no:'غير متوفر',unknown:'غير مؤكد'}[p.availability] ?? 'غير مؤكد')),
      h('button', { type: 'button', class: 'btn sm out', onclick: () => run(() => showStored(p.id)) }, 'عرض الصور المحفوظة'),
      isManager ? h('button', { type: 'button', class: 'btn sm out', onclick: () => run(() => attachExisting(p)) }, 'أؤكد ربط الصورة بهذا السجل') : null)));
    if (!result.matches?.length) matches.append(h('p', { class: 'tiny' }, 'لا يوجد تطابق محلي مسجل. لم يُنفذ بحث عالمي أو تعرف بصري.'));
  };
  const lookup = async () => {
    const code = barcode.value.trim(); if (!codePattern.test(code)) throw new Error('أدخل كودًا صالحًا للبحث المحلي.');
    const identity = await api('GET', '/api/intelligence/identity/barcode/' + encodeURIComponent(code)); showMatches(identity); return identity;
  };
  const choose = async (file, from) => {
    if (!file) return;
    if (!['image/jpeg','image/png'].includes(file.type)) throw new Error('اختر JPEG أو PNG.');
    if (file.size > INPUT_MAX) throw new Error('الصورة الأصلية أكبر من 25 ميغابايت.');
    fill(note, 'جارٍ ضغط الصورة وفحص الملف محليًا…');
    const processed = await processImage(file);
    if (!processed?.blob?.size || processed.blob.size > PROCESSED_MAX) throw new Error('حجم الصورة بعد الضغط يجب ألا يتجاوز 2 ميغابايت.');
    const inspection = await api('POST', '/api/intelligence/attachments/inspect-image', processed.blob, { raw: true });
    if (closed) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    selected = processed; origin = from; invalidate(); fill(matches); fill(stored); previewUrl = URL.createObjectURL(processed.blob);
    fill(photo, h('img', { src: previewUrl, alt: 'معاينة محلية للصورة المختارة', style: 'max-width:100%;max-height:220px;object-fit:contain' }), h('p', { class: 'tiny muted' }, `${inspection.width ?? '?'}×${inspection.height ?? '?'} · ${Math.round(inspection.size / 1024)} ك.ب — فحص ملف فقط؛ لم يُستخرج اسم أو INCI من الصورة.`));
    const decoded = await detectAttachmentBarcodes(processed.blob);
    if (closed) return;
    if (decoded.codes.length === 1) { barcode.value = decoded.codes[0]; await lookup(); fill(note, 'فُك كود من الصورة وبُحث عنه محليًا. لم يُنفذ OCR أو فهم بصري للمكونات.'); }
    else fill(note, decoded.codes.length > 1 ? 'ظهر أكثر من كود؛ أدخل الكود المقصود يدويًا للبحث.' : decoded.supported ? 'لم يُقرأ كود من الصورة. أدخل الاسم أو الكود والمكونات يدويًا.' : 'فك الباركود من الصورة غير مدعوم هنا. أدخل الكود يدويًا؛ OCR والفهم البصري غير متاحين.');
  };
  const camera = h('input', { type: 'file', accept: 'image/jpeg,image/png', capture: 'environment', class: 'hide', 'aria-label': 'تصوير منتج', onchange: e => run(() => choose(e.target.files?.[0], 'camera')) });
  const gallery = h('input', { type: 'file', accept: 'image/jpeg,image/png', class: 'hide', 'aria-label': 'اختيار صورة منتج', onchange: e => run(() => choose(e.target.files?.[0], 'upload')) });
  const previewDraft = async () => {
    if (!name.value.trim()) throw new Error('أدخل اسم المنتج من العبوة أو سجل موثوق.');
    prepared = await api('POST', '/api/intelligence/product-drafts/preview', readDraft()); requestRef = newRef();
    fill(draftSummary, h('p', {}, 'معاينة مسودة: ' + prepared.draft.name), h('p', { class: 'tiny muted' }, prepared.note), prepared.missing_information?.length ? h('p', { class: 'tiny' }, 'معلومات ناقصة: ' + prepared.missing_information.map(k => ({brand:'العلامة',ingredients:'المكونات',size:'الحجم',source:'المصدر'}[k] ?? k)).join('، ')) : null,
      prepared.duplicate?.length ? h('p', { class: 'notice warn' }, 'الكود موجود مسبقًا؛ استخدم السجل الموجود بدل إنشاء نسخة.') : null);
    confirmed.checked = false; fill(note, 'راجع البيانات؛ المعاينة لم تحفظ منتجًا أو صورة.');
  };
  const saveDraft = async () => {
    if (!isManager) throw new Error('حفظ المسودة للمدير فقط.');
    if (!prepared || !confirmed.checked) throw new Error('عاين المسودة وأكد بياناتها صراحة قبل الحفظ.');
    if (prepared.duplicate?.length) throw new Error('الكود موجود مسبقًا؛ ابحث عن السجل الموجود واربط الصورة به.');
    if (!savedProduct) { savedProduct = await api('POST', '/api/intelligence/product-drafts/confirm', { confirmed: true, client_ref: requestRef, draft: prepared.draft }); fields.forEach(f => { f.disabled = true; }); dataOrigin.disabled = true; }
    if (selected && !uploaded) { await uploadImage(savedProduct.id, { blob: selected.blob, origin, kind: kind.value }); uploaded = true; }
    const images = await showStored(savedProduct.id); fill(note, 'حُفظت مسودة تحتاج مراجعة' + (uploaded ? ' مع صورة فعلية.' : '.') + ' لا يثبت الحفظ أصالة المنتج أو توفره أو اعتماده العلمي.');
    onStored({ product_id: savedProduct.id, name: prepared.draft.name, images, verification: 'review' });
  };
  const useContext = () => { if (!name.value.trim() && !ingredients.value.trim()) { fill(note, 'أدخل اسمًا أو قائمة مكونات مقروءة قبل استخدام المعلومات.'); return; } const context = attachmentConsultationText(readDraft()); if (context.length > 1000) { fill(note, 'المعلومات أطول من حد رسالة الاستشارة (1000 حرف). لم تُختصر أو تُرسل خفية؛ راجع الحقول واستخدم سؤالًا أقصر، ويمكن للمدير حفظ المسودة الكاملة للمراجعة.'); return; } onContext(context); close(); };
  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'صورة منتج ومعلومات العبوة' }, h('div', {},
    h('h3', { class: 't' }, 'صورة منتج ومعلومات العبوة'), h('p', { class: 'notice info' }, 'الصورة للمعاينة والتخزين المحلي وفك الباركود إذا دعمه الجهاز. لا يوجد OCR أو نموذج فهم صور مفعّل؛ انقل الاسم وINCI يدويًا. لا تُرسل الصورة إلى خدمة خارجية.'),
    camera, gallery, h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn sm', onclick: () => camera.click() }, 'تصوير العبوة'), h('button', { type: 'button', class: 'btn sm out', onclick: () => gallery.click() }, 'اختيار صورة')), photo, field('نوع الصورة', kind),
    field('الباركود أو الكود', barcode), h('button', { type: 'button', class: 'btn sm out', onclick: () => run(lookup) }, 'بحث الكود محليًا'), matches,
    field('اسم المنتج المنقول من العبوة', name), field('العلامة', brand), field('الحجم', size), field('المكونات INCI كما نُقلت', ingredients), field('رابط مصدر اختياري', sourceUrl), field('مصدر البيانات الذي تؤكده', dataOrigin),
    h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn sm out', onclick: () => run(previewDraft) }, 'معاينة مسودة المعلومات'), h('button', { type: 'button', class: 'btn sm', onclick: useContext }, 'استخدام المعلومات في السؤال')), draftSummary,
    isManager ? h('div', {}, h('label', {}, confirmed, ' أؤكد صحة نقل البيانات وأريد حفظ مسودة تحتاج مراجعة.'), h('button', { type: 'button', class: 'btn sm out', onclick: () => run(saveDraft) }, 'حفظ المسودة والصورة بعد التأكيد')) : h('p', { class: 'tiny muted' }, 'يمكنك الفحص والبحث واستخدام المعلومات؛ حفظ المسودة والصورة من هذه الشاشة للمدير فقط.'),
    note, stored, h('button', { type: 'button', class: 'btn out', onclick: close }, 'إغلاق')));
  document.body.append(sheet); window.addEventListener('hashchange', onLeave, { once: true });
  return { element: sheet, close };
}
