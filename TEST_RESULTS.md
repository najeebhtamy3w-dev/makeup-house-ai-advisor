# نتائج الاختبارات — CP03 (نُفذت فعليًا)

## CP04 — 2026-11-19 (الفرع cp04-images-audit)
| الفحص | النتيجة |
|---|---|
| `npm run typecheck` | نظيف |
| `npm test` | **94/94** (89 + 5 صور: كشف النوع والأبعاد، SSRF، API والصلاحيات، صور OBF والاعتماد، الحجم بلا وحدة) |
| `npm run test:ui` | **32/32** (27 + 5: قائمة Samsung وعارض الصورة، لا «null»، تحقق فوري، رفع/معاينة/عرض الصورة، الكاميرا الخلفية ورفض الملفات) |
| `tests/staging-smoke.mjs` محليًا وداخل صورة Docker | **12/12** |
| الرابط المنشور (فحوص عامة، قبل نشر CP04) | **9/9** (فحوص ما بعد الدخول تحتاج بيانات المالك) |
| صورة OBF حية (معاينة + اعتماد) | ناجح — docs/CP04_AUDIT.md |
| Samsung حقيقي | **DEVICE-PENDING** |

## تحديث Staging — 2026-11-19 (على الفرع cp03-cloud-staging)
| الفحص | النتيجة |
|---|---|
| `npm run typecheck` (TypeScript 5.9.3 مثبت) | نظيف |
| `npm test` | **89/89** (85 + 4 اختبارات Staging) |
| `npm run test:ui` | **27/27** بلا انحدار |
| `tests/staging-smoke.mjs` محليًا (production + staging، Galaxy S9+ محاكى) | **12/12** |
| صورة Docker (`npm ci` من package-lock) تشغيل كمستخدم `node` + فحص الدخان | **12/12** |
| OBF حي (`npm run live:obf`) + مسار `/api/enrichment/lookup` الحي | انظر docs/validation/OBF_LIVE_2026-11-19.md |
| النشر على Render / Samsung حقيقي | **لم يُجرَ بعد** (ربط الحساب / DEVICE-PENDING) |

## ملخص
| الفحص | النتيجة |
|---|---|
| `npm run typecheck` (يشمل scripts) | نظيف |
| `npm test` | **85/85** (CP02: 65 + هوية المنتج 3 + علم المكونات/المستشار 17؛ واختبارا الموصل الموجودان عُدّلا لـv3) |
| `npm run test:ui` (Chromium 390×800) | **27/27** (CP02: 26)؛ جولات متتالية: 3 + 2 + 1 كلها 27/27 بلا فشل |
| `tests/device-page.mjs` | PASS (كاميرا وهمية + HID محاكى) — **ليس اختبار جهاز** |
| أداء 10,000 منتج | قائمة ≈9ms، فلترة ≈6ms، مستشار ≈139ms (بيانات الأداء بلا مكونات؛ تكلفة تحليل INCI لم تُقس على كتالوج كبير بقوائم مكونات) |
| خط الأساس (قبل التعديل) | 65/65 · tsc نظيف · واجهة 26/26 — أعيد إثباته على شجرة نظيفة = وسم `cp02` |

## حي مقابل محاكاة (تمييز إلزامي)
| النوع | الحالة |
|---|---|
| اتصال حي بـOBF | **لم يُجرَ — BLOCKED** (CONNECT 403 من بوابة الخروج) |
| اختبارات الموصل | ردود **بالشكل الموثق** (محاكاة) |
| مطابقة المنتجات | اختبارات وحدة على نصوص تركيبية |
| منتجات المحل الحقيقية | **لم تُجرَ** (PENDING) |
| Samsung / HID حقيقي | **لم يُجرَ** (DEVICE-PENDING) |

