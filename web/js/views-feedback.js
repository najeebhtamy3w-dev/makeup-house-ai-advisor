// Trial feedback (CP03 staging). Notes are kept ON THIS PHONE ONLY (localStorage), so a staging server restart never loses them,
// and nothing is sent anywhere automatically. The owner exports them (share / copy / download) when ready.
// Only non-sensitive technical info is attached: no token, no username, no product data.
import { h, fill, toast, field, select } from './util.js';

const KEY = 'mh_feedback_v1';
export const FEATURES = ['تسجيل الدخول', 'البحث اليدوي عن المنتجات', 'مسح الباركود بالكاميرا', 'قارئ باركود خارجي (HID)', 'البحث العالمي (Open Beauty Facts)', 'مصدر بيانات المنتج',
  'مقارنة بيانات المنتج بالعبوة', 'حفظ مسودة / بطاقة منتج', 'المستشار التجميلي', 'تفسير التوصيات', 'التحذيرات وحالات عدم اليقين', 'المنتجات المستبعدة وأسبابها',
  'تحديث التوفر', 'مراجعة المعلومات (المدير)', 'الاستيراد (المدير)', 'الشكل والتصميم', 'السرعة', 'أخرى'];
const RESULTS = [['fail', 'لم تعمل كما يجب'], ['partial', 'عملت جزئيًا'], ['ok', 'عملت كما يجب'], ['idea', 'اقتراح']];
const RL = Object.fromEntries(RESULTS);

export function loadNotes() { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } }
function saveNotes(list) { try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch { return false; } }

export function techInfo(version) {
  return { app_version: version ?? null, page: location.hash.split('?')[0] || '#/', user_agent: navigator.userAgent, screen: `${screen.width}x${screen.height}@${devicePixelRatio}`,
    viewport: `${innerWidth}x${innerHeight}`, secure_context: window.isSecureContext, online: navigator.onLine, camera_api: !!navigator.mediaDevices?.getUserMedia,
    barcode_detector: 'BarcodeDetector' in window, installed_app: matchMedia('(display-mode: standalone)').matches, language: navigator.language };
}

const asText = (list) => list.map((n, i) => [`#${i + 1} — ${n.feature} — ${RL[n.result] ?? n.result}`, `الوقت: ${new Date(n.at).toLocaleString('ar-YE')}`,
  n.expected ? `المتوقع: ${n.expected}` : null, n.actual ? `الفعلي: ${n.actual}` : null, n.details ? `الوصف: ${n.details}` : null,
  `تقني: ${n.tech.user_agent} | شاشة ${n.tech.screen} | HTTPS ${n.tech.secure_context ? 'نعم' : 'لا'} | BarcodeDetector ${n.tech.barcode_detector ? 'نعم' : 'لا'} | إصدار ${n.tech.app_version}`].filter(Boolean).join('\n')).join('\n\n');

