# التشغيل والاستعادة (Windows)
1. ثبّت Node 22 أو أحدث (`node -v`).
2. فك الضغط ثم داخل المجلد: `npm install` (يحتاج إنترنت).
3. `npm run typecheck` ثم `npm test` (يجب 65/65).
4. في PowerShell: `$env:MH_ADMIN_USER="admin"; $env:MH_ADMIN_PASSWORD="<قوية 10+>"; $env:MH_SECRET="<عشوائية طويلة>"`. (`npm run seed:dev` للتطوير فقط — بيانات اعتماد معروفة، لا تستخدمها في الإنتاج.)
5. التشغيل: `npm start` ثم افتح `http://localhost:8080` (المتغير `PORT`).
6. إثراء تجريبي: `$env:MH_ENRICH="mock"`. حقيقي: `$env:MH_ENRICH="obf"` و`$env:MH_ENRICH_CONTACT="you@example.com"` (غير مختبر حيًا).
## من حزمة Git
`git clone makeup-house-cp02.bundle makeup-house` ثم الخطوات أعلاه.
## النسخ الاحتياطي
`npm run backup -- <db> <out>` ينتج نسخة `VACUUM INTO` مع فحص سلامة. للاستعادة: أوقف الخادم، استبدل ملف قاعدة البيانات بالنسخة، شغّل.
