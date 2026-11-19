# تدقيق الفجوات — MAKEUP HOUSE AI BEAUTY ADVISOR V3.0 (بعد CP03–CP05)

**تاريخ التدقيق:** 2026-11-19 · **المصدر المدقق:** `cp03-cloud-staging` @ `1040aac` (= ما تخدمه Staging فعليًا: `/api/meta` → `3.0.0-cp05.5-staging`, commit `1040aac`) · **فرع التدقيق:** `cp05-final-audit`

## 0. حالة المصدر والفروع (مُتحقق منها)
| العنصر | الحالة |
|---|---|
| `main` | `d33fc10` (CP03 PARTIAL) — **متأخر 10 commits** عن Staging |
| `cp03-cloud-staging` | `1040aac` — يحتوي كل CP03→CP05؛ هو مصدر Render |
| PR #1 (Staging → `main`) | **مفتوح**، غير مدموج |
| PR #2–#7 | مدموجة في فرع Staging (دمج سريع) |
| الوسوم `alpha1`, `cp02`, `cp03-partial` | **غير موجودة على GitHub** (رُفض دفعها 403 في CP03؛ معلّق على المالك) |
| Render | يخدم `1040aac` (تحقق خارجي من `/api/meta`) |

## 1. الاختبارات المنفذة في هذا التدقيق (نتائج فعلية على `1040aac` + إصلاح التدقيق)
| الفحص | النتيجة |
|---|---|
| `npm run typecheck` | نظيف |
| `npm test` (10 ملفات) | **118/118** (117 + اختبار أداء جديد) |
| `npm run test:ui` (Chromium، قاعدة مؤقتة) | **49/49** |
| `npm run test:ui:empty` (قاعدة معزولة + إعادة تشغيل فعلية) | **9/9** |
| `scripts/perf-audit.ts 10000` (قاعدة مؤقتة تُحذف بعد القياس) | انظر §6 |
| فحص الرابط الحي دون دخول | 9/9 (آخر تشغيل بعد نشر `1040aac`) |
| فحص الرابط الحي بعد الدخول | **لم يُنفذ** — يحتاج بيانات دخول المالك |
| جهاز Samsung حقيقي | **لم يُنفذ** |

مفتاح الحالات: **VERIFIED** = منفذ وله اختبار آلي ناجح · **LIVE PENDING** = لم يُختبر على الرابط الحي بعد الدخول · **DEVICE PENDING** = يحتاج Samsung حقيقي · **PARTIAL** · **NOT IMPLEMENTED** · **BLOCKED** · **DEFECT**.

## 2. إدارة المنتجات
| الوظيفة | الحالة | الملفات / الدوال | الدليل | القيود |
|---|---|---|---|---|
| إضافة منتج | VERIFIED · LIVE PENDING · DEVICE PENDING | `routes.ts` `POST /api/products`؛ `views-core.js` `productEdit` | api.test، ui «rapid entry»، «optional details» | — |
| الحفظ ثم نموذج فارغ تلقائيًا | VERIFIED · DEVICE PENDING | `productEdit` (`saveMode='next'`) | ui «rapid entry… focus on barcode» | — |
| «حفظ وفتح البطاقة» | VERIFIED | `openBtn` | ui CP05.3 | — |
| **حفظ كمسودة (حالة على الخادم)** | **NOT IMPLEMENTED** (قرار) | — | قرار 38 | البديل: حفظ تلقائي محلي (`sessionStorage`) + كل منتج جديد «تحتاج مراجعة» |
| حفظ تلقائي للعمل غير المحفوظ | VERIFIED · DEVICE PENDING | `saveDraft` / `DKEY` | ui «unsaved… restored» | داخل نفس جلسة المتصفح فقط |
| تعديل منتج موجود في مكانه | VERIFIED | `PATCH /api/products/:id` | taxonomy.test 4، ui «editing… in place» | — |
| الحقول الاختيارية (حجم، INCI، فوائد، تحذيرات) | VERIFIED | `productInput` (`.default('')`, `.trim()`)، DB `NOT NULL DEFAULT ''` | optional-details.test ×5، ui ×2 | — |
| التصنيف الموحد (فئة/نوع/منطقة/وظيفة) | VERIFIED | `taxonomy.ts`، migration 005 | taxonomy.test ×7 | التصنيف مُدار في الكود (لا شاشة إدارة) |
| أنواع المنتجات وشبكة «المزيد…» | VERIFIED · DEVICE PENDING | `drawTypes`، `picker.js` | ui CP05.3 (كريم ≠ كريم أساس) | — |
| تحويل التصنيف للمنتجات القائمة | VERIFIED (API فقط) | `POST /api/taxonomy/suggest-existing` | taxonomy.test 6 | **PARTIAL**: لا زر في الواجهة |
| قائمة مضغوطة + صفحات | VERIFIED | `products()`، `view=compact` | taxonomy.test 3، ui | — |
| البحث والمرشحات والأعداد | VERIFIED | `productFilter`، `/api/products/facets` | taxonomy.test 3 (العدد = النتائج) | — |
| منع التكرار (باركود، نقر مزدوج، إعادة محاولة) | VERIFIED | `client_ref` + فهرس فريد، 409 للباركود | taxonomy.test 4، ui | — |
| حماية البيانات عند فشل الحفظ | VERIFIED | `save()` catch | ui «save failure keeps everything» | لا طابور حفظ دون اتصال |
| قائمة فارغة عند صفر منتجات | VERIFIED · LIVE PENDING | `emptycat` | ui-empty ×9 | — |
| **المقارنة والروتين والرئيسية مع >500 منتج** | **DEFECT** (حجم) | `views-advisor.js:91,120`، `views-core.js:50` (`limit=500`) | قراءة الكود | المنتجات بعد أول 500 (بترتيب التحديث) لا تظهر في المقارنة/الروتين، وعدّادات الرئيسية تُحسب من 500 فقط |