export function feedback(main, meta) {
  const feat = select(FEATURES.map((f) => [f, f]), FEATURES[0], { 'aria-label': 'الوظيفة' });
  const res = select(RESULTS, 'fail', { 'aria-label': 'النتيجة' });
  const exp = h('textarea', { rows: 2, maxlength: 600, placeholder: 'ماذا كنت تتوقع أن يحدث؟' });
  const act = h('textarea', { rows: 2, maxlength: 600, placeholder: 'ماذا حدث فعلًا؟' });
  const det = h('textarea', { rows: 3, maxlength: 1500, placeholder: 'وصف الخطأ أو الخطوات (بدون أسماء عملاء أو أرقام هواتف)' });
  const listBox = h('div', {});
  const render = () => {
    const list = loadNotes();
    fill(listBox, h('div', { class: 'row sb' }, h('strong', {}, `الملاحظات المحفوظة على هذا الهاتف: ${list.length}`)),
      list.length ? h('div', { class: 'row', style: 'margin:8px 0' },
        navigator.share ? h('button', { class: 'btn sm', onclick: async () => { try { await navigator.share({ title: 'ملاحظات تجربة MAKEUP HOUSE', text: asText(list) }); } catch { /* cancelled */ } } }, 'مشاركة') : null,
        h('button', { class: 'btn sm out', onclick: async () => { try { await navigator.clipboard.writeText(asText(list)); toast('تم النسخ'); } catch { toast('تعذر النسخ'); } } }, 'نسخ كنص'),
        h('button', { class: 'btn sm out', onclick: () => { const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify({ exported_at: new Date().toISOString(), notes: list }, null, 2)], { type: 'application/json' })), download: `makeup-house-feedback-${Date.now()}.json` }); document.body.append(a); a.click(); a.remove(); } }, 'تنزيل JSON'),
        h('button', { class: 'btn sm light', onclick: () => { if (confirm('حذف كل الملاحظات من هذا الهاتف؟')) { saveNotes([]); render(); } } }, 'حذف الكل')) : null,
      list.slice().reverse().map((n) => h('div', { class: 'card' }, h('div', { class: 'row sb' }, h('strong', {}, n.feature), h('span', { class: 'badge ' + (n.result === 'ok' ? 'ok' : n.result === 'fail' ? 'no' : 'warn') }, RL[n.result] ?? n.result)),
        h('p', { class: 'tiny muted' }, new Date(n.at).toLocaleString('ar-YE')), n.actual ? h('p', { class: 'tiny' }, 'الفعلي: ', n.actual) : null, n.details ? h('p', { class: 'tiny' }, n.details) : null)));
  };
  const submit = (e) => {
    e.preventDefault();
    if (!act.value.trim() && !det.value.trim()) { toast('اكتب النتيجة الفعلية أو وصفًا قصيرًا'); return; }
    const list = loadNotes();
    list.push({ at: new Date().toISOString(), feature: feat.value, result: res.value, expected: exp.value.trim(), actual: act.value.trim(), details: det.value.trim(), tech: techInfo(meta?.version) });
    if (!saveNotes(list)) { toast('تعذر الحفظ على هذا الهاتف (التخزين غير متاح)'); return; }
    exp.value = act.value = det.value = ''; toast('حُفظت الملاحظة على هذا الهاتف'); render();
  };
  main.append(h('div', { class: 'notice info' }, 'تُحفظ الملاحظات على هذا الهاتف فقط ولا تُرسل تلقائيًا. عند الانتهاء استخدم «مشاركة» أو «نسخ كنص» لإرسالها. تُرفق معلومات تقنية غير حساسة (نوع المتصفح والشاشة ودعم الكاميرا) دون اسم المستخدم أو بيانات المنتجات.'),
    h('form', { class: 'card', onsubmit: submit, id: 'feedback-form' }, field('الوظيفة المختبرة', feat), field('النتيجة', res), field('النتيجة المتوقعة', exp), field('النتيجة الفعلية', act), field('وصف الخطأ', det),
      h('button', { class: 'btn', type: 'submit', style: 'width:100%' }, 'حفظ الملاحظة')),
    h('div', { class: 'card' }, h('strong', {}, 'قائمة اختبار Samsung'), h('p', { class: 'tiny muted' }, 'بنود قصيرة للكاميرا والمعرض ورفع الصور.'), h('a', { class: 'btn sm', href: '#/checklist' }, 'فتح القائمة')),
    h('div', { class: 'card' }, h('strong', {}, 'اختبار الكاميرا والقارئ'), h('p', { class: 'tiny muted' }, 'صفحة تشخيص مستقلة للكاميرا الخلفية وBarcodeDetector وقارئ HID.'), h('a', { class: 'btn sm out', href: '/device-test.html' }, 'فتح صفحة اختبار الجهاز')),
    listBox);
  render();
}

