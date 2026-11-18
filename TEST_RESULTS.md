# نتائج الاختبارات — CP02 (نُفذت فعليًا)

## ملخص
| الفحص | النتيجة |
|---|---|
| `npm run typecheck` | نظيف |
| `npm test` (وحدة + تكامل + إثراء + مستشار + أداء) | **65/65** |
| `npm run test:ui` (Playwright، Chromium 390×800) | **26/26**، كُررت 4 مرات متتالية بلا فشل |
| أداء عند 10,000 منتج | قائمة ≈13ms، فلترة ≈9ms، مستشار ≈113ms (أقصى ≈170ms في جولات أخرى) |

## ما لم يُختبر (صراحة)
* **اتصال حي بـ Open Beauty Facts — BLOCKED** (الوكيل يرفض 403). الموصل مختبر بردود مسجّلة الشكل وبموصل mock فقط؛ مسار نقطة النهاية يحتاج تحققًا عند أول اتصال حي.
* PostgreSQL (المخطط `db/postgres` غير مُشغَّل) · Docker/compose · كاميرا/قارئ HID حقيقيان · هواتف فعلية · Netlify/GitHub (لم يُنشر شيء) · `npm audit` · الوضع الداكن · قارئ الشاشة.

## جدول معايير القبول
| المعيار | الحالة |
|---|---|
| لا أسعار/كميات/تكاليف (مخطط + 400 على الحقول) | TESTED |
| صلاحيات مدير/موظف على الخادم | TESTED |
| مصادقة، حد محاولات | TESTED |
| باركود GTIN، منع التكرار، أرقام عربية | TESTED |
| استيراد CSV/XLSX + قنبلة ضغط | TESTED |
| التوفر ثلاثي + انتهاء الصلاحية | TESTED |
| المستشار الاسترجاعي وقواعد السلامة | TESTED |
| محرك الإثراء (موصلات، مسودات، تعارض، مراجعة، طابور، معدل) | TESTED (موصلات وهمية/مسجلة) |
| الإثراء من الإنترنت الفعلي | BLOCKED |
| واجهة الهاتف، المراجعة، حالات الخطأ/الانقطاع، الحركة المخفضة | TESTED (Chromium) |
| مسح الكاميرا | PARTIALLY TESTED (مسار الخطأ فقط) |
| الوضع الداكن | NOT IMPLEMENTED (رموز مجهزة) |
| AI Provider | IMPLEMENTED (حارس + لا مزود)، TESTED للحارس؛ لا LLM مفعّل |
| ملاءمة قائمة على المكونات | NOT IMPLEMENTED |
| Docker / PostgreSQL / نشر | UNTESTED / NOT DEPLOYED |