## 3. الصور والتعرف
| الوظيفة | الحالة | الملفات | الدليل | القيود |
|---|---|---|---|---|
| التصوير المباشر (الكاميرا الخلفية) | VERIFIED (محاكاة) · **DEVICE PENDING** | `images.js` `pickImage('camera')` | ui (`capture=environment`) | لم يُجرَّب على Samsung |
| الاختيار من الاستوديو + معاينة + إعادة الالتقاط | VERIFIED · DEVICE PENDING | `processImage`، `previewSheet` | ui images | — |
| ضغط/اتجاه/إزالة EXIF | VERIFIED (Chromium) · DEVICE PENDING | `processImage` | ui (إعادة ترميز WebP/JPEG) | الاتجاه الحقيقي من كاميرا Samsung لم يُجرَّب |
| صورة لمنتج محفوظ، رئيسية وإضافية، حذف، صلاحيات | VERIFIED | `images.ts` | images.test ×5 | 8 صور/منتج |
| العرض بالحجم الكامل | VERIFIED | `viewImage` | ui | — |
| صورة من الإنترنت (OBF) + المصدر والترخيص | VERIFIED (محاكاة) + تجربة حية واحدة في CP04 | `approveImageCandidate` | images.test 4؛ CP04 حي (CeraVe) | الصورة من سجل الباركود فقط |
| البحث عن صورة بالاسم دون باركود | **NOT IMPLEMENTED** (قرار) | — | قرار CP04 | خطر هوية |
| التعرف بالباركود | VERIFIED · حي في CP03/CP05 | `discovery.ts` `identify` | cp05.test 1؛ اتصال حي موثق | تغطية OBF جزئية |
| البحث بالاسم/العلامة مع أسباب المطابقة والحجم | VERIFIED · حي في CP05 | `searchByName`، `matchReasons` | cp05.test 2؛ حي «Nivea Creme» | ترتيب المصدر غير موثوق |
| **التعرف البصري / OCR** | **NOT IMPLEMENTED** | — | لا كود | يحتاج قرار المالك (قرار 14) |
| المراجعة قبل الاعتماد | VERIFIED | `reviewCandidate`، `views-review.js`، `discovery.js` | enrichment.test، ui review | — |

## 4. الاستيراد والإثراء
| الوظيفة | الحالة | الدليل | القيود |
|---|---|---|---|
| CSV وXLSX | VERIFIED | api.test 29–33 | محلل XLSX داخلي محدود (لا معادلات/أوراق متعددة) |
| دون صور/مكونات | VERIFIED | cp05.test 6 | — |
| الباركود نصًا والأصفار | VERIFIED | cp05.test 6، taxonomy.test 5 | لا يُستعاد ما حذفه Excel قبل الرفع (تحذير) |
| منع التكرار (بباركود/بدونه) | VERIFIED | cp05.test 6–7 | الصف المبهم يُعرض «مشابه محتمل» ولا يُستورد |
| تقارير الاستيراد | VERIFIED | ui import | تُعرض في الشاشة فقط (لا سجل تقارير قابل للتنزيل) |
| نوع المنتج في الاستيراد | VERIFIED | taxonomy.test 5 | — |
| 10,000 صف | VERIFIED (قياس) | perf-audit: 10,000 صف في **0.19 ث** محليًا | الحد 10,000 صف/8 م.ب |
| الإثراء الفردي | VERIFIED | cp05.test، ui | — |
| الإثراء الجماعي (طابور) | VERIFIED (منطق) · **PARTIAL تشغيليًا** | enrichment.test 58–59؛ `server.ts:53` | على Render المجاني يسكن الخادم فيتوقف الطابور |
| حماية البيانات المعتمدة | VERIFIED | enrichment.test 54، cp05.test 7 | — |
| حفظ مصدر كل معلومة | VERIFIED | `product_facts`، `product_images.source_*` | لا شاشة تعرض سجل المصدر لكل حقل |

## 5. المستشار التجميلي
**طبيعته:** محرك استرجاع وقواعد (`advisor.ts`) + قاعدة معرفة مكونات (`science/knowledge.ts`) **غير مراجَعة من مختص** + تقييم ملاءمة (`science/suitability.ts`). **لا يوجد مزود ذكاء اصطناعي مفعّل** (`llm:false`؛ `ai/provider.ts` واجهة وحارس فقط).

