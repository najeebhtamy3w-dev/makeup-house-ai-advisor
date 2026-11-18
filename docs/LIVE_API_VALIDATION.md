# Live API Validation — Open Beauty Facts (CP03, Phase B)
**Gate B: BLOCKED** (لا اتصال حي. لا يُعلن نجاح التكامل. حالة Live Integration = معلّق).

## 1) محاولة الاتصال الحي (2026-11-18 ≈21:50 UTC)
| البند | النتيجة |
|---|---|
| Endpoint | `https://world.openbeautyfacts.org/api/v3/product/{code}?product_type=beauty&fields=…` |
| HTTP Status | **لا يوجد** — فشل نفق `CONNECT` قبل الوصول إلى المصدر: `curl: (56) CONNECT tunnel failed, response 403` |
| مصدر المنع (دليل) | `GET $HTTPS_PROXY/__agentproxy/status` → `recentRelayFailures`: `kind: connect_rejected`, `gateway answered 403 to CONNECT (policy denial or other refusal)`, `host: world.openbeautyfacts.org:443` |
| الاستنتاج | الرفض صادر عن **بوابة الخروج في بيئة البناء (سياسة)**، لا عن Open Beauty Facts؛ لم يصل أي طلب إلى المصدر. لم أتجاوز القيد (لا بدائل curl/mirror/cache) وفق التعليمات. |
| Content-Type / Time / Fields / Barcode match | غير متاحة (لا استجابة) |
| أداة Node (`fetch`) | `Unreachable:network` — الأداة نفسها لا تستخدم وكيل البيئة؛ لا دلالة إضافية |

## 2) مراجعة الوثائق الرسمية (محققة عبر WebFetch/WebSearch)
| النقطة | الحالة | المصدر |
|---|---|---|
| إصدار API | **v3 موصى به؛ v2 مُهمَل (deprecated)** → صُحّح الموصل من v2 إلى v3 | openfoodfacts.github.io/openfoodfacts-server/api/ |
| مسار الباركود | `GET /api/v3/product/{code}` ✔ | documentation …/v3/products/get-api-v3-product-code/ |
| المعاملات | `fields` (قائمة مفصولة بفواصل)، `lc`, `cc`, `tags_lc`, `product_type` (`beauty|food|petfood|product|all`) ✔ | نفس الصفحة |
| شكل الاستجابة | `status` ∈ {`success`,`success_with_warnings`,`success_with_errors`,`failure`}، `result`, `warnings`, `errors`, `product` ✔ | نفس الصفحة |
| غير موجود | HTTP **404** ✔ (محتوى الجسم غير موصوف) | نفس الصفحة |
| User-Agent | `AppName/Version (ContactEmail)` ✔ | api/ |
| الحدود | **15 طلب/دقيقة/IP لقراءة المنتج؛ 10/دقيقة للبحث**؛ «لا تستخدمه للبحث أثناء الكتابة»؛ لأكثر من بضع مئات منتج: نزّل CSV/JSONL | api/ |
| الترخيص | قاعدة البيانات ODbL، المحتويات DbCL، **الصور CC BY-SA** (وقد تحوي عناصر محمية) | api/ |
| الإسناد | صفحة API لا تذكر متطلبًا مفصلًا؛ تحيل إلى «Terms of use and reuse» وويكي ODbL — **لم تُقرأ** | — |
**غير محقق:** اسم مضيف Open Beauty Facts الرسمي للإنتاج (صفحة openbeautyfacts.org/data خارج القائمة المسموحة؛ يُستخدم `world.openbeautyfacts.org` وهو قابل للضبط عبر `MH_OBF_BASE`)، جسم الاستجابة الحقيقي عند 404، وصفحة الشروط الكاملة.

## 3) ما تغيّر في الكود (Level 1/2)
* الموصل: v3 + `product_type=beauty`؛ يقبل `status` النصي ويتسامح مع الرقمي القديم؛ **أي شكل غير متوقع = `Unreachable('bad_shape')` وليس «غير موجود»** (لئلا يُخفي تغيّر API)؛ **تحقق هوية: `product.code` ≠ الباركود المطلوب ⇒ ليس منتجنا**.
* `MH_OBF_BASE` للمضيف. الاختبارات: v3، failure، v2 القديم، شكل مفاجئ، نص خام، كود مختلف.
* **تنبيه صدق:** الاختبارات تعتمد على ردود **بالشكل الموثق** وليست استجابات حقيقية مسجّلة.

## 4) أداة الاختبار المستقلة لـ Windows — جاهزة ولم تُشغَّل حيًا
```powershell
cd makeup-house
npm install
# استخدم باركودات منتجات حقيقية عندك (لا توجد أمثلة مختلقة). الأداة تنتظر 5 ثوانٍ بين الطلبات.
npm run live:obf -- --contact you@example.com 6291041500213 <باركود2> <باركود3>
# النتيجة: obf-live-report-<وقت>.json  (endpoint, HTTP, content-type, ms, الحقول, تطابق الباركود, حكم الموصل)
```
أرسل ملف التقرير. إن ظهر `LIVE_REACHED` يُراجَع شكل الحقول يدويًا قبل اعتبار البوابة VERIFIED.
