// CP06.2 Phase 1 — one guard for every way out of a screen with unsaved edits: the header back button, "إلغاء", the bottom
// bar, the browser's Back/Forward, links, and reload/close. The router (app.js) asks `confirmLeave()` before rendering a new
// route; the product form registers itself with `setLeaveGuard()`.
import { h } from './util.js';

let guard = null; // { isDirty(): boolean, save(): Promise<boolean>, discard?(): void, pending?(): Promise | null }
export const setLeaveGuard = (g) => { guard = g; };
export const clearLeaveGuard = () => { guard = null; };
export const hasUnsavedChanges = () => !!guard?.isDirty();

// reload / close tab / leaving the site: the browser shows its own generic prompt (custom text is not allowed there)
window.addEventListener('beforeunload', (e) => { if (hasUnsavedChanges()) { e.preventDefault(); e.returnValue = ''; } });

let open = null;
/** Three explicit choices. Resolves 'save' | 'discard' | 'stay'. Esc / tapping outside = stay (never loses work). */
export function askLeave() {
  if (open) return open;
  open = new Promise((resolve) => {
    const done = (v) => { sheet.remove(); document.removeEventListener('keydown', onKey); open = null; resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') done('stay'); };
    const sheet = h('div', { class: 'sheet', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'leave-t', id: 'leave-dialog', onclick: (e) => { if (e.target === sheet) done('stay'); } },
      h('div', {},
        h('h3', { class: 't', id: 'leave-t' }, 'توجد تعديلات غير محفوظة'),
        h('p', { class: 'tiny muted' }, 'اختر ما تريد فعله بالتعديلات قبل مغادرة هذه الشاشة.'),
        h('div', { class: 'leave-actions' },
          h('button', { class: 'btn primary', type: 'button', id: 'leave-save', onclick: () => done('save') }, 'حفظ والخروج'),
          h('button', { class: 'btn danger', type: 'button', id: 'leave-discard', onclick: () => done('discard') }, 'الخروج دون حفظ'),
          h('button', { class: 'btn out', type: 'button', id: 'leave-stay', onclick: () => done('stay') }, 'متابعة التعديل'))));
    document.addEventListener('keydown', onKey);
    document.body.append(sheet);
    sheet.querySelector('#leave-stay').focus();
  });
  return open;
}

/** True when it is OK to leave now (nothing unsaved, or the person chose save-then-leave and the save succeeded, or discard). */
export async function confirmLeave() {
  // a save already on its way (tap "save" then "back"): wait for it — if it succeeds there is nothing left to ask about
  const p = guard?.pending?.(); if (p) { try { await p; } catch { /* the form shows the error */ } }
  if (!hasUnsavedChanges()) { clearLeaveGuard(); return true; }
  const choice = await askLeave();
  if (choice === 'stay') return false;
  if (choice === 'save') { const ok = await guard.save(); if (!ok) return false; }
  else guard.discard?.();
  clearLeaveGuard();
  return true;
}
