# CP07 — سجل التراخيص والاعتماديات

التاريخ: 2026-11-20. لا يُعد هذا رأيًا قانونيًا؛ «REQUIRES LEGAL REVIEW» تعني أن قرار الاستخدام التجاري يحتاج محاميًا.

## 1. الكود

| المكوّن | الترخيص | الاستخدام التجاري | الالتزامات | Telemetry / خدمات خارجية | التصنيف |
|---|---|---|---|---|---|
| llama.cpp | MIT | مسموح | إبقاء نص الترخيص | لا (فحص كود الربط: لا تتبّع) | COMPATIBLE |
| node-llama-cpp 3.22.3 | MIT | مسموح | إبقاء الترخيص | لا (بحث في `dist` عن telemetry/posthog/sentry: لا نتائج). ينزّل ثنائيات من npm عند التثبيت فقط | COMPATIBLE |
| اعتماديات node-llama-cpp (124 حزمة) | MIT ×104، ISC ×13، BlueOak-1.0.0 ×6 (`tar`, `minipass`…)، (BSD-2/MIT/Apache) ×1 | مسموح | إسناد | لا | COMPATIBLE |
| Perplexica/Vane | MIT | مسموح | إسناد؛ لكنه يجلب SearxNG (AGPL) ومزودين سحابيين | نعم عند تفعيل مزودين | COMPATIBLE WITH CONDITIONS (غير مستخدم) |
| AiPaca | GPL-3.0-or-later | مسموح لكن **أي تطبيق يضمّن كوده يصبح GPL** | إتاحة المصدر الكامل | لا (حسب README) | REQUIRES LEGAL REVIEW (غير مستخدم) |
| LightRAG | MIT | مسموح | إسناد؛ الإعداد الافتراضي يتطلب مفاتيح OpenAI | نعم بالإعداد الافتراضي | COMPATIBLE WITH CONDITIONS (غير مستخدم) |
| SearXNG | AGPL-3.0 | مسموح بشروط | إتاحة المصدر لمستخدمي الشبكة عند التعديل؛ شروط المحركات المكشوطة | يرسل الاستعلامات لمحركات خارجية | REQUIRES LEGAL REVIEW (غير مستخدم) |
| SQLite FTS5 | Public domain | مسموح | — | لا | COMPATIBLE |

## 2. النماذج (منفصلة عن الكود)

المصدر: وسوم الترخيص في واجهة Hugging Face لكل مستودع + ملف LICENSE المرافق.

| النموذج | الملف المختبر | الحجم | SHA-256 | الترخيص | مقيّد (gated) | التصنيف |
|---|---|---|---|---|---|---|
| Qwen3-0.6B | `Qwen3-0.6B-Q8_0.gguf` | 639 MB | `9465e63a…3bb031` | Apache-2.0 | لا | COMPATIBLE |
| Qwen2.5-1.5B-Instruct | `qwen2.5-1.5b-instruct-q4_k_m.gguf` | 1.12 GB | `6a1a2eb6…e9407e` | Apache-2.0 | لا | COMPATIBLE |
| Qwen3-1.7B | `Qwen3-1.7B-Q8_0.gguf` | 1.83 GB | `061b54da…590cb1a` | Apache-2.0 | لا | COMPATIBLE |
| Qwen3-4B | `Qwen3-4B-Q4_K_M.gguf` | 2.50 GB | `7485fe6f…34fdf5` | Apache-2.0 | لا | COMPATIBLE |
| SmolLM3-3B | `SmolLM3-Q4_K_M.gguf` (ggml-org) | ≈1.9 GB | يُسجّل في تقرير القياس | Apache-2.0 (وسم `ar` موجود) | لا | COMPATIBLE |
| Qwen2.5-3B-Instruct | — | — | — | **other (Qwen Research License — غير تجاري)** | لا | INCOMPATIBLE (لم يُختبر) |
| Gemma-3-1B-it | — | — | — | Gemma Terms of Use + سياسة استخدام | **نعم** | REQUIRES LEGAL REVIEW (لم يُختبر؛ يحتاج حسابًا وقبول شروط) |
| Llama-3.2-1B-Instruct | — | — | — | Llama 3.2 Community License + AUP | **نعم** | REQUIRES LEGAL REVIEW (لم يُختبر) |
| Falcon-H1 0.5B/1.5B | — | — | — | other (TII Falcon License) | لا | REQUIRES LEGAL REVIEW (لم يُختبر) |
| SILMA-Kashif-2B (عربي) | — | — | — | Gemma | لا | REQUIRES LEGAL REVIEW (لم يُختبر) |

**ملاحظة:** «مفتوح الأوزان» ≠ «مفتوح المصدر» بالمعنى الكامل: بيانات تدريب Qwen وSmolLM غير منشورة بالكامل؛ الترخيص يغطي الأوزان فقط.

### الملحق: البصمات الكاملة
```
9465e63a22add5354d9bb4b99e90117043c7124007664907259bd16d043bb031  Qwen3-0.6B-Q8_0.gguf
6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e  qwen2.5-1.5b-instruct-q4_k_m.gguf
061b54daade076b5d3362dac252678d17da8c68f07560be70818cace6590cb1a  Qwen3-1.7B-Q8_0.gguf
7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5  Qwen3-4B-Q4_K_M.gguf
```
مستودعات HF (sha عند التنزيل): Qwen3-0.6B-GGUF `23749fefcc72` · Qwen2.5-1.5B-Instruct-GGUF `91cad51170dc` · Qwen3-1.7B-GGUF `90862c4b9d27` · Qwen3-4B-GGUF `bc640142c66e`.

## 3. المصادر العلمية (المحتوى)

انظر `CP07_SCIENTIFIC_SOURCE_AUDIT.md`. الخلاصة: لا نُسخ نصوص؛ روابط + ملخصات عربية أصلية مكتوبة للمشروع؛ PubMed بيانات وصفية فقط.

## 4. ما دخل المشروع الأساسي

لا اعتمادية جديدة في `package.json` الرئيسي. لا كود منسوخ من أي مشروع خارجي.
