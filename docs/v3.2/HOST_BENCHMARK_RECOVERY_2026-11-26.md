# استعادة Host benchmark بعد فقد البيئة — 2026-11-26

الحالة الحالية: REPORTED للنتائج التاريخية أدناه؛ لم يُعَد تشغيل النموذج في البيئة المستعادة. فُقدت ملفات GGUF والـ native binary والسجلات الخام مع scratch؛ لا تُعد أسماء المسارات القديمة روابط تسليم. استُعيد runner من سجل التنفيذ مع تحسين رفض متابعة inference بعد موت العملية وحماية مجلد النتائج. يجب typecheck وتشغيل smoke جديد بعد استعادة التبعيات. لا يُدّعى أن المصدر المستعاد مطابق byte-for-byte للنسخة المفقودة.

## الأدلة التاريخية المتاحة في سجل المحادثة فقط

| التجربة | النتيجة التاريخية | النطاق |
|---|---|---|
| 2B قبل strict grammar | FAILED: رسائل tools كانت strings بدل objects ثم تجاوزت max4؛ رجوع حتمي بعد 52.66 ثانية ومحاولتين | رسالة development واحدة |
| 2B بعد strict grammar، قبل آخر تقوية validator | JSON صالح، ثم فشل تحقق القرار وbounded retry وfallback؛ 153046ms. لا نجزم بسبب التحقق التفصيلي بعد فقد السجلات الخام | رسالة واحدة مكتملة، أُوقفت بقية تجربة الأربع رسائل بـ Ctrl-C بعد حفظها |
| 4B بعد تقوية validator | clarification، JSON صالح، استدعاء واحد، 32350ms؛ native load2997.94ms وTTFT16875.68ms وgeneration29329.87ms و82tokens | رسالة development واحدة |
| 2B على نفس مصدر تجربة4B الأخيرة | بدأ التشغيل ولم يصل سجل نتيجة نهائية قبل فقد البيئة؛ NOT TESTED نهائيًا / interrupted | لا نتيجة قابلة للاستنتاج |
| parser negative probes | REPORTED PASSED5/5: malformedJSON، top-level[]، unknown task، max_tokens769، extra field | نفس عملية4B المحملة، دون generation إضافي |
| ablation | أربع رسائل عائلة واحدة، صفر model calls، fallback؛ فشل عقود plan/slots/tool observability | ليست مقارنة تاريخية كاملة مع V3.0 |

إجابة4B كانت استيضاحًا: «هل تعاني من جفاف شديد أو تشقق في الوجه بعد الغسل؟». scorer سجل intent/slots/tool_selection failures وgenuine completion0، لأن المرجع الهندسي لهذا السؤال كان يتوقع consultation وجفاف البشرة. هذا المرجع يحتاج مراجعة بشرية: الشد بعد الغسل لا يثبت نوع البشرة وحده، والاستيضاح قد يكون مناسبًا. لم نغير المرجع بعد النتيجة ولم نستخدم holdout. النتيجة ليست دليل تفوق أو فشل سريري لنموذج.

سجل المقارنة آنذاك أكد تطابق source_hashes وbinary SHA بين4B وتشغيل2B الأخير الذي لم ترد نتيجته. Native binary وmodel identity ليسا إثبات تشغيل Android. لا يوجد قبول Samsung أو نسب ذكاء ممثلة إحصائيًا. n=1 لا يجيز اختيار فائز أو خفض بوابات القبول.

## هوية النماذج التاريخية

- 2B: Qwen3.5-2B GGUF Q4_K_M، hash حسب `native/model-manifest.json`؛ تحقق فعليًا قبل التشغيل التاريخي.
- 4B: Qwen3.5-4B Q4_K_M، revision `e87f176479d0855a907a41277aca2f8ee7a09523`، size2740937888، SHA-256 `00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4`؛ تحقق فعليًا تاريخيًا، وليس معاد التحقق الآن.

## الاستئناف القابل للتنفيذ

بعد استعادة runtime والنماذج الموثقة فقط:

```sh
node --import tsx scripts/intelligence-benchmark-run.ts --candidate 2b --limit 1 --out artifacts/v3.2/recovered-2b-smoke
node --import tsx scripts/intelligence-benchmark-run.ts --candidate 4b --model ../toolchain/qwen35-4b.gguf --limit 1 --parser-probes --out artifacts/v3.2/recovered-4b-smoke
```

لا تشغل العمليتين بالتوازي. runner يسمح development/model_selection فقط ويرفض final_holdout وvalidation. احفظ وادفع السجلات الخام مباشرة بعد كل رسالة. يجب عدم إعادة استخدام مجلد نتيجة قائم. لقطة world للهوية والتوفر تأتي من DB والأدوات الفعلية؛ fallback القديم يفتقر إلى trace استرجاع مستقل، فلا تُفسَّر نتيجة grounding غير القابلة للإثبات باعتبارها حكمًا على صحة seed العلمية.

## تحقق جديد بعد الاستعادة

VERIFIED: `node --import tsx scripts/intelligence-benchmark-run.ts --mode ablation --limit 1` نفذ فعلًا في2026-11-26: رسالة واحدة، deterministic_fallback،48ms، صفر استدعاءات نموذج. حفظت لقطة DB والخرج وscorer في `benchmark-recovery-evidence/`. بقيت عقود intent/slots/tool_selection/grounding غير محققة لمسار fallback وفق حدود instrumentation الموضحة. هذا يثبت تكامل runner مع المصدر المستعاد فقط؛ لا يثبت inference جديدًا ولا جودة علمية أو لغوية.


## تصحيح سبب فشل التشغيل الجديد

الأدلة الخام الجديدة في `evidence/host2b-recovered-smoke/` تسجل `fallback_reason: unobserved_product`. بعض معرفات الادعاءات التي بدت غريبة كانت موجودة فعلًا في نتائج أداة الاسترجاع؛ لا يصح وصفها بأنها مختلقة لمجرد شكل معرفاتها. الفشل الجديد يتعلق باختيار منتج غير مشاهد، ولا يبرر حكمًا عامًا بأن كل مصادر القرار مختلقة. عدد native generation responses الفعلي3، بينما عدّاد داخل الرد سجل6؛ observations يعتمد العدد الفعلي المستقل3.
