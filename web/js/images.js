// CP04 product images (client side): authenticated display, camera / gallery capture with preview + retake,
// orientation-correct resize & compression in the browser, and a small manager for the product's images.
import { getToken } from './api.js';
import { h, fill, toast, select, haptic } from './util.js';

export const KIND_LABEL = { front: 'الواجهة', package: 'العبوة', ingredients: 'المكونات', other: 'أخرى' };
const ORIGIN_LABEL = { camera: 'تصوير المحل', upload: 'من المعرض', source: 'مصدر عالمي' };
const ACCEPT = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_INPUT_BYTES = 25 * 1024 * 1024;   // raw phone photo before compression
const MAX_SIDE = 1600;                       // enough to read an ingredient list, small enough for a phone upload
const SERVER_MAX = 2 * 1024 * 1024;

/* ---------- display (bytes are behind login, so <img src> cannot fetch them directly) ---------- */
const urlCache = new Map();
async function objectUrl(path) {
  if (urlCache.has(path)) return urlCache.get(path);
  const p = fetch(path, { headers: { authorization: 'Bearer ' + getToken() } }).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.blob(); }).then((b) => URL.createObjectURL(b));
  urlCache.set(path, p); p.catch(() => urlCache.delete(path));
  return p;
}
export const forgetImage = (id) => urlCache.delete('/api/images/' + id);
export function authImg(path, alt, cls = '') {
  const img = h('img', { alt, class: cls + ' loading', decoding: 'async' });
  objectUrl(path).then((u) => { img.src = u; img.classList.remove('loading'); }).catch(() => { img.classList.remove('loading'); img.classList.add('broken'); img.alt = 'تعذر تحميل الصورة'; });
  return img;
}
/** Thumbnail for cards / search / advisor: the product photo, or its initial when there is none. */
export function thumb(p, size = 'md') {
  return h('div', { class: 'th ' + size, 'aria-hidden': p.primary_image_id ? null : 'true' },
    p.primary_image_id ? authImg('/api/images/' + p.primary_image_id, 'صورة ' + (p.name || 'المنتج')) : (p.name || '؟').trim()[0]);
}

/* ---------- capture + processing ---------- */
/** Validates, fixes orientation (EXIF), downsizes and re-encodes. Re-encoding also strips EXIF metadata such as GPS location. */
export async function processImage(file) {
  if (!file) throw new Error('لم يتم اختيار صورة');
  if (!ACCEPT.includes(file.type)) throw new Error('نوع الملف غير مدعوم. اختر صورة JPEG أو PNG أو WebP.');
  if (file.size > MAX_INPUT_BYTES) throw new Error('الصورة كبيرة جدًا (أكثر من 25 ميغابايت).');
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { bmp = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('تعذر قراءة الصورة. قد يكون الملف تالفًا.')); i.src = URL.createObjectURL(file); }); }
  const w0 = bmp.width, h0 = bmp.height; if (!w0 || !h0) throw new Error('أبعاد الصورة غير صالحة.');
  const k = Math.min(1, MAX_SIDE / Math.max(w0, h0)); const w = Math.round(w0 * k), hh = Math.round(h0 * k);
  const cv = document.createElement('canvas'); cv.width = w; cv.height = hh;
  const ctx = cv.getContext('2d'); ctx.imageSmoothingQuality = 'high';
  if (file.type !== 'image/png') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, hh); }
  ctx.drawImage(bmp, 0, 0, w, hh); bmp.close?.();
  const enc = (type, q) => new Promise((res) => cv.toBlob(res, type, q));
  let blob = await enc('image/webp', 0.86);
  if (!blob || blob.type !== 'image/webp') blob = await enc('image/jpeg', 0.88);
  for (const q of [0.78, 0.68]) { if (blob && blob.size <= SERVER_MAX) break; blob = await enc(blob?.type === 'image/webp' ? 'image/webp' : 'image/jpeg', q); }
  if (!blob) throw new Error('تعذر ضغط الصورة على هذا الجهاز.');
  if (blob.size > SERVER_MAX) throw new Error('الصورة ما زالت كبيرة بعد الضغط. جرّب صورة أخرى.');
  return { blob, width: w, height: hh, original: { width: w0, height: h0, bytes: file.size } };
}

