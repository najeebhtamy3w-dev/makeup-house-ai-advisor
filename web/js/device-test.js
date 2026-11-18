// Standalone device diagnostic. Collects ONLY what the person does on this page; nothing is sent anywhere.
const $ = (id) => document.getElementById(id);
const R = { when: new Date().toISOString(), ua: navigator.userAgent, secure_context: window.isSecureContext, protocol: location.protocol, screen: [screen.width, screen.height, devicePixelRatio],
  mediaDevices: !!navigator.mediaDevices?.getUserMedia, barcodeDetector: 'BarcodeDetector' in window, formats: null, camera: { permission: null, started: false, reads: [], duplicates_suppressed: 0, error: null }, hid: { scans: [], notes: [] }, rtl: document.documentElement.dir };
$('env').innerHTML = `<b>البيئة</b><div class="tiny">HTTPS/آمن: ${R.secure_context ? 'نعم' : '<b style="color:#b3261e">لا — لن تعمل الكاميرا</b>'}<br>getUserMedia: ${R.mediaDevices}<br>BarcodeDetector: ${R.barcodeDetector}<br>المتصفح: ${R.ua}</div>`;
if (R.barcodeDetector && BarcodeDetector.getSupportedFormats) BarcodeDetector.getSupportedFormats().then((f) => (R.formats = f)).catch(() => {});
let stream, timer, last = '', lastAt = 0; const v = $('v');
$('cam-start').onclick = async () => {
  const out = $('cam-out'); out.textContent = 'جارٍ طلب الإذن…';
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }); R.camera.permission = 'granted'; R.camera.started = true;
    v.srcObject = stream; v.style.display = 'block'; await v.play(); $('cam-stop').disabled = false; out.textContent = 'الكاميرا تعمل. وجّهها إلى باركود.';
    if (!R.barcodeDetector) { out.textContent += ' (المتصفح لا يدعم BarcodeDetector — لن تُقرأ الباركودات هنا)'; return; }
    const det = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
    timer = setInterval(async () => { try { const c = await det.detect(v); if (!c.length) return; const code = c[0].rawValue, t = Date.now();
      if (code === last && t - lastAt < 3000) { R.camera.duplicates_suppressed++; return; } last = code; lastAt = t; R.camera.reads.push({ code, format: c[0].format, at: new Date().toISOString() }); out.textContent = `قُرئ: ${code} (${R.camera.reads.length})`; navigator.vibrate?.(30); } catch (e) { R.camera.error = String(e); } }, 250);
  } catch (e) { R.camera.permission = e.name === 'NotAllowedError' ? 'denied' : 'error'; R.camera.error = e.name + ': ' + e.message; out.textContent = 'تعذر تشغيل الكاميرا: ' + e.name; }
};
$('cam-stop').onclick = () => { clearInterval(timer); stream?.getTracks().forEach((t) => t.stop()); v.style.display = 'none'; $('cam-stop').disabled = true; R.camera.stopped_cleanly = !stream?.getTracks().some((t) => t.readyState === 'live'); $('cam-out').textContent = 'تم إيقاف الكاميرا.'; };
// HID: a keyboard-wedge scanner types digits very fast then sends Enter.
let buf = '', first = 0;
$('hid').addEventListener('keydown', (e) => { const t = performance.now();
  if (e.key === 'Enter') { e.preventDefault(); if (buf) { const ms = Math.round(t - first); R.hid.scans.push({ code: buf, digits: buf.length, typing_ms: ms, chars_per_sec: ms ? Math.round(buf.length / (ms / 1000)) : null, enter_received: true }); $('hid-out').textContent = `آخر مسح: ${buf} — ${ms}ms — إجمالي ${R.hid.scans.length}`; } buf = ''; $('hid').value = ''; return; }
  if (e.key.length === 1) { if (!buf) first = t; buf += e.key; } });
$('rep').onclick = () => { R.hid.notes = [R.hid.scans.length ? 'تم استقبال Enter' : 'لم تُسجَّل أي عملية مسح'];
  const dup = R.hid.scans.some((s, i) => i && s.code === R.hid.scans[i - 1].code); R.hid.consecutive_duplicate_seen = dup; $('rep-out').value = JSON.stringify(R, null, 2); };
$('copy').onclick = async () => { try { await navigator.clipboard.writeText($('rep-out').value); $('copy').textContent = 'تم النسخ'; } catch { $('rep-out').select(); } };
