# Full Completion — Baseline Audit (Gate A)

Date: 2026-11-20 · Branch: `cp-full-completion-final-release` (from `5c2e613`, head of `cp09-unified-integration`)

## Baseline verification — VERIFIED

| Check | Result |
|---|---|
| CP09 head | `5c2e613` = `origin/cp09-unified-integration` |
| CP06.3 ancestry | `15c0bf3` is an ancestor of `5c2e613` |
| Working tree at start | clean |
| Schema | migrations 001–009, all additive; none added or changed in this phase |
| Architecture | one shared `dispatch()` route layer for the Node server and the Android web worker (SQLite WASM + OPFS) |

## Feature classification

The "At start" column is the state found at the beginning of this phase. The "Now" column is the state after this phase's work and tests. Chromium and Node evidence is not device evidence.

| Area | Feature | At start | Now | Evidence |
|---|---|---|---|---|
| Data model | name_ar / name_en / manufacturer / variant / record_status / version | Implemented and verified | Implemented and verified | migration 006, `tests/cp06-2-*.test.ts` |
| Data model | Multiple barcodes per product (`product_codes`) | Partially implemented (table and primary-code triggers only) | Implemented and verified | `server/src/product-codes.ts`, `tests/final-completion.test.ts` |
| Data model | One code never maps to two products | Partially implemented (primary only) | Implemented and verified | create / update / extra-code 409 tests |
| Data model | Lookup by any code (scan screen) | Missing | Implemented and verified | `by-code`, `by-barcode` fallback |
| Evidence | Field-level evidence, human approval | Implemented and verified | Implemented and verified | `tests/cp06-2-phase5.test.ts` (T) |
| Matching | Shared engine, labeled dataset | Implemented and verified (404 cases) | Implemented and verified | `tests/matching.test.ts`, gate 3: zero strong/exact matches on any conflict case |
| Queue v2 | Leases, back-off, budgets, pause / cancel | Implemented and verified | Implemented and verified | `tests/cp06-2-phase5.test.ts` (Q) |
| Queue v2 | Priority (staff-requested > GTIN > name_en+brand > rest) | Partially implemented (column unused) | Implemented and verified | import priority and `POST /api/queue/prioritize/:id` tests |
| Providers | Open Beauty Facts | Implemented and verified | Implemented and verified | `tests/providers.test.ts` |
| Providers | UPCitemdb | Implemented, disabled by policy (terms not verified) | Unchanged | `docs/CP06_2_PHASE4_PROVIDERS.md` |
| Providers | Paid providers | Out of scope (owner approval required) | Out of scope | — |
| Import | 10,000 rows, invalid-row report, resume after a crash, rollback | Implemented and verified | Implemented and verified | `tests/cp06-2-phase5.test.ts` (P/Q) |
| Import | Column-mapping preview | Partially implemented (ignored columns only) | Implemented and verified (automatic mapping shown; header names only) | `column_mapping` test |
| Import | Manual column re-mapping | Missing | Missing — optional; headers follow `import-template.csv` and aliases | — |
| Review | Evidence review (manager, version check, audit) | Implemented and verified | Implemented and verified | `tests/ui-evidence.mjs`, server tests |
| Review | Bulk classification | Missing | Implemented and verified (manager only, optimistic concurrency, scientific fields untouched) | server + UI tests |
| Manager | Dashboard with real counts | Partially implemented (reports page) | Implemented and verified (`/api/dashboard`, no financial figures) | server + UI + on-device tests |
| OCR | Local OCR | Missing | Out of scope for this release (deferred) | `docs/OCR_EVALUATION.md` |
| CP09 | Scientific advisor, switch, multi-turn safety, offline | Implemented and verified | Implemented and verified | `tests/cp09.test.ts`, `tests/ui-intel.mjs`, `tests/local-intel.mjs` |
| CP09 | Catalog → advisor (drafts excluded, products without ingredients never recommended) | Implemented but not verified end to end | Implemented and verified | integration test in `tests/final-completion.test.ts` |
| Android | Back button, lifecycle, MHBAK2 backup, thumbnails | Implemented and verified (Chromium) | Unchanged | CP06.3 reports |
| Android | Physical device behavior | Blocked (no device) | Blocked | — |
| Release | Owner-controlled permanent signing | Missing | Prepared; the signed release is blocked until the owner supplies the key | `docs/RELEASE_SIGNING_AND_CUSTODY.md` |
| Policy | Prices, costs, sales, invoices, stock quantities | Out of scope (excluded) | Out of scope (excluded; tests assert it) | `tests/api.test.ts`, dashboard test |
