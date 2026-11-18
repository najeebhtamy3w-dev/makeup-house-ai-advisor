// Three input paths: camera (BarcodeDetector), USB/Bluetooth HID scanner (keyboard wedge: digits + Enter into a focused input), manual.
export const cameraSupported = () => !!(navigator.mediaDevices?.getUserMedia && 'BarcodeDetector' in window);
export class ScanError extends Error { constructor(kind, msg) { super(msg); this.kind = kind; } }

/** Starts the camera. Rejects with ScanError(kind: insecure|unsupported|denied|nocamera|busy|other) so the UI can explain precisely. */
export async function startCamera(video, { onCode, onState }) {
  if (!window.isSecureContext) throw new ScanError('insecure', 'الكاميرا تتطلب HTTPS (أو localhost). افتح التطبيق عبر عنوان آمن.');
  if (!navigator.mediaDevices?.getUserMedia) throw new ScanError('unsupported', 'هذا المتصفح لا يتيح الكاميرا.');
  if (!('BarcodeDetector' in window)) throw new ScanError('unsupported', 'هذا المتصفح لا يدعم قراءة الباركود بالكاميرا. استخدم Chrome على أندرويد، أو قارئًا خارجيًا، أو الإدخال اليدوي.');
  onState?.('permission');
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }); }
  catch (e) {
    const n = e?.name;
    if (n === 'NotAllowedError' || n === 'SecurityError') throw new ScanError('denied', 'تم رفض إذن الكاميرا. فعّله من إعدادات الموقع في المتصفح ثم أعد المحاولة، أو أدخل الرقم يدويًا.');
    if (n === 'NotFoundError' || n === 'OverconstrainedError') throw new ScanError('nocamera', 'لا توجد كاميرا متاحة على هذا الجهاز.');
    if (n === 'NotReadableError') throw new ScanError('busy', 'الكاميرا مستخدمة من تطبيق آخر. أغلقه وأعد المحاولة.');
    throw new ScanError('other', 'تعذر تشغيل الكاميرا.');
  }
  video.srcObject = stream; await video.play().catch(() => {});
  const det = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
  let stopped = false, last = '', n = 0, lastAccepted = '', lastAt = 0;
  onState?.('scanning');
  const timer = setInterval(async () => {
    if (stopped || video.readyState < 2) return;
    try {
      const v = (await det.detect(video))[0]?.rawValue;
      if (!v) { last = ''; n = 0; return; }
      if (v === last) n++; else { last = v; n = 1; }
      if (n >= 2) { // two identical consecutive reads, and never the same code twice within 3s
        if (v === lastAccepted && Date.now() - lastAt < 3000) return;
        lastAccepted = v; lastAt = Date.now(); onState?.('success'); setTimeout(() => { stop(); onCode(v); }, 280);
        stopped = true;
      }
    } catch { /* frame not ready */ }
  }, 220);
  function stop() { stopped = true; clearInterval(timer); stream.getTracks().forEach((t) => t.stop()); video.srcObject = null; }
  return stop;
}
