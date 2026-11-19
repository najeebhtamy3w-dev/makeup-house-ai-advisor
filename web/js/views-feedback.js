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
    h('div', { class: 'card' }, h('strong', {}, 'اختبار الكاميرا والقارئ'), h('p', { class: 'tiny muted' }, 'صفحة تشخيص مستقلة للكاميرا الخلفية وBarcodeDetector وقارئ HID.'), h('a', { class: 'btn sm out', href: '/device-test.html' }, 'فتح صفحة اختبار الجهاز')),
    listBox);
  render();
}
