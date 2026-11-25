# البحث والاختيار — VERIFIED / IMPLEMENTED

المصادر الأولية فُحصت عبر المستودعات الرسمية وملفات README والترخيص، ومصدر llama.cpp الفعلي بُني واختُبر. لا تعني قراءة المستندات قياس أداء المرشحين على Android.

| المستودع | ما تم فحصه | القرار |
|---|---|---|
| https://github.com/ggml-org/llama.cpp | المصدر، Android docs، C API، grammar sampler، MIT؛ بناء واستدلال حقيقي | اعتماد v1.0.0 عند b1b770d90d94cad9e9ea5b993bdbc383a522fb28 |
| https://github.com/google-ai-edge/LiteRT-LM | SDK Kotlin وCPU/GPU، مستندات البناء، Apache-2.0 | بديل صالح للبحث؛ يتطلب artifact مختلفًا وتكاملًا جديدًا؛ لم يقس محليًا |
| https://github.com/mlc-ai/mlc-llm | Android/model compilation، Apache-2.0 | غير معتمد؛ عبء TVM وتجهيز كل نموذج؛ أداء الجهاز غير مقاس |
| https://github.com/pytorch/executorch | mobile deployment وREADME والترخيص المخصص | غير معتمد؛ سلسلة تصدير وتحقق أوسع؛ لا ادعاء بتعارض الترخيص دون مراجعة كاملة |
| https://github.com/microsoft/onnxruntime | توثيق ORT Mobile وQwen/GenAI الأمثلة الرسمية | غير معتمد؛ artifact/export مختلفان؛ لا تفوق مقاس في هذا المشروع |
| https://github.com/tensai-app/llama.kt | Android JNI، مصدر llama.rn المرقع وسلسلة bootstrap، Apache-2.0 | موجود ومحدث؛ لم ينسخ؛ الجسر Java القائم أبسط من إدخال طبقات Kotlin/RN وترقيعات إضافية |
| https://github.com/gthgomez/PrismLocal | تطبيق Android كامل وRAG وApache-2.0 | موجود؛ لم يُنسخ تطبيق مستقل بدل تطبيقنا |
| https://github.com/Airuxn/Pocket-AI | تطبيق ARM64 وMIT وطرق الإصدار | موجود؛ لم يعتمد كبديل كامل للمعمارية |
| https://github.com/dojekon/AIPaca | Android runtime وGPL-3.0 | موجود؛ لم يُنسخ كود لتجنب التزامات توزيع لم يقررها المالك |
| https://github.com/Arindam200/awesome-ai-apps | فهرس RAG/agents وMIT | مصدر اكتشاف؛ خدمات Python/Cloud ليست اعتماد تشغيل للهاتف |

الأسماء المتشابهة ليست هويات فريدة؛ استُخدمت الروابط أعلاه صراحة. لم يُبنَ كل مرشح أو يُقَس. لا توجد نتيجة حسابية ملفقة للأوزان 25/20/15/15/10/5/5/5: السلامة والعربية والتوافق اختُبرت جزئيًا، لكن الهاتف والحرارة والطاقة لم تُقَس. الاختيار الحالي مرشح هندسي، لا إثبات للتفوق المطلق.

أُعيد استخدام البنية الناضجة للاستدلال والـgrammar sampler، وقاعدة SQLite والمستشار العلمي وfidelityCheck وCapacitor القائمة. الكود الخاص الجديد مقتصر على إدارة جلسة واحدة، تنزيل artifact معتمد، الجسر، وربط التحقق؛ لا قاعدة embeddings منفصلة ولا سيرفر Python أو Docker أو API سحابي للاستدلال.
