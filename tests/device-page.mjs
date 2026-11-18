// Browser test of web/device-test.html (NOT a device test): fake camera + simulated keyboard-wedge scanner.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
const base = process.argv[2] ?? 'http://localhost:8099';
const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const ctx = await b.newContext({ viewport: { width: 390, height: 800 }, permissions: ['camera'] }); const page = await ctx.newPage(); const errs = [];
page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await page.goto(base + '/device-test.html'); await page.waitForSelector('#env');
await page.click('#cam-start'); await page.waitForFunction(() => /الكاميرا تعمل|تعذر/.test(document.getElementById('cam-out').textContent));
const cam = await page.textContent('#cam-out'); assert.match(cam, /الكاميرا تعمل/);
await page.click('#cam-stop');
await page.focus('#hid'); for (const code of ['5901234123457', '5901234123457', '4006381333931']) { await page.keyboard.type(code, { delay: 5 }); await page.keyboard.press('Enter'); }
await page.click('#rep'); const rep = JSON.parse(await page.inputValue('#rep-out'));
assert.equal(rep.hid.scans.length, 3); assert.ok(rep.hid.scans.every((s) => s.enter_received && s.digits === 13)); assert.equal(rep.hid.consecutive_duplicate_seen, true);
assert.equal(rep.camera.started, true); assert.equal(rep.camera.stopped_cleanly, true); assert.equal(rep.secure_context, true);
assert.equal(rep.rtl, 'rtl'); assert.deepEqual(errs, []);
console.log('PASS device-test page: fake camera starts/stops, HID wedge captured 3 scans incl. duplicate; barcodeDetector in this browser =', rep.barcodeDetector);
await b.close();
