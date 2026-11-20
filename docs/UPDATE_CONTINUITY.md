# Future Update Continuity

## What an update must keep

| Item | Value / rule | Where |
|---|---|---|
| Application ID | `com.makeuphouse.advisor`; never change it | `android/app/build.gradle` |
| Signing identity | the owner's permanent key, same fingerprint every time | `docs/RELEASE_SIGNING_AND_CUSTODY.md` |
| versionCode | strictly increasing (this release: **4**; the next one ≥ 5) | `android/app/build.gradle` |
| Database | additive migrations only; applied automatically on start; never drop or rename | `server/migrations/` |
| Backup format | MHBAK2 (current) and MHBAK1 (older) both restore | `mobile/src/backup.ts` |
| User data | on-device storage (OPFS) is kept by Android across an update signed with the same key | — |

## Evidence

| Test | Result | Label |
|---|---|---|
| Data-layer update: the CP09 baseline bundle (`5c2e613`) creates 25 products, a staff account and the advisor switch; the v3.0.0 bundle opens the same storage | data, login, settings and accounts kept; migrations applied; extra codes and dashboard work on old data | VERIFIED (Chromium persistent profile; `tests/local-update-continuity.mjs`, `docs/final/update-continuity-last-run.json`) |
| MHBAK1 backup → current schema | restores and migrates | VERIFIED (Chromium; `tests/local-backup-scale.mjs`) |
| APK update signed build → later signed build on a phone | — | **BLOCKED** (no owner key, no device or emulator) |

## First install of v3.0.0

The owner decided that the old test APKs hold no important data. The first permanently signed release is therefore a **clean install**: uninstall the old debug-signed app first, because Android refuses a different key. From then on, every update installs over it and keeps the data.

## Owner procedure for every future update

1. **Back up first:** More → Backup, then store the file off the phone.
2. Build or sign the new version with **the same key**, and check the fingerprint matches.
3. Install it over the existing app; do not uninstall.
4. Open the app and check the product count on the dashboard, sign-in for staff, and that a recent product is present.
5. If Android says "App not installed" or reports a package conflict, the key differs. **Do not uninstall** (that deletes the data). Find the correct key.