const fileInput = (capture) => h('input', { type: 'file', accept: capture ? 'image/*' : ACCEPT.join(','), capture: capture ? 'environment' : null, class: 'hide', 'aria-hidden': 'true' });

/** Bottom sheet: preview, kind, save / retake / cancel. Resolves with { blob, kind, origin } or null. */
function previewSheet(processed, origin, retake) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(processed.blob);
    const kind = select(Object.entries(KIND_LABEL), 'front', { 'aria-label': 'نوع الصورة' });
    const close = (v) => { URL.revokeObjectURL(url); sheet.remove(); resolve(v); };
    const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-label': 'معاينة الصورة' }, h('div', { class: 'imgprev' },
      h('h3', { class: 't' }, 'معاينة قبل الحفظ'),
      h('img', { src: url, alt: 'معاينة الصورة' }),
      h('div', { class: 'tiny muted' }, `${processed.width}×${processed.height} · ${Math.round(processed.blob.size / 1024)} ك.ب (الأصل ${processed.original.width}×${processed.original.height} · ${Math.round(processed.original.bytes / 1024)} ك.ب)`),
      h('div', { class: 'field' }, h('label', {}, 'ماذا تُظهر الصورة؟'), kind),
      h('div', { class: 'notice info' }, 'تأكد أن الصورة واضحة وتخص هذا المنتج نفسه (نفس الحجم والإصدار).'),
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => close({ blob: processed.blob, kind: kind.value, origin }) }, 'حفظ الصورة'),
        h('button', { class: 'btn out', onclick: () => { close(null); retake(); } }, origin === 'camera' ? 'إعادة الالتقاط' : 'اختيار صورة أخرى'),
        h('button', { class: 'btn light', onclick: () => close(null) }, 'إلغاء'))));
    document.body.append(sheet);
  });
}

/** Opens camera or gallery, processes, previews. onPicked({ blob, kind, origin }) is called on "save". */
export function pickImage(origin, onPicked) {
  const inp = fileInput(origin === 'camera'); document.body.append(inp);
  inp.addEventListener('change', async () => {
    const file = inp.files?.[0]; inp.remove(); if (!file) return;
    try { const pr = await processImage(file); const res = await previewSheet(pr, origin, () => pickImage(origin, onPicked)); if (res) await onPicked(res); }
    catch (e) { toast(e.message); }
  }, { once: true });
  inp.click();
}

export async function uploadImage(productId, { blob, kind, origin }, primary = false) {
  const res = await fetch(`/api/products/${productId}/images?kind=${encodeURIComponent(kind)}&origin=${origin}${primary ? '&primary=1' : ''}`, { method: 'POST', headers: { authorization: 'Bearer ' + getToken(), 'content-type': blob.type }, body: blob })
    .catch(() => { throw new Error('تعذر رفع الصورة. تحقق من الاتصال وأعد المحاولة.'); });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? 'تعذر حفظ الصورة');
  return data;
}

function viewImage(img) {
  const sheet = h('div', { class: 'sheet viewer', role: 'dialog', 'aria-label': 'عرض الصورة', onclick: (e) => { if (e.target === sheet) sheet.remove(); } },
    h('div', {}, authImg('/api/images/' + img.id, 'الصورة بالحجم الكامل'), h('div', { class: 'tiny muted' }, `${KIND_LABEL[img.kind]} · ${img.width ?? '?'}×${img.height ?? '?'} · ${Math.round(img.size / 1024)} ك.ب`),
      h('button', { class: 'btn out', onclick: () => sheet.remove() }, 'إغلاق')));
  document.body.append(sheet);
}

/* ---------- product image manager ---------- */
/**
 * productId null => "staged" mode for a new product: picked images are kept in memory and uploaded by `flush(id)` after the
 * product is created. Returns { el, flush, count }.
 */
