# المعمارية (V3.0-alpha)

```
Android/Chrome PWA (RTL, vanilla ES modules)  ──HTTPS──▶  Node 22 API (http + zod)  ──▶  SQLite (WAL)   [PostgreSQL twin: غير مفعّل/غير مختبر]
   js/{app,api,util,scanner}.js                         server/src/{http,routes,advisor,importer,xlsx,csv,gtin,security,db}.ts
   js/views-{core,advisor,admin}.js                      server/migrations/*.sql  (قابلة للتكرار، كل ترحيل في معاملة)
```

## الفصل المطلوب في التفويض (البند 17)
| الطبقة | الموضع الحالي | الحالة |
|---|---|---|
| Presentation | `web/` | منفذة |
| Auth & Authorization | `security.ts`, `http.ts` (`requireRole`, إعادة قراءة المستخدم من DB في كل طلب) | منفذة ومختبرة |
| Product Catalog / Store Library | `routes.ts` + جدول `products` | منفذة (الفصل بين «المعرفة العالمية» و«مكتبة المحل» منطقي حاليًا: `product_facts` جاهز للمصدر/الثقة لكنه غير مستخدم بعد) |
| Product Enrichment | — | **غير منفذة**؛ الواجهة ترد `enrichment: not_configured` صراحة |
| Availability | `routes.ts` + `presentProduct` | منفذة ومختبرة |
| AI Consultation / Retrieval | `advisor.ts` | **استرجاع حتمي فقط، بلا LLM** |
| Import Processing | `importer.ts`, `xlsx.ts`, `csv.ts` | منفذة (متزامنة؛ 5000 صف مختبرة)؛ Background Jobs غير منفذة |
| Reporting & Audit | `audit_log`, `/api/reports/summary`, `/api/requests/summary` | منفذة جزئيًا |

## قيود ثابتة وكيف تُفرض
* **لا أسعار/كميات/مالية:** (1) كل مخططات zod `.strict()` فأي حقل غريب = 400؛ (2) لا أعمدة مالية في المخطط وهناك اختبار يفحص `pragma_table_info` لكل الجداول؛ (3) الاستيراد لا يقرأ إلا قائمة بيضاء من الأعمدة ويسجّل **أسماء** الأعمدة المهملة فقط؛ (4) اختبار يتأكد أن قيم الأسعار لا تظهر في DB/سجلات.
* **لا اختلاق:** المستشار لا يعرض إلا حقولًا مخزنة؛ منتج بلا مكونات موثقة يذهب إلى «لا يمكن تقييمها» عند طلب «بدون عطر».
* **التوفر:** `availability_effective` = `unknown` إذا كان التأكيد أقدم من `MH_AVAILABILITY_STALE_HOURS` (24 افتراضيًا).
* **الصلاحيات على الخادم:** كل مسار يعلن `none|any|manager`؛ الواجهة تخفي القوائم فقط للراحة.

## تقييم الاستضافة (Netlify)
Netlify يستضيف **الواجهة الثابتة** (`web/`) فقط. الخادم يحتاج عملية Node دائمة وتخزينًا ثابتًا، وهو ما لا توفره Netlify Functions (بلا حالة ولا ملفات دائمة). خيارات مفصّلة في `docs/DEPLOYMENT.md`. **لم يُنشأ أي حساب أو موقع أو مورد مدفوع.**
