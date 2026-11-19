// CP06 backup & restore (Android local-first build). The backup is the WHOLE on-device database — products, images,
// sources, taxonomy, verification states and accounts — encrypted with a passphrase the person chooses.
// Restore is verified on a separate copy before anything is replaced (see mobile/src/worker.ts).
import { getToken, setToken } from './api.js';
import { h, fill, toast, field, busy, fmtDate } from './util.js';

const LAST = 'mh_last_backup';
const kb = (n) => (n > 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + ' م.ب' : Math.max(1, Math.round(n / 1024)) + ' ك.ب');
const authHeader = () => (getToken() ? { authorization: 'Bearer ' + getToken() } : {});
async function call(path, body, raw = false) {
  const res = await fetch(path, { method: 'POST', headers: { ...authHeader(), ...(raw ? {} : { 'content-type': 'application/json' }) }, body: raw ? body : JSON.stringify(body) });
  if (!res.ok) { let m = 'حدث خطأ'; try { m = (await res.json()).error ?? m; } catch { /* binary */ } throw new Error(m); }
  return res;
}
const pack = (opts, file) => { const j = new TextEncoder().encode(JSON.stringify(opts)); const out = new Uint8Array(4 + j.length + file.byteLength); new DataView(out.buffer).setUint32(0, j.length); out.set(j, 4); out.set(new Uint8Array(file), 4 + j.length); return out; };

function restoreSection(onDone) {
  const file = h('input', { type: 'file', accept: '.mhbak,application/octet-stream', id: 'restore-file' });
  const pass = h('input', { type: 'password', id: 'restore-pass', autocomplete: 'off' });
  const out = h('div', { 'aria-live': 'polite' });
  let verified = null;
  const read = async () => { const f = file.files?.[0]; if (!f) throw new Error('اختر ملف النسخة (.mhbak)'); return f.arrayBuffer(); };
  const verifyBtn = h('button', { class: 'btn out', type: 'button', onclick: (e) => busy(e.currentTarget, async () => {
    fill(out); verified = null;
    try {
      const r = await (await call('/api/local/restore', pack({ passphrase: pass.value, dry: true }, await read()), true)).json();
      verified = r.header;
      fill(out, h('div', { class: 'notice ok' }, `✓ النسخة سليمة ومطابقة لبصمتها. تاريخها: ${fmtDate(r.header.created_at)} · منتجات: ${r.header.counts.products} · صور: ${r.header.counts.images} · حسابات: ${r.header.counts.users}`),
        h('button', { class: 'btn danger', type: 'button', id: 'restore-go', onclick: (e2) => busy(e2.currentTarget, async () => {
          if (!confirm('ستُستبدل كل البيانات الحالية على هذا الهاتف بمحتوى النسخة. متابعة؟')) return;
          try { await call('/api/local/restore', pack({ passphrase: pass.value }, await read()), true); setToken(null); fill(out, h('div', { class: 'notice ok', id: 'restore-done' }, 'تمت الاستعادة. سجّل الدخول بحساب من النسخة.')); onDone?.(); }
          catch (x) { fill(out, h('div', { class: 'notice err' }, x.message)); }
        }) }, 'استعادة الآن (تستبدل البيانات الحالية)'));
    } catch (x) { fill(out, h('div', { class: 'notice err' }, x.message)); }
  }) }, 'التحقق من النسخة');
  return h('div', { class: 'card' }, h('h3', { class: 'fsec-t' }, 'استعادة نسخة احتياطية'),
    h('p', { class: 'tiny muted' }, 'يُتحقق من النسخة أولًا على نسخة منفصلة (كلمة المرور، البصمة، سلامة SQLite، الأعداد). لا يُستبدل شيء قبل نجاح التحقق، وعند أي فشل تبقى البيانات الحالية كما هي.'),
    field('ملف النسخة (.mhbak)', file), field('كلمة مرور النسخة', pass), verifyBtn, out);
}

