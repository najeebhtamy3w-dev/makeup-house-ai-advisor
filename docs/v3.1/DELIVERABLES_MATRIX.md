# مصفوفة التسليم

|#|المطلوب|الحالة|الملف/الدليل|
|---:|---|---|---|
|1|المصدر المحدث|IMPLEMENTED|المستودع وSOURCE ZIP|
|2|فرع GitHub|VERIFIED|work-local-ai-final-release؛ تتم مطابقة الشجرة عند التسليم|
|3|commit النهائي|VERIFIED عند التسليم|DELIVERY_MANIFEST.json|
|4|استعادة المصدر|VERIFIED|SOURCE_RECOVERY_AND_BASELINE_REPORT.md|
|5|إعادة البناء|VERIFIED|ENVIRONMENT_SETUP_AND_BUILD_REPRODUCIBILITY.md|
|6|الأساس|PASSED|baseline185 وREGRESSION_TEST_REPORT.md|
|7|حفظ الوظائف|VERIFIED/PARTIAL|FEATURE_PRESERVATION_MATRIX.md|
|8|البحث المفتوح|VERIFIED|OPEN_SOURCE_DISCOVERY_AND_SELECTION_REPORT.md|
|9|قرار المكونات|VERIFIED|OPEN_SOURCE_COMPONENT_DECISION.md|
|10|التبعيات والتراخيص|VERIFIED/PARTIAL|DEPENDENCY_AND_LICENSE_INVENTORY.md|
|11|اختيار/benchmark|HOST VERIFIED|MODEL_SELECTION_AND_BENCHMARK_REPORT.md|
|12|PoC حقيقي|PASSED HOST|native/poc.cpp ونتائج GGUF؛ Android NOT TESTED|
|13|runtime|IMPLEMENTED|native/runtime.* وELF ARM64 فيAPK|
|14|جسر Capacitor|IMPLEMENTED|LocalAIPlugin.java + bridge.cpp|
|15|خدمة TypeScript|IMPLEMENTED|mobile/src/local-ai.ts|
|16|مدير النموذج|IMPLEMENTED / NOT TESTED DEVICE|Java plugin وviews-local-ai.js|
|17|manifest مثبت|VERIFIED|native/model-manifest.json؛ size+SHA مطابقان|
|18|RAG محلي|IMPLEMENTED|server/src/local-ai.ts|
|19|السلامة العلمية|PASSED في النطاق المختبر|حتمي قبل وبعد؛ لا قبول بشري شامل|
|20|تكامل المنتجات|PARTIAL|PRODUCT_INTELLIGENCE_INTEGRATION_REPORT.md|
|21|هجرة DB|VERIFIED|DATABASE_MIGRATION_REPORT.md؛ لا حذف أوmigrationتخريبي|
|22|تقييم العربية|PARTIAL|ARABIC_INTELLIGENCE_EVALUATION.md|
|23|الانحدار|PASSED|191/191 وUI/local suites|
|24|اختبارات native|PASSED HOST / NOT TESTED DEVICE|NATIVE_AI_TEST_REPORT.md|
|25|الأمن|PARTIAL|SECURITY_ACCEPTANCE_REPORT.md|
|26|بناء Android|PASSED|ANDROID_BUILD_REPORT.md|
|27|الأداء|HOST VERIFIED / NOT TESTED DEVICE|PERFORMANCE_REPORT.md|
|28|النسخ والاستعادة|PASSED Chromium|BACKUP_AND_RESTORE_REPORT.md|
|29|استمرار التحديث|PASSED DATA / NOT TESTED APK|UPDATE_CONTINUITY_REPORT.md|
|30|التوقيع والحيازة|VERIFIED OLD / BLOCKED NEW|SIGNING_AND_CUSTODY_REPORT.md|
|31|APK فعلي|PASSED BUILD|Unsigned + Debug؛ Signed release BLOCKED|
|32|بصماتAPK|VERIFIED|SHA256SUMS-3.1.0-RC1.txt|
|33|SOURCE ZIP|VERIFIED عند التسليم|حزمة مصدر كاملة وأدلة دون مفاتيح/أوزان|
|34|قبولSamsung|NOT TESTED|SAMSUNG_ACCEPTANCE_V3_1.md|
|35|القيود|VERIFIED|KNOWN_LIMITATIONS_AND_BLOCKERS.md|
|36|الاستئناف|IMPLEMENTED|IMPLEMENTATION_CONTINUATION.md|
|37|التوصية|CONDITIONAL TEST CANDIDATE|FINAL_IMPLEMENTATION_REPORT_AR.md|
