# SMART STOCK — Test Report

## Update 1.3.0 (versionCode 10300) — date column, new scanner, A4 portrait
**Date column:** recognised by name (تاريخ الانتهاء / التاريخ / الصلاحية / expiry …). Excel date cells → `yyyy-MM-dd`;
date serials without a date format are converted too; text dates kept as written. Shown on the item card, in the
duplicate-barcode chooser (helps choosing the right batch) and the list. The add-item form has a date field
(calendar) in its column position; on export it is written as a real Excel date using the column's date format
(text if the column has none). Not printed. DB schema v3 → v4 (`items.expiry`).
**Scanner:** ZXing replaced by Google ML Kit barcode scanning with the **bundled** model (in the APK, no download,
no network) on CameraX: 1920×1080 analysis, continuous AF + tap-to-focus, zoom slider, torch, aiming frame.
1D codes accepted after 2 identical reads (guards against glare misreads), QR/DataMatrix at once (`ScanConfirmTest`).
APK checked: `assets/mlkit_barcode_models/*.tflite` and `libbarhopper_v3.so` present; permissions still only
CAMERA + VIBRATE (ML Kit's INTERNET / ACCESS_NETWORK_STATE removed in the manifest). APK limited to ARM ABIs (16 MB).
**Not device-verified:** scanning speed through shrink-wrap must be confirmed on the phone.
**Print:** A4 portrait, 6 columns (no date), wrapped column titles; ~26 items/page (10,000 items: 386 pages, was 626).
**Tests added:** `DateColumnTest` (3), `ScanConfirmTest` (3), date in `AddItemTest` (export → real date read back),
portrait assertion in the PDF test. Total: **66 / 66 TEST PASSED**.


## Update 1.2.0 (versionCode 10200) — adding items not in the Excel file
**Feature:** when a scanned barcode is not in the file, *إضافة صنف جديد* opens a form whose fields follow the
Excel column order and use the file's own column titles (group, name, unit, pack, barcode prefilled, quantity, cost).
The item is saved with its first count in one transaction (item + ADD log entry), marked «مُضاف», editable/deletable
(imported items stay read-only), counted, undone and backed up like any item. On export it is written as a new row
after the last item: first into empty prepared rows (keeping their formatting), else as new rows, copying the cell
styles of the last item row; barcode written as text; total column filled. Database schema v2 → v3 (`items.added`).
**Tests added (`AddItemTest`, all pass):** add + cumulative count + stats (557.5) + verified export; exported rows 12–13
right after the last item in the prepared rows of a multi-sheet file, every field in its column, barcode `0099887766`
kept, other sheets intact; reordered single-sheet file → new row 22 and form order = column order; validation, double
save, edit, undo, delete, backup/restore; real count screen: unknown barcode → add form → saved.
Independent check: the export opened and recalculated in LibreOffice Calc shows the 2 new rows and total column sum 557.5.
Total: **60 / 60 TEST PASSED**.


## Update 1.1.0 (versionCode 10100) — multi-phone merged printing
**Feature:** each phone counts its own Excel file and exports it; on one phone, *Print → طباعة مجمّعة لعدة جوالات*
loads several exported files, merges them into one read-only report session and prints them as one file:
item list (file order, then row order) + per-file totals page + final report with one grand total.
**Database:** schema v1 → v2 (`sessions.kind`, `sessions.parts`, `items.src`) via in-place `ALTER TABLE`; no data loss.
**Tests added (`MergeTest`, all pass):**
- 3 phones with different files (incl. one with BOM) → count → verified export → merge: grand total
  **3,087.1356** = 538.00 + 80.00 + 2,469.1356 = sum of the three phones; per-file totals equal each phone; 38 items; PDF 5 pages.
- Same file added twice is refused; barcodes present in several files are reported, rows not merged.
- Merge screen end-to-end (pick files → merge → opens print screen).
- v1 database (app 1.0.x) upgraded to v2 keeping sessions and counts.
A merged report shows items by quantity (with quantity / zero quantity) instead of counted / not counted,
because an exported Excel file does not store that state. Also fixed: hash hex formatting forced to `Locale.US`.
Total: **56 / 56 TEST PASSED**.


## Update 1.0.1 (versionCode 10001) — first device feedback
**Bug reported from the phone:** import failed with `Unexpected token (position:TEXT @1:2)`.
**Cause:** the workbook's XML parts start with a byte-order mark (BOM) before `<?xml`; Android's XML parser
rejects that. Synthetic test files did not contain a BOM, so it was missed.
**Fix:** every XML part is now read through a reader that skips a UTF-8/UTF-16 BOM and leading whitespace.
**Tests added:** `BomTest` (import + verified export of a BOM workbook, UTF-16 and whitespace cases) and
`BomAndroidTest` (same file through the Android platform parser — reproduced the exact phone error before the fix).
Total now **53 / 53 TEST PASSED**. Error message for unreadable files is now actionable Arabic text.

---


Date: 2026-11-25 · Environment: Linux x86_64 container, JDK 21, Android SDK 35, Gradle 8.14.3, AGP 8.10.1,
Robolectric 4.14.1 (SDK 34, native graphics). **No physical device and no emulator** (no KVM available).

Status legend: **IMPLEMENTED** · **BUILD PASSED** · **TEST PASSED** (automated, JVM/Robolectric) ·
**DEVICE VERIFIED** (none yet) · **RELEASE SIGNED** · **BLOCKED**

## Summary
| Area | Status |
|---|---|
| Source recovery, restore point (original prototype kept unmodified in `reference/`) | DONE |
| Debug APK `com.smartstock.debug` 1.3.0 (10300) | BUILD PASSED — 5.9 MB, v2 signed with debug key |
| Release APK `com.smartstock` 1.3.0 | BUILD PASSED (unsigned) · signing pipeline TEST PASSED with throw-away key |
| RELEASE SIGNED with permanent key | **BLOCKED** — owner must create the key (see signing guide) |
| Automated tests | **66 / 66 TEST PASSED** (core 36 · data/PDF/merge/add 22 · UI flows 8) |
| Samsung Galaxy S22 Ultra | **NOT DEVICE VERIFIED** — acceptance checklist below |
| APK permissions | CAMERA, VIBRATE only — no INTERNET (checked with `aapt2 dump permissions`) |

## What the prototype had and what changed
The V1 prototype (2 Java files) was reviewed line by line. Kept ideas: SAF import, private copy of the
workbook, cumulative add, duplicate-barcode chooser, DOM-based quantity/total update. Defects found and fixed
by rewrite of the engines: whole workbook loaded into memory (DOM) → streaming; import **aborted on any error
cell** (the reference template's `#NAME?` row) and on any non-zero quantity; costs/quantities via SharedPreferences
without transactions/audit log; integer-only quantities; exact-name header matching; no zero-vs-uncounted state,
no undo/correction log, no sessions, no backup; printing via WebView screenshot-style HTML; no tests; never built.

## A. Excel import — TEST PASSED
| Case | Test | Result |
|---|---|---|
| 10 items, multi-sheet, approved sheet `تصدير_بلاس` chosen | `XlsxImportTest.multiSheet…` | ✓ |
| 1,000 / 10,000 / 50,000 items | `import1k10k50k` | ✓ 11 / 80 / 279 ms (JVM) |
| 50,000 items into SQLite session (Robolectric) | `WorkflowTest.largeSession50k` | ✓ 773 ms |
| Single sheet with any name | `singleSheetReordered…` | ✓ `Sheet1` |
| Columns in different order + extra columns | `singleSheetReordered…` | ✓ |
| Header name variants (العدد، تكلفة الصنف، Barcode، العبوة / حبة …) | `ColumnMatcherTest.variants` | ✓ |
| Never confuses «التكلفة قبل التحويل» / «معامل التحويل» with cost | `neverPicksCostBeforeConversion` | ✓ |
| Ambiguous / missing column → manual mapping once | `ambiguousHeader…`, `UiFlowTest.importNeedsMapping…` | ✓ |
| Leading-zero barcode kept (text) | `multiSheet…` (`0012345`) | ✓ |
| Numeric barcode + `0000000000000` format re-padded | `numericBarcodes` | ✓ |
| Duplicate barcode counted, rows kept separate | `multiSheet…`, `duplicateBarcode…` | ✓ |
| Item without barcode kept, searchable by name | `multiSheet…`, `searchByName…` | ✓ |
| Decimal costs exact (12.125, 1234.5678, 0.1) | `multiSheet…` | ✓ |
| Blank rows inside data / 60 prepared formatted rows ignored | `multiSheet…` | ✓ |
| Cost from formula → cached value used (12.74) | `multiSheet…` | ✓ |
| Formula without cached value / error / text / negative / empty cost → flagged, **not zeroed** | `invalidData…` | ✓ (4 invalid) |
| Invalid / pre-existing quantities reported | `invalidData…` | ✓ |
| No total column → created (K) | `roundTrip…` | ✓ |
| Not an XLSX → Arabic error | `notAnXlsx` | ✓ |
| Owner's reference workbook `مازن.xlsx` (local only, never committed) | `ownerReferenceWorkbookIfPresent` | ✓ sheet `تصدير_بلاس` found, headers mapped without manual step; the template contains no item values (only a `_xludf.FILTER` formula cached as `#NAME?`), so import correctly stops with an explanatory message |

## B. Counting — TEST PASSED
| Case | Test |
|---|---|
| First count, second count adds (12 + 8 = 20) | `WorkflowTest.cumulativeCounting…`, `UiFlowTest.countingScreen…` (via real screen) |
| Scanning alone adds nothing | `UiFlowTest.countingScreen…` |
| Double tap / repeated signal → one save (idempotency token + UNIQUE constraint + button lock) | `doubleSaveIsBlocked`, UI double `performClick` |
| Correction with reason, logged as CORRECT | `correctionAndUndo…` |
| Undo last op (writes UNDO record, nothing deleted), repeated undo back to "not counted" | `correctionAndUndo…` (6 log rows kept) |
| Counted-zero distinct from not-counted | `zeroCountIsDistinct…` |
| Search by name (Arabic normalisation أ/ا, ة/ه …) and by barcode; Arabic-Indic digits | `searchByName…`, `duplicateBarcode…` |
| Duplicate barcode → chooser, no auto-pick | `UiFlowTest.unknownBarcode…AndDuplicateAsksToChoose` |
| Unknown barcode → message; an item is created only through the explicit «إضافة صنف جديد» form (1.2.0) | same, `AddItemTest` |
| Leading-zero-insensitive fallback (UPC-A vs EAN-13) | `duplicateBarcode…` |
| Keyboard-wedge scanner burst typed into quantity field → treated as barcode, nothing saved | `scannerBurst…` |
| Negative / decimal (when disabled) quantities rejected | `invalidQuantitiesRejected` |
| Close & reopen (process death simulated by closing/reopening the DB) | `sessionsAreIsolatedAndSurviveReopen` |
| Sessions isolated; delete one leaves the other intact | same |

## C. Calculations — TEST PASSED
25.50 × (12+8) = **510.00** ✓ · 0.28 × 100 = **28.00** ✓ · 10,000 × 0.1 = 1000 exactly and 10,000 × (3×0.28) = 8400
exactly (the test also proves `double` would drift) ✓ · 50,000-item total equals independently computed BigDecimal sum ✓.
All money/quantity math uses `BigDecimal`, stored as exact decimal text; no intermediate rounding.

## D. Export — TEST PASSED
Round-trip (`XlsxExportTest`, `WorkflowTest.verifiedExportMatchesDatabase`): header names & order, row order,
barcodes, costs, groups, packs unchanged; extra columns and other sheets byte-identical; styles/sharedStrings
identical; quantities and totals correct; total column created when absent; stale total formulas replaced by
values; shared-formula masters handled; namespace-prefixed sheets / cells without `r` handled; calcChain removed
and `fullCalcOnLoad` set; original file byte-identical after export; 50,000-row export + verification 1.6–2.0 s.
Every export inside the app is re-opened and verified row by row against the database before it is saved.
Independent check: `SMART_STOCK_SAMPLE_OUTPUT.xlsx` opened with **openpyxl** and **LibreOffice Calc**
(re-calculated): totals column sum = **538** = database = PDF. *Not opened in Microsoft Excel itself here.*

## E. Printing — TEST PASSED (layout/drawing), vector PDF on device not executed
Robolectric has no native `PdfDocument`, so tests run the **same drawing code** into bitmaps
(`ReportPdf.PageSink`); on the phone the identical code writes a vector PDF via `PdfDocument`.
Verified: A4 landscape; columns م • اسم الصنف • العبوة/حبة • الباركود • الكمية • التكلفة • إجمالي (no group/unit/expiry/notes);
Arabic shaping & RTL correct; barcodes never cut (font shrinks to fit); long names wrap; rows never split;
headers repeat; «صفحة X من Y»; page subtotals; zero/uncounted items printed; final report on its own page with
signatures; filtered scope shows separate scope totals; 10,000 items → 626 pages without crash (7.2 s JVM).
`SMART_STOCK_SAMPLE_PRINT.pdf` / `…_10K_EXCERPT.pdf` are **raster renders (144 dpi) of that drawing code**, assembled
into PDF for review — the phone produces the vector version.
Not tested: Android print dialog / real printer, PdfRenderer preview.

## F. Persistence & backup — TEST PASSED
Backup (DB + source workbooks + settings, SHA-256 per entry, per-session totals) → data changed → validate →
real restore → counts, zero-counts, quantities, values and op-log count identical; export works after restore;
safety copy created (`backupAndRealRestore`). Tampered backup rejected, live data untouched (`corruptedBackupIsRejected`).
Phone reboot: not testable here (SQLite rollback journal, commit per save → durable by design).

## UI
8 Robolectric flow tests drive the real activities (home, count, items, reports, sessions, settings, export,
print options, import wizard incl. shared file intent and manual mapping). Screenshots: `delivery/screenshots/`.
A real bug found this way was fixed: single-line RTL text fields scrolled their text out of view.

## Performance notes (JVM numbers; phone will differ)
Import 50k: 0.3 s parse + 0.8 s DB insert · save: ~7 ms · stats over 50k: ~0.19 s · export+verify 50k: ~2 s ·
PDF: ~16 rows per page (≈3,125 pages for 50k items — generated in streaming passes; size grows with pages).

## Known limitations
- Not verified on a real device (camera scanning, external scanner, printing, performance on S22 Ultra).
- Excel: if the quantity cells of the owner's file are spilled from a dynamic-array formula (e.g. `FILTER`),
  the export writes static values into those cells; deliver the final file as values (as planned by the owner).
  Removing formulas from target cells means dependent shared-formula cells keep their last cached value.
- Barcodes stored as numbers longer than 15 digits lose precision inside Excel itself (warned at import).
- Session data in the debug build does not move to the release build automatically (use backup/restore).

## Device acceptance checklist (owner, on the S22 Ultra)
1. Install debug APK; open; home shows "no active session".
2. Import the real final `تصدير بلاس` file from Downloads and from WhatsApp "open with"; check the summary counts.
3. Scan 5 items with the camera (with and without flash), 2 with an external scanner if available.
4. Re-count one item (12 then 8 → 20); double-tap save; verify only one addition.
5. Mark one item zero; correct one item; undo last; check Reports → integrity check ✓.
6. Force-stop the app (Settings → Apps → Force stop), reopen: quantities intact. Reboot phone: intact.
7. Export to Downloads; open in Microsoft Excel: columns, other sheets, quantities, totals.
8. Print: preview, save PDF, print to a real printer A4 landscape; compare final total with Excel.
9. Backup → uninstall/reinstall (or second phone) → restore → totals identical.
10. Time a full import of the real file and note any slowness.
