# Samsung Acceptance — v3.0.0

**No physical Samsung device and no Android emulator were reachable from this session.** The cloud container has no `/dev/kvm` and no system images. Every item is therefore NOT TESTED or BLOCKED. The "Closest non-device evidence" column lists what was checked in Chromium or Node. That is supporting evidence only and **not** a device result.

Build to test: the owner-signed `makeuphouse-advisor-3.0.0-release.apk`, after signing per `docs/RELEASE_SIGNING_AND_CUSTODY.md`. The debug TEST-ONLY APK can be used for a functional pass, but not for items 29–30.

| # | Area | Device result | Closest non-device evidence |
|---|---|---|---|
| 1 | Clean installation | NOT TESTED | APK badging verified: package, versionCode 4, minSdk 24 |
| 2 | First launch | NOT TESTED | `tests/local-app.mjs` (setup screen, no demo data) |
| 3 | Offline startup | NOT TESTED | `tests/local-app.mjs`, `tests/local-final.mjs` (offline) |
| 4 | Product browsing | NOT TESTED | `tests/ui.mjs`, `tests/local-perf.mjs` |
| 5 | Product creation | NOT TESTED | `tests/ui.mjs` |
| 6 | Product editing | NOT TESTED | `tests/ui.mjs`, `tests/ui-nav.mjs` |
| 7 | Barcode scanning | NOT TESTED | none (needs a camera) |
| 8 | Camera permissions | NOT TESTED | manifest declares CAMERA only |
| 9 | Product image capture | NOT TESTED | `tests/ui-images.mjs` (upload path) |
| 10 | Excel import | NOT TESTED | `tests/cp06-2-phase5.test.ts` (10,000 rows) |
| 11 | Import interruption and resume | NOT TESTED | crash-after-3-chunks resume test |
| 12 | Product matching | NOT TESTED | `tests/matching.test.ts` (404 cases) |
| 13 | Enrichment queue | NOT TESTED | queue tests (server) |
| 14 | Human review | NOT TESTED | `tests/ui-evidence.mjs` |
| 15 | Bulk classification | NOT TESTED | `tests/ui-final.mjs`, `tests/local-final.mjs` |
| 16 | Scientific consultation | NOT TESTED | `tests/ui-intel.mjs`, `tests/local-intel.mjs` |
| 17 | Urgent symptom escalation | NOT TESTED | `tests/cp09.test.ts` blind safety set |
| 18 | Multi-turn conversation | NOT TESTED | `tests/cp09.test.ts` |
| 19 | Network research | NOT TESTED | `tests/local-intel.mjs` (mocked source) |
| 20 | Network failure handling | NOT TESTED | device-runtime offline test |
| 21 | Backup | NOT TESTED | `tests/local-backup-scale.mjs` |
| 22 | Restore | NOT TESTED | same, including attack and legacy cases |
| 23 | Application restart | NOT TESTED | `tests/local-app.mjs` persistence |
| 24 | Background / foreground lifecycle | NOT TESTED | CP06.3 lifecycle audit |
| 25 | Manager permissions | NOT TESTED | server 403 tests |
| 26 | Data persistence | NOT TESTED | `tests/local-update-continuity.mjs` |
| 27 | Performance | NOT TESTED | `tests/local-perf.mjs` (Chromium numbers only) |
| 28 | Battery and memory | NOT TESTED | none |
| 29 | Update installation | BLOCKED (no owner key, no device) | — |
| 30 | Data preserved after update | BLOCKED (no owner key, no device) | data-layer continuity test |

Record PASS / FAIL for each item on the phone. The in-app checklist (More → Samsung test checklist) stores answers as feedback notes.
