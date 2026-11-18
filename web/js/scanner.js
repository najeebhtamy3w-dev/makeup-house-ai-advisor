// Three input paths: camera (BarcodeDetector), USB/Bluetooth HID scanner (types digits + Enter into a focused input), manual.
// HID needs no code: the scanner behaves as a keyboard, so the barcode <input> + Enter handler covers it.
export const cameraSupported = () => !!(navigator.mediaDevices?.getUserMedia && 'BarcodeDetector' in window);
export async function startCamera(video, onCode) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('الكاميرا غير متاحة. افتح التطبيق عبر HTTPS.');
  if (!('BarcodeDetector' in window)) throw new Error('هذا المتصفح لا يدعم قراءة الباركود بالكاميرا. استخدم قارئًا خارجيًا أو الإدخال اليدوي (Chrome على أندرويد يدعمها).');
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
  video.srcObject = stream; await video.play().catch(() => {});
  const det = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
  let stopped = false, last = '', n = 0;
  const timer = setInterval(async () => {
    if (stopped || video.readyState < 2) return;
    try {
      const hits = await det.detect(video);
      const v = hits[0]?.rawValue;
      if (!v) { last = ''; n = 0; return; }
      // require two consecutive identical reads to avoid mis-reads
      if (v === last) n++; else { last = v; n = 1; }
      if (n >= 2) { stop(); onCode(v); }
    } catch { /* frame not ready */ }
  }, 250);
  function stop() { stopped = true; clearInterval(timer); stream.getTracks().forEach((t) => t.stop()); video.srcObject = null; }
  return stop;
}