## تغطية قوائم التفويض 12.x
* 12.1 Live: HTTP error/Timeout/تغير الشكل/Rate limit/غير موجود **بمحاكاة**؛ اتصال ناجح وباركود معروف: **غير مُنجَز**.
* 12.2 Matching: تطابق كامل، اختلاف حجم، اختلاف إصدار/اسم (partial)، تعارض مكونات، بيانات ناقصة، عدم تكرار منتج ✔.
* 12.3 Scientific: مكونات موثقة/ناقصة، عطر موثق، عطر غير معروف، تحذير، عدم اختلاق (مكوّن غير معروف لا يُخمَّن)، عدم استنتاج تركيز ✔.
* 12.4 Advisor: توصية مفسرة، فصل الملاءمة/التوفر (+بدائل)، استبعاد بسبب موثق، نقص المعلومات، سقف النتائج، عربية متنوعة ✔.
* 12.5 UI: بحث/تحميل/أخطاء/مراجعة/بطاقات/محادثة/تنقل/هاتف/Reduced Motion/لا null ✔ (Chromium).
* 12.6 Regression: كل اختبارات CP02 أُعيد تشغيلها (عُدّل اختبار واجهة واحد عمدًا لأن دلالة «الملاءمة: جزئية» حلّت محلها الأحكام الأربعة).

## قائمة الوحدة والتكامل
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
PASS 64 - identity: sizes compare by unit-normalised value (200ml == 200 ml == ٢٠٠ مل; 200 ml != 250 ml; oz/ml converted)
PASS 65 - identity: name similarity is never proof — variant words give partial/conflict, brand mismatch is a conflict
PASS 66 - identity: INCI comparison — same list exact; reordered = partial (order encodes concentration); different list = conflict
PASS 67 - perf @10,000 products: list/search < 400ms, advisor < 1500ms (measured, budget is generous for mid-range hosting)
PASS 68 - perf: advisor response size is bounded (does not dump thousands of products to the client)
PASS 69 - knowledge model: every record has provenance + review state; seed is NOT expert-reviewed; no invented review dates
PASS 70 - documented verified ingredients: explained support, but seed KB is unreviewed => at most "conditional", never "suitable"
PASS 71 - with EXPERT-REVIEWED records a clean verified product can be "suitable" (and only then)
PASS 72 - missing / unreviewed ingredients => insufficient + FORMULATION NOT VERIFIED; no benefit inferred
PASS 73 - fragrance: documented presence => contains (excluded when avoided), even from an unreviewed list
PASS 74 - fragrance: ABSENCE only from a VERIFIED list; partial/unreviewed/missing => unknown (never "fragrance-free")
PASS 75 - fragrance: a name claim ("Fragrance Free") is a CLAIM, not evidence; "unscented" may hide masking agents
PASS 76 - fragrance: benzyl alcohol alone (dual function) does not prove a fragrance; essential oils do; carrier oils do not
PASS 77 - precautions are relevant and documented: exfoliating acid, sulfate, sensitive-skin notice; no medical/therapeutic wording
PASS 78 - no concentration inference: nothing numeric/percent is invented; the ordering caveat is always stated
PASS 79 - sunscreen: UV filters in a verified list are explained as presence only; no filter => insufficient (no SPF is ever inferred)
PASS 80 - paraben / sulfate avoidance: excluded only on documented presence; unknown when list is not verified
PASS 81 - advisor: explained recommendation carries used info, missing info, precautions, availability and alternatives
PASS 82 - advisor: available-but-unsuitable is EXCLUDED with a reason (never silently dropped, never recommended)
PASS 83 - advisor: Arabic / Yemeni phrasing — dry, sensitive, oily+sunscreen, hair, "ناشفة"
PASS 84 - advisor: "does this product contain fragrance?" answers about the named product from its list; without a product it does not guess
PASS 85 - advisor: results never exceed the cap even with many matches + excluded list capped
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
PASS advisor: "does it contain fragrance?" on an unverified list answers UNKNOWN, never "fragrance-free"; details explain used/missing info
PASS layout: no horizontal overflow or null text on every page at 360 / 390 / 768 / 1280 widths
PASS layout: fixed nav never covers the last content (bottom padding >= nav height)
console errors seen: []
PASS no unexpected console/page errors (deliberate 401/409/400 network logs excluded)
```
