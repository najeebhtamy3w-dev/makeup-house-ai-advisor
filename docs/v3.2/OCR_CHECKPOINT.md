# Offline OCR checkpoint — 2026-11-26

Status: IMPLEMENTED / Android compilation and physical-device recognition NOT TESTED.
This is OCR, **not VLM**, product identity approval, INCI verification, or scientific validation.

## Verified dependencies

- Official source: https://github.com/adaptech-cz/Tesseract4Android/tree/4.9.0
- Official README coordinate: `cz.adaptech.tesseract4android:tesseract4android:4.9.0` (standard, not OpenMP).
- Published artifact downloaded from JitPack: 12,848,454 bytes; SHA256 `bce5d6413a1a5ae3d7240033fbbc851ba3217d0a08d9769400e17a077f42cb2a`.
- Apache-2.0 license fetched from official source and hash-pinned in manifest. Dependencies Tesseract/Leptonica/png/jpeg retain upstream licenses; existing third-party notice distribution must retain their notices.
- `readelf -lW` on actual AAR's four ARM64 libraries (`libjpeg.so`, `libleptonica.so`, `libpngx.so`, `libtesseract.so`) showed **every LOAD alignment `0x4000`**. APK ZIP alignment still requires final artifact validation.
- Official tessdata_fast revision `87416418657359cb625c412a48b6e1d6d41c29bd`:
  - eng: 4,113,088 bytes; SHA256 `7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2`.
  - ara: 1,432,056 bytes; SHA256 `e3206d3dc87fd50c24a0fb9f01838615911d25168f4e64415244b67d2bb3e729`.
- Models' Apache-2.0 license downloaded/hash-pinned; bundled together with engine license.

## Component behavior

`ProductOCRPlugin` exposes authenticated `capabilities`, `recognize({token,image_base64})`, `cancel`. Staff/manager verified through the existing local auth worker for each call. Serial work, reject concurrent recognition, 2MiB compressed bytes, 8 million pixels, bitmap recycling, private `files/ocr/tessdata` copied from verified bundled models. Hash verification occurs before each initialization. No image network traffic, product writes, or saved image logs.

Tesseract `getUTF8Text()` alone is explicitly non-interruptible upstream. Implementation first invokes interruptible `getHOCRText(0)` then reads UTF-8 text; a scheduled 20-second deadline requests native `stop()`. This is a cooperative deadline, not a proven hard real-time bound. Initialization/decode/copy are outside this recognition deadline; device cancellation/timeout must be tested. SDK/native memory can exceed bitmap size; 8MP is a bound, not a measured peak RAM guarantee. Output is limited to 16,000 UTF-16 characters and 200 candidate text lines, whole-page mean confidence. Candidate lines lack per-line confidence/coordinates. They must not be called independently verified visual regions.

## Exact integration for owner agent

1. After Capacitor Android sync (which may clear generated assets), run `python scripts/prepare-ocr-assets.py`. It reuses verified cache, otherwise downloads pinned assets and verifies size/SHA256 before replacement. Existing assets and model files are untouched.
2. In app Gradle dependencies add `implementation files('libs/tesseract4android-4.9.0.aar')`. No new Maven repository required. Ensure local AAR generated before Gradle configuration/build.
3. MainActivity `registerPlugin(ProductOCRPlugin.class);` before/with existing plugin registration.
4. UI register Capacitor `ProductOCR`; pass bearer token and raw Base64 without data prefix. Display candidate text for review; `ocr:true, vision:false`. No automatic identity approval/product creation.
5. CI must prepare OCR assets after `cap sync android` and before Android build; final APK requires ARM64 ELF and ZIP16KiB alignment check. Generated AAR/model assets can remain build outputs, not Git blobs.

## Executed checks

PASS: all downloaded asset byte counts/SHA256, four ARM64 ELF LOAD alignments, Python script execution/reuse, corrupted asset rejection and Python compilation.

Real **Host** `/usr/bin/tesseract` with downloaded pinned eng+ara models, synthetic high-resolution images (Pillow rendering, not physical products):

| Input | Raw recognized text | Measured wall time |
|---|---|---:|
| `MAKEUP HOUSE` / `INGREDIENTS: AQUA GLYCERIN NIACINAMIDE` | exact same text, two lines | 509 ms |
| `مرطب البشرة الجافة` | `مرطب البشرة الجافة` | 246 ms |

No Android/emulator/Samsung OCR execution occurred. No recognition quality percentage inferred from these two examples. No physical-product label benchmark or Arabic/Latin mixture accuracy claim. Source needs CI Java/API compilation and physical-device tests including cancellation, authorization, resource recovery, small/blurred labels, mixed direction, rotated labels, incorrect ingredient text and corrupted assets.

## Follow-up independent review

Pinned upstream Java source confirms `OEM_LSTM_ONLY`, `init(String,String,int)`, `setImage(Bitmap)`, `getHOCRText(int)`, `getUTF8Text()`, `meanConfidence()`, `stop()` and `recycle()` APIs. Android SDK/JDK are not installed in this local executor (`javap: command not found`), so compilation remains a CI requirement.

Fixed native lifecycle races: cancellation requests no longer wait for native initialization on UI thread; deadline captures the specific engine instance so an old timer cannot stop a later request. Plugin destruction rejects outstanding authorization requests and prevents new work; recognition resources stay owned by worker until its cleanup. Native cancellation remains cooperative, requiring phone testing.

Run integrity suite: `python tests/test_ocr_assets.py`. These tests use synthetic byte fixtures **only for supply-chain enforcement**, not to claim OCR intelligence. They verify cached reuse without download, same-size cache corruption replacement, bad-hash rejection preserving existing destination, oversized download rejection, and completeness of real manifest model/license pins. Failed or oversized temporary downloads are removed.

Source ZIP/reproducible-build packaging must include `native/ocr-manifest.json`, `scripts/prepare-ocr-assets.py`, this Java plugin, and tests. Build output/APK must retain generated `assets/ocr/engine-LICENSE.txt`, `assets/ocr/models-LICENSE.txt`, `assets/ocr/manifest.json` and traineddata. Source ZIP may omit binary AAR/traineddata only if prep instructions are included. Also retain upstream transitive library notices; the two generated licenses do not replace those.

Raw integrity run:
test_actual_manifest_pins_models_engine_and_licenses (__main__.OCRAssetIntegrity.test_actual_manifest_pins_models_engine_and_licenses) ... ok
test_bad_hash_never_overwrites_existing_destination (__main__.OCRAssetIntegrity.test_bad_hash_never_overwrites_existing_destination) ... ok
test_corrupt_same_length_cache_is_replaced (__main__.OCRAssetIntegrity.test_corrupt_same_length_cache_is_replaced) ... ok
test_oversized_download_never_installed (__main__.OCRAssetIntegrity.test_oversized_download_never_installed) ... ok
test_verified_download_and_cache_reuse (__main__.OCRAssetIntegrity.test_verified_download_and_cache_reuse) ... ok

----------------------------------------------------------------------
Ran 5 tests in 0.005s

OK
eng.traineddata: SHA256 VERIFIED
eng.traineddata: SHA256 VERIFIED
eng.traineddata: SHA256 VERIFIED
