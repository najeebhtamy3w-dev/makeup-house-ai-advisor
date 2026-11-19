import { api } from './api.js';
import { h, fill, toast, busy, skeleton, errorBox, emptyState, FIELD_LABEL, ENRICH_LABEL } from './util.js';
import { go } from './views-core.js';
import { authImg, thumb } from './images.js';

/* ---------- manager review of global-source drafts (spec 9.5) ---------- */
export async function review(root) {
  const queueBox = h('div', {}); const list = h('div', {});
  root.append(h('h2', { class: 't' }, 'مراجعة معلومات المنتجات'), queueBox, list);
  const load = async () => {
    fill(list, skeleton(2));
    try {
      const [{ items }, st] = await Promise.all([api('GET', '/api/enrichment/pending'), api('GET', '/api/enrichment/status')]);
      fill(queueBox, h('div', { class: 'card' }, h('div', { class: 'row sb' }, h('b', {}, 'البحث العالمي: ', st.mode === 'off' ? 'غير مفعّل' : st.mode === 'mock' ? 'تجريبي (MOCK)' : 'Open Beauty Facts'), h('span', { class: 'badge info' }, `طابور: ${st.queue.queued} · تم: ${st.queue.done} · فشل: ${st.queue.failed}`)),
        st.mode === 'off' ? h('div', { class: 'notice' }, 'فعّل MH_ENRICH على الخادم (mock للتجربة أو obf) لتشغيل الإثراء.') : null,
        st.mode === 'mock' ? h('div', { class: 'notice' }, 'وضع تجريبي: البيانات وهمية للاختبار ولا يُكتب لها رابط مصدر.') : null,
        st.mode !== 'off' ? h('div', { class: 'row', style: 'margin-top:8px' },
          h('button', { class: 'btn sm light', onclick: async (e) => busy(e.currentTarget, async () => { try { const r = await api('POST', '/api/enrichment/queue/start'); toast(`أُضيف ${r.queued} باركود للطابور`); load(); } catch (x) { toast(x.message); } }) }, 'إضافة منتجات ناقصة للطابور'),
          h('button', { class: 'btn sm out', onclick: async (e) => busy(e.currentTarget, async () => { try { const r = await api('POST', '/api/enrichment/queue/run'); toast(`عولج ${r.processed} (${r.stopped === 'rate_limited' ? 'بلغنا حد المعدل' : 'تم'})`); load(); } catch (x) { toast(x.message); } }) }, 'تشغيل دفعة الآن')) : null));
      if (!items.length) { fill(list, emptyState('✓', 'لا توجد معلومات معلقة', 'ستظهر هنا اقتراحات المصادر العالمية لمراجعتها.')); return; }
      fill(list, items.map(group));
    } catch (e) { fill(list, errorBox(e.message, load)); }
  };
  const decide = async (c, action, value, btn) => busy(btn, async () => {
    try { await api('POST', `/api/enrichment/candidates/${c.id}/review`, { action, ...(value !== undefined ? { value } : {}) }); toast(action === 'approve' ? 'تم الاعتماد (يبقى «جزئي» حتى اعتماد المدير النهائي بمصدر)' : 'تم الرفض'); load(); }
    catch (e) { toast(e.message); }
  });
  const cand = (g, c) => {
    const lv = g.local_product?.[c.field];
    const edit = h('input', { value: c.value, class: 'hide', 'aria-label': 'تعديل القيمة' });
    const ok = h('button', { class: 'btn sm', onclick: (e) => decide(c, 'approve', edit.classList.contains('hide') ? undefined : edit.value, e.currentTarget) }, 'اعتماد');
    return h('div', { class: 'cand' + (c.conflict_note ? ' conf' : '') },
      h('div', { class: 'row sb' }, h('b', {}, FIELD_LABEL[c.field]), h('span', { class: 'badge ' + (c.conflict_note ? 'warn' : 'info') }, c.conflict_note ? ENRICH_LABEL.conflict : 'مسودة غير معتمدة')),
      c.field === 'image_url'
        ? h('div', { class: 'diff' }, h('div', {}, h('div', { class: 'tiny muted' }, 'صورة المحل الحالية'), g.local_product?.primary_image_id ? thumb(g.local_product, 'lg') : '—'),
          h('div', { class: 'new' }, h('div', { class: 'tiny muted' }, 'الصورة المقترحة'), authImg(`/api/enrichment/candidates/${c.id}/image`, 'الصورة المقترحة من المصدر', 'candimg')))
        : h('div', { class: 'diff' }, h('div', {}, h('div', { class: 'tiny muted' }, 'بيانات المحل'), lv || '—'), h('div', { class: 'new' }, h('div', { class: 'tiny muted' }, 'المقترح'), c.value)),
      c.field === 'image_url' ? h('div', { class: 'notice' }, 'قارن الصورة بالعبوة الموجودة في يدك: نفس العلامة والاسم والحجم والإصدار؟ إن اختلف أي منها فارفضها وصوّر العبوة بنفسك. الصورة مرخصة CC BY-SA 3.0 وتُحفظ مع اسم المصدر.') : null,
      h('div', { class: 'tiny muted' }, 'المصدر: ', c.source_url ? h('a', { href: c.source_url, target: '_blank', rel: 'noopener noreferrer' }, c.source_name) : c.source_name, ` · ${c.license || ''} · ${new Date(c.extracted_at).toLocaleDateString('ar-YE')}`, c.is_mock ? ' · ⚠ بيانات تجريبية' : ''),
      c.conflict_note ? h('div', { class: 'notice' }, c.conflict_note) : null, edit,
      c.field === 'image_url' ? h('div', { class: 'row', style: 'margin-top:6px' }, h('button', { class: 'btn sm', onclick: (e) => decide(c, 'approve', undefined, e.currentTarget) }, 'اعتماد الصورة'), h('button', { class: 'btn sm danger', onclick: (e) => decide(c, 'reject', undefined, e.currentTarget) }, 'رفض'))
      : h('div', { class: 'row', style: 'margin-top:6px' }, ok,
        h('button', { class: 'btn sm light', onclick: (e) => { edit.classList.toggle('hide'); e.currentTarget.textContent = edit.classList.contains('hide') ? 'تعديل' : 'إلغاء التعديل'; if (!edit.classList.contains('hide')) edit.focus(); } }, 'تعديل'),
        h('button', { class: 'btn sm danger', onclick: (e) => decide(c, 'reject', undefined, e.currentTarget) }, 'رفض')));
  };
  const group = (g) => h('div', { class: 'card' },
    h('div', { class: 'row sb' }, h('b', { dir: 'ltr' }, g.barcode), g.local_product ? h('span', { class: 'badge' }, g.local_product.name) : h('span', { class: 'badge warn' }, 'لا توجد بطاقة محلية')),
    !g.local_product ? h('div', { class: 'notice' }, 'أنشئ بطاقة المنتج أولًا ثم اعتمد المعلومات. ', h('button', { class: 'btn sm light', onclick: () => { const n = g.candidates.find((c) => c.field === 'name'); try { sessionStorage.setItem('mh_prefill', JSON.stringify({ barcode: g.barcode, name: n?.value ?? '' })); } catch { /* ignore */ } go('#/product-new' + (g.barcode ? '?barcode=' + g.barcode : '')); } }, 'إنشاء بطاقة')) : null,
    g.candidates.map((c) => cand(g, c)));
  load();
}
