# SMART STOCK — Build & Update Guide

## Requirements
- JDK 17 or 21, Android SDK (platform 35, build-tools 35.0.0). Android Studio (Ladybug+) works as-is.
- Internet only at build time (Gradle downloads dependencies). The app itself never uses the network.

## Build
```bash
echo "sdk.dir=/path/to/Android/sdk" > local.properties   # or set ANDROID_HOME
./gradlew :app:testDebugUnitTest      # 50 tests (JUnit + Robolectric)
./gradlew :app:assembleDebug          # app/build/outputs/apk/debug/app-debug.apk
./gradlew :app:assembleRelease        # unsigned unless a signing config exists (see signing guide)
```
Gradle wrapper 8.14.3, Android Gradle Plugin 8.10.1. `settings.gradle` lists a Google-hosted Maven Central
mirror first (avoids HTTP 429 rate limits on CI); remove it if undesired.
Optional: `-Dsmartstock.out=/some/dir` makes the tests write sample outputs (xlsx, page renders, screenshots).
`SMARTSTOCK_REFERENCE_XLSX=/path/file.xlsx` additionally runs an import check on a real workbook
(never commit real business data).

Regenerate synthetic fixtures (needs Python 3 + openpyxl + LibreOffice):
`python3 tools/make_fixtures.py app/src/test/resources/fixtures`

## Releasing an update
1. Increase `versionCode` (e.g. 1.0.1 → 10001, 1.1.0 → 10100) and `versionName` in `app/build.gradle`.
2. Keep `applicationId 'com.smartstock'` and sign with the SAME permanent key — otherwise Android refuses the update.
3. Database changes: bump `Db.VERSION` and add an incremental, data-preserving step in `Db.onUpgrade()`
   (`if (oldVersion < 2) { ALTER TABLE ... }`). Never drop tables to "fix" an upgrade. Downgrades are refused.
4. Run the tests, then `tools/sign_release.sh`.
5. Installing the new APK over the old one keeps all sessions (app data is preserved by Android).

## Data locations (on the phone, private app storage)
- `databases/smartstock.db` — sessions, items, quantities, states, operation log (rollback journal, fsync per commit)
- `files/sources/*.xlsx` — private copy of each imported workbook (export never depends on the original file)
- `shared_prefs/settings.xml` — settings
Android cloud backup is disabled on purpose (business data stays on the device); use the in-app backup.
