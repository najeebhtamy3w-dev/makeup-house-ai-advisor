# التبعيات والتراخيص

| المكون | الإصدار/المصدر | الترخيص/الحالة |
|---|---|---|
| llama.cpp / GGML | v1.0.0؛ b1b770d | MIT؛ النص محفوظ في native/LLAMA_LICENSE وAPK THIRD_PARTY_NOTICES |
| Qwen3.5-2B | Qwen؛ GGUF Unsloth عند f6d5376be1edb4d416d56da11e5397a961aca8ae | Apache-2.0 بحسب model metadata؛ تنزيل منفصل، لا وزن داخل APK |
| Qwen3-1.7B التجريبي | ggml-org artifact daeb8e2 | Apache-2.0؛ مقيّم وغير مختار |
| Qwen2.5-1.5B التجريبي | Qwen artifact 91cad511 | Apache-2.0؛ مقيّم وغير مختار |
| Capacitor core/android/CLI | 8.6.2 | MIT؛ البنية الأصلية |
| Zod | 4.6.7 بدل3.25.76 | MIT؛ إصلاح GHSA-mrhx-c7xc-m3w5 مع حفظ سلوك PATCH |
| SQLite WASM / بقية npm | النسخ الدقيقة في package-lock.json | التفصيل في evidence/npm-license-inventory.json؛ لم تبدل قاعدة البيانات |

PASSED: npm audit حديثًا لا يبلغ عن vulnerabilities. هذا فحص npm فقط، وليس شهادة شاملة لانعدام ثغرات C++ أو Android أو النموذج. لا نموذج خارجي يثبت دون size+SHA256 المعتمدين؛ لا RPC/server/OpenSSL داخل محرك الاستدلال. مصدر native مثبت ويُبنى من المصدر. مراجعة أمنية مستقلة شاملة وسلوك native على Samsung: NOT TESTED.
