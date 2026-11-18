# نتائج الاختبارات (نُفذت فعليًا في هذه الجلسة)

## الوحدة + التكامل (`npm test`) — node:test عبر HTTP حقيقي
```
PASS 1 - unit: GTIN check digit, length, Arabic-Indic digits
PASS 2 - unit: password hashing and tokens
PASS 3 - unit: CSV parser handles quotes, CRLF, BOM
PASS 4 - unit: migrations are idempotent
PASS 5 - auth: wrong password rejected, no token => 401, bad token => 401
PASS 6 - auth: login throttling after repeated failures
PASS 7 - rbac: staff blocked from manager-only endpoints (server-side)
PASS 8 - rbac: deactivated user loses access immediately; last manager protected
PASS 9 - rbac: weak password rejected on user creation
PASS 10 - policy: price / cost / quantity fields are rejected, never stored
PASS 11 - policy: schema has no price/cost/quantity columns anywhere
PASS 12 - product: create, duplicate barcode blocked, invalid barcode rejected
PASS 13 - barcode: unknown product => not found + enrichment honestly NOT configured (no invented data)
PASS 14 - barcode: Arabic-Indic digits from a scanner still match existing product
PASS 15 - verification: staff cannot approve; manager needs a source; edits revoke approval
PASS 16 - product: delete is manager-only
PASS 17 - search: by name and barcode, LIKE wildcards neutralised
PASS 18 - availability: unconfirmed is never "available"; staleness downgrades; updater recorded
PASS 19 - import: CSV and XLSX parse identically; price/quantity columns ignored (names only)
PASS 20 - import: preview writes nothing; commit adds once; re-import creates no duplicates
PASS 21 - import: no price/qty strings ever stored in DB or import log
PASS 22 - import: bad file type / empty file rejected
PASS 23 - import: scales to 5000 rows without trouble
PASS 24 - advisor: only documented ingredients; unknown composition is "cannot assess", never invented
PASS 25 - advisor: severe symptoms => no product recommendation, refer to professional
PASS 26 - advisor: stale/unconfirmed availability is flagged, not promised
PASS 27 - requests: repeats are counted; personal data rejected; manager-only summary
PASS 28 - reports: summary has counts only, no financial fields
PASS 29 - security: path traversal on static server blocked; security headers present
PASS 30 - security: SQL-injection-like input is treated as data
PASS 31 - security: passwords never returned by API
PASS 32 - persistence: data survives close/reopen of an on-disk DB
PASS 33 - api: duplicate-barcode 409 tells the UI which record to open
PASS 34 - backup: VACUUM INTO produces a verifiable, restorable copy
# tests 34
# pass 34
# fail 0
```

## الواجهة (`scripts/ui-run.sh`) — Chromium، 390×800، قاعدة بيانات جديدة لكل جولة؛ 3 جولات متتالية: 15/15 في كل منها
```
seeded
PASS login screen is RTL and rejects bad password
PASS staff login -> home with 5-item bottom nav
PASS no horizontal overflow on home (390px)
PASS advisor: chat is primary; fragrance-free query excludes undocumented/fragranced items
PASS advisor: recommendation card has no price and no personal data
PASS scan: manual unknown barcode -> new product form prefilled -> save
PASS scan: same barcode again -> existing record, no duplicate
PASS scan: invalid check digit rejected with message
PASS availability: 3-tap update changes badge
PASS compare: two products show differences, no "winner"
PASS routine: built from store products
PASS staff cannot see manager menu items nor open manager pages
PASS manager: reports + users + import pages render
PASS manager: XLSX import preview ignores price/qty and shows warning columns by name only
PASS no unexpected console/page errors (deliberate 401/409/400 network logs excluded)
```

`tsc --noEmit`: نظيف.

## ما لم يُختبر
* PostgreSQL (المخطط موجود فقط) · Docker · اختبار الكاميرا الفعلية/قارئ HID على جهاز حقيقي (الكود موجود؛ المسار اليدوي وHID-بإدخال لوحة المفاتيح مغطى بالاختبار) · Netlify · أداء على أندرويد حقيقي.
