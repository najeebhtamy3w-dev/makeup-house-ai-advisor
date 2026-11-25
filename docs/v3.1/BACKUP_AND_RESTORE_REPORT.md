# النسخ والاستعادة

PASSED حديثًا في Chromium/SQLite WASM: MHBAK2 streaming ورفض كلمة مرور خاطئة/تلاعب/truncation وترتيب frames وextra bytes مع بقاء البيانات؛ MHBAK1 schema001–007 يهاجر إلى المخطط الحالي. أعيد اختبار100 صنف، ومرة100 صنف بصور؛ stress1000/2500 لم يعد هنا، ونتائجه القديمة REPORTED فقط.

PASSED: backup للمراجعة العلمية ومفتاح تفعيل المستشار وlocal_ai_metadata؛ restore على ملف OPFS جديد يعيدها. weights ليست في DB وتوضع native في noBackupFilesDir؛ لا تنزل أو تُفعّل تلقائيًا من backup. غياب الوزن يؤدي إلى الاستمرار بالقواعد.

NOT TESTED على الهاتف: الحالات الفعلية model-installed/model-removed/استعادة جهاز آخر مع مخزن native وshared preferences؛ تدوير lifecycle أثناء restore. لا تعد نتيجة Chromium اختبار Samsung.
