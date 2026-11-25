// Main-thread bridge for the Android build. Loaded BEFORE the app: every same-origin request to /api/* is answered by the
// on-device worker (mobile/src/worker.ts) instead of a network server. Requests to other hosts (Open Beauty Facts) are
// untouched. The existing UI therefore runs unchanged against the local database.
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { App } from '@capacitor/app';
import { localAI } from './local-ai.ts';

declare global { interface Window { MH_onBack?: () => Promise<'handled' | 'exit'>; MH_LOCAL?: boolean; MH_READY?: Promise<void>; MHNative?: { saveFile(name: string, blob: Blob): Promise<string>; isNative: boolean; backup?: typeof backupStream; restore?: typeof restoreStream } } }

const worker = new Worker('/local/worker.js', { type: 'module' });
let seq = 0;
const streams = new Map<number, (m: any) => void>();
const waiting = new Map<number, (m: { status: number; headers: Record<string, string>; body: string | ArrayBuffer }) => void>();
window.MH_LOCAL = true;
window.MH_READY = new Promise<void>((resolve, reject) => {
  worker.addEventListener('message', (e) => {
    const m = e.data;
    if (m?.type === 'ready') { resolve(); return; }
    if (m?.type && streams.has(m.id)) { streams.get(m.id)!(m); return; }
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
  if (url.pathname === '/api/cp08/advisor/chat' && reply.status === 200 && typeof reply.body === 'string') {
    const result = await localAI.compose(JSON.parse(reply.body), (headers.get('authorization') ?? '').replace(/^Bearer /, ''), window.fetch);
    return new Response(JSON.stringify(result), { status: reply.status, headers: reply.headers });
  }
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
/* ---------- CP06.3 streaming backup / restore (bounded memory on both sides) ---------- */
const b64chunk = (u: Uint8Array) => { let bin = ''; for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(bin); };
const authHeaders = (token: string | null): Record<string, string> => ({ 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) });
async function jsonOrThrow(r: Response) { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error ?? 'حدث خطأ'); return j; }

/** Encrypted backup written chunk by chunk: on Android each ~1 MiB frame is APPENDED to the file in the app cache (never the
 *  whole backup in memory), then the share sheet opens; in a desktop browser the frames are collected and downloaded. */
async function backupStream(passphrase: string, token: string | null): Promise<{ how: string; size: number; name: string; counts: Record<string, number> }> {
  const { ticket, filename } = await jsonOrThrow(await window.fetch('/api/local/backup/stream', { method: 'POST', headers: authHeaders(token), body: JSON.stringify({ passphrase }) }));
  const native = Capacitor.isNativePlatform(); const parts: BlobPart[] = []; let size = 0; let uri = '';
  const id = ++seq;
  const counts = await new Promise<Record<string, number>>((resolve, reject) => {
    streams.set(id, async (m) => {
      try {
        if (m.type === 'backup-chunk') {
          const u = new Uint8Array(m.bytes); size += u.length;
          if (native) { if (m.seq === 0) uri = (await Filesystem.writeFile({ path: filename, data: b64chunk(u), directory: Directory.Cache })).uri; else await Filesystem.appendFile({ path: filename, data: b64chunk(u), directory: Directory.Cache }); }
          else parts.push(u);
          worker.postMessage({ type: 'ack', id, seq: m.seq });
        } else if (m.type === 'backup-done') { streams.delete(id); resolve(m.counts); }
        else if (m.type === 'stream-error') { streams.delete(id); reject(new Error(m.error)); }
      } catch (e) { streams.delete(id); reject(e); }
    });
    worker.postMessage({ type: 'backup-stream', id, ticket });
  });
  if (native) { await Share.share({ title: filename, text: 'نسخة احتياطية مشفرة — ميك أب هاوس', url: uri, dialogTitle: 'احفظ النسخة الاحتياطية (الملفات، Drive، USB…)' }); return { how: 'shared', size, name: filename, counts }; }
  await saveFile(filename, new Blob(parts, { type: 'application/octet-stream' }));
  return { how: 'download', size, name: filename, counts };
}

/** Restore from a File the person picked: the worker asks for byte ranges and gets one slice at a time (File.slice). */
async function restoreStream(file: File, passphrase: string, dry: boolean, token: string | null): Promise<any> {
  const { ticket } = await jsonOrThrow(await window.fetch('/api/local/restore/stream', { method: 'POST', headers: authHeaders(token), body: JSON.stringify({ passphrase, dry, size: file.size }) }));
  const id = ++seq;
  return new Promise((resolve, reject) => {
    streams.set(id, async (m) => {
      try {
        if (m.type === 'restore-need') { const buf = await file.slice(m.offset, m.offset + m.length).arrayBuffer(); worker.postMessage({ type: 'restore-data', id, n: m.n, bytes: buf }, [buf]); }
        else if (m.type === 'restore-done') { streams.delete(id); resolve(m.result); }
        else if (m.type === 'stream-error') { streams.delete(id); reject(new Error(m.error)); }
      } catch (e) { streams.delete(id); reject(e); }
    });
    worker.postMessage({ type: 'restore-stream', id, ticket });
  });
}
window.MHNative = { saveFile, isNative: Capacitor.isNativePlatform(), backup: backupStream, restore: restoreStream };

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