/* ---------- Samsung acceptance checklist (CP04). Each answer is also saved as a feedback note, so one "share" sends everything. ---------- */
const CK_KEY = 'mh_checklist_v1';
export const CHECKLIST = [
  ['login', 'تسجيل الدخول', 'افتح الرابط في Chrome أو Samsung Internet وسجّل الدخول. يظهر شريط «نسخة تجريبية».'],
  ['device', 'صفحة اختبار الجهاز', 'من شاشة الدخول: «اختبار الكاميرا وقارئ الباركود» ← تشغيل الكاميرا ← وجّهها إلى باركود عبوة.'],
  ['scan', 'مسح باركود داخل التطبيق', '«مسح» ← فتح الكاميرا ← باركود عبوة حقيقية ← تظهر النتيجة المحلية أو العالمية.'],
  ['create', 'إضافة منتج تجريبي وحفظه', '«المنتجات» ← «＋ جديد» ← اسم تجريبي ← «حفظ البطاقة». جرّب الحفظ بلا اسم: تظهر رسالة تحت الحقل.'],
  ['camera', 'تصوير العبوة بالكاميرا الخلفية', 'في المنتج: «📷 تصوير العبوة» ← تفتح الكاميرا الخلفية ← التقط.'],
  ['preview', 'المعاينة: الاتجاه والوضوح', 'في المعاينة: الصورة غير مقلوبة وواضحة، ويظهر حجمها بعد الضغط.'],
  ['retake', 'إعادة الالتقاط', 'في المعاينة: «إعادة الالتقاط» تفتح الكاميرا مجددًا.'],
  ['gallery', 'الاختيار من المعرض', '«🖼 من المعرض» ← صورة قديمة كبيرة ← معاينة ← حفظ.'],
  ['readable', 'وضوح المكونات بعد الحفظ', 'صوّر جهة المكونات (نوع: المكونات) ← احفظ ← اضغط الصورة لفتحها كاملة ← هل النص مقروء؟'],
  ['primary', 'الصورة الرئيسية في القوائم', 'تظهر الصورة في «المنتجات» ونتائج البحث والمستشار.'],
  ['manage', 'تغيير الرئيسية والحذف', '«اجعلها رئيسية» ثم «حذف» لصورة أخرى. تتحدث الصورة في القائمة.'],
  ['denied', 'رفض إذن الكاميرا', 'ارفض الإذن مرة (أو من إعدادات الموقع): تظهر رسالة واضحة ويبقى الإدخال اليدوي متاحًا.'],
  ['speed', 'سرعة الرفع على بيانات الجوال', 'أوقف Wi-Fi وارفع صورة. اكتب كم ثانية استغرقت تقريبًا.'],
  ['hid', 'قارئ باركود خارجي (إن توفر)', 'في صفحة اختبار الجهاز: اضغط الحقل وامسح 3 باركودات.'],
  ['identify', 'التعرف وجلب المعلومات (منتج جديد)', '«＋ جديد» ← «▥ مسح» لباركود عبوة عالمية ← «التعرف وجلب المعلومات» ← هل ظهرت مسودات مع مصدرها؟ استخدم الاسم في النموذج ثم احفظ.'],
  ['namesearch', 'البحث بالاسم', 'منتج جديد بلا باركود: اكتب الاسم والعلامة ← «التعرف وجلب المعلومات» ← هل تظهر مرشحات بأسباب المطابقة والاختلاف (خاصة الحجم)؟'],
  ['complete', 'استكمال منتج موجود', 'افتح منتجًا ناقصًا ← «استكمال معلومات المنتج من الإنترنت» ← لا يُنشأ منتج جديد، وتظهر الاقتراحات في البطاقة نفسها.'],
  ['import', 'الاستيراد من Excel/CSV (المدير)', '«المزيد ← الاستيراد» ← ملف تجريبي بلا صور ← المعاينة تعرض الجديد والموجود والناقص ← اعتماد.'],
];
const loadCk = () => { try { return JSON.parse(localStorage.getItem(CK_KEY) || '{}'); } catch { return {}; } };
const saveCk = (v) => { try { localStorage.setItem(CK_KEY, JSON.stringify(v)); return true; } catch { return false; } };

export function checklist(main, meta) {
  const box = h('div', {}); const head = h('div', {});
  const draw = () => {
    const st = loadCk(); const done = CHECKLIST.filter(([k]) => st[k]).length;
    fill(head, h('div', { class: 'card' }, h('div', { class: 'row sb' }, h('strong', {}, 'قائمة اختبار Samsung'), h('span', { class: 'badge ' + (done === CHECKLIST.length ? 'ok' : 'info') }, `${done} / ${CHECKLIST.length}`)),
      h('p', { class: 'tiny muted' }, 'جرّب كل بند على هاتفك ثم اختر النتيجة. كل إجابة تُحفظ أيضًا في «ملاحظات التجربة» على هذا الهاتف. عند الانتهاء اضغط «إرسال النتائج».'),
      h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: () => { location.hash = '#/feedback'; } }, 'إرسال النتائج (ملاحظات التجربة)'),
        done ? h('button', { class: 'btn sm light', onclick: () => { if (confirm('مسح إجابات القائمة؟ (الملاحظات المحفوظة تبقى)')) { saveCk({}); draw(); } } }, 'بدء من جديد') : null)));
    fill(box, CHECKLIST.map(([k, title, how], i) => {
      const cur = st[k]; const note = h('input', { placeholder: 'ملاحظة قصيرة (اختياري)', maxlength: 300, value: cur?.note ?? '' });
      const answer = (res) => {
        const list = loadNotes();
        list.push({ at: new Date().toISOString(), feature: `قائمة Samsung · ${title}`, result: res, expected: how, actual: note.value.trim() || RL[res], details: '', tech: techInfo(meta?.version) });
        saveNotes(list); const s2 = loadCk(); s2[k] = { result: res, note: note.value.trim(), at: new Date().toISOString() }; saveCk(s2); toast('حُفظت النتيجة'); draw();
      };
      return h('div', { class: 'card ck' + (cur ? ' answered' : ''), 'data-item': k },
        h('div', { class: 'row sb' }, h('strong', {}, `${i + 1}. ${title}`), cur ? h('span', { class: 'badge ' + (cur.result === 'ok' ? 'ok' : cur.result === 'fail' ? 'no' : 'warn') }, RL[cur.result]) : h('span', { class: 'badge' }, 'لم يُختبر')),
        h('p', { class: 'tiny' }, how), note,
        h('div', { class: 'row', style: 'margin-top:6px' }, h('button', { class: 'btn sm', onclick: () => answer('ok') }, '✓ نجح'), h('button', { class: 'btn sm out', onclick: () => answer('partial') }, '◐ جزئيًا'), h('button', { class: 'btn sm danger', onclick: () => answer('fail') }, '✗ فشل')));
    }));
  };
  main.append(head, box); draw();
}
