# Five Real Products Pilot (CP03, Phase C)
**Gate C: PENDING REAL PRODUCT INPUT — المرحلة غير مكتملة.** لم تتوفر باركودات/بيانات منتجات حقيقية من ميك أب هاوس؛ لم أخترع أي منتج أو باركود.

## ما جُهّز
1. نموذج الإدخال: `docs/pilot/five_products_template.csv` — `barcode,name,brand,size,variant,inci_from_pack,packaging_photo_file,market_country,notes` (يُملأ من العبوة نفسها). يفضَّل التنوع: عناية بشرة، تنظيف، ترطيب، واقي شمس، شعر، تجميل.
2. المشغّل: `npm run pilot -- products.csv` (يحتاج خادمًا يعمل + `MH_URL/MH_USER/MH_PASS` وإنترنت للمصدر الحي).
   لكل منتج: فحص GTIN ← بحث محلي ← بحث عالمي ← مطابقة الهوية (اسم/علامة/حجم: exact/partial/conflict) ← مقارنة قائمة المكونات بما على العبوة ← حالة المصدر ← الاعتماد (دائمًا «يحتاج مراجعة» حتى يعتمد المدير يدويًا) ← الحكم `FORMULATION NOT VERIFIED` ما لم يتطابق الاسم والحجم والمكونات مع العبوة.
3. تقارير: `pilot-report.json` / `.md` (Found/Not Found، Exact/Partial/Conflict، Ingredients Available/Missing، Source Verified/Unverified، Approved/Needs Review، Error).

## ما اختُبر فعليًا (اختبار الأداة فقط — **ليس** المرحلة)
تشغيل المشغّل على خادم بوضع `MH_ENRICH=mock` وCSV تجريبي صريح التسمية (TOOL SELF-TEST): النتائج exact / conflict (حجم 75 مل مقابل 100 مل) / not_found، وتُوسم بيانات المحاكاة `mock_data_not_a_source` و`MOCK DATA — not a real result`. هذه ليست نتائج منتجات حقيقية.

## قواعد المطابقة المنفذة والمختبرة (`identity.ts`)
حجم بالوحدات (`200ml = 200 مل = ٢٠٠ مل`، لتر/مل، أونصة) • اسم بتشابه رموز (variant/درجة ⇒ partial) • علامة مختلفة ⇒ conflict • INCI: نفس القائمة exact، نفس المكونات بترتيب مختلف partial (الترتيب يدل على التركيز النسبي)، قائمة مختلفة conflict • تطابق `product.code` للمصدر مع الباركود • لا يكفي تشابه الاسم لإثبات التركيبة.
**الصور:** معطلة (CC BY-SA). **السوق/الإصدار:** يُسجَّل `market_country` و`variant` في النموذج للمراجعة اليدوية؛ OBF لا يعيد حقل إصدار منظمًا فلا مطابقة آلية له.

## المطلوب منك
املأ 5 صفوف من العبوات (باركود، الاسم، العلامة، الحجم، ومكونات INCI المطبوعة إن وُجدت) ثم نفّذ `npm run pilot` من جهاز له إنترنت، أو أرسل الصفوف لأشغّلها حين يتوفر الاتصال.