export function restoreOnly(main) {
  main.append(h('div', { class: 'login' }, h('div', { class: 'logo' }, h('b', {}, '✦'), h('strong', {}, 'MAKEUP HOUSE'), h('div', { class: 'tiny muted' }, 'استعادة البيانات على هاتف جديد')),
    restoreSection(() => setTimeout(() => location.replace('/'), 900)), h('p', { class: 'tiny', style: 'text-align:center' }, h('a', { href: '#/' }, 'رجوع لإنشاء حساب جديد'))));
}

export async function backupView(main) {
  const info = h('div', {}, h('div', { class: 'tiny muted' }, 'جارٍ القراءة…'));
  const pass = h('input', { type: 'password', id: 'backup-pass', autocomplete: 'new-password' }), pass2 = h('input', { type: 'password', id: 'backup-pass2', autocomplete: 'new-password' });
  const out = h('div', { 'aria-live': 'polite' });
  let last = null; try { last = JSON.parse(localStorage.getItem(LAST) || 'null'); } catch { /* ignore */ }
  const make = h('button', { class: 'btn', type: 'button', id: 'backup-go', onclick: (e) => busy(e.currentTarget, async () => {
    fill(out);
    if (pass.value.length < 8) { fill(out, h('div', { class: 'notice err' }, 'كلمة مرور النسخة 8 أحرف على الأقل.')); return; }
    if (pass.value !== pass2.value) { fill(out, h('div', { class: 'notice err' }, 'كلمتا المرور غير متطابقتين.')); return; }
    try {
      const res = await call('/api/local/backup', { passphrase: pass.value });
      const blob = await res.blob(); const name = res.headers.get('x-mh-filename') || 'makeup-house.mhbak'; const counts = JSON.parse(res.headers.get('x-mh-counts') || '{}');
      const how = await window.MHNative.saveFile(name, blob);
      try { localStorage.setItem(LAST, JSON.stringify({ at: new Date().toISOString(), size: blob.size, name })); } catch { /* ignore */ }
      fill(out, h('div', { class: 'notice ok', id: 'backup-done' }, `✓ أُنشئت النسخة «${name}» (${kb(blob.size)} · منتجات ${counts.products} · صور ${counts.images}). ${how === 'shared' ? 'اختر مكان الحفظ من نافذة المشاركة (الملفات، Drive، USB).' : 'نُزّل الملف.'}`),
        h('div', { class: 'notice' }, 'احفظ كلمة مرور النسخة في مكان آمن منفصل عن الهاتف. بدونها لا يمكن استعادة النسخة، ولا يمكن لأحد استرجاعها.'));
    } catch (x) { fill(out, h('div', { class: 'notice err' }, x.message)); }
  }) }, 'إنشاء نسخة احتياطية مشفرة');
  main.append(h('h2', { class: 't' }, 'النسخ الاحتياطي والاستعادة'),
    h('div', { class: 'notice' }, 'البيانات محفوظة على هذا الهاتف فقط. حذف التطبيق أو «مسح بيانات التطبيق» أو فقدان الهاتف يحذفها. خذ نسخة احتياطية بانتظام واحفظها خارج الهاتف.'),
    h('div', { class: 'card' }, h('h3', { class: 'fsec-t' }, 'إنشاء نسخة'), info,
      last ? h('p', { class: 'tiny' }, `آخر نسخة من هذا الهاتف: ${fmtDate(last.at)} (${kb(last.size)})`) : h('p', { class: 'tiny', style: 'color:var(--warn)' }, 'لم تُنشأ نسخة احتياطية من هذا الهاتف بعد.'),
      field('كلمة مرور النسخة (8 أحرف على الأقل)', pass), field('تأكيد كلمة المرور', pass2), make, out),
    restoreSection(() => setTimeout(() => location.replace('/'), 1200)));
  try {
    const r = await (await fetch('/api/local/backup/info', { headers: authHeader() })).json();
    fill(info, h('p', { class: 'tiny' }, `المحتوى الحالي: منتجات ${r.counts.products} · صور ${r.counts.images} · حسابات ${r.counts.users} · الحجم ${kb(r.db_bytes)} · المخطط ${r.schema.length} ترحيلات`));
  } catch { fill(info); }
  void toast;
}
