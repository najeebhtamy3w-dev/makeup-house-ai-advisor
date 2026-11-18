# الخطوات التالية (بالأولوية)
1. `npm run live:obf -- --contact <بريدك> <3–5 باركودات حقيقية>` من جهاز متصل ← أرسل `obf-live-report-*.json` ← تصحيح الموصل ← اعتبار Gate B VERIFIED فقط إن اطابقت الحقول.
2. املأ `docs/pilot/five_products_template.csv` من 5 عبوات ← `npm run pilot` ← مراجعة المدير ← Gate C.
3. اختبار Samsung (+HID) وفق docs/ANDROID_DEVICE_VALIDATION.md وإرسال تقرير JSON ← Gate D.
4. مراجعة مختص (تجميل/صيدلة) لـ `server/src/science/knowledge.ts` والاحتياطات والأكاديمية؛ يضع `expert_reviewed` + المراجِع + التاريخ لكل سجل.
5. قراءة شروط الاستخدام والإسناد الكاملة لـOpen Beauty Facts (مراجعة قانونية) قبل أي عرض للبيانات/الصور.
6. قياس أداء المستشار على كتالوج كبير **مع** قوائم مكونات؛ تصفية SQL مسبقة عند الحاجة.
7. دين تقني: تقسيم routes.ts، ترقيم صفحات، تسجيل محاولات الدخول الفاشلة، Docker/PostgreSQL، `npm audit`.
8. قرارك: مزود LLM (اختياري ولا شيء مفعّل)، خطة النشر.
