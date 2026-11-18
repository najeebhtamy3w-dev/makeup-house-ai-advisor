# MAKEUP HOUSE — مستشار الجمال (V3.0-alpha)
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

## Docker
انسخ `.env.example` إلى `.env` وعدّله ثم `docker compose up -d` (**لم يُختبر Docker في بيئة البناء**).

## أوامر
`npm test` اختبارات الوحدة/التكامل · `npm run typecheck` · `npm run test:ui` (يتطلب Chromium+Playwright) · `npm run backup -- <db> <out>`
