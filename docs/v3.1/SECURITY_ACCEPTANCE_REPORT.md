# القبول الأمني — PARTIAL

PASSED بالاختبارات: صلاحيات API؛ تذكرة تحقق مرتبطة بالمستخدم ولمرة واحدة؛ محاولة ثانية فقط؛ رفض claimed sources مجهولة؛ إدراج instruction/URL؛ كلمات diagnosis/promises؛ نفي متغير؛ metadata IDs ورفض paths/fields إضافية؛ npm audit0 بعد ترقية Zod. اختبارات المصدر السابقة للمراجعة والأدوار محفوظة.

VERIFIED بالبناء/الفحص: إصدار غير debuggable؛ INTERNET وCAMERA فقط؛ lib ARM64 مع16KB alignment؛ لا أوزان أو مفاتيح توقيع داخل APK. لا إرسال استشارات إلى خدمة ذكاء سحابية. plugin يراجع الدور عبر العامل المحلي لكل طلب، وهذا يعتمد على حد الثقة القائم داخل WebView؛ ليس مصممًا لحماية التطبيق بعد اختراق JavaScript ذاته.

IMPLEMENTED: مصدر/حجم/SHA مثبت؛ HTTPS فقط؛ redirects محدودة؛ Content-Range مضبوط؛ حد حجم؛ private noBackupFilesDir؛ لا URL أو filename يحدده الموظف؛ تثبيت rename ذري؛ queue native واحدة؛ cancellation atomic؛ metadata/audit دون مخرجات مرفوضة كأدلة.

NOT TESTED: pentest مستقل، fuzzing وASAN شاملان، native memory pressure/Activity races على Samsung، كل ثغرات upstream/CVE عبر مراجعة مستقلة. npm audit لا يغطي native أو SDK. لا blanket security certification.

عُزل خلل في كود الدمج الجديد: إدخال ChatML كان يمكن أن ينشئ رأس system ثانيًا أثناء tokenization. اختبار قبل الإصلاح دلّ على 2 بدل 1؛ أُصلح بترميز < و> كـJSON Unicode في كل الحقول غير الموثوقة، وعاد الاختبار أخضر. سجل chat-template-regression-before.log محفوظ.
