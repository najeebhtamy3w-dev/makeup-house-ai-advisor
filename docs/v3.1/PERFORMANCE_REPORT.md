# الأداء — HOST VERIFIED / SAMSUNG NOT TESTED

توجد الأرقام الدقيقة في evidence/final-host-performance.json، وحالة native_metrics لكل prompt في نتائج التقييم. القياس المنفصل: تحميل2.99s، أول رمز4.02s،55 رمزًا في9.49s شاملة prefill، max RSS نحو1.85GiB، wall12.62s. هذه ليست أرقام هاتف.

حدود التشغيل الحالية: CPU4threads كحد أقصى؛ context2048؛ prompt<=1536؛ output384؛ batch128؛ mmap؛4 حقائق<=1300 حرف؛ تنزيلchunk256KiB؛ تحقّق hashstream1MiB؛ unload بالخلفية/ضغط الذاكرة؛ عملية native واحدة.

لا قياس Samsung للحرارة أو البطارية أو أول رمز أو الذاكرة أو20 محادثة أو cancellation latency. لا GPU/NPU مُعتمد. أهداف القبول محددة في PERFORMANCE_ACCEPTANCE_THRESHOLDS.md قبل قياس الجهاز ولا تُعد نتائج ناجحة.
