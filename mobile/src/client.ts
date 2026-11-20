// Main-thread bridge for the Android build. Loaded BEFORE the app: every same-origin request to /api/* is answered by the
// on-device worker (mobile/src/worker.ts) instead of a network server. Requests to other hosts (Open Beauty Facts) are
// untouched. The existing UI therefore runs unchanged against the local database.
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { App } from '@capacitor/app';

declare global { interface Window { MH_onBack?: () => Promise<'handled' | 'exit'>; MH_LOCAL?: boolean; MH_READY?: Promise<void>; MHNative?: { saveFile(name: string, blob: Blob): Promise<string>; isNative: boolean } } }

const worker = new Worker('/local/worker.js', { type: 'module' });
let seq = 0;
const waiting = new Map<number, (m: { status: number; headers: Record<string, string>; body: string | ArrayBuffer }) => void>();
window.MH_LOCAL = true;
window.MH_READY = new Promise<void>((resolve, reject) => {
  worker.addEventListener('message', (e) => {
    const m = e.data;
    if (m?.type === 'ready') { resolve(); return; }
    if (m?.type === 'fatal') { reject(new Error(m.error)); document.body.innerHTML = '<p style="padding:20px;font:16px sans-serif" dir="rtl">تعذر فتح قاعدة البيانات المحلية على هذا الجهاز: ' + String(m.error).replace(/[<>&]/g, '') + '</p>'; return; }
    waiting.get(m.id)?.(m); waiting.delete(m.id);
  });
});
// keep the app's storage from being evicted under storage pressure where the platform allows it
navigator.storage?.persist?.().catch(() => { /* not supported */ });

const nativeFetch = window.fetch.bind(window);
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = input instanceof Request ? input : null;
  const url = new URL(req ? req.url : String(input), location.href);
  if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return nativeFetch(input as RequestInfo, init);
  const method = (init?.method ?? req?.method ?? 'GET').toUpperCase();
  const headers = new Headers(init?.headers ?? req?.headers);
  const src = init?.body ?? (req && method !== 'GET' ? await req.arrayBuffer() : null);
  const body = src == null ? null : await new Response(src as BodyInit).arrayBuffer();
  await window.MH_READY;
  const id = ++seq;
  const reply = await new Promise<{ status: number; headers: Record<string, string>; body: string | ArrayBuffer }>((resolve) => {
    waiting.set(id, resolve);
    worker.postMessage({ id, method, url: url.pathname + url.search, authorization: headers.get('authorization') ?? undefined, body }, body ? [body] : []);
  });
  return new Response(reply.body, { status: reply.status, headers: reply.headers });
}) as typeof fetch;

/** Save a file somewhere the person can find it: on Android, the share sheet (Files, Drive, WhatsApp, USB…) after
 *  writing it to the app cache; in a browser, a normal download. */
async function saveFile(name: string, blob: Blob): Promise<string> {
  if (!Capacitor.isNativePlatform()) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove();
    return 'download';
  }
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  const w = await Filesystem.writeFile({ path: name, data: btoa(bin), directory: Directory.Cache });
  await Share.share({ title: name, text: 'نسخة احتياطية مشفرة — ميك أب هاوس', url: w.uri, dialogTitle: 'احفظ النسخة الاحتياطية (الملفات، Drive، USB…)' });
  return 'shared';
}
window.MHNative = { saveFile, isNative: Capacitor.isNativePlatform() };

// CP06.3 — Android hardware Back. Capacitor 8 core has no Back handling, so without this listener Back closed the app and an
// unsaved product edit was lost without any question. Registering the listener replaces the default; the web app decides
// (window.MH_onBack in web/js/app.js): close a dialog, leave a screen through the unsaved-changes guard, or — on the home
// screen — minimise (not kill) the app.
if (Capacitor.isNativePlatform()) {
  App.addListener('backButton', async () => {
    try { const r = await window.MH_onBack?.(); if (r === 'exit' || r === undefined) await App.minimizeApp(); }
    catch { /* never crash on Back */ }
  });
  // coming back to the foreground: nothing is saved automatically; the product form keeps its own unsaved-edit draft
  App.addListener('pause', () => { document.dispatchEvent(new Event('mh:pause')); });
}
