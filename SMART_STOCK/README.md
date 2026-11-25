# SMART STOCK — الجرد الذكي (V1.0.0)

Offline Android inventory-count app (Arabic RTL). Import an Excel (XLSX) item list, scan barcodes,
enter counted quantities (cumulative), export the same workbook with quantity + row total updated,
and print an A4-landscape PDF count sheet with an independent final report page.

| Item | Value |
|---|---|
| Application ID | `com.smartstock` (debug: `com.smartstock.debug`) — never change |
| Version | 1.0.0 / versionCode 10000 |
| Min / target SDK | 26 / 35 |
| Language | Java 17, AndroidX, Material 3, SQLite, ZXing (embedded, offline) |
| Permissions | CAMERA, VIBRATE only (no INTERNET) |

## Layout
```
app/src/main/java/com/smartstock/
  core/   pure-Java engines (no Android UI): XLSX import (streaming), round-trip exporter,
          export verifier, column matcher, exact decimal math  -> JVM unit-tested
  data/   SQLite schema/migrations (Db), Repository (atomic count+log), Backup, Workflows
  pdf/    ReportPdf: A4 landscape vector PDF (Android PdfDocument)
  ui/     Activities (Home, Import, Count, Scan, Items, Reports, Export, Print, Sessions, Settings)
app/src/test/   50 automated tests (JUnit + Robolectric) and synthetic fixtures
tools/          fixture generator, signing script, test-result printer
docs/           user guide source (HTML)
reference/original_prototype/   the unmodified V1 prototype received (restore point)
delivery/       built artifacts
```
See `SMART_STOCK_BUILD_GUIDE.md`, `SMART_STOCK_SIGNING_GUIDE.md`, `SMART_STOCK_TEST_REPORT.md`.
