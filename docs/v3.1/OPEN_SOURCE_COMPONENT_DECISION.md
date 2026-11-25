# قرار المكونات

IMPLEMENTED: llama.cpp v1.0.0، C++17، JNI، Capacitor Java plugin، TypeScript service؛ CPU ARM64 محافظ؛ threads<=4، context2048، prompt<=1536، batch128، output<=384؛ mmap؛ ناتج JSON مقيد بـgrammar؛ تسلسل عمليات native وإلغاء ذري.

البدء التجريبي كان b6500 مع Qwen3-1.7B. بعد قياس محدود انتقل التنفيذ إلى الإصدار الثابت الأحدث الذي يدعم Qwen3.5. مصدر الإصدار الفعلي b1b770d يختلف عن target_commitish في metadata الخاصة بالـrelease؛ الـpin يطابق checkout الوسم الفعلي. SHA256 لأرشيف المصدر `ae8556670b17c25931cd39eb7c95617650eaf6091bbcff206750583ddde1acb4`.

المرشح الحالي Qwen3.5-2B-Q4_K_M، تحويل Unsloth، الأصل Qwen/Qwen3.5-2B. لم تُستخدم أوزان مجهولة البصمة. المفاضلة قيّمت توليفات runtime/model لا عدد المعاملات وحده. لا دليل GPU/NPU على Samsung؛ لم يُفرض دعم عتاد غير متحقق.

تجنبنا نسخ تطبيق محادثة كامل؛ لا تبديل للهوية أو Capacitor أو SQLite. إدارة التنزيل خاصة بالتطبيق لأن صلاحيات العامل/المدير والتثبيت الذري والبصمة ومكان noBackupFilesDir تحتاج ربطًا صغيرًا بالسياق الحالي. لا تنزيلات arbitrary ولا paths من المستخدم.