export function imageManager(productId, me, api) {
  const staged = [];
  const grid = h('div', { class: 'imggrid' });
  const info = h('div', { class: 'tiny muted' });
  let images = [];
  const canModify = (img) => me.role === 'manager' || img.created_by === me.id;
  const reload = async () => {
    if (!productId) { drawStaged(); return; }
    try { images = (await api('GET', `/api/products/${productId}/images`)).images; draw(); }
    catch (e) { fill(grid, h('div', { class: 'notice err' }, e.message)); }
  };
  const draw = () => {
    fill(grid, images.length ? images.map((img) => h('figure', { class: 'imgitem' + (img.is_primary ? ' primary' : '') },
      h('button', { class: 'imgopen', type: 'button', 'aria-label': 'فتح الصورة بالحجم الكامل', onclick: () => viewImage(img) }, authImg('/api/images/' + img.id, KIND_LABEL[img.kind] + ' — ' + ORIGIN_LABEL[img.origin])),
      h('figcaption', {},
        h('div', { class: 'row' }, img.is_primary ? h('span', { class: 'badge ok' }, 'رئيسية') : null, h('span', { class: 'badge' }, KIND_LABEL[img.kind]), h('span', { class: 'badge ' + (img.origin === 'source' ? 'warn' : 'info') }, ORIGIN_LABEL[img.origin])),
        img.origin === 'source' ? h('div', { class: 'tiny' }, '© ', img.attribution, ' · ', img.license, ' · ', h('a', { href: img.source_url, target: '_blank', rel: 'noopener noreferrer' }, img.source_name || 'المصدر')) : null,
        img.identity_note ? h('div', { class: 'tiny muted' }, img.identity_note) : null,
        canModify(img) ? h('div', { class: 'row' },
          !img.is_primary ? h('button', { class: 'btn sm light', onclick: () => act(() => api('PATCH', `/api/images/${img.id}`, { primary: true }), 'أصبحت الصورة الرئيسية') }, 'اجعلها رئيسية') : null,
          h('button', { class: 'btn sm danger', onclick: () => { if (confirm('حذف هذه الصورة؟')) act(() => api('DELETE', `/api/images/${img.id}`).then(() => forgetImage(img.id)), 'تم حذف الصورة'); } }, 'حذف')) : null)))
      : h('div', { class: 'imgempty' }, h('b', {}, '🖼'), h('div', {}, 'لا توجد صورة للمنتج بعد'), h('div', { class: 'tiny' }, 'صوّر العبوة أو اختر صورة من المعرض.')));
    info.textContent = images.length ? `${images.length} صورة` : '';
  };
  const drawStaged = () => {
    fill(grid, staged.length ? staged.map((s, i) => { const u = URL.createObjectURL(s.blob); return h('figure', { class: 'imgitem' + (i === 0 ? ' primary' : '') }, h('img', { src: u, alt: 'صورة مختارة', onload: () => URL.revokeObjectURL(u) }),
      h('figcaption', {}, h('div', { class: 'row' }, i === 0 ? h('span', { class: 'badge ok' }, 'رئيسية') : null, h('span', { class: 'badge' }, KIND_LABEL[s.kind]), h('span', { class: 'badge info' }, 'تُرفع بعد الحفظ')),
        h('button', { class: 'btn sm danger', onclick: () => { staged.splice(i, 1); drawStaged(); } }, 'إزالة'))); })
      : h('div', { class: 'imgempty' }, h('b', {}, '🖼'), h('div', {}, 'لا توجد صورة بعد'), h('div', { class: 'tiny' }, 'يمكنك إضافة صورة الآن، وستُحفظ مع البطاقة.')));
  };
  const act = async (fn, okMsg) => { try { await fn(); toast(okMsg); reload(); } catch (e) { toast(e.message); } };
  const onPicked = async (res) => {
    if (!productId) { staged.push(res); drawStaged(); haptic(); return; }
    try { await uploadImage(productId, res); haptic(); toast('حُفظت الصورة'); reload(); } catch (e) { toast(e.message); }
  };
  const el = h('div', { class: 'imgmgr' }, grid,
    h('div', { class: 'row' }, h('button', { class: 'btn sm', type: 'button', onclick: () => pickImage('camera', onPicked) }, '📷 تصوير العبوة'), h('button', { class: 'btn sm out', type: 'button', onclick: () => pickImage('upload', onPicked) }, '🖼 من المعرض'), info),
    h('div', { class: 'tiny muted' }, 'JPEG أو PNG أو WebP. تُصحَّح الوضعية وتُصغَّر الصورة تلقائيًا قبل الرفع، وتُزال بيانات الموقع منها.'));
  reload();
  return {
    el, count: () => (productId ? images.length : staged.length),
    async flush(id) { const failed = []; for (const [i, s] of staged.entries()) { try { await uploadImage(id, s, i === 0); } catch (e) { failed.push(e.message); } } staged.length = 0; return failed; },
  };
}
