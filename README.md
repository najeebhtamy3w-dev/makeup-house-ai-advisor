# MAKEUP HOUSE — مستشار الجمال (V3.0 — CP03 PARTIAL CHECKPOINT)
منصة داخلية للمدير والموظفين. **لا أسعار ولا كميات ولا مبيعات.**

## التشغيل على Windows
1. ثبّت **Node.js 22.13+** من nodejs.org.
2. في المجلد: `npm install` (يحتاج إنترنت مرة واحدة).
3. في PowerShell:
```powershell
$env:MH_ADMIN_USER="admin"; $env:MH_ADMIN_PASSWORD="كلمة-مرور-قوية-10+"
$env:MH_SECRET="سلسلة-عشوائية-طويلة"
npm start
```
4. افتح `http://localhost:8080`. (للكاميرا على الهاتف يلزم HTTPS.)
المدير ينشئ حسابات الموظفين من «المزيد ← الموظفون».

## الإثراء من المصادر العالمية (اختياري، مسودات فقط)
`MH_ENRICH=off|mock|obf` (الافتراضي off) · `MH_OBF_BASE` (افتراضي https://world.openbeautyfacts.org) · `MH_ENRICH_CONTACT` بريد للتعريف في User-Agent (مطلوب مع obf) · `MH_ENRICH_RATE_PER_MIN` (الافتراضي 12، السقف 14). **الاتصال الحي لم يُختبر** (محجوب في بيئة البناء). التفاصيل: docs/ENRICHMENT.md.

## CP03: التحقق الواقعي
حالة البوابات: **CP03_ACCEPTANCE.md**. اتصال OBF حي: `npm run live:obf -- --contact you@example.com <باركودات>` · المنتجات الخمسة: `npm run pilot -- products.csv` (docs/FIVE_PRODUCT_PILOT.md) · اختبار Samsung: افتح `/device-test.html` (docs/ANDROID_DEVICE_VALIDATION.md).

## الوثائق
CP03: EXPERT_DECISIONS.md · docs/LIVE_API_VALIDATION.md · FIVE_PRODUCT_PILOT.md · SCIENTIFIC_KNOWLEDGE_AUDIT.md · ANDROID_DEVICE_VALIDATION.md · 
docs/AUDIT_CP02.md · SCIENTIFIC_REVIEW.md · UIUX_REPORT.md · DESIGN_SYSTEM.md · ENRICHMENT.md · RESTORE.md · preview/index.html · TEST_RESULTS.md · CHANGELOG.md

## Docker
انسخ `.env.example` إلى `.env` وعدّله ثم `docker compose up -d` (**لم يُختبر Docker في بيئة البناء**).

## أوامر
`npm test` اختبارات الوحدة/التكامل · `npm run typecheck` · `npm run test:ui` (يتطلب Chromium+Playwright) · `npm run backup -- <db> <out>`