## قائمة اختبارات الوحدة والتكامل
```
PASS 1 - dialect/spelling: جافه / حساسه / ما يهيج / دهنيه match like the standard spellings
PASS 2 - follow-up: skin type asked only when missing; contextual, short, with choices
PASS 3 - suitability is SEPARATE from availability: documented-but-unavailable outranks undocumented-but-available
PASS 4 - advisor never invents: unmatched query returns nothing, only a clarification note
PASS 5 - conflicting sources downgrade suitability and are announced
PASS 6 - safety: severe symptoms in any spelling => no products; acne/dandruff add referral notes without therapeutic promises
PASS 7 - fragrance-free: unknown composition is never claimed fragrance-free; marketing words in the name are ignored
PASS 8 - engine honesty flags: llm=false, engine=retrieval
PASS 9 - guard: rejects products outside retrieved set, prices/discounts, therapeutic promises; accepts grounded text
PASS 10 - provider: failure or missing provider falls back safely; hallucinating provider is rejected
PASS 11 - unit: GTIN check digit, length, Arabic-Indic digits
PASS 12 - unit: password hashing and tokens
PASS 13 - unit: CSV parser handles quotes, CRLF, BOM
PASS 14 - unit: migrations are idempotent
PASS 15 - auth: wrong password rejected, no token => 401, bad token => 401
PASS 16 - auth: login throttling after repeated failures
PASS 17 - rbac: staff blocked from manager-only endpoints (server-side)
PASS 18 - rbac: deactivated user loses access immediately; last manager protected
PASS 19 - rbac: weak password rejected on user creation
PASS 20 - policy: price / cost / quantity fields are rejected, never stored
PASS 21 - policy: schema has no price/cost/quantity columns anywhere
PASS 22 - product: create, duplicate barcode blocked, invalid barcode rejected
PASS 23 - barcode: unknown product => not found + enrichment honestly NOT configured (no invented data)
PASS 24 - barcode: Arabic-Indic digits from a scanner still match existing product
PASS 25 - verification: staff cannot approve; manager needs a source; edits revoke approval
PASS 26 - product: delete is manager-only
PASS 27 - search: by name and barcode, LIKE wildcards neutralised
PASS 28 - availability: unconfirmed is never "available"; staleness downgrades; updater recorded
PASS 29 - import: CSV and XLSX parse identically; price/quantity columns ignored (names only)
PASS 30 - import: preview writes nothing; commit adds once; re-import creates no duplicates
PASS 31 - import: no price/qty strings ever stored in DB or import log
PASS 32 - import: bad file type / empty file rejected
PASS 33 - import: scales to 5000 rows without trouble
PASS 34 - advisor: only documented ingredients; unknown composition is "cannot assess", never invented
PASS 35 - advisor: severe symptoms => no product recommendation, refer to professional
PASS 36 - advisor: stale/unconfirmed availability is flagged, not promised
PASS 37 - requests: repeats are counted; personal data rejected; manager-only summary
PASS 38 - reports: summary has counts only, no financial fields
PASS 39 - security: path traversal on static server blocked; security headers present
PASS 40 - security: SQL-injection-like input is treated as data
PASS 41 - security: passwords never returned by API
PASS 42 - persistence: data survives close/reopen of an on-disk DB
PASS 43 - api: duplicate-barcode 409 tells the UI which record to open
PASS 44 - backup: VACUUM INTO produces a verifiable, restorable copy
PASS 45 - security: XLSX zip-bomb (≈100KB file expanding to >100MB) is rejected with 400, server stays up
PASS 46 - disabled mode: honest "disabled", nothing invented
PASS 47 - success: candidates are DRAFTS with source, licence, time; local product untouched
PASS 48 - not found in source => not_found (no candidates, no invented data)
PASS 49 - offline / source down => unreachable, recorded, not cached as a miss
PASS 50 - cache: repeat lookup within 24h makes no external call; manager force bypasses
PASS 51 - conflict: differs from local value AND between two sources => flagged for review
PASS 52 - review: manager-only; approve applies field, records provenance, caps at "partial" (never auto-verified)
PASS 53 - review: manager edit is stored as origin=manual; reject changes nothing; approve without a product is refused
PASS 54 - review: approving over a VERIFIED product drops it back to review
PASS 55 - mock-sourced approval never writes a source URL (cannot be passed off as sourced)
PASS 56 - rate limit: over-limit lookups report rate_limited instead of hammering the source
PASS 57 - invalid barcode rejected before any external call
PASS 58 - queue: batches, respects limit, retries with backoff, gives up after 5 attempts
PASS 59 - queue: rate-limited run stops and leaves jobs queued (no burst)
PASS 60 - status endpoint reports mode/connectors/queue honestly
PASS 61 - no price/cost/quantity columns in enrichment tables
PASS 62 - OBF connector: parses fields, sends identifying User-Agent, restricts requested fields
PASS 63 - OBF connector: status 0 / 404 => not found; 5xx / network / bad JSON / timeout => Unreachable
PASS 64 - perf @10,000 products: list/search < 400ms, advisor < 1500ms (measured, budget is generous for mid-range hosting)
PASS 65 - perf: advisor response size is bounded (does not dump thousands of products to the client)
```

## الواجهة (آخر جولة)
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
PASS advisor: contextual follow-up chip appears and refines the query; suitability and availability are separate blocks
PASS offline: lookup keeps the barcode, shows retry, recovers when back online
PASS camera unavailable/denied: precise explanation, manual input stays usable
PASS reduced motion: animations are disabled
PASS manager home: review card with count; More menu shows review
PASS review screen: diff local vs proposed, source, conflict flag, draft badge
PASS review: approve ingredients -> product gets ingredients, stays "partial" (not verified), no source URL for mock
PASS review: edit-then-approve stores manager edit; reject leaves field untouched
PASS advisor now sees approved ingredients as partial suitability (not "documented")
PASS layout: no horizontal overflow or null text on every page at 360 / 390 / 768 / 1280 widths
PASS layout: fixed nav never covers the last content (bottom padding >= nav height)
console errors seen: []
PASS no unexpected console/page errors (deliberate 401/409/400 network logs excluded)
```