| الوظيفة | الحالة | الدليل | القيود |
|---|---|---|---|
| العربية واللهجة اليمنية الشائعة | VERIFIED (عيّنة) | advisor.test 1، science 83 | قائمة تعبيرات محدودة، لا فهم لغوي عام |
| الاسترجاع بالمواضيع والنوع | VERIFIED | taxonomy.test 7 | — |
| تحليل المكونات/العطر/المواد المتجنبة | VERIFIED (منطق) | science.test ×17 | **المعرفة غير مراجعة من مختص** → الحد الأعلى «قد يكون مناسبًا» |
| شرح أسباب التوصية والمعلومات الناقصة | VERIFIED | science 81 | — |
| الفصل بين التوفر والملاءمة | VERIFIED | advisor.test 3 | — |
| المنتجات ناقصة المعلومات | VERIFIED | optional-details.test 3 | — |
| المقارنة | VERIFIED (≤500) · **DEFECT** فوق 500 | ui compare | انظر §2 |
| الروتين | PARTIAL | ui routine | مطابقة بالاسم/الفئة فقط، لا يستخدم التصنيف الجديد؛ ≤500 |
| البدائل العالمية غير المسجلة | NOT IMPLEMENTED | `global_alternatives: not_configured` | — |
| **الأداء مع كتالوج كبير بمكونات** | **DEFECT → مُصلح في هذا التدقيق** | perf.test 3: قبل الإصلاح 5.5 ث (فشل)، بعده يمر؛ perf-audit: 8–9.5 ث ← 0.3 ث | السبب: حساب «البدائل» لكل منتج مطابق مقابل كل الآخرين (O(n²)) قبل الاقتصار على أفضل 8 |

## 6. البيانات والتخزين — ملخص (التفاصيل في DATA_PERSISTENCE_OPTIONS.md)
| البند | الحالة |
|---|---|
| قاعدة البيانات | SQLite مدمجة في Node (`node:sqlite`)، ملف واحد `MH_DB_PATH` (`/data/makeup-house.db` في الصورة) |
| الصور | داخل نفس ملف SQLite (BLOB) — قياس: **~252 ك.ب/صورة** → صورة واحدة لكل من 10,000 منتج ≈ **2.4 GB** |
| Render (الحالي) | **قرص مؤقت**: كل البيانات (منتجات، صور، مستخدمون غير المدير) تُفقد عند السكون/إعادة التشغيل/النشر — **BLOCKER للتشغيل الحقيقي** |
| النسخ الاحتياطي | سكربت `scripts/backup.ts` (VACUUM INTO + integrity_check) مختبر (api.test 44) — **غير مجدول، ولا يعمل على Render المجاني** |
| الاستعادة | `docs/RESTORE.md` **قديم** (Windows، 85/85) |
| الترحيلات | 001–005 إضافية؛ ترقية قاعدة قديمة ببيانات مُختبرة (CP05.2) |

## 7. الأمان والصلاحيات
| البند | الحالة | الدليل |
|---|---|---|
| مصادقة (scrypt + رمز HMAC 12 ساعة) | VERIFIED | api.test 12، 15 |
| صلاحيات المدير/الموظف على الخادم | VERIFIED | api.test 17–18، 25–26، images.test 3 |
| حماية الرفع (نوع من البايتات، حجم، أبعاد، عدد، SSRF) | VERIFIED | images.test 1–3 |
| الأسرار عبر متغيرات Render | VERIFIED (تصميم) | `render.yaml` |
| سجل التدقيق | **PARTIAL** | يُكتب (`audit_log`) لكن **لا واجهة/API لعرضه**، ومحاولات الدخول الفاشلة **لا تُسجَّل** |
| قفل الدخول بعد 5 محاولات | VERIFIED · **خطر** | api.test 16 — من يعرف اسم المدير يستطيع قفله 10 دقائق |
| استبعاد الأسعار/الكميات/المالية | VERIFIED | api.test 20–21، 31، 38، cp05/taxonomy (أعمدة) |
| التوفر yes/no/unknown (= AVAILABLE/UNAVAILABLE/UNKNOWN) | VERIFIED | api.test 28 |

## 8. Samsung
كل وظائف الكاميرا والمعرض والباركود والشاشات **مختبرة بالمحاكاة فقط (Chromium)**. لم تصل نتائج «قائمة اختبار Samsung» من المالك بعد. انظر `SAMSUNG_ACCEPTANCE_CHECKLIST.md`.

## 9. تغييرات هذا التدقيق (صغيرة ومعزولة)
1. `server/src/advisor.ts`: حساب «البدائل» لأفضل 8 معروضة فقط (النتائج المعروضة نفسها). + اختبار `tests/perf.test.ts` (3).
2. `scripts/perf-audit.ts`: أداة قياس على قاعدة مؤقتة تُحذف بعد القياس.
